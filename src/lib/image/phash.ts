/**
 * Perceptual hash (dHash) of an image blob — 64 bits as 16 hex chars.
 * Two photos of the same scene hash identically (or nearly), regardless of
 * re-compression, so a rep reusing one photo across several visits is
 * detectable server-side with a simple equality/grouping query.
 */
export async function dHash(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, 9, 8);
    if ('close' in bitmap) bitmap.close();

    const { data } = ctx.getImageData(0, 0, 9, 8);
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    // Each bit: is this pixel brighter than its right neighbour?
    let hash = '';
    let nibble = 0;
    let bits = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = gray[y * 9 + x];
        const right = gray[y * 9 + x + 1];
        nibble = (nibble << 1) | (left > right ? 1 : 0);
        bits++;
        if (bits === 4) {
          hash += nibble.toString(16);
          nibble = 0;
          bits = 0;
        }
      }
    }
    return hash;
  } catch {
    return null; // hashing is best-effort — never blocks a save
  }
}

/** Per-photo forensic metadata stored alongside the storage path. */
export interface PhotoMeta {
  kind: 'arrival' | 'completion' | 'extra';
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  capturedAt: string; // ISO
  phash: string | null;
}
