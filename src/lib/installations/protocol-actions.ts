'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath('/[locale]/admin/protocol', 'page');
}

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'step'}_${suffix}`;
}

/** Add a step at the end of the protocol. */
export async function addProtocolStep(label: string): Promise<ActionResult> {
  const clean = label.trim();
  if (!clean) return { ok: false, error: 'empty' };
  const supabase = await createClient();

  const { data: last } = await supabase
    .from('install_protocol_steps')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (last?.sort_order ?? 0) + 1;

  const { error } = await supabase
    .from('install_protocol_steps')
    .insert({ key: slugify(clean), label: clean, sort_order: nextOrder });
  if (error) return { ok: false, error: 'save_failed' };
  revalidate();
  return { ok: true };
}

/** Rename a step or toggle it active/inactive. */
export async function updateProtocolStep(
  id: string,
  fields: { label?: string; is_active?: boolean },
): Promise<ActionResult> {
  const patch: Record<string, unknown> = {};
  if (fields.label !== undefined) {
    const clean = fields.label.trim();
    if (!clean) return { ok: false, error: 'empty' };
    patch.label = clean;
  }
  if (fields.is_active !== undefined) patch.is_active = fields.is_active;

  const supabase = await createClient();
  const { error } = await supabase
    .from('install_protocol_steps')
    .update(patch)
    .eq('id', id);
  if (error) return { ok: false, error: 'save_failed' };
  revalidate();
  return { ok: true };
}

/** Delete a step from the protocol. */
export async function deleteProtocolStep(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('install_protocol_steps').delete().eq('id', id);
  if (error) return { ok: false, error: 'save_failed' };
  revalidate();
  return { ok: true };
}

/** Move a step up or down by swapping sort_order with its neighbour. */
export async function moveProtocolStep(
  id: string,
  direction: 'up' | 'down',
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: steps } = await supabase
    .from('install_protocol_steps')
    .select('id, sort_order')
    .order('sort_order', { ascending: true });
  if (!steps) return { ok: false, error: 'save_failed' };

  const idx = steps.findIndex((s: { id: string }) => s.id === id);
  if (idx === -1) return { ok: false, error: 'not_found' };
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= steps.length) return { ok: true }; // already at edge

  const a = steps[idx] as { id: string; sort_order: number };
  const b = steps[swapIdx] as { id: string; sort_order: number };
  await Promise.all([
    supabase.from('install_protocol_steps').update({ sort_order: b.sort_order }).eq('id', a.id),
    supabase.from('install_protocol_steps').update({ sort_order: a.sort_order }).eq('id', b.id),
  ]);
  revalidate();
  return { ok: true };
}
