'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, History } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ContactEvent } from '@/lib/contacts/events';
import type { DealEvent } from '@/lib/deals/events';

/**
 * What has been changed ON the fiche — as opposed to the Historique above it,
 * which is what happened AT the customer.
 *
 * Folded shut: it is a reference you consult when a figure looks wrong, not
 * something you read on the way past.
 */
export function ContactJournal({
  events,
  removed = [],
  names,
}: {
  events: ContactEvent[];
  /** Journal lines of affaires that no longer exist — they have no card left. */
  removed?: DealEvent[];
  names: Record<string, string>;
}) {
  const t = useTranslations('contactJournal');
  const [open, setOpen] = useState(false);

  type Line = {
    id: string;
    at: string;
    actor_id: string | null;
    field: string;
    body: string;
    gone?: string | null;
  };
  const lines: Line[] = [
    ...events.map((e) => ({
      id: e.id,
      at: e.at,
      actor_id: e.actor_id,
      field: t(`f_${e.kind}` as never),
      body:
        e.kind === 'created' || e.kind === 'imported'
          ? e.to_label
            ? t(`k_${e.kind}WithPin` as never, { pin: e.to_label })
            : t(`k_${e.kind}` as never)
          : e.from_label
            ? `${e.from_label} → ${e.to_label ?? '—'}`
            : `→ ${e.to_label ?? '—'}`,
    })),
    ...removed.map((e) => ({
      id: e.id,
      at: e.at,
      actor_id: e.actor_id,
      field: t('f_removedDeal'),
      body: e.from_label ? `${e.from_label} → ${e.to_label ?? '—'}` : (e.to_label ?? t(`d_${e.kind}` as never)),
      gone: e.deal_title,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  if (lines.length === 0) return null;

  const when = (iso: string) =>
    new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Abidjan',
    }).format(new Date(iso));

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t('title')}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {t('count', { n: lines.length })}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <ol className="ml-5 space-y-0 border-l-2 border-border pl-3 pr-4 pb-3">
            {lines.map((l) => {
              const who = l.actor_id ? (names[l.actor_id] ?? null) : null;
              return (
                <li key={l.id} className="py-0.5 text-xs">
                  <span className="text-muted-foreground">{when(l.at)}</span>{' '}
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {l.field}
                  </span>{' '}
                  <span className="break-words">{l.body}</span>
                  {l.gone && (
                    <span className="text-muted-foreground"> · {t('onRemoved', { name: l.gone })}</span>
                  )}
                  {who && <span className="text-muted-foreground"> · {who}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
