'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';

export type DictationStatus = 'idle' | 'recording' | 'processing' | 'error' | 'unsupported';

export interface DictationOptions {
  /**
   * Voice-mode behaviour: stop automatically after ~2s of silence once the
   * user has spoken (plus a 30s hard cap). Without it, recording stops only
   * on tap.
   */
  autoStop?: boolean;
  /**
   * Show words as they are spoken. On by default; pass false where there is
   * no field to draw them into.
   */
  live?: boolean;
}

const SILENCE_MS = 2000;
const MAX_RECORDING_MS = 30_000;
/** RMS levels (0..1) — speech well above, ambient noise below. */
const SPEECH_RMS = 0.02;
const SILENCE_RMS = 0.012;

// --- Web Speech API ----------------------------------------------------------
// Not in lib.dom, and the vendor-prefixed name is still the only one Safari
// answers to. Only the handful of members we touch are typed.
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Nothing to be gained by retrying these — the live layer is simply not available. */
const FATAL_SPEECH_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

/**
 * What a note field shows mid-dictation: what is already written, then what is
 * being said. The trailing ellipsis is the tell that the tail is still provisional
 * — the transcript replaces it when the mic stops.
 */
export function withLivePreview(saved: string, interim: string): string {
  if (!interim) return saved;
  return `${saved ? saved + ' ' + interim : interim} …`;
}

/**
 * Voice dictation in two layers.
 *
 * The recording is still what counts: mic audio goes to /api/transcribe, whose
 * prompt biases the model toward how the field actually talks — FCFA, RDV,
 * Cocody, Yopougon. That transcript is the one written to the note.
 *
 * On top of it the browser's own recogniser runs purely for the eyes, so words
 * appear while they are being said instead of after. It is allowed to be
 * wrong and allowed to be missing: `interim` is a preview that the transcript
 * replaces on stop, and if the recogniser refuses to start — older Android
 * builds hand the mic to one consumer at a time — dictation carries on
 * without it.
 *
 * Requires HTTPS (same constraint as the camera/GPS check-in).
 */
export function useDictation(onResult: (text: string) => void, options?: DictationOptions) {
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [interim, setInterim] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const locale = useLocale();
  const speechLang = locale === 'en' ? 'en-US' : 'fr-FR';

  // --- live preview ----------------------------------------------------------
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** Settled phrases so far this take; the interim tail is appended for display. */
  const settledRef = useRef('');
  /** True between start() and stop() — tells onend whether a restart is wanted. */
  const wantLiveRef = useRef(false);

  const stopLive = useCallback(() => {
    wantLiveRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      // already gone
    }
  }, []);

  const startLive = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    settledRef.current = '';
    wantLiveRef.current = true;

    const spin = () => {
      let rec: SpeechRecognitionLike;
      try {
        rec = new Ctor();
      } catch {
        wantLiveRef.current = false;
        return;
      }
      rec.lang = speechLang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (e) => {
        let tail = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const text = r[0]?.transcript ?? '';
          if (r.isFinal) settledRef.current = (settledRef.current + ' ' + text).trim();
          else tail += text;
        }
        setInterim((settledRef.current + ' ' + tail).trim());
      };
      rec.onerror = (e) => {
        // 'no-speech' and 'aborted' are ordinary; only the fatal ones end the
        // preview. Either way the recording is untouched.
        if (FATAL_SPEECH_ERRORS.has(e.error)) wantLiveRef.current = false;
      };
      rec.onend = () => {
        // Android ends the session at every pause. Pick it back up while the
        // recorder is still running, so one long note stays one dictation.
        if (wantLiveRef.current && recognitionRef.current === rec) spin();
      };

      recognitionRef.current = rec;
      try {
        rec.start();
      } catch {
        // Mic already claimed, or a session was still closing — the note is
        // unaffected, so let it go rather than retry into a loop.
        wantLiveRef.current = false;
        recognitionRef.current = null;
      }
    };

    spin();
  }, [speechLang]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4' // iOS Safari
          : '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      // --- silence auto-stop (voice mode) ---------------------------------
      let audioCtx: AudioContext | null = null;
      let meterTimer: ReturnType<typeof setInterval> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;
      if (options?.autoStop && typeof AudioContext !== 'undefined') {
        try {
          audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          const buf = new Float32Array(analyser.fftSize);
          let spoke = false;
          let silentSince = 0;
          meterTimer = setInterval(() => {
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            const rms = Math.sqrt(sum / buf.length);
            const now = Date.now();
            if (rms >= SPEECH_RMS) {
              spoke = true;
              silentSince = 0;
            } else if (spoke && rms < SILENCE_RMS) {
              if (!silentSince) silentSince = now;
              else if (now - silentSince >= SILENCE_MS) {
                if (rec.state !== 'inactive') rec.stop();
              }
            } else {
              silentSince = 0;
            }
          }, 150);
          maxTimer = setTimeout(() => {
            if (rec.state !== 'inactive') rec.stop();
          }, MAX_RECORDING_MS);
        } catch {
          // metering unavailable — fall back to tap-to-stop
        }
      }
      cleanupRef.current = () => {
        if (meterTimer) clearInterval(meterTimer);
        if (maxTimer) clearTimeout(maxTimer);
        void audioCtx?.close().catch(() => undefined);
        stream.getTracks().forEach((t) => t.stop());
      };

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        cleanupRef.current?.();
        cleanupRef.current = null;
        stopLive();
        setStatus('processing');
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          if (blob.size < 2000) {
            // nothing meaningful was recorded (instant stop / pure silence)
            setInterim('');
            setStatus('idle');
            return;
          }
          const ext = (rec.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
          const form = new FormData();
          form.append('audio', new File([blob], `dictation.${ext}`, { type: blob.type }));
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          if (!res.ok) throw new Error(String(res.status));
          const { text } = (await res.json()) as { text: string };
          // Preview and note swap in the same tick, so the words never blink out.
          setInterim('');
          setStatus('idle');
          if (text?.trim()) onResultRef.current(text.trim());
        } catch {
          setInterim('');
          setStatus('error');
        }
      };
      recorderRef.current = rec;
      rec.start();
      setStatus('recording');
      if (options?.live !== false) startLive();
    } catch {
      // permission denied or no mic
      setStatus('error');
    }
  }, [options?.autoStop, options?.live, startLive, stopLive]);

  const toggle = useCallback(() => {
    if (status === 'recording') stop();
    else if (status !== 'processing') void start();
  }, [status, start, stop]);

  // Leaving the screen mid-dictation must not leave the mic open.
  useEffect(
    () => () => {
      stopLive();
      cleanupRef.current?.();
    },
    [stopLive],
  );

  return { status, start, stop, toggle, interim };
}
