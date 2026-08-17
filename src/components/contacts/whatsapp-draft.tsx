'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, Loader2, MessageCircle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * "Brouillon IA" — drafts a WhatsApp follow-up from the contact's real
 * history, lets the rep edit it, then opens WhatsApp with the text prefilled.
 */
export function WhatsappDraft({ contactId, phone }: { contactId: string; phone: string }) {
  const t = useTranslations('contacts');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
      if (res.status === 429) {
        setError(t('draftQuota'));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { text: string };
      setDraft(data.text);
      setOpen(true);
    } catch {
      setError(t('draftError'));
    } finally {
      setLoading(false);
    }
  }

  const waHref = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(draft)}`;

  if (!open) {
    return (
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t('draftButton')}
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="space-y-2 pt-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          {t('draftTitle')}
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-touch flex-1 items-center justify-center gap-1.5 rounded-md bg-knock-green px-4 py-2 text-sm font-medium text-white"
          >
            <MessageCircle className="h-4 w-4" />
            {t('draftOpen')}
          </a>
          <Button variant="outline" size="sm" onClick={() => void generate()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label={t('draftClose')}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
