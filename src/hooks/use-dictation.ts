'use client';

import { useCallback, useRef, useState } from 'react';

export type DictationStatus = 'idle' | 'recording' | 'processing' | 'error' | 'unsupported';

/**
 * Voice dictation: records mic audio (MediaRecorder) and sends it to
 * /api/transcribe. `onResult` receives the transcript text.
 * Requires HTTPS (same constraint as the camera/GPS check-in).
 */
export function useDictation(onResult: (text: string) => void) {
  const [status, setStatus] = useState<DictationStatus>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setStatus('processing');
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          const ext = (rec.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
          const form = new FormData();
          form.append('audio', new File([blob], `dictation.${ext}`, { type: blob.type }));
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          if (!res.ok) throw new Error(String(res.status));
          const { text } = (await res.json()) as { text: string };
          if (text?.trim()) onResult(text.trim());
          setStatus('idle');
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
  }, [onResult]);

  const toggle = useCallback(() => {
    if (status === 'recording') stop();
    else if (status !== 'processing') void start();
  }, [status, start, stop]);

  return { status, start, stop, toggle };
}
