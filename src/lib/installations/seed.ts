import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { OPEN_INSTALL_STATUSES } from '@/lib/installations/protocol';
import { getTemplateChecklist } from '@/lib/installations/template';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Ensure a WON deal that needs installation has an open installation job.
 * Idempotent: if the deal already has an open job it does nothing, so re-winning
 * never spawns duplicates. Keyed on the deal; `contactId` is carried onto the
 * job (denormalised) for the many readers that reach the customer through it.
 */
export async function ensurePendingInstallation(
  supabase: ServerClient,
  args: { dealId: string; contactId: string; title?: string | null; createdBy: string | null },
): Promise<void> {
  const { data: open } = await supabase
    .from('installations')
    .select('id')
    .eq('deal_id', args.dealId)
    .in('status', OPEN_INSTALL_STATUSES)
    .limit(1);
  if (open && open.length > 0) return;

  const checklist = await getTemplateChecklist(supabase);
  await supabase.from('installations').insert({
    deal_id: args.dealId,
    contact_id: args.contactId,
    title: args.title ?? null,
    status: 'pending',
    checklist,
    created_by: args.createdBy,
  });
}
