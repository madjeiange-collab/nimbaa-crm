'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { DISPOSITION_BY_KEY, type KnockDisposition } from '@/lib/visits/dispositions';
import { ensurePendingInstallation } from '@/lib/installations/seed';

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
  visitedAt?: string; // ISO — defaults to now
  photoPaths?: string[]; // storage paths of geo-stamped check-in photos
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

  // 3. Insert the visit.
  const { data: visit, error: vErr } = await supabase
    .from('visits')
    .insert({
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
    })
    .select('id')
    .single();

  if (vErr || !visit) return { ok: false, error: 'save_failed' };

  // 3b. Link the uploaded geo-stamped photos to the visit.
  if (input.photoPaths && input.photoPaths.length > 0) {
    await supabase.from('visit_photos').insert(
      input.photoPaths.map((p) => ({
        visit_id: visit.id,
        storage_path: p,
        taken_at: input.visitedAt ?? new Date().toISOString(),
      })),
    );
  }

  // 4. Auto-create a contact for engaged knocks (unless one is already linked).
  let contactId: string | null = input.contactId ?? null;
  const meta = DISPOSITION_BY_KEY[input.disposition];
  if (!contactId && meta?.createsContact) {
    let stageId: string | null = null;
    if (meta.stageName) {
      const { data: stage } = await supabase
        .from('pipeline_stages')
        .select('id')
        .eq('name', meta.stageName)
        .maybeSingle();
      stageId = stage?.id ?? null;
    }

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
        lifecycle: meta.lifecycle,
        pipeline_stage_id: stageId,
        source: 'd2d_knock',
        assigned_rep_id: user.id,
        territory_id: ut?.territory_id ?? null,
        lat: input.lat,
        lng: input.lng,
        created_by: user.id,
        converted_at: meta.lifecycle === 'customer' ? new Date().toISOString() : null,
      })
      .select('id')
      .single();

    if (contact) {
      contactId = contact.id;
      await supabase.from('visits').update({ contact_id: contactId }).eq('id', visit.id);

      // The engaged knock also opens an Affaire (deal) at the mapped stage.
      const won = meta.lifecycle === 'customer'; // "sold"
      const { data: deal } = await supabase
        .from('deals')
        .insert({
          contact_id: contact.id,
          pipeline_stage_id: stageId,
          status: won ? 'won' : 'open',
          needs_installation: won, // a sold door is installed by default
          assigned_rep_id: user.id,
          won_at: won ? new Date().toISOString() : null,
          created_by: user.id,
        })
        .select('id')
        .single();

      // A door that closes as "sold" becomes a customer awaiting installation.
      if (won && deal) {
        await ensurePendingInstallation(supabase, {
          dealId: deal.id,
          contactId: contact.id,
          title: null,
          createdBy: user.id,
        });
      }
    }
  }

  revalidatePath('/[locale]/turf', 'page');
  return { ok: true, visitId: visit.id, contactId, outOfTurf };
}
