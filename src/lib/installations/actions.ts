'use server';

import { revalidatePath } from 'next/cache';
import { ensureTechCommissionForInstall } from '@/lib/commissions/core';
import { createClient } from '@/lib/supabase/server';
import { ensureTaskForRevisit } from '@/lib/tasks/actions';
import { getTemplateChecklist } from '@/lib/installations/template';
import type {
  ChecklistItem,
  EquipmentItem,
  InstallStatus,
} from '@/types/database';

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateContact(id: string) {
  revalidatePath('/[locale]/contacts', 'page');
  revalidatePath(`/[locale]/contacts/${id}`, 'page');
  revalidatePath('/[locale]/installs', 'page');
  revalidatePath('/[locale]/dashboard', 'page');
}

/**
 * Assign (or reassign) a technician to a specific installation job.
 * Callable by a manager or the winning commercial. Sets the job to `scheduled`.
 */
export async function assignInstaller(
  installationId: string,
  contactId: string,
  technicianId: string | null,
  scheduledDate?: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase
    .from('installations')
    .update({
      installer_id: technicianId,
      status: technicianId ? 'scheduled' : 'pending',
      scheduled_date: scheduledDate || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', installationId);
  if (error) return { ok: false, error: 'save_failed' };

  revalidateContact(contactId);
  return { ok: true };
}

export type InterventionOrigin = 'service' | 'warranty' | 'maintenance';

/**
 * Open a job that no sale produced — an SAV callback, a warranty return, a
 * maintenance round. Any field user can raise one: a technician who takes the
 * call should not have to route it through a commercial, and a commercial who
 * spots a fault on site should not have to invent an affaire.
 *
 * `deal_id` stays null, which is also what keeps it out of the pipeline and
 * out of the technician's commission (that helper requires a won deal).
 */
export async function createIntervention(input: {
  contactId: string;
  origin: InterventionOrigin;
  title: string;
  reason?: string | null;
  scheduledDate?: string | null;
  assignedTo?: string | null;
}): Promise<{ ok: true; installationId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  if (!input.title.trim()) return { ok: false, error: 'title_required' };

  const checklist = await getTemplateChecklist(supabase);
  const assignee = input.assignedTo ?? user.id;
  const row: Record<string, unknown> = {
    contact_id: input.contactId,
    deal_id: null,
    title: input.title.trim(),
    status: assignee ? 'scheduled' : 'pending',
    checklist,
    equipment: [],
    installer_id: assignee,
    scheduled_date: input.scheduledDate || null,
    created_by: user.id,
  };

  let { data, error } = await supabase
    .from('installations')
    .insert({ ...row, origin: input.origin, reason: input.reason?.trim() || null })
    .select('id')
    .single();
  // Pre-0027 the origin columns do not exist yet — still create the job.
  if (error && /origin|reason/.test(error.message)) {
    ({ data, error } = await supabase.from('installations').insert(row).select('id').single());
  }
  if (error || !data) return { ok: false, error: 'save_failed' };

  revalidateContact(input.contactId);
  return { ok: true, installationId: data.id };
}

export interface InstallPhotoMeta {
  kind: 'arrival' | 'completion' | 'extra';
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  capturedAt: string; // ISO
  phash: string | null;
}

export interface SaveInstallationInput {
  installationId: string;
  clientUuid: string;
  contactId: string;
  lat: number | null;
  lng: number | null;
  status: InstallStatus; // in_progress | done | needs_revisit
  checklist: ChecklistItem[];
  equipment: EquipmentItem[];
  notes?: string | null;
  nextVisitDate?: string | null; // ISO date, only for needs_revisit
  photoPaths?: string[]; // storage paths of geo-stamped check-in photos
  photoMeta?: InstallPhotoMeta[]; // forensic metadata, aligned with photoPaths
  startedAt?: string | null; // ISO — arrival-photo moment of THIS trip
  visitedAt?: string; // ISO — defaults to now
  taskId?: string | null; // the planned follow-up this trip discharges
}

export type SaveInstallationResult =
  | { ok: true; visitId: string }
  | { ok: false; error: 'unauthenticated' | 'save_failed' };

/**
 * Record an on-site installation trip against a specific job.
 *  1. Inserts a `visits` row (visit_type='installation') so GPS, photos and the
 *     contact timeline are reused as-is.
 *  2. Links the uploaded geo-stamped photos.
 *  3. Updates the job with the latest checklist / equipment / status; stamps
 *     started_at (first progress) and completed_at (done).
 */
export async function saveInstallation(
  input: SaveInstallationInput,
): Promise<SaveInstallationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Idempotence for offline-queue retries: client_uuid is unique.
  const { data: existing } = await supabase
    .from('visits')
    .select('id')
    .eq('client_uuid', input.clientUuid)
    .maybeSingle();
  if (existing) return { ok: true, visitId: existing.id };

  const now = input.visitedAt ?? new Date().toISOString();

  // 1. Insert the installation visit (reuses the field-visit infrastructure).
  //    started_at is 0024 — retry without it if the migration isn't applied.
  const visitRow = {
    client_uuid: input.clientUuid,
    contact_id: input.contactId,
    rep_id: user.id,
    visit_type: 'installation' as const,
    visited_at: now,
    lat: input.lat,
    lng: input.lng,
    notes: input.notes ?? null,
    next_visit_date:
      input.status === 'needs_revisit' ? input.nextVisitDate ?? null : null,
  };
  // 0026: the trip carries which job it belongs to, which planned follow-up it
  // discharged, what was concluded and how far the protocol stood — that is
  // what turns a job into a history rather than a final state.
  const linked = {
    ...visitRow,
    started_at: input.startedAt ?? null,
    installation_id: input.installationId,
    task_id: input.taskId ?? null,
    install_status: input.status,
    checklist_snapshot: input.checklist,
  };
  let { data: visit, error: vErr } = await supabase
    .from('visits')
    .insert(linked)
    .select('id')
    .single();
  if (vErr && /installation_id|task_id|install_status|checklist_snapshot/.test(vErr.message)) {
    ({ data: visit, error: vErr } = await supabase
      .from('visits')
      .insert({ ...visitRow, started_at: input.startedAt ?? null })
      .select('id')
      .single());
  }
  if (vErr && /started_at/.test(vErr.message)) {
    ({ data: visit, error: vErr } = await supabase
      .from('visits')
      .insert(visitRow)
      .select('id')
      .single());
  }
  if (vErr || !visit) return { ok: false, error: 'save_failed' };

  // 2. Link uploaded photos with per-photo forensics (falls back to the
  //    legacy shape pre-0024).
  if (input.photoPaths && input.photoPaths.length > 0) {
    const legacyRows = input.photoPaths.map((p) => ({
      visit_id: visit.id,
      storage_path: p,
      taken_at: now,
    }));
    const rows = legacyRows.map((r, i) => {
      const m = input.photoMeta?.[i];
      return m
        ? {
            ...r,
            kind: m.kind,
            lat: m.lat,
            lng: m.lng,
            accuracy: m.accuracy,
            captured_at: m.capturedAt,
            phash: m.phash,
          }
        : r;
    });
    const { error: pErr } = await supabase.from('visit_photos').insert(rows);
    if (pErr && /kind|captured_at|phash/.test(pErr.message)) {
      await supabase.from('visit_photos').insert(legacyRows);
    }
  }

  // 3. Update the installation job.
  const { data: prev } = await supabase
    .from('installations')
    .select('started_at')
    .eq('id', input.installationId)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    installer_id: user.id,
    status: input.status,
    checklist: input.checklist,
    equipment: input.equipment,
    notes: input.notes ?? null,
    next_visit_date:
      input.status === 'needs_revisit' ? input.nextVisitDate ?? null : null,
    updated_at: now,
  };
  // The clock starts at the arrival PHOTO of the first trip (more honest than
  // the save moment) and stops at the completion photo when marking done.
  const completionAt = input.photoMeta?.find((m) => m.kind === 'completion')?.capturedAt;
  if (!prev?.started_at) patch.started_at = input.startedAt ?? now;
  if (input.status === 'done') patch.completed_at = completionAt ?? now;

  const { error: iErr } = await supabase
    .from('installations')
    .update(patch)
    .eq('id', input.installationId);
  if (iErr) return { ok: false, error: 'save_failed' };

  // A completed installation earns the technician their per-product rate.
  if (input.status === 'done') {
    await ensureTechCommissionForInstall(supabase, input.installationId, user.id);
  }

  // "Retour requis" becomes an owned, dated task carrying what is left to do —
  // the unfinished protocol steps, plus whatever the technician noted.
  if (input.status === 'needs_revisit') {
    const { data: job } = await supabase
      .from('installations')
      .select('title, deal_id, contacts(name)')
      .eq('id', input.installationId)
      .maybeSingle();
    const pending = (input.checklist ?? []).filter((c) => !c.done).map((c) => c.label);
    const details = [
      pending.length ? `Reste à faire : ${pending.join(', ')}` : null,
      input.notes?.trim() || null,
    ]
      .filter(Boolean)
      .join(' — ');
    await ensureTaskForRevisit(supabase, {
      installationId: input.installationId,
      contactId: input.contactId,
      dealId: (job as { deal_id?: string | null } | null)?.deal_id ?? null,
      assignedTo: user.id,
      dueAt: input.nextVisitDate ?? null,
      title: `Retour chantier — ${(job as { contacts?: { name: string | null } | null } | null)?.contacts?.name ?? job?.title ?? 'client'}`,
      details: details || null,
    });
  } else {
    // Finished or back in progress: close any open return task for this job.
    await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: now, completed_by: user.id, updated_at: now })
      .eq('installation_id', input.installationId)
      .eq('status', 'open')
      .eq('kind', 'revisit');
  }

  revalidateContact(input.contactId);
  return { ok: true, visitId: visit.id };
}
