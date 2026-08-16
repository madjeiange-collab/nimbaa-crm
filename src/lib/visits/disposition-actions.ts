'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { DISPOSITIONS, type KnockDisposition } from './dispositions';
import { DISPOSITION_SETTINGS_KEY, type DispositionConfig } from './disposition-config';

export type SaveDispositionsResult = { ok: true } | { ok: false; error: string };

/** Admin: store custom labels + visibility of the visit outcomes. */
export async function saveDispositionSettings(
  input: Partial<Record<KnockDisposition, { label?: string; active?: boolean }>>,
): Promise<SaveDispositionsResult> {
  await requireRole(['admin']);

  const value = {} as DispositionConfig;
  let anyActive = false;
  for (const d of DISPOSITIONS) {
    const s = input[d.key] ?? {};
    const label = typeof s.label === 'string' ? s.label.trim().slice(0, 40) : '';
    const active = s.active !== false;
    if (active) anyActive = true;
    value[d.key] = { label: label || null, active };
  }
  if (!anyActive) return { ok: false, error: 'atLeastOne' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key: DISPOSITION_SETTINGS_KEY, value, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  if (error) return { ok: false, error: 'saveError' };

  revalidatePath('/[locale]/visit/new', 'page');
  revalidatePath('/[locale]/admin/dispositions', 'page');
  return { ok: true };
}
