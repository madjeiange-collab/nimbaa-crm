import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { haversineMeters } from '@/lib/geo';
import { DISPOSITION_BY_KEY, type KnockDisposition } from '@/lib/visits/dispositions';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Shared thresholds for the Check-In and -Out checks. */
/**
 * Arrival vs end photo — the two are taken at the same doorway, so any gap
 * between them is GPS disagreement, not travel.
 *
 * A flat radius is wrong in both directions: two fixes each claiming ±8 m that
 * land 140 m apart is a real signal, while two taken inside a concrete-walled
 * maquis reporting ±85 m can land that far apart with nobody moving. So the
 * allowance follows what the phone said about itself — two independent fixes
 * at one spot can separate by roughly the sum of their errors — with a floor
 * so an optimistic ±3 m does not make the check hair-trigger, and a ceiling
 * that fires whatever the phone claims, since claiming terrible accuracy is
 * precisely what someone gaming it would arrange.
 */
export const PAIR_DISTANCE_M = 150; // absolute ceiling
export const PAIR_FLOOR_M = 40;
export const PAIR_ACCURACY_K = 2;
export const CONTACT_DISTANCE_M = 250; // photo vs the customer's pin
export const MIN_ENGAGED_VISIT_MIN = 3;
export const MIN_INSTALL_MIN = 10;
export const CLOCK_DRIFT_MIN = 10;

export type JournalFlag = 'pairFar' | 'tooShort' | 'farFromContact' | 'clockDrift' | 'noFix';

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
  /** A trip's own conclusion (0026). Null on commercial visits. */
  installStatus: string | null;
  arrivalUrl: string | null;
  completionUrl: string | null;
  pairMeters: number | null;
  contactMeters: number | null;
  flags: JournalFlag[];
}

const minutesBetween = (a: string, b: string) =>
  Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60_000;

/** The visit shape the journal needs — the controls page already selects it. */
export interface JournalVisit {
  id: string;
  rep_id: string;
  contact_id: string | null;
  visit_type: string;
  disposition: string | null;
  install_status?: string | null;
  visited_at: string;
  started_at: string | null;
  created_at: string;
  lat: number | null;
  lng: number | null;
  contacts: { name: string | null; lat: number | null; lng: number | null } | null;
}

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
    untilIso,
    repId,
    limit = 150,
  }: {
    sinceIso: string | null;
    /** Upper bound, so a caller can ask for one finished day, not "since". */
    untilIso?: string | null;
    repId?: string | null;
    limit?: number;
  },
): Promise<JournalRow[]> {
  let q = supabase
    .from('visits')
    .select(
      'id, rep_id, contact_id, visit_type, disposition, install_status, visited_at, started_at, created_at, lat, lng, contacts(name, lat, lng)',
    )
    .order('visited_at', { ascending: false })
    .limit(limit);
  if (sinceIso) q = q.gte('visited_at', sinceIso); // null = every passage on record
  if (untilIso) q = q.lte('visited_at', untilIso);
  if (repId) q = q.eq('rep_id', repId);

  const [{ data: visitRows, error }, { data: userRows }] = await Promise.all([
    q,
    supabase.from('users').select('id, full_name, username'),
  ]);
  if (error) return [];

  const nameOf = new Map(
    ((userRows ?? []) as { id: string; full_name: string | null; username: string | null }[]).map(
      (u) => [u.id, u.full_name ?? u.username ?? '—'],
    ),
  );
  return buildJournalRows(supabase, (visitRows ?? []) as unknown as JournalVisit[], nameOf);
}

/**
 * Turn already-fetched visits into journal rows. Split out so a caller that
 * filters its visits first (by secteur, type d'activité, tag) can cap the list
 * AFTER filtering — capping before would leave a nearly empty journal.
 */
export async function buildJournalRows(
  supabase: ServerClient,
  visits: JournalVisit[],
  nameOf: Map<string, string>,
): Promise<JournalRow[]> {
  if (visits.length === 0) return [];

  // Photos of exactly these visits (arrival + end carry the forensics).
  const { data: photoRows } = await supabase
    .from('visit_photos')
    .select('visit_id, kind, lat, lng, accuracy, captured_at, storage_path')
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
    accuracy: number | null;
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
    const { durationMin, pairMeters, contactMeters, flags, isInstall } = visitFlags(v, ph);

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
      installStatus: v.install_status ?? null,
      arrivalUrl: arrival ? (signed.get(arrival.storage_path) ?? null) : null,
      completionUrl: completion ? (signed.get(completion.storage_path) ?? null) : null,
      pairMeters,
      contactMeters,
      flags,
    };
  });
}

/** A photo row as the checks need it — every caller selects at least this. */
export interface CheckinPhoto {
  kind: string | null;
  lat: number | null;
  lng: number | null;
  /** Metres the phone claimed for this fix. Null on legacy rows. */
  accuracy?: number | null;
}

/**
 * The single place the checks are defined: duration, the two distances and
 * which flags a passage raises. The journal, the Check-In page and the AI all
 * read from here, so a threshold can never mean two things at once.
 */
export function visitFlags(
  v: Pick<JournalVisit, 'visit_type' | 'disposition' | 'visited_at' | 'started_at' | 'created_at' | 'contacts'>,
  photos: CheckinPhoto[],
) {
  const arrival = photos.find((p) => p.kind === 'arrival');
  const completion = photos.find((p) => p.kind === 'completion');
  const flags: JournalFlag[] = [];

  let pairMeters: number | null = null;
  if (arrival?.lat != null && arrival.lng != null && completion?.lat != null && completion.lng != null) {
    pairMeters = Math.round(haversineMeters(arrival.lat, arrival.lng, completion.lat, completion.lng));
    // Unknown accuracy falls back to the floor rather than to nothing: a
    // legacy row should not become unflaggable.
    const claimed = (arrival.accuracy ?? 0) + (completion.accuracy ?? 0);
    const allowed = Math.min(PAIR_DISTANCE_M, Math.max(PAIR_FLOOR_M, PAIR_ACCURACY_K * claimed));
    if (pairMeters > allowed) flags.push('pairFar');
  } else if (arrival || completion) {
    // Photos taken, position missing. Quieter than pairFar and kept separate:
    // it is not evidence of distance, it is the absence of evidence — and a
    // passage that cannot be placed at all is worth its own line.
    flags.push('noFix');
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

  // Only for passages carrying forensics — legacy rows are backdated and would
  // otherwise all look like drift.
  if (photos.length > 0 && minutesBetween(v.visited_at, v.created_at) > CLOCK_DRIFT_MIN) {
    flags.push('clockDrift');
  }

  return { durationMin, pairMeters, contactMeters, flags, isInstall, engaged };
}
