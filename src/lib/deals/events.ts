import 'server-only';

import type { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type DealEventKind =
  | 'created'
  | 'stage'
  | 'product'
  | 'value'
  | 'person'
  | 'install_flag'
  | 'renamed'
  | 'deleted';

export interface DealEvent {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  deal_title: string | null;
  kind: DealEventKind;
  from_label: string | null;
  to_label: string | null;
  actor_id: string | null;
  at: string;
}

/**
 * Record one change to an affaire.
 *
 * Never throws and never blocks the write it describes: a journal that can
 * take a stage change down with it would be worse than no journal. A
 * pre-0034 database simply records nothing.
 */
export async function logDealEvent(
  db: ServerClient,
  e: {
    dealId: string;
    contactId: string | null;
    dealTitle: string | null;
    kind: DealEventKind;
    from?: string | null;
    to?: string | null;
    actorId: string | null;
  },
): Promise<void> {
  try {
    await db.from('deal_events').insert({
      deal_id: e.dealId,
      contact_id: e.contactId,
      deal_title: e.dealTitle,
      kind: e.kind,
      from_label: e.from ?? null,
      to_label: e.to ?? null,
      actor_id: e.actorId,
    });
  } catch {
    // Table missing, or RLS refused — the change itself already happened.
  }
}

/**
 * Several fields can move in one save (choosing a product also moves the
 * value), so the diff is computed once and written as separate lines: one
 * fact per row keeps the fil readable and the counting honest.
 */
export async function logDealDiff(
  db: ServerClient,
  base: { dealId: string; contactId: string | null; dealTitle: string | null; actorId: string | null },
  changes: { kind: DealEventKind; from?: string | null; to?: string | null }[],
): Promise<void> {
  for (const c of changes) {
    await logDealEvent(db, { ...base, kind: c.kind, from: c.from, to: c.to });
  }
}

/** Money as the rest of the app writes it, so a diff reads like the field it changed. */
export const fcfa = (n: number | null | undefined): string =>
  n == null ? '—' : `${Number(n).toLocaleString('fr-FR')} F`;
