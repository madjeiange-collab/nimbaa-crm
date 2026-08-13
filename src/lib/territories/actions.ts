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
}): Promise<SaveTerritoryResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'noName' };
  if (!input.geometry) return { ok: false, error: 'noPolygon' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_territory', {
    p_name: name,
    p_type: input.type,
    p_geojson: input.geometry as unknown as Record<string, unknown>,
  });

  if (error) {
    return { ok: false, error: 'territorySaveError' };
  }

  revalidatePath('/[locale]/admin/territories', 'page');
  return { ok: true, id: data as string };
}
