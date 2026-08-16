'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export type StageActionResult = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath('/[locale]/admin/stages', 'page');
  revalidatePath('/[locale]/dashboard/pipeline', 'page');
  revalidatePath('/[locale]/contacts', 'page');
}

/** Adds a stage at the end of the list. */
export async function addStage(name: string): Promise<StageActionResult> {
  await requireRole(['admin']);
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return { ok: false, error: 'noName' };

  const supabase = await createClient();
  const { data: max } = await supabase
    .from('pipeline_stages')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from('pipeline_stages')
    .insert({ name: trimmed, sort_order: (max?.sort_order ?? 0) + 1 });
  if (error) return { ok: false, error: 'saveError' };
  revalidate();
  return { ok: true };
}

/** Renames a stage (system stages included — automation matches by key). */
export async function renameStage(id: string, name: string): Promise<StageActionResult> {
  await requireRole(['admin']);
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return { ok: false, error: 'noName' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('pipeline_stages')
    .update({ name: trimmed })
    .eq('id', id);
  if (error) return { ok: false, error: 'saveError' };
  revalidate();
  return { ok: true };
}

/** Persists a full new order (array of stage ids, first = leftmost column). */
export async function reorderStages(ids: string[]): Promise<StageActionResult> {
  await requireRole(['admin']);
  const supabase = await createClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from('pipeline_stages')
      .update({ sort_order: i + 1 })
      .eq('id', ids[i]);
    if (error) return { ok: false, error: 'saveError' };
  }
  revalidate();
  return { ok: true };
}

/** Shows/hides a stage in dropdowns and on the board. */
export async function setStageActive(id: string, active: boolean): Promise<StageActionResult> {
  await requireRole(['admin']);
  const supabase = await createClient();
  // System stages must stay active — the sold/interested/RDV flows target them.
  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('system_key')
    .eq('id', id)
    .maybeSingle();
  if (!active && stage?.system_key) return { ok: false, error: 'systemStage' };

  const { error } = await supabase
    .from('pipeline_stages')
    .update({ is_active: active })
    .eq('id', id);
  if (error) return { ok: false, error: 'saveError' };
  revalidate();
  return { ok: true };
}

/** Deletes a stage — only non-system stages with no deals/contacts on them. */
export async function deleteStage(id: string): Promise<StageActionResult> {
  await requireRole(['admin']);
  const supabase = await createClient();

  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('system_key')
    .eq('id', id)
    .maybeSingle();
  if (stage?.system_key) return { ok: false, error: 'systemStage' };

  const [{ count: deals }, { count: contacts }] = await Promise.all([
    supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('pipeline_stage_id', id),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('pipeline_stage_id', id),
  ]);
  if ((deals ?? 0) > 0 || (contacts ?? 0) > 0) return { ok: false, error: 'stageInUse' };

  const { error } = await supabase.from('pipeline_stages').delete().eq('id', id);
  if (error) return { ok: false, error: 'saveError' };
  revalidate();
  return { ok: true };
}
