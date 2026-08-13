'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * Nimbaa brand mark, used throughout the app.
 *
 * Serves /public/nimbaa-logo.png through next/image, which resizes and
 * compresses it (WebP) to the actual display size — critical for the low-data
 * field context (the source PNG is large; reps must never download it in full).
 * Falls back to a styled "Nimbaa" wordmark if the image fails to load.
 *
 * - variant="full"   → large mascot for the login / splash
 * - variant="inline" → compact mark for the app header
 */
const RATIO = 1024 / 1536; // source aspect ratio (w/h)

export function BrandLogo({
  variant = 'inline',
  className = '',
}: {
  variant?: 'full' | 'inline';
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const isFull = variant === 'full';

  if (imgError) {
    return (
      <span
        className={`font-extrabold tracking-wide text-brand-green ${
          isFull ? 'block text-center text-3xl' : 'text-lg'
        } ${className}`}
        style={{ WebkitTextStroke: isFull ? '1px hsl(var(--primary))' : '0.5px hsl(var(--primary))' }}
      >
        {isFull ? 'NIMBAA' : 'Nimbaa'}
      </span>
    );
  }

  const height = isFull ? 128 : 32;
  const width = Math.round(height * RATIO);

  return (
    <Image
      src="/nimbaa-logo.png"
      alt="Nimbaa"
      width={width}
      height={height}
      priority={isFull}
      onError={() => setImgError(true)}
      className={`${isFull ? 'mx-auto' : ''} h-auto w-auto ${className}`}
    />
  );
}
