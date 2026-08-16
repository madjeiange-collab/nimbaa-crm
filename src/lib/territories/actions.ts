'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Polygon } from 'geojson';
import type { TerritoryType } from '@/types/database';

export type SaveTerritoryResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Persists an admin-drawn polygon as a territory. The GeoJSON geometry is
 * converted to geography server-side by the create_territory RPC (which also
 * re-checks the admin role, so RLS can't be bypassed from the client).
 */
export async function saveTerritory(input: {
  name: string;
  type: TerritoryType;
  geometry: Polygon;
  description?: string;
}): Promise<SaveTerritoryResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'noName' };
  if (!input.geometry) return { ok: false, error: 'noPolygon' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_territory', {
    p_name: name,
    p_type: input.type,
    p_geojson: input.geometry as unknown as Record<string, unknown>,
    p_description: input.description?.trim() || null,
  });

  if (error) {
    return { ok: false, error: 'territorySaveError' };
  }

  revalidatePath('/[locale]/admin/territories', 'page');
  return { ok: true, id: data as string };
}

/** GeoJSON Polygon → EWKT literal (PostgREST casts the text into geography). */
function polygonToEwkt(p: Polygon): string {
  const rings = p.coordinates
    .map((ring) => '(' + ring.map(([lng, lat]) => `${lng} ${lat}`).join(',') + ')')
    .join(',');
  return `SRID=4326;POLYGON(${rings})`;
}

export type TerritoryActionResult = { ok: true } | { ok: false; error: string };

/**
 * Updates an existing territory. The polygon is only replaced when a new
 * geometry was drawn; name/type/description always update. Direct table
 * write — the terr_admin RLS policy restricts this to admins.
 */
export async function updateTerritory(input: {
  id: string;
  name: string;
  type: TerritoryType;
  description?: string;
  geometry?: Polygon | null;
}): Promise<TerritoryActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'noName' };

  const patch: Record<string, unknown> = {
    name,
    type: input.type,
    description: input.description?.trim() || null,
  };
  if (input.geometry) patch.polygon = polygonToEwkt(input.geometry);

  const supabase = await createClient();
  const { error } = await supabase.from('territories').update(patch).eq('id', input.id);
  if (error) return { ok: false, error: 'territorySaveError' };

  revalidatePath('/[locale]/admin/territories', 'page');
  return { ok: true };
}

/**
 * Deletes a territory. user_territories rows cascade; contacts keep a plain
 * FK, so a territory that still has contacts refuses to delete (23503) and
 * we surface that as "territoryInUse".
 */
export async function deleteTerritory(id: string): Promise<TerritoryActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('territories').delete().eq('id', id);
  if (error) {
    return { ok: false, error: error.code === '23503' ? 'territoryInUse' : 'territorySaveError' };
  }
  revalidatePath('/[locale]/admin/territories', 'page');
  return { ok: true };
}
