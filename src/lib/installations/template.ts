import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { freshChecklist } from '@/lib/installations/protocol';
import type { ChecklistItem } from '@/types/database';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Build a fresh checklist for a new installation job from the admin-editable
 * protocol template (`install_protocol_steps`). The active steps are copied
 * onto the job in order, so later template edits never touch jobs in flight.
 * Falls back to the code default if the table is empty or missing (e.g. before
 * migration 0006 is applied).
 */
export async function getTemplateChecklist(
  supabase: ServerClient,
): Promise<ChecklistItem[]> {
  const { data, error } = await supabase
    .from('install_protocol_steps')
    .select('key, label')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error || !data || data.length === 0) return freshChecklist();

  return data.map((s: { key: string; label: string }) => ({
    key: s.key,
    label: s.label,
    done: false,
  }));
}
