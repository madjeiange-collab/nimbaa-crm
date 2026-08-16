import type { SupabaseClient } from '@supabase/supabase-js';
import { DISPOSITIONS, type KnockDisposition } from './dispositions';

/**
 * Admin-adjustable presentation of the visit outcomes (app_settings key
 * 'visit_dispositions'): custom label and active flag per outcome. The
 * BEHAVIOUR of each outcome (creates a lead, wins a deal, needs an
 * appointment…) stays fixed in code — only wording and visibility move.
 */
export interface DispositionSetting {
  label: string | null; // null → use the default i18n label
  active: boolean;
}
export type DispositionConfig = Record<KnockDisposition, DispositionSetting>;

export const DISPOSITION_SETTINGS_KEY = 'visit_dispositions';

export async function getDispositionConfig(db: SupabaseClient): Promise<DispositionConfig> {
  const { data } = await db
    .from('app_settings')
    .select('value')
    .eq('key', DISPOSITION_SETTINGS_KEY)
    .maybeSingle();
  const stored = (data?.value ?? {}) as Partial<
    Record<KnockDisposition, { label?: unknown; active?: unknown }>
  >;
  const cfg = {} as DispositionConfig;
  for (const d of DISPOSITIONS) {
    const s = stored[d.key] ?? {};
    const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim() : null;
    cfg[d.key] = { label, active: s.active !== false };
  }
  // Never let a broken config blank the form: if everything is off, all on.
  if (DISPOSITIONS.every((d) => !cfg[d.key].active)) {
    for (const d of DISPOSITIONS) cfg[d.key].active = true;
  }
  return cfg;
}
