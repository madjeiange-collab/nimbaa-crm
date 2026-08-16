import imageCompression from 'browser-image-compression';

export interface GeoStamp {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  at: Date;
  address?: string | null;
  /** Who took the photo (commercial / technician) — burned into the stamp. */
  by?: string | null;
}

function formatDateTime(d: Date): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/**
 * Prepares a check-in photo: downscales + compresses to the low-data spec
 * (max 1024px, JPEG ~0.7), then burns a GPS + date/time stamp into the bottom
 * of the image so the location proof is visually baked in (tamper-evident).
 * Returns the final JPEG blob ready for upload.
 */
export async function processCheckInPhoto(file: File, stamp: GeoStamp): Promise<Blob> {
  // 1. Normalise orientation + downscale + compress.
  const compressed = await imageCompression(file, {
    maxWidthOrHeight: 1024,
    maxSizeMB: 0.6,
    initialQuality: 0.7,
    useWebWorker: true,
    fileType: 'image/jpeg',
  });

  // 2. Draw onto a canvas and burn the geo-stamp.
  const bitmap = await createImageBitmap(compressed);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return compressed;

  ctx.drawImage(bitmap, 0, 0);
  if ('close' in bitmap) bitmap.close();

  const pad = Math.round(canvas.width * 0.022);
  const fs = Math.max(13, Math.round(canvas.width * 0.033));
  const lineH = fs * 1.4;

  const gpsLine =
    stamp.lat != null && stamp.lng != null
      ? `GPS ${stamp.lat.toFixed(5)}, ${stamp.lng.toFixed(5)}  ±${Math.round(
          stamp.accuracy ?? 0,
        )} m`
      : 'Position GPS indisponible';
  // Keep the address to a sensible on-image length.
  const address =
    stamp.address && stamp.address.length > 60
      ? stamp.address.slice(0, 57) + '…'
      : stamp.address;
  const by = stamp.by && stamp.by.length > 40 ? stamp.by.slice(0, 37) + '…' : stamp.by;
  const lines = [formatDateTime(stamp.at), by, address, gpsLine].filter(
    (l): l is string => !!l,
  );
  const boxH = lineH * lines.length + pad;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, canvas.height - boxH, canvas.width, boxH);

  ctx.textBaseline = 'top';
  ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  lines.forEach((l, i) =>
    ctx.fillText(l, pad, canvas.height - boxH + pad * 0.4 + i * lineH),
  );

  // Brand tag (lime green) in the corner.
  ctx.fillStyle = 'hsl(88, 54%, 62%)';
  ctx.textAlign = 'right';
  ctx.fillText('NIMBAA', canvas.width - pad, canvas.height - boxH + pad * 0.4);

  return new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? compressed), 'image/jpeg', 0.78),
  );
}
