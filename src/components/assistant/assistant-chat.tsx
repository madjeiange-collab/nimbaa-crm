'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Mic,
  Send,
  Square,
  Loader2,
  Sparkles,
  Headphones,
  Volume2,
} from 'lucide-react';
import { useDictation } from '@/hooks/use-dictation';
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
      else setInput((prev) => (prev ? prev + ' ' + text : text));
    },
    { autoStop: voiceMode },
  );
  // Keep a stable handle for restarting the mic from async code.
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending, speaking]);

  /** Core ask: sends a question, updates the thread, returns the reply. */
  async function ask(question: string): Promise<string | null> {
    const q = question.trim();
    if (!q || pending) return null;
    setNotice(null);
    const next: Message[] = [...messagesRef.current, { role: 'user', content: q }];
    messagesRef.current = next;
    setMessages(next);
    setPending(true);
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
      const data = (await res.json()) as { text: string };
      messagesRef.current = [...messagesRef.current, { role: 'assistant', content: data.text }];
      setMessages(messagesRef.current);
      return data.text;
    } catch {
      setNotice(t('error'));
      return null;
    } finally {
      setPending(false);
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

        {pending && (
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
            <Headphones className="h-4 w-4" />
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
          <Headphones className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant={dictation.status === 'recording' ? 'destructive' : 'outline'}
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={dictation.toggle}
          disabled={
            voiceMode ||
            dictation.status === 'processing' ||
            dictation.status === 'unsupported'
          }
          aria-label={t('dictate')}
        >
          {dictation.status === 'recording' ? (
            <Square className="h-5 w-5" />
          ) : dictation.status === 'processing' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </Button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
