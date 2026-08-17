import 'server-only';

import { createClient } from '@/lib/supabase/server';

/** Daily per-user cap for the voice endpoints (transcriptions + TTS clips).
 *  Generous — a full voice-mode day — but bounds a runaway loop's cost. */
export const DAILY_AUDIO_CAP = 120;

/**
 * Counts one audio clip against today's quota; false = over cap.
 * Degrades OPEN if the audio_clips column is not deployed yet (0020) —
 * never blocks the field on a missing migration.
 */
export async function consumeAudioQuota(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const day = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('ai_usage')
    .select('audio_clips')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle();
  if (error) return true;
  const used = (data?.audio_clips as number | null) ?? 0;
  if (used >= DAILY_AUDIO_CAP) return false;
  await supabase
    .from('ai_usage')
    .upsert({ user_id: userId, day, audio_clips: used + 1 }, { onConflict: 'user_id,day' });
  return true;
}
