'use client';

import { useCallback, useRef, useState } from 'react';

export type DictationStatus = 'idle' | 'recording' | 'processing' | 'error' | 'unsupported';

export interface DictationOptions {
  /**
   * Voice-mode behaviour: stop automatically after ~2s of silence once the
   * user has spoken (plus a 30s hard cap). Without it, recording stops only
   * on tap.
   */
  autoStop?: boolean;
}

const SILENCE_MS = 2000;
const MAX_RECORDING_MS = 30_000;
/** RMS levels (0..1) — speech well above, ambient noise below. */
const SPEECH_RMS = 0.02;
const SILENCE_RMS = 0.012;

/**
 * Voice dictation: records mic audio (MediaRecorder) and sends it to
 * /api/transcribe. `onResult` receives the transcript text.
 * Requires HTTPS (same constraint as the camera/GPS check-in).
 */
export function useDictation(onResult: (text: string) => void, options?: DictationOptions) {
  const [status, setStatus] = useState<DictationStatus>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

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
        setStatus('processing');
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          if (blob.size < 2000) {
            // nothing meaningful was recorded (instant stop / pure silence)
            setStatus('idle');
            return;
          }
          const ext = (rec.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
          const form = new FormData();
          form.append('audio', new File([blob], `dictation.${ext}`, { type: blob.type }));
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          if (!res.ok) throw new Error(String(res.status));
          const { text } = (await res.json()) as { text: string };
          setStatus('idle');
          if (text?.trim()) onResultRef.current(text.trim());
        } catch {
          setStatus('error');
        }
      };
      recorderRef.current = rec;
      rec.start();
      setStatus('recording');
    } catch {
      // permission denied or no mic
      setStatus('error');
    }
  }, [options?.autoStop]);

  const toggle = useCallback(() => {
    if (status === 'recording') stop();
    else if (status !== 'processing') void start();
  }, [status, start, stop]);

  return { status, start, stop, toggle };
}
