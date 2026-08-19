import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { visitFlags, type CheckinPhoto, type JournalVisit } from '@/lib/checkin/journal';

/** Works with the request-scoped client (RLS) and the service-role one alike. */
type Db = SupabaseClient;

const mean = (xs: number[]) =>
  xs.length ? Math.round(xs.reduce((s, n) => s + n, 0) / xs.length) : null;
const minutesBetween = (a: string, b: string) =>
  Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60_000;

export interface CheckinPersonSummary {
  nom: string;
  passages: number;
  visites: number;
  chantiers: number;
  duree_moyenne_min: number | null;
  temps_total_min: number;
  taux_temps_client_pct: number | null;
  premier_check_in: string | null;
  dernier_check_out: string | null;
  paires_incompletes: number;
  alertes: number;
}

/**
 * Time actually spent with customers, measured between the arrival and end
 * photos, plus the consistency checks. One shared shape so the assistant, the
 * daily brief and the manager report all describe the same reality.
 */
export async function summarizeCheckins(
  db: Db,
  {
    sinceIso,
    untilIso,
    repId,
    withPerPerson = false,
  }: { sinceIso: string; untilIso?: string; repId?: string | null; withPerPerson?: boolean },
) {
  let q = db
    .from('visits')
    .select(
      'id, rep_id, contact_id, visit_type, disposition, visited_at, started_at, created_at, lat, lng, contacts(name, lat, lng)',
    )
    .gte('visited_at', sinceIso)
    .order('visited_at', { ascending: false })
    .limit(3000);
  if (untilIso) q = q.lt('visited_at', untilIso);
  if (repId) q = q.eq('rep_id', repId);

  const { data: visitRows, error } = await q;
  if (error) return { error: error.message };
  const visits = (visitRows ?? []) as unknown as JournalVisit[];
  if (visits.length === 0) {
    return { passages: 0, note: 'aucun passage sur la période' };
  }

  const { data: photoRows } = await db
    .from('visit_photos')
    .select('visit_id, kind, lat, lng, accuracy, phash')
    .in(
      'visit_id',
      visits.map((v) => v.id),
    )
    .limit(6000);
  const photos = (photoRows ?? []) as (CheckinPhoto & { visit_id: string | null; phash: string | null })[];
  const byVisit = new Map<string, typeof photos>();
  for (const p of photos) {
    if (!p.visit_id) continue;
    const list = byVisit.get(p.visit_id) ?? [];
    list.push(p);
    byVisit.set(p.visit_id, list);
  }

  const { data: userRows } = await db.from('users').select('id, full_name, username');
  const nameOf = new Map(
    ((userRows ?? []) as { id: string; full_name: string | null; username: string | null }[]).map(
      (u) => [u.id, u.full_name || u.username || '—'],
    ),
  );

  // sans_position added with the flag itself: the if-chain below simply
  // dropped it, so the assistant reported fewer alerts than the manager's page.
  const alertes = {
    photos_eloignees: 0,
    visites_trop_courtes: 0,
    photo_loin_du_client: 0,
    decalage_horloge: 0,
    sans_position: 0,
  };
  const visitDurations: number[] = [];
  const installDurations: number[] = [];
  let incompletePairs = 0;

  // person → day → { onSite, first, last }
  const perPerson = new Map<string, CheckinPersonSummary & { _days: Map<string, { onSite: number; first: number; last: number }> }>();

  for (const v of visits) {
    const ph = byVisit.get(v.id) ?? [];
    const { durationMin, flags, isInstall } = visitFlags(v, ph);
    for (const f of flags) {
      if (f === 'pairFar') alertes.photos_eloignees++;
      else if (f === 'tooShort') alertes.visites_trop_courtes++;
      else if (f === 'farFromContact') alertes.photo_loin_du_client++;
      else if (f === 'clockDrift') alertes.decalage_horloge++;
      else if (f === 'noFix') alertes.sans_position++;
    }
    if (durationMin == null) incompletePairs++;
    else if (isInstall) installDurations.push(durationMin);
    else visitDurations.push(durationMin);

    if (!withPerPerson && !repId) continue;
    const row =
      perPerson.get(v.rep_id) ??
      ({
        nom: nameOf.get(v.rep_id) ?? '—',
        passages: 0,
        visites: 0,
        chantiers: 0,
        duree_moyenne_min: null,
        temps_total_min: 0,
        taux_temps_client_pct: null,
        premier_check_in: null,
        dernier_check_out: null,
        paires_incompletes: 0,
        alertes: 0,
        _days: new Map(),
      } as CheckinPersonSummary & { _days: Map<string, { onSite: number; first: number; last: number }> });
    row.passages++;
    if (isInstall) row.chantiers++;
    else row.visites++;
    row.alertes += flags.length;
    if (durationMin == null) row.paires_incompletes++;
    else {
      row.temps_total_min += durationMin;
      const day = (v.started_at as string).slice(0, 10);
      const inMs = new Date(v.started_at as string).getTime();
      const outMs = new Date(v.visited_at).getTime();
      const d = row._days.get(day) ?? { onSite: 0, first: inMs, last: outMs };
      d.onSite += (outMs - inMs) / 60_000;
      d.first = Math.min(d.first, inMs);
      d.last = Math.max(d.last, outMs);
      row._days.set(day, d);
    }
    perPerson.set(v.rep_id, row);
  }

  // Engaged visits need the disposition test the flags helper already knows.
  const engagedOnly = visits
    .filter((v) => v.visit_type !== 'installation' && v.started_at)
    .filter((v) => visitFlags(v, byVisit.get(v.id) ?? []).engaged)
    .map((v) => Math.round(minutesBetween(v.started_at as string, v.visited_at)));

  const fmtTime = (ms: number) =>
    new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Abidjan' });

  const people = [...perPerson.values()].map((r) => {
    let onSite = 0;
    let field = 0;
    let first = Infinity;
    let last = -Infinity;
    for (const d of r._days.values()) {
      onSite += d.onSite;
      if (d.last > d.first) field += (d.last - d.first) / 60_000;
      first = Math.min(first, d.first);
      last = Math.max(last, d.last);
    }
    const { _days, ...rest } = r;
    return {
      ...rest,
      temps_total_min: Math.round(r.temps_total_min),
      duree_moyenne_min: r.passages - r.paires_incompletes > 0 ? Math.round(onSite / (r.passages - r.paires_incompletes)) : null,
      taux_temps_client_pct: field > 0 ? Math.round((onSite / field) * 100) : null,
      premier_check_in: first === Infinity ? null : fmtTime(first),
      dernier_check_out: last === -Infinity ? null : fmtTime(last),
    };
  });

  // Duplicate photos across passages — a reused image.
  const byHash = new Map<string, Set<string>>();
  for (const p of photos) {
    if (!p.phash || !p.visit_id) continue;
    const set = byHash.get(p.phash) ?? new Set<string>();
    set.add(p.visit_id);
    byHash.set(p.phash, set);
  }
  const reused = [...byHash.values()].filter((s) => s.size > 1).length;

  return {
    passages: visits.length,
    paires_incompletes: incompletePairs,
    duree_moyenne_visite_min: mean(visitDurations),
    duree_moyenne_visite_engagee_min: mean(engagedOnly),
    duree_moyenne_chantier_min: mean(installDurations),
    temps_total_chez_clients_min: Math.round(
      [...visitDurations, ...installDurations].reduce((s, n) => s + n, 0),
    ),
    alertes: { ...alertes, photos_reutilisees: reused },
    ...(people.length > 0 ? { par_personne: people.sort((a, b) => b.temps_total_min - a.temps_total_min) } : {}),
    note: "durée = entre la photo d'arrivée (check-in) et la photo de fin (check-out) ; paire incomplète = pas de photo d'arrivée, donc durée inconnue",
  };
}
