import 'server-only';

import type { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Recompute the customer-level rollup on a contact from its deals. `lifecycle`
 * and `value_xof` are kept on the contact so every existing lifecycle/value
 * reader (contacts list tabs, /stats, dashboard KPIs, map pin colours) keeps
 * working. Call after any deal mutation.
 *  - lifecycle: customer if any deal won, else lead if any open, else lost if
 *    any lost, else lead.
 *  - value_xof: sum of non-lost deal values (realised + pipeline).
 *  - converted_at: earliest won_at once the contact has a won deal.
 */
export async function recomputeContactRollup(
  supabase: ServerClient,
  contactId: string,
): Promise<void> {
  const { data } = await supabase
    .from('deals')
    .select('status, value_xof, won_at')
    .eq('contact_id', contactId);
  const deals = (data ?? []) as { status: string; value_xof: number | null; won_at: string | null }[];

  const hasWon = deals.some((d) => d.status === 'won');
  const hasOpen = deals.some((d) => d.status === 'open');
  const hasLost = deals.some((d) => d.status === 'lost');
  const lifecycle = hasWon ? 'customer' : hasOpen ? 'lead' : hasLost ? 'lost' : 'lead';

  const active = deals.filter((d) => d.status !== 'lost');
  const value = active.length ? active.reduce((s, d) => s + (d.value_xof ?? 0), 0) : null;

  const patch: Record<string, unknown> = {
    lifecycle,
    value_xof: value,
    updated_at: new Date().toISOString(),
  };
  const wonAts = deals
    .filter((d) => d.status === 'won' && d.won_at)
    .map((d) => d.won_at as string)
    .sort();
  if (wonAts.length) patch.converted_at = wonAts[0];

  await supabase.from('contacts').update(patch).eq('id', contactId);
}
