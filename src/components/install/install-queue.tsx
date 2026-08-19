'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, MapPin, Search, Wrench, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { INSTALL_STATUS_BADGE, INSTALL_STATUS_BY_KEY } from '@/lib/installations/protocol';
import type { InstallStatus } from '@/types/database';

export interface QueueJob {
  id: string;
  title: string | null;
  status: InstallStatus;
  scheduledDate: string | null;
  nextVisitDate: string | null;
  installerId: string | null;
  installerName: string | null;
  contactName: string | null;
  address: string | null;
  /** The commercial who owns the customer — not the technician on the job. */
  repId: string | null;
  territoryId: string | null;
}

/**
 * Accent- and case-blind. On this keyboard "Supérette" is as likely to be
 * typed "superette", and a queue search that misses on an accent is a search
 * nobody uses twice.
 */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function InstallQueue({
  jobs,
  reps,
  territories,
  currentUserId,
  showOwner,
}: {
  jobs: QueueJob[];
  reps: { id: string; name: string }[];
  territories: { id: string; name: string }[];
  currentUserId: string;
  /** The technician's team view names who holds each job. */
  showOwner: boolean;
}) {
  const t = useTranslations('installation');
  const tStatus = useTranslations('installation.status');
  const [q, setQ] = useState('');
  const [rep, setRep] = useState('');
  const [terr, setTerr] = useState('');

  const shown = useMemo(() => {
    const needle = fold(q.trim());
    return jobs.filter((j) => {
      if (rep && j.repId !== rep) return false;
      if (terr && j.territoryId !== terr) return false;
      if (!needle) return true;
      // One box over everything you might remember: the shop, what the job is,
      // and where it is. Typing "cocody four" finds the bakery.
      const hay = fold([j.contactName, j.title, j.address, j.installerName].filter(Boolean).join(' '));
      return needle.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [jobs, q, rep, terr]);

  const filtering = !!(q.trim() || rep || terr);
  const sel = 'flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm';

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('queueSearch')}
            className="pl-9 pr-9"
            aria-label={t('queueSearch')}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label={t('queueClear')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {(reps.length > 0 || territories.length > 0) && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {reps.length > 0 && (
              <select
                value={rep}
                onChange={(e) => setRep(e.target.value)}
                aria-label={t('queueAllReps')}
                className={sel}
              >
                <option value="">{t('queueAllReps')}</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            {territories.length > 0 && (
              <select
                value={terr}
                onChange={(e) => setTerr(e.target.value)}
                aria-label={t('queueAllTerritories')}
                className={sel}
              >
                <option value="">{t('queueAllTerritories')}</option>
                {territories.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {filtering && (
          <p className="px-0.5 text-xs text-muted-foreground">
            {t('queueShowing', { n: shown.length, total: jobs.length })}
          </p>
        )}
      </div>

      {shown.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
          <Wrench className="h-8 w-8 opacity-40" />
          <p className="text-sm">{filtering ? t('queueNoMatch') : t('queueEmpty')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((job) => {
            const meta = INSTALL_STATUS_BY_KEY[job.status];
            const when = job.nextVisitDate ?? job.scheduledDate;
            return (
              <Link key={job.id} href={`/install/new?job=${job.id}`} className="block">
                <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-accent">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Wrench className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold leading-tight">{job.contactName ?? '—'}</p>
                    {job.title && (
                      <p className="truncate text-xs text-muted-foreground">{job.title}</p>
                    )}
                    {job.address && (
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {job.address}
                      </p>
                    )}
                    {when && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarClock className="h-3 w-3 shrink-0" />
                        {when}
                      </p>
                    )}
                    {showOwner && (
                      <p className="mt-0.5 text-xs">
                        {job.installerId === currentUserId ? (
                          <span className="font-medium text-primary">{t('scopeMine')}</span>
                        ) : job.installerName ? (
                          <span className="text-muted-foreground">{job.installerName}</span>
                        ) : (
                          <span className="font-medium text-brand-brown">{t('unassigned')}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                      INSTALL_STATUS_BADGE[meta.color]
                    }`}
                  >
                    {tStatus(meta.i18n)}
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
