'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, History } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ContactEvent } from '@/lib/contacts/events';

/**
 * What has been changed ON the fiche — as opposed to the Historique above it,
 * which is what happened AT the customer.
 *
 * Folded shut: it is a reference you consult when a figure looks wrong, not
 * something you read on the way past.
 */
export function ContactJournal({
  events,
  names,
}: {
  events: ContactEvent[];
  names: Record<string, string>;
}) {
  const t = useTranslations('contactJournal');
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;

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
            {t('count', { n: events.length })}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <ol className="ml-5 space-y-0 border-l-2 border-border pl-3 pr-4 pb-3">
            {events.map((e) => {
              const who = e.actor_id ? (names[e.actor_id] ?? null) : null;
              // A from → to reads best when both halves exist; a creation or an
              // import has only the fact itself.
              const body =
                e.kind === 'created' || e.kind === 'imported'
                  ? e.to_label
                    ? t(`k_${e.kind}WithPin` as never, { pin: e.to_label })
                    : t(`k_${e.kind}` as never)
                  : e.from_label
                    ? `${e.from_label} → ${e.to_label ?? '—'}`
                    : `→ ${e.to_label ?? '—'}`;
              return (
                <li key={e.id} className="py-0.5 text-xs">
                  <span className="text-muted-foreground">{when(e.at)}</span>{' '}
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(`f_${e.kind}` as never)}
                  </span>{' '}
                  <span className="break-words">{body}</span>
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
