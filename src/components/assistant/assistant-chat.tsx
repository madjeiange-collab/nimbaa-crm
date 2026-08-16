'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mic, Send, Square, Loader2, Sparkles } from 'lucide-react';
import { useDictation } from '@/hooks/use-dictation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Message = { role: 'user' | 'assistant'; content: string };

export function AssistantChat() {
  const t = useTranslations('assistant');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dictation = useDictation((text) => {
    setInput((prev) => (prev ? prev + ' ' + text : text));
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setNotice(null);
    setInput('');
    const next: Message[] = [...messages, { role: 'user', content: question }];
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
        return;
      }
      if (res.status === 503) {
        setNotice(t('notConfigured'));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { text: string };
      setMessages((prev) => [...prev, { role: 'assistant', content: data.text }]);
    } catch {
      setNotice(t('error'));
    } finally {
      setPending(false);
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
                  onClick={() => void send(s)}
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

        {notice && (
          <p role="alert" className="text-center text-sm font-medium text-destructive">
            {notice}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form
        className="flex items-end gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Button
          type="button"
          variant={dictation.status === 'recording' ? 'destructive' : 'outline'}
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={dictation.toggle}
          disabled={dictation.status === 'processing' || dictation.status === 'unsupported'}
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
              void send(input);
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
