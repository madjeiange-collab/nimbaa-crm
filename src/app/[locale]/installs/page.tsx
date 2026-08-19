import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { StatTile } from '@/components/charts/stat-tile';
import { Card } from '@/components/ui/card';
import { OPEN_INSTALL_STATUSES } from '@/lib/installations/protocol';
import type { InstallStatus } from '@/types/database';
import { InstallQueue, type QueueJob } from '@/components/install/install-queue';

interface JobRow {
  id: string;
  title: string | null;
  status: InstallStatus;
  scheduled_date: string | null;
  next_visit_date: string | null;
  contact_id: string;
  installer_id: string | null;
  contacts: {
    id: string;
    name: string | null;
    address: string | null;
    assigned_rep_id: string | null;
    territory_id: string | null;
  } | null;
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
  const tInt = await getTranslations('intervention');

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
      'id, title, status, scheduled_date, next_visit_date, contact_id, installer_id, contacts(id, name, address, assigned_rep_id, territory_id), installer:users!installer_id(full_name, username)',
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

  // Only the people and secteurs actually present in the queue: a dropdown of
  // twelve names when four of them have jobs is a list you read twice.
  const repIds = [...new Set(jobs.map((j) => j.contacts?.assigned_rep_id).filter(Boolean))] as string[];
  const terrIds = [...new Set(jobs.map((j) => j.contacts?.territory_id).filter(Boolean))] as string[];
  const [{ data: repRows }, { data: terrRows }] = await Promise.all([
    repIds.length
      ? supabase.from('users').select('id, full_name, username').in('id', repIds)
      : Promise.resolve({ data: [] }),
    terrIds.length
      ? supabase.from('territories').select('id, name').in('id', terrIds)
      : Promise.resolve({ data: [] }),
  ]);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'fr');
  const reps = ((repRows ?? []) as { id: string; full_name: string | null; username: string | null }[])
    .map((u) => ({ id: u.id, name: u.full_name ?? u.username ?? '—' }))
    .sort(byName);
  const territories = ((terrRows ?? []) as { id: string; name: string | null }[])
    .map((x) => ({ id: x.id, name: x.name ?? '—' }))
    .sort(byName);

  const queue: QueueJob[] = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    status: j.status,
    scheduledDate: j.scheduled_date,
    nextVisitDate: j.next_visit_date,
    installerId: j.installer_id,
    installerName: j.installer?.full_name ?? j.installer?.username ?? null,
    contactName: j.contacts?.name ?? null,
    address: j.contacts?.address ?? null,
    repId: j.contacts?.assigned_rep_id ?? null,
    territoryId: j.contacts?.territory_id ?? null,
  }));

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

        {/* Raise a job nobody sold — SAV, warranty, maintenance. */}
        <Link href="/install/new" className="block">
          <Card className="flex items-center justify-center gap-2 p-3 text-sm font-medium text-primary transition-colors hover:bg-accent">
            <Plus className="h-4 w-4" />
            {tInt('newIntervention')}
          </Card>
        </Link>

        {/* Search and the two filters live with the list, in the browser: the
            queue is already loaded in full, so filtering it is instant and a
            round trip per keystroke would be the slower answer. */}
        <InstallQueue
          jobs={queue}
          reps={reps}
          territories={territories}
          currentUserId={user.id}
          showOwner={scope === 'all' && !isManager}
        />
      </main>
    </>
  );
}
