/** Public URL of a dish photo. The `menu` bucket is public for reads. */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base}/storage/v1/object/public/menu/${path}` : null;
}

/**
 * Thumbnail budget. The CRM compresses its evidence photos to 1024px / 0.6MB;
 * for a menu tile that is fifteen times too heavy — a twenty-dish grid would be
 * 12MB, unusable on 3G. 480px of WebP lands around 25–40KB.
 */
export const THUMB = { maxWidthOrHeight: 480, maxSizeMB: 0.05, fileType: 'image/webp' as const };
