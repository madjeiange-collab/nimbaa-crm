import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChecklistItem } from '@/types/database';

export interface TripRow {
  id: string;
  at: string;
  startedAt: string | null;
  durationMin: number | null;
  by: string | null;
  outcome: string | null;
  note: string | null;
  stepsDone: number | null;
  stepsTotal: number | null;
  photos: { kind: string; url: string }[];
}

export interface JobHistory {
  installationId: string;
  trips: TripRow[];
  /** Returns asked for = trips that ended needing another one. */
  returns: number;
  totalMinutes: number;
  firstTrip: string | null;
  lastTrip: string | null;
}

/**
 * The trips of one job, oldest first: when, how long, who, what they concluded,
 * how far the protocol stood and the two photos of each passage. Needs 0026 —
 * before it, trips carry no installation_id and this returns nothing rather
 * than guessing.
 */
export async function loadJobHistory(
  db: SupabaseClient,
  installationId: string,
): Promise<JobHistory | null> {
  const { data, error } = await db
    .from('visits')
    .select(
      'id, visited_at, started_at, notes, install_status, checklist_snapshot, rep_id, users:rep_id(full_name, username)',
    )
    .eq('installation_id', installationId)
    .order('visited_at', { ascending: true })
    .limit(50);
  if (error || (data ?? []).length === 0) return null;

  const rows = data as unknown as {
    id: string;
    visited_at: string;
    started_at: string | null;
    notes: string | null;
    install_status: string | null;
    checklist_snapshot: ChecklistItem[] | null;
    users: { full_name: string | null; username: string | null } | null;
  }[];

  const { data: photoRows } = await db
    .from('visit_photos')
    .select('visit_id, kind, storage_path')
    .in(
      'visit_id',
      rows.map((r) => r.id),
    )
    .in('kind', ['arrival', 'completion'])
    .limit(200);
  const photos = (photoRows ?? []) as { visit_id: string; kind: string; storage_path: string }[];
  const signed = new Map<string, string>();
  if (photos.length > 0) {
    const { data: urls } = await db.storage
      .from('visit-photos')
      .createSignedUrls(photos.map((p) => p.storage_path), 3600);
    for (const u of urls ?? []) if (u.signedUrl && u.path) signed.set(u.path, u.signedUrl);
  }

  const trips: TripRow[] = rows.map((r) => {
    const mine = photos.filter((p) => p.visit_id === r.id);
    const steps = r.checklist_snapshot;
    return {
      id: r.id,
      at: r.visited_at,
      startedAt: r.started_at,
      durationMin: r.started_at
        ? Math.round((new Date(r.visited_at).getTime() - new Date(r.started_at).getTime()) / 60_000)
        : null,
      by: r.users?.full_name || r.users?.username || null,
      outcome: r.install_status,
      note: r.notes,
      stepsDone: steps ? steps.filter((s) => s.done).length : null,
      stepsTotal: steps ? steps.length : null,
      photos: mine
        .map((p) => ({ kind: p.kind, url: signed.get(p.storage_path) ?? '' }))
        .filter((p) => p.url),
    };
  });

  return {
    installationId,
    trips,
    returns: trips.filter((t) => t.outcome === 'needs_revisit').length,
    totalMinutes: trips.reduce((s, t) => s + (t.durationMin ?? 0), 0),
    firstTrip: trips[0]?.startedAt ?? trips[0]?.at ?? null,
    lastTrip: trips[trips.length - 1]?.at ?? null,
  };
}
