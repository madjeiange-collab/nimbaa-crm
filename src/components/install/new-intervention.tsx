'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Wrench } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { createIntervention, type InterventionOrigin } from '@/lib/installations/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

const ORIGINS: InterventionOrigin[] = ['service', 'warranty', 'maintenance'];

/**
 * Open a job that no sale produced. Deliberately reachable by technicians as
 * well as commercials: whoever hears about the fault can raise it.
 */
export function NewIntervention({
  contacts,
  technicians,
  selfId,
  presetContactId = null,
}: {
  contacts: { id: string; name: string | null; address: string | null }[];
  technicians: { id: string; name: string }[];
  selfId: string;
  presetContactId?: string | null;
}) {
  const t = useTranslations('intervention');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [contactId, setContactId] = useState<string | null>(presetContactId);
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<InterventionOrigin>('service');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState('');
  const [assignee, setAssignee] = useState(selfId);
  const [error, setError] = useState<string | null>(null);

  const chosen = contacts.find((c) => c.id === contactId) ?? null;
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts.slice(0, 40);
    return contacts.filter((c) => (c.name ?? '').toLowerCase().includes(q)).slice(0, 25);
  }, [query, contacts]);

  const effectiveTitle = title.trim() || t(`origin_${origin}`);
  const canSave = !!contactId && !isPending;

  function submit() {
    if (!canSave || !contactId) return;
    setError(null);
    startTransition(async () => {
      const res = await createIntervention({
        contactId,
        origin,
        title: effectiveTitle,
        reason: reason.trim() || null,
        scheduledDate: when || null,
        assignedTo: assignee || null,
      });
      if (res.ok) router.push(`/install/new?job=${res.installationId}`);
      else setError(t('saveError'));
    });
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 pb-28">
      <Card className="space-y-3 p-4">
        <p className="text-sm font-semibold">{t('customer')}</p>
        {chosen ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-primary/10 px-3 py-2">
            <span className="truncate text-sm font-medium text-primary">{chosen.name ?? '—'}</span>
            {!presetContactId && (
              <button
                type="button"
                onClick={() => setContactId(null)}
                className="shrink-0 text-xs text-muted-foreground underline"
              >
                {t('change')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchCustomer')}
                className="pl-8"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {results.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t('noMatch')}</p>
              ) : (
                results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setContactId(c.id)}
                    className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent"
                  >
                    <span className="text-sm">{c.name ?? '—'}</span>
                    {c.address && (
                      <span className="text-xs text-muted-foreground">{c.address}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-4">
        <div className="space-y-2">
          <Label>{t('type')}</Label>
          <div className="grid grid-cols-3 gap-2">
            {ORIGINS.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOrigin(o)}
                className={`min-h-touch rounded-lg border px-2 text-sm font-medium ${
                  origin === o
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background'
                }`}
              >
                {t(`origin_${o}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="i-title">{t('title')}</Label>
          <Input
            id="i-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t(`origin_${origin}`)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="i-reason">{t('reason')}</Label>
          <textarea
            id="i-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reasonPlaceholder')}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="i-date">{t('when')}</Label>
          <Input id="i-date" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>

        {technicians.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="i-tech">{t('assignee')}</Label>
            <select
              id="i-tech"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {technicians.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t('noSaleHint')}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button size="xl" className="w-full" onClick={submit} disabled={!canSave}>
            <Wrench className="mr-2 h-5 w-5" />
            {isPending ? t('creating') : t('create')}
          </Button>
        </div>
      </div>
    </main>
  );
}
