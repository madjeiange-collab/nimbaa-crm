'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mic, Send, Loader2, Sparkles, Volume2 } from 'lucide-react';
import { useDictation, withLivePreview } from '@/hooks/use-dictation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Message = { role: 'user' | 'assistant'; content: string };

/** Tiny silent wav — played on the voice-mode tap to unlock audio playback
 *  for the later (async) TTS replies on mobile browsers. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export function AssistantChat() {
  const t = useTranslations('assistant');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const voiceModeRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const dictation = useDictation(
    (text) => {
      if (voiceModeRef.current) void voiceTurn(text);
    },
    { autoStop: true },
  );
  // Keep a stable handle for restarting the mic from async code.
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending, speaking]);

  /**
   * Core ask: sends a question and streams the reply (NDJSON deltas) into a
   * growing assistant bubble, so text appears as it is generated. Returns the
   * full reply once the stream ends (used by voice mode for TTS).
   */
  async function ask(question: string): Promise<string | null> {
    const q = question.trim();
    if (!q || pending) return null;
    setNotice(null);
    const next: Message[] = [...messagesRef.current, { role: 'user', content: q }];
    messagesRef.current = next;
    setMessages(next);
    setPending(true);
    setStreaming(false);
    let acc = '';
    let failed = false;

    const applyDelta = (delta: string) => {
      const wasEmpty = acc === '';
      acc += delta;
      if (wasEmpty) {
        messagesRef.current = [...messagesRef.current, { role: 'assistant', content: acc }];
        setStreaming(true);
      } else {
        messagesRef.current = [
          ...messagesRef.current.slice(0, -1),
          { role: 'assistant', content: acc },
        ];
      }
      setMessages(messagesRef.current);
    };
    const handleLine = (line: string) => {
      let evt: { d?: string; tool?: string; done?: boolean; error?: string };
      try {
        evt = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof evt.d === 'string') applyDelta(evt.d);
      else if (evt.error) failed = true;
    };

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      if (res.status === 429) {
        setNotice(t('quotaReached'));
        return null;
      }
      if (res.status === 503) {
        setNotice(t('notConfigured'));
        return null;
      }
      if (!res.ok) throw new Error(String(res.status));

      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf('\n');
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) handleLine(line);
            nl = buf.indexOf('\n');
          }
        }
        if (buf.trim()) handleLine(buf.trim());
      } else {
        // Very old browsers without stream reading: take the body at once.
        (await res.text()).split('\n').forEach((l) => l.trim() && handleLine(l.trim()));
      }

      if (failed && !acc) throw new Error('ai_error');
      if (!acc) {
        applyDelta(t('emptyReply'));
        return null;
      }
      if (failed) setNotice(t('error'));
      return acc;
    } catch {
      setNotice(t('error'));
      return null;
    } finally {
      setPending(false);
      setStreaming(false);
    }
  }

  /** Voice mode: speak the reply aloud, then reopen the mic. */
  async function voiceTurn(question: string) {
    const reply = await ask(question);
    if (!reply || !voiceModeRef.current) return;
    try {
      setSpeaking(true);
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply }),
      });
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = url;
        await audio.play().catch(() => undefined);
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
        });
        URL.revokeObjectURL(url);
      }
    } finally {
      setSpeaking(false);
    }
    // Their turn again — reopen the mic if voice mode is still on.
    if (voiceModeRef.current) void dictationRef.current.start();
  }

  function toggleVoiceMode() {
    const next = !voiceMode;
    setVoiceMode(next);
    voiceModeRef.current = next;
    setNotice(null);
    if (next) {
      // Unlock mobile audio playback within this user gesture.
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = SILENT_WAV;
      void audio.play().catch(() => undefined);
      void dictationRef.current.start();
    } else {
      dictationRef.current.stop();
      audioRef.current?.pause();
      setSpeaking(false);
    }
  }

  const suggestions = [t('suggestion1'), t('suggestion2'), t('suggestion3')];

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-3xl flex-col p-4">
      {/* Conversation */}
      <div className="flex-1 space-y-3 overflow-y-auto pb-3">
        {messages.length === 0 && (
          <Card className="space-y-3 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              {t('welcomeTitle')}
            </p>
            <p className="text-sm text-muted-foreground">{t('welcomeHint')}</p>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </Card>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
              m.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'mr-auto border bg-card'
            }`}
          >
            {m.content}
          </div>
        ))}

        {pending && !streaming && (
          <div className="mr-auto flex items-center gap-2 rounded-2xl border bg-card px-4 py-2.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('thinking')}
          </div>
        )}
        {speaking && (
          <div className="mr-auto flex items-center gap-2 rounded-2xl border bg-card px-4 py-2.5 text-sm text-muted-foreground">
            <Volume2 className="h-4 w-4 animate-pulse text-primary" />
            {t('speaking')}
          </div>
        )}

        {notice && (
          <p role="alert" className="text-center text-sm font-medium text-destructive">
            {notice}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Voice-mode banner */}
      {voiceMode && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
          <span className="flex items-center gap-2">
            <Mic className={`h-4 w-4 ${dictation.status === 'recording' ? 'animate-pulse' : ''}`} />
            {dictation.status === 'recording'
              ? t('listening')
              : dictation.status === 'processing' || pending
                ? t('thinking')
                : speaking
                  ? t('speaking')
                  : t('voiceModeOn')}
          </span>
          <button type="button" onClick={toggleVoiceMode} className="underline">
            {t('voiceModeStop')}
          </button>
        </div>
      )}

      {/* Composer */}
      <form
        className="flex items-end gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
          setInput('');
        }}
      >
        <Button
          type="button"
          variant={voiceMode ? 'default' : 'outline'}
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={toggleVoiceMode}
          disabled={dictation.status === 'unsupported'}
          aria-label={t('voiceMode')}
          title={t('voiceMode')}
        >
          <Mic
            className={`h-5 w-5 ${
              voiceMode && dictation.status === 'recording' ? 'animate-pulse' : ''
            }`}
          />
        </Button>
        <textarea
          // Voice mode sends the transcript straight to the assistant, so the
          // words show here only to confirm what was heard.
          value={withLivePreview(input, dictation.interim)}
          onChange={(e) => setInput(e.target.value)}
          readOnly={!!dictation.interim}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
              setInput('');
            }
          }}
          placeholder={
            dictation.status === 'recording' ? t('listening') : t('placeholder')
          }
          rows={1}
          className="max-h-32 min-h-[44px] flex-1 resize-y rounded-md border border-input bg-background px-3 py-2.5 text-base"
        />
        <Button
          type="submit"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={pending || !input.trim()}
          aria-label={t('send')}
        >
          <Send className="h-5 w-5" />
        </Button>
      </form>
      {dictation.status === 'error' && (
        <p className="mt-1 text-xs text-destructive">{t('micError')}</p>
      )}
    </div>
  );
}
