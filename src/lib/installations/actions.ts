'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { freshChecklist } from '@/lib/installations/protocol';
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

/** Create a new installation job for a customer (multiple jobs are allowed). */
export async function createInstallation(
  contactId: string,
  title?: string | null,
): Promise<{ ok: true; installationId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data, error } = await supabase
    .from('installations')
    .insert({
      contact_id: contactId,
      title: title?.trim() || null,
      status: 'pending',
      checklist: freshChecklist(),
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'save_failed' };

  revalidateContact(contactId);
  return { ok: true, installationId: data.id };
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
  visitedAt?: string; // ISO — defaults to now
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

  const now = input.visitedAt ?? new Date().toISOString();

  // 1. Insert the installation visit (reuses the field-visit infrastructure).
  const { data: visit, error: vErr } = await supabase
    .from('visits')
    .insert({
      client_uuid: input.clientUuid,
      contact_id: input.contactId,
      rep_id: user.id,
      visit_type: 'installation',
      visited_at: now,
      lat: input.lat,
      lng: input.lng,
      notes: input.notes ?? null,
      next_visit_date:
        input.status === 'needs_revisit' ? input.nextVisitDate ?? null : null,
    })
    .select('id')
    .single();
  if (vErr || !visit) return { ok: false, error: 'save_failed' };

  // 2. Link uploaded photos.
  if (input.photoPaths && input.photoPaths.length > 0) {
    await supabase.from('visit_photos').insert(
      input.photoPaths.map((p) => ({
        visit_id: visit.id,
        storage_path: p,
        taken_at: now,
      })),
    );
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
  if (!prev?.started_at) patch.started_at = now;
  if (input.status === 'done') patch.completed_at = now;

  const { error: iErr } = await supabase
    .from('installations')
    .update(patch)
    .eq('id', input.installationId);
  if (iErr) return { ok: false, error: 'save_failed' };

  revalidateContact(input.contactId);
  return { ok: true, visitId: visit.id };
}
