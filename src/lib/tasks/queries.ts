import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TaskRow } from '@/lib/tasks/actions';

const SELECT =
  'id, contact_id, deal_id, installation_id, kind, title, details, due_at, assigned_to, status, completed_at, contacts(name), users:assigned_to(full_name, username)';

type Raw = {
  id: string;
  contact_id: string | null;
  deal_id: string | null;
  installation_id: string | null;
  kind: TaskRow['kind'];
  title: string;
  details: string | null;
  due_at: string | null;
  assigned_to: string | null;
  status: TaskRow['status'];
  completed_at: string | null;
  contacts: { name: string | null } | null;
  users: { full_name: string | null; username: string | null } | null;
};

const shape = (r: Raw): TaskRow => ({
  id: r.id,
  contactId: r.contact_id,
  contactName: r.contacts?.name ?? null,
  dealId: r.deal_id,
  installationId: r.installation_id,
  kind: r.kind,
  title: r.title,
  details: r.details,
  dueAt: r.due_at,
  assignedTo: r.assigned_to,
  assigneeName: r.users?.full_name || r.users?.username || null,
  status: r.status,
  completedAt: r.completed_at,
});

/**
 * Open tasks for one person, soonest first. Undated ones come last — they are
 * reminders without a deadline, not overdue work.
 * Returns [] when the table is missing (pre-migration), so callers can render
 * nothing rather than crash.
 */
export async function loadMyTasks(
  db: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<TaskRow[]> {
  const { data, error } = await db
    .from('tasks')
    .select(SELECT)
    .eq('assigned_to', userId)
    .eq('status', 'open')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as unknown as Raw[]).map(shape);
}

/** Everything on one customer — the whole team sees the same follow-ups. */
export async function loadContactTasks(
  db: SupabaseClient,
  contactId: string,
  limit = 30,
): Promise<TaskRow[]> {
  const { data, error } = await db
    .from('tasks')
    .select(SELECT)
    .eq('contact_id', contactId)
    .order('status', { ascending: true })
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as unknown as Raw[]).map(shape);
}

/** Team-wide open tasks, for the manager area and the daily brief. */
export async function loadOpenTasks(db: SupabaseClient, limit = 200): Promise<TaskRow[]> {
  const { data, error } = await db
    .from('tasks')
    .select(SELECT)
    .eq('status', 'open')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as unknown as Raw[]).map(shape);
}
