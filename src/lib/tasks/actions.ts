'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// 'trial_end' (0032) is the one kind born from a DATE rather than a passage.
export type TaskKind = 'rdv' | 'revisit' | 'service' | 'manual' | 'trial_end';
export type TaskStatus = 'open' | 'done' | 'cancelled';

export interface TaskRow {
  id: string;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  installationId: string | null;
  kind: TaskKind;
  title: string;
  details: string | null;
  dueAt: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  status: TaskStatus;
  completedAt: string | null;
}

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidate(contactId?: string | null) {
  revalidatePath('/[locale]/home', 'page');
  revalidatePath('/[locale]/installs', 'page');
  revalidatePath('/[locale]/stats', 'page');
  if (contactId) revalidatePath(`/[locale]/contacts/${contactId}`, 'page');
}

/**
 * Both auto-creators are best-effort and idempotent: a task must never break
 * saving a visit or an installation, and an offline retry must not duplicate
 * it (a partial unique index enforces one open task per source row).
 */
export async function ensureTaskForAppointment(
  db: SupabaseClient,
  {
    visitId,
    contactId,
    dealId,
    assignedTo,
    dueAt,
    title,
    details,
  }: {
    visitId: string;
    contactId: string | null;
    dealId?: string | null;
    assignedTo: string | null;
    dueAt: string | null;
    title: string;
    details?: string | null;
  },
): Promise<void> {
  try {
    const { data: existing } = await db
      .from('tasks')
      .select('id')
      .eq('visit_id', visitId)
      .eq('status', 'open')
      .maybeSingle();
    if (existing) return;
    await db.from('tasks').insert({
      contact_id: contactId,
      deal_id: dealId ?? null,
      visit_id: visitId,
      kind: 'rdv',
      title,
      details: details ?? null,
      due_at: dueAt,
      assigned_to: assignedTo,
      created_by: assignedTo,
    });
  } catch {
    // Table missing (pre-migration) or a race on the unique index — ignore.
  }
}

export async function ensureTaskForRevisit(
  db: SupabaseClient,
  {
    installationId,
    contactId,
    dealId,
    assignedTo,
    dueAt,
    title,
    details,
  }: {
    installationId: string;
    contactId: string | null;
    dealId?: string | null;
    assignedTo: string | null;
    dueAt: string | null;
    title: string;
    details?: string | null;
  },
): Promise<void> {
  try {
    const { data: existing } = await db
      .from('tasks')
      .select('id')
      .eq('installation_id', installationId)
      .eq('status', 'open')
      .maybeSingle();
    if (existing) {
      // A second trip can move the date — keep the task, refresh what it says.
      await db
        .from('tasks')
        .update({ due_at: dueAt, details: details ?? null, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      return;
    }
    await db.from('tasks').insert({
      contact_id: contactId,
      deal_id: dealId ?? null,
      installation_id: installationId,
      kind: 'revisit',
      title,
      details: details ?? null,
      due_at: dueAt,
      assigned_to: assignedTo,
      created_by: assignedTo,
    });
  } catch {
    // Same as above — never block the installation save.
  }
}

/** Close a task. Anyone on the team can, since anyone may settle the job. */
export async function completeTask(taskId: string, contactId?: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      completed_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', 'open');
  if (error) return { ok: false, error: 'save_failed' };
  revalidate(contactId);
  return { ok: true };
}

/** Undo a close — a task marked done by mistake. */
export async function reopenTask(taskId: string, contactId?: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'open',
      completed_at: null,
      completed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);
  if (error) return { ok: false, error: 'save_failed' };
  revalidate(contactId);
  return { ok: true };
}

/** A task added by hand on a contact. */
export async function createTask(input: {
  contactId: string;
  title: string;
  dueAt?: string | null;
  assignedTo?: string | null;
  details?: string | null;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  if (!input.title.trim()) return { ok: false, error: 'title_required' };

  const { error } = await supabase.from('tasks').insert({
    contact_id: input.contactId,
    kind: 'manual',
    title: input.title.trim(),
    details: input.details?.trim() || null,
    due_at: input.dueAt || null,
    assigned_to: input.assignedTo ?? user.id,
    created_by: user.id,
  });
  if (error) return { ok: false, error: 'save_failed' };
  revalidate(input.contactId);
  return { ok: true };
}

export async function deleteTask(taskId: string, contactId?: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) return { ok: false, error: 'save_failed' };
  revalidate(contactId);
  return { ok: true };
}
