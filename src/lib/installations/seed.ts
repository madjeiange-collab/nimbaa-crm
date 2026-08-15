import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { freshChecklist, OPEN_INSTALL_STATUSES } from '@/lib/installations/protocol';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Ensure a won customer has at least one OPEN installation job. Called from the
 * win paths (convert / won stage / sold knock). Idempotent: if the customer
 * already has an open job it does nothing, so re-saving a won stage never spawns
 * duplicate jobs. Additional jobs are added explicitly from the contact page.
 */
export async function ensurePendingInstallation(
  supabase: ServerClient,
  contactId: string,
  createdBy: string | null,
): Promise<void> {
  const { data: open } = await supabase
    .from('installations')
    .select('id')
    .eq('contact_id', contactId)
    .in('status', OPEN_INSTALL_STATUSES)
    .limit(1);
  if (open && open.length > 0) return;

  await supabase.from('installations').insert({
    contact_id: contactId,
    status: 'pending',
    checklist: freshChecklist(),
    created_by: createdBy,
  });
}
