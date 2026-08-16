'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_POINTS, type PointConfig } from '@/lib/leaderboard/score';

export type SavePointsResult = { ok: true } | { ok: false; error: string };

/** Admin: store the leaderboard point values (app_settings, RLS = admin). */
export async function saveLeaderboardPoints(
  input: Partial<PointConfig>,
): Promise<SavePointsResult> {
  await requireRole(['admin']);

  const value: PointConfig = { ...DEFAULT_POINTS };
  for (const k of Object.keys(DEFAULT_POINTS) as (keyof PointConfig)[]) {
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      return { ok: false, error: 'invalid' };
    }
    value[k] = Math.round(n);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key: 'leaderboard_points', value, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  if (error) return { ok: false, error: 'saveError' };

  revalidatePath('/[locale]/leaderboard', 'page');
  return { ok: true };
}
