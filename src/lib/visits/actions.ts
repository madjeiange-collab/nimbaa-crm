'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { DISPOSITION_BY_KEY, type KnockDisposition } from '@/lib/visits/dispositions';
import { ensurePendingInstallation } from '@/lib/installations/seed';
import { ensureCommissionForWonDeal } from '@/lib/commissions/core';
import { recomputeContactRollup } from '@/lib/deals/rollup';
import { ensureTaskForAppointment } from '@/lib/tasks/actions';

export interface VisitPhotoMeta {
  kind: 'arrival' | 'completion' | 'extra';
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  capturedAt: string; // ISO
  phash: string | null;
}

export interface SaveVisitInput {
  clientUuid: string;
  visitType: 'd2d_knock' | 'b2b_visit';
  lat: number | null;
  lng: number | null;
  disposition: KnockDisposition;
  notes?: string | null;
  appointmentDate?: string | null; // ISO
  contactId?: string | null;
  contactName?: string | null;
  address?: string | null; // reverse-geocoded label (best-effort)
  dealId?: string | null; // link the visit to a chosen affaire (existing contact)
  visitedAt?: string; // ISO — defaults to now
  startedAt?: string | null; // ISO — arrival-photo moment (time spent = visited - started)
  photoPaths?: string[]; // storage paths of geo-stamped check-in photos
  photoMeta?: VisitPhotoMeta[]; // forensic metadata, aligned with photoPaths
}

export type SaveVisitResult =
  | { ok: true; visitId: string; contactId: string | null; outOfTurf: boolean }
  | { ok: false; error: 'unauthenticated' | 'do_not_knock' | 'save_failed' };

/**
 * Records a field visit / knock.
 *  - Blocks the save server-side if within 20 m of a do-not-knock entry.
 *  - Flags (does not block) knocks that fall outside the rep's assigned turf.
 *  - For engaged dispositions (interested / appointment / sold) auto-creates a
 *    contact in the pipeline and links the visit to it.
 */
export async function saveVisit(input: SaveVisitInput): Promise<SaveVisitResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Idempotence: an offline-queue retry whose first attempt actually landed
  // (response lost) must not duplicate — client_uuid is unique.
  const { data: existing } = await supabase
    .from('visits')
    .select('id, contact_id')
    .eq('client_uuid', input.clientUuid)
    .maybeSingle();
  if (existing) {
    return { ok: true, visitId: existing.id, contactId: existing.contact_id, outOfTurf: false };
  }

  const hasCoords = input.lat != null && input.lng != null;

  // 1. Do-not-knock block (authoritative — client also checks for speed).
  //    Only enforceable when we have coordinates.
  if (hasCoords) {
    const { data: nearDnk } = await supabase.rpc('near_do_not_knock', {
      p_lat: input.lat as number,
      p_lng: input.lng as number,
    });
    if (nearDnk === true) return { ok: false, error: 'do_not_knock' };
  }

  // 2. Out-of-turf flag (only meaningful with coords + an assigned turf).
  //    A knock saved without GPS is treated as out-of-turf (flagged for review).
  let outOfTurf = false;
  const { count: turfCount } = await supabase
    .from('user_territories')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if ((turfCount ?? 0) > 0) {
    if (hasCoords) {
      const { data: inTurf } = await supabase.rpc('point_in_my_turf', {
        p_lat: input.lat as number,
        p_lng: input.lng as number,
      });
      outOfTurf = inTurf !== true;
    } else {
      outOfTurf = true;
    }
  }

  // 3. Insert the visit. started_at is 0024 — retry without it if the
  //    migration isn't applied yet (never break the core flow).
  const visitRow = {
    client_uuid: input.clientUuid,
    contact_id: input.contactId ?? null,
    rep_id: user.id,
    visit_type: input.visitType,
    visited_at: input.visitedAt ?? new Date().toISOString(),
    lat: input.lat,
    lng: input.lng,
    notes: input.notes ?? null,
    disposition: input.disposition,
    appointment_date: input.appointmentDate ?? null,
  };
  let { data: visit, error: vErr } = await supabase
    .from('visits')
    .insert({ ...visitRow, started_at: input.startedAt ?? null })
    .select('id')
    .single();
  if (vErr && /started_at/.test(vErr.message)) {
    ({ data: visit, error: vErr } = await supabase
      .from('visits')
      .insert(visitRow)
      .select('id')
      .single());
  }

  if (vErr || !visit) return { ok: false, error: 'save_failed' };

  // Imported contacts arrive without coordinates and are invisible on maps —
  // the first GPS-tagged visit at their door fills them in.
  if (input.contactId && hasCoords) {
    await supabase
      .from('contacts')
      .update({ lat: input.lat, lng: input.lng })
      .eq('id', input.contactId)
      .is('lat', null);
  }

  // 3b. Link the uploaded geo-stamped photos to the visit, with per-photo
  //     forensics (kind / GPS / capture time / perceptual hash). Falls back to
  //     the legacy shape if migration 0024 isn't applied yet.
  if (input.photoPaths && input.photoPaths.length > 0) {
    const legacyRows = input.photoPaths.map((p) => ({
      visit_id: visit.id,
      storage_path: p,
      taken_at: input.visitedAt ?? new Date().toISOString(),
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

  // 4. Contact + Affaire (deal) handling.
  const now = new Date().toISOString();
  let contactId: string | null = input.contactId ?? null;
  const meta = DISPOSITION_BY_KEY[input.disposition];
  const engaged = !!meta?.createsContact;
  const won = meta?.lifecycle === 'customer'; // "sold"

  // The pipeline stage this disposition maps to — by stable system_key, so
  // the admin can rename stages freely.
  let stageId: string | null = null;
  if (meta?.stageKey) {
    const { data: stage } = await supabase
      .from('pipeline_stages')
      .select('id')
      .eq('system_key', meta.stageKey)
      .maybeSingle();
    stageId = stage?.id ?? null;
  }

  // 4a. Auto-create a contact for engaged knocks (unless one is already linked).
  if (!contactId && engaged) {
    const { data: ut } = await supabase
      .from('user_territories')
      .select('territory_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    const { data: contact } = await supabase
      .from('contacts')
      .insert({
        name: input.contactName ?? null,
        address: input.address ?? null,
        lifecycle: meta!.lifecycle,
        pipeline_stage_id: stageId,
        source: 'd2d_knock',
        assigned_rep_id: user.id,
        territory_id: ut?.territory_id ?? null,
        lat: input.lat,
        lng: input.lng,
        created_by: user.id,
        converted_at: won ? now : null,
      })
      .select('id')
      .single();
    if (contact) {
      contactId = contact.id;
      await supabase.from('visits').update({ contact_id: contactId }).eq('id', visit.id);
    }
  }

  // 4b. Attach the visit to an Affaire (deal), advancing / creating as needed.
  let dealId: string | null = input.dealId ?? null;
  if (contactId) {
    if (dealId) {
      // Existing chosen affaire: a "sold" visit wins it (+ installation job).
      if (won) {
        await supabase
          .from('deals')
          .update({ pipeline_stage_id: stageId, status: 'won', needs_installation: true, won_at: now, updated_at: now })
          .eq('id', dealId);
        await ensurePendingInstallation(supabase, { dealId, contactId, title: null, createdBy: user.id });
      }
      if (won) await ensureCommissionForWonDeal(supabase, dealId);
    } else if (engaged) {
      // No affaire chosen but engaged → open a new one at the mapped stage.
      const { data: deal } = await supabase
        .from('deals')
        .insert({
          contact_id: contactId,
          pipeline_stage_id: stageId,
          status: won ? 'won' : 'open',
          needs_installation: won,
          assigned_rep_id: user.id,
          won_at: won ? now : null,
          created_by: user.id,
        })
        .select('id')
        .single();
      dealId = deal?.id ?? null;
      if (won && dealId) {
        await ensurePendingInstallation(supabase, { dealId, contactId, title: null, createdBy: user.id });
        await ensureCommissionForWonDeal(supabase, dealId);
      }
    }

    if (dealId) await supabase.from('visits').update({ deal_id: dealId }).eq('id', visit.id);
    await recomputeContactRollup(supabase, contactId);
  }

  // A rendez-vous becomes a real follow-up someone owns and closes, not just a
  // date on the visit. Best-effort: never break the save.
  if (input.appointmentDate && meta?.needsAppointment) {
    const { data: contact } = contactId
      ? await supabase.from('contacts').select('name').eq('id', contactId).maybeSingle()
      : { data: null };
    await ensureTaskForAppointment(supabase, {
      visitId: visit.id,
      contactId,
      dealId,
      assignedTo: user.id,
      dueAt: input.appointmentDate,
      title: `Rendez-vous — ${contact?.name ?? input.contactName ?? 'client'}`,
      details: input.notes?.trim() || null,
    });
  }

  revalidatePath('/[locale]/turf', 'page');
  return { ok: true, visitId: visit.id, contactId, outOfTurf };
}
