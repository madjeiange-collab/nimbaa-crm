import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { OPEN_INSTALL_STATUSES } from '@/lib/installations/protocol';
import type { InstallStatus } from '@/types/database';
import type { TechTally } from '@/components/dashboard/installations-summary';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface TechnicianStatsData {
  pending: number;
  inProgress: number;
  doneWeek: number;
  revisits: number;
  perTech: TechTally[];
}

/**
 * Team-wide installation statistics for managers: aggregate KPIs + a
 * per-technician breakdown (done 7d / open / revisits). Shared by the manager
 * dashboard section and the standalone "Statistiques techniciens" page.
 */
export async function loadTechnicianStats(
  supabase: ServerClient,
): Promise<TechnicianStatsData> {
  const d7Iso = new Date(Date.now() - 7 * 864e5).toISOString();

  const [{ data: users }, { data: installs }] = await Promise.all([
    supabase.from('users').select('id, full_name, username, role'),
    supabase.from('installations').select('status, installer_id, completed_at').limit(5000),
  ]);

  type InstallRow = { status: InstallStatus; installer_id: string | null; completed_at: string | null };
  const rows = (installs ?? []) as InstallRow[];
  const openSet = new Set<InstallStatus>(OPEN_INSTALL_STATUSES);

  const perTechMap = new Map<string, TechTally>();
  for (const u of (users ?? []) as { id: string; full_name: string | null; username: string | null; role?: string }[]) {
    if (u.role === 'technician') {
      perTechMap.set(u.id, { name: u.full_name ?? u.username ?? '—', done7d: 0, open: 0, revisits: 0 });
    }
  }

  let pending = 0;
  let inProgress = 0;
  let doneWeek = 0;
  let revisits = 0;
  for (const r of rows) {
    const doneThisWeek = r.status === 'done' && !!r.completed_at && r.completed_at >= d7Iso;
    if (r.status === 'pending' || r.status === 'scheduled') pending++;
    if (r.status === 'in_progress') inProgress++;
    if (r.status === 'needs_revisit') revisits++;
    if (doneThisWeek) doneWeek++;

    const tally = r.installer_id ? perTechMap.get(r.installer_id) : null;
    if (tally) {
      if (doneThisWeek) tally.done7d++;
      if (openSet.has(r.status)) tally.open++;
      if (r.status === 'needs_revisit') tally.revisits++;
    }
  }
  const perTech = [...perTechMap.values()].sort((a, b) => b.done7d - a.done7d || b.open - a.open);

  return { pending, inProgress, doneWeek, revisits, perTech };
}
