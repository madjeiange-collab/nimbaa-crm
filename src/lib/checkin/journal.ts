import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { haversineMeters } from '@/lib/geo';
import { DISPOSITION_BY_KEY, type KnockDisposition } from '@/lib/visits/dispositions';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Shared thresholds for the Check-In and -Out checks. */
export const PAIR_DISTANCE_M = 150; // arrival vs end photo
export const CONTACT_DISTANCE_M = 250; // photo vs the customer's pin
export const MIN_ENGAGED_VISIT_MIN = 3;
export const MIN_INSTALL_MIN = 10;
export const CLOCK_DRIFT_MIN = 10;

export type JournalFlag = 'pairFar' | 'tooShort' | 'farFromContact' | 'clockDrift';

export interface JournalRow {
  id: string;
  personId: string;
  personName: string;
  /** Calendar day of the check-in (Abidjan = UTC), for grouping. */
  day: string;
  inAt: string | null;
  outAt: string;
  durationMin: number | null;
  contactId: string | null;
  contactName: string | null;
  kind: 'visit' | 'install';
  disposition: string | null;
  arrivalUrl: string | null;
  completionUrl: string | null;
  pairMeters: number | null;
  contactMeters: number | null;
  flags: JournalFlag[];
}

const minutesBetween = (a: string, b: string) =>
  Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60_000;

/**
 * The check-in / check-out journal: one row per passage, newest first, with the
 * arrival and end photos signed for display. Rows without an arrival photo
 * (logged before the pair became mandatory) still appear — they simply have no
 * duration, which is itself worth seeing.
 */
export async function loadJournalRows(
  supabase: ServerClient,
  {
    sinceIso,
    repId,
    limit = 150,
  }: { sinceIso: string; repId?: string | null; limit?: number },
): Promise<JournalRow[]> {
  let q = supabase
    .from('visits')
    .select(
      'id, rep_id, contact_id, visit_type, disposition, visited_at, started_at, created_at, lat, lng, contacts(name, lat, lng)',
    )
    .gte('visited_at', sinceIso)
    .order('visited_at', { ascending: false })
    .limit(limit);
  if (repId) q = q.eq('rep_id', repId);

  const [{ data: visitRows, error }, { data: userRows }] = await Promise.all([
    q,
    supabase.from('users').select('id, full_name, username'),
  ]);
  if (error) return [];

  const visits = (visitRows ?? []) as unknown as {
    id: string;
    rep_id: string;
    contact_id: string | null;
    visit_type: string;
    disposition: string | null;
    visited_at: string;
    started_at: string | null;
    created_at: string;
    lat: number | null;
    lng: number | null;
    contacts: { name: string | null; lat: number | null; lng: number | null } | null;
  }[];
  if (visits.length === 0) return [];

  const nameOf = new Map(
    ((userRows ?? []) as { id: string; full_name: string | null; username: string | null }[]).map(
      (u) => [u.id, u.full_name ?? u.username ?? '—'],
    ),
  );

  // Photos of exactly these visits (arrival + end carry the forensics).
  const { data: photoRows } = await supabase
    .from('visit_photos')
    .select('visit_id, kind, lat, lng, captured_at, storage_path')
    .in(
      'visit_id',
      visits.map((v) => v.id),
    )
    .limit(2000);
  const photos = (photoRows ?? []) as {
    visit_id: string | null;
    kind: string | null;
    lat: number | null;
    lng: number | null;
    captured_at: string | null;
    storage_path: string;
  }[];

  // One signed-URL round trip for every thumbnail on the page.
  const paths = photos.filter((p) => p.kind === 'arrival' || p.kind === 'completion').map((p) => p.storage_path);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from('visit-photos').createSignedUrls(paths, 3600);
    for (const u of urls ?? []) if (u.signedUrl && u.path) signed.set(u.path, u.signedUrl);
  }

  const byVisit = new Map<string, typeof photos>();
  for (const p of photos) {
    if (!p.visit_id) continue;
    const list = byVisit.get(p.visit_id) ?? [];
    list.push(p);
    byVisit.set(p.visit_id, list);
  }

  return visits.map((v) => {
    const ph = byVisit.get(v.id) ?? [];
    const arrival = ph.find((p) => p.kind === 'arrival');
    const completion = ph.find((p) => p.kind === 'completion');
    const flags: JournalFlag[] = [];

    let pairMeters: number | null = null;
    if (arrival?.lat != null && arrival.lng != null && completion?.lat != null && completion.lng != null) {
      pairMeters = Math.round(haversineMeters(arrival.lat, arrival.lng, completion.lat, completion.lng));
      if (pairMeters > PAIR_DISTANCE_M) flags.push('pairFar');
    }

    const durationMin = v.started_at ? Math.round(minutesBetween(v.started_at, v.visited_at)) : null;
    const isInstall = v.visit_type === 'installation';
    const engaged =
      !isInstall &&
      !!(v.disposition && DISPOSITION_BY_KEY[v.disposition as KnockDisposition]?.createsContact);
    if (engaged && durationMin != null && durationMin < MIN_ENGAGED_VISIT_MIN) flags.push('tooShort');

    let contactMeters: number | null = null;
    const fix = arrival ?? completion;
    if (v.contacts?.lat != null && v.contacts.lng != null && fix?.lat != null && fix.lng != null) {
      contactMeters = Math.round(haversineMeters(fix.lat, fix.lng, v.contacts.lat, v.contacts.lng));
      if (contactMeters > CONTACT_DISTANCE_M) flags.push('farFromContact');
    }

    if (ph.length > 0 && minutesBetween(v.visited_at, v.created_at) > CLOCK_DRIFT_MIN) {
      flags.push('clockDrift');
    }

    return {
      id: v.id,
      personId: v.rep_id,
      personName: nameOf.get(v.rep_id) ?? '—',
      day: (v.started_at ?? v.visited_at).slice(0, 10),
      inAt: v.started_at,
      outAt: v.visited_at,
      durationMin,
      contactId: v.contact_id,
      contactName: v.contacts?.name ?? null,
      kind: isInstall ? ('install' as const) : ('visit' as const),
      disposition: v.disposition,
      arrivalUrl: arrival ? (signed.get(arrival.storage_path) ?? null) : null,
      completionUrl: completion ? (signed.get(completion.storage_path) ?? null) : null,
      pairMeters,
      contactMeters,
      flags,
    };
  });
}
