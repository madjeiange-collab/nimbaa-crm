import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CalendarClock, MapPin, Wrench } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { StatTile } from '@/components/charts/stat-tile';
import { Card } from '@/components/ui/card';
import {
  INSTALL_STATUS_BADGE,
  INSTALL_STATUS_BY_KEY,
  OPEN_INSTALL_STATUSES,
} from '@/lib/installations/protocol';
import type { InstallStatus } from '@/types/database';

interface JobRow {
  id: string;
  title: string | null;
  status: InstallStatus;
  scheduled_date: string | null;
  next_visit_date: string | null;
  contact_id: string;
  installer_id: string | null;
  contacts: { id: string; name: string | null; address: string | null } | null;
  installer: { full_name: string | null; username: string | null } | null;
}

export default async function InstallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { locale } = await params;
  const { scope: scopeParam } = await searchParams;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('installation');
  const tStatus = await getTranslations('installation.status');

  const isManager = user.role === 'manager' || user.role === 'admin';
  const supabase = await createClient();

  const now = new Date();
  const startOfWeek = new Date(now.getTime() - 7 * 864e5);

  // Open jobs (queue). Technicians land on THEIR jobs; the toggle widens to
  // every open job (to take over or help out). Managers always see all.
  const scope: 'mine' | 'all' = isManager || scopeParam === 'all' ? 'all' : 'mine';
  let jobsQuery = supabase
    .from('installations')
    .select(
      'id, title, status, scheduled_date, next_visit_date, contact_id, installer_id, contacts(id, name, address), installer:users!installer_id(full_name, username)',
    )
    .in('status', OPEN_INSTALL_STATUSES)
    .order('scheduled_date', { ascending: true, nullsFirst: false });
  if (scope === 'mine') jobsQuery = jobsQuery.eq('installer_id', user.id);

  const { data: rawJobs } = await jobsQuery;
  const jobs = (rawJobs ?? []) as unknown as JobRow[];

  // Completed this week (for the technician's own tally / whole team for managers).
  let doneQuery = supabase
    .from('installations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'done')
    .gte('completed_at', startOfWeek.toISOString());
  if (!isManager) doneQuery = doneQuery.eq('installer_id', user.id);
  const { count: doneWeek } = await doneQuery;

  const pending = jobs.length;
  const revisits = jobs.filter((j) => j.status === 'needs_revisit').length;

  return (
    <>
      <AppHeader title={t('queueTitle')} />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {/* Mine ↔ team toggle (technicians) */}
        {!isManager && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(['mine', 'all'] as const).map((s) => (
              <Link
                key={s}
                href={`/installs${s === 'all' ? '?scope=all' : ''}`}
                className={`rounded-md px-3 py-1.5 text-center text-sm font-medium ${
                  scope === s ? 'bg-background shadow' : 'text-muted-foreground'
                }`}
              >
                {s === 'mine' ? t('scopeMine') : t('scopeAll')}
              </Link>
            ))}
          </div>
        )}

        {/* Compact stats strip */}
        <div className="grid grid-cols-3 gap-2">
          <StatTile label={t('kpiPending')} value={pending} accent="primary" />
          <StatTile label={t('kpiDoneWeek')} value={doneWeek ?? 0} accent="green" />
          <StatTile label={t('kpiRevisits')} value={revisits} accent="amber" />
        </div>

        {jobs.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
            <Wrench className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t('queueEmpty')}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => {
              const meta = INSTALL_STATUS_BY_KEY[job.status];
              const when = job.next_visit_date ?? job.scheduled_date;
              return (
                <Link
                  key={job.id}
                  href={`/install/new?job=${job.id}`}
                  className="block"
                >
                  <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-accent">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Wrench className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold leading-tight">
                        {job.contacts?.name ?? '—'}
                      </p>
                      {job.title && (
                        <p className="truncate text-xs text-muted-foreground">{job.title}</p>
                      )}
                      {job.contacts?.address && (
                        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {job.contacts.address}
                        </p>
                      )}
                      {when && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarClock className="h-3 w-3 shrink-0" />
                          {when}
                        </p>
                      )}
                      {scope === 'all' && !isManager && (
                        <p className="mt-0.5 text-xs">
                          {job.installer_id === user.id ? (
                            <span className="font-medium text-primary">{t('scopeMine')}</span>
                          ) : job.installer ? (
                            <span className="text-muted-foreground">
                              {job.installer.full_name ?? job.installer.username}
                            </span>
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
      </main>
    </>
  );
}
