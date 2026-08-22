'use client';

import { useRef, useState } from 'react';
import imageCompression from 'browser-image-compression';
import { createClient } from '@/lib/supabase/client';
import { THUMB } from '@/lib/ui/photo';
import { tileColour, tileInitials } from '@/lib/ui/tile';

/**
 * Take the dish's photo, compress it, upload it, and hand the resulting path to
 * the surrounding form through a hidden input.
 *
 * `capture="environment"` opens the camera directly on a phone rather than a
 * file browser — the patron is standing in his own kitchen, not managing files.
 *
 * Compression happens here, before the upload, because the connection is the
 * scarce resource: sending 3MB to have the server shrink it is the one thing
 * this must not do.
 */
export function PhotoField({
  restaurantId, name, label = 'Photo du plat', dishName = '',
}: {
  restaurantId: string;
  name: string;
  label?: string;
  dishName?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null);
    try {
      // useWebWorker: false on purpose. With the worker enabled the library
      // fetches its worker script from a public CDN at runtime — a third-party
      // request on every photo, which fails outright behind a strict CSP and
      // wastes seconds on a weak connection. Compressing to 480px on the main
      // thread costs a brief pause and no network at all.
      const small = await imageCompression(file, { ...THUMB, useWebWorker: false });
      const key = `${restaurantId}/${crypto.randomUUID()}.webp`;
      const { error: upErr } = await createClient().storage
        .from('menu').upload(key, small, { contentType: 'image/webp', upsert: false });
      if (upErr) throw upErr;
      setPath(key);
      setSize(Math.round(small.size / 1024));
      setPreview(URL.createObjectURL(small));
    } catch {
      // A failed photo must not block the dish: the fallback tile carries it.
      setError("La photo n'a pas pu être envoyée. Le plat peut être créé sans.");
    } finally {
      setBusy(false);
    }
  }

  // An empty photo button is not standing in for a dish, so it must not borrow
  // a dish's colour — that would make it look like a tile that already means
  // something. Neutral until there is a name to derive from.
  const { bg, fg } = dishName
    ? tileColour(dishName)
    : { bg: 'var(--tw-empty,#EEEEE7)', fg: '#868C83' };

  return (
    <div>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      <input ref={input} type="file" accept="image/*" capture="environment"
             onChange={onPick} className="hidden" data-photo-input />
      <input type="hidden" name={name} value={path} />

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="relative flex aspect-[3/4] w-32 items-center justify-center overflow-hidden
                   rounded-xl border border-dashed border-rule text-center disabled:opacity-60"
        style={preview ? undefined : { background: bg }}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="text-2xl font-bold" style={{ color: fg }}>
            {busy ? '…' : dishName ? tileInitials(dishName) : '📷'}
          </span>
        )}
        <span className="absolute bottom-1 left-1 right-1 rounded bg-black/60 px-1 py-0.5
                         text-[10px] text-white">
          {busy ? 'envoi…' : preview ? `remplacer · ${size} Ko` : 'prendre la photo'}
        </span>
      </button>

      {error && <p role="alert" className="mt-1.5 text-sm text-red-800">{error}</p>}
    </div>
  );
}
