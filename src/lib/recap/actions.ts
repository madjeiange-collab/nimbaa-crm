'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export type RecapSettingsResult = { ok: true } | { ok: false; error: string };

/** Admin: send hour of the daily brief + the reps' daily visit goal. */
export async function saveRecapSettings(input: {
  hour: number;
  dailyGoal: number;
}): Promise<RecapSettingsResult> {
  await requireRole(['admin']);
  const hour = Math.round(Number(input.hour));
  const goal = Math.round(Number(input.dailyGoal));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { ok: false, error: 'invalid' };
  if (!Number.isInteger(goal) || goal < 1 || goal > 200) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const now = new Date().toISOString();
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase
      .from('app_settings')
      .upsert({ key: 'recap_schedule', value: { hour }, updated_at: now }, { onConflict: 'key' }),
    supabase
      .from('app_settings')
      .upsert({ key: 'daily_visit_goal', value: { goal }, updated_at: now }, { onConflict: 'key' }),
  ]);
  if (e1 || e2) return { ok: false, error: 'saveError' };
  revalidatePath('/[locale]/admin/recap', 'page');
  return { ok: true };
}
