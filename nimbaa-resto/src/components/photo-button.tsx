'use client';

import { useRef, useState } from 'react';
import imageCompression from 'browser-image-compression';
import { createClient } from '@/lib/supabase/client';
import { setPhoto } from '@/app/r/[slug]/admin/actions';
import { THUMB } from '@/lib/ui/photo';
import { tileColour, tileInitials } from '@/lib/ui/tile';

/**
 * Take a photo of something that already exists — a category, or a dish that
 * was created without one — and save it immediately.
 *
 * PhotoField is the other half of this: it fills a form that has not been
 * submitted yet, so it can only hand the path to a hidden input. Here the row
 * is already saved, so there is nothing to wait for.
 *
 * Two shapes, one behaviour: `tile` sits in a category row, `corner` sits on a
 * dish card. The corner is where "more about this item" always lives, so the
 * camera there reads as "this tile's picture" and not as a new control.
 */
export function PhotoButton({
  slug, restaurantId, target, id, name, url, variant = 'tile',
}: {
  slug: string;
  restaurantId: string;
  target: 'category' | 'item';
  id: string;
  name: string;
  url?: string | null;
  variant?: 'tile' | 'corner';
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(false); setSaved(false);
    try {
      const small = await imageCompression(file, { ...THUMB, useWebWorker: false });
      const key = `${restaurantId}/${crypto.randomUUID()}.webp`;
      const { error: upErr } = await createClient().storage
        .from('menu').upload(key, small, { contentType: 'image/webp', upsert: false });
      if (upErr) throw upErr;
      // Optimistic: revalidatePath will repaint with the stored path, but on a
      // weak connection that round trip is seconds away, and a photo just taken
      // has to appear at once or it gets taken a second time.
      setPreview(URL.createObjectURL(small));
      await setPhoto({ slug, target, id, path: key });
      setSaved(true);
    } catch {
      setError(true);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? url ?? null;
  const { bg, fg } = tileColour(name);

  const common = (
    <input ref={input} type="file" accept="image/*" capture="environment"
           onChange={onPick} className="hidden" data-photo-input={`${target}:${name}`} />
  );

  if (variant === 'corner') {
    return (
      <>
        {common}
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          data-photo-button={target} data-photo-for={name}
          title={shown ? 'Changer la photo' : 'Prendre la photo'}
          aria-label={shown ? `Changer la photo de ${name}` : `Prendre la photo de ${name}`}
          className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm
                      shadow-sm disabled:opacity-60 ${
            error ? 'border-red-800 bg-white' : 'border-white bg-white/90'}`}>
          {busy ? '…' : error ? '!' : saved ? '✓' : '📷'}
        </button>
      </>
    );
  }

  return (
    <>
      {common}
      <button type="button" onClick={() => input.current?.click()} disabled={busy}
        data-photo-button={target} data-photo-for={name}
        title={shown ? 'Changer la photo' : 'Prendre la photo'}
        aria-label={shown ? `Changer la photo de ${name}` : `Prendre la photo de ${name}`}
        className="relative h-12 w-12 flex-none overflow-hidden rounded-lg border border-rule
                   disabled:opacity-60"
        style={shown ? undefined : { background: bg }}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="text-base font-bold" style={{ color: fg }}>
            {busy ? '…' : error ? '!' : tileInitials(name)}
          </span>
        )}
        <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[9px] leading-4 text-white">
          {busy ? '…' : '📷'}
        </span>
      </button>
    </>
  );
}
