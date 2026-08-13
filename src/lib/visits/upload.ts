'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * Uploads a prepared check-in photo blob to the private visit-photos bucket.
 * Path: <repId>/<clientUuid>-<index>.jpg (RLS keys on the leading uid folder).
 * Returns the storage path to persist in visit_photos.
 */
export async function uploadVisitPhoto(
  repId: string,
  clientUuid: string,
  index: number,
  blob: Blob,
): Promise<string> {
  const supabase = createClient();
  const path = `${repId}/${clientUuid}-${index}.jpg`;
  const { error } = await supabase.storage
    .from('visit-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return path;
}
