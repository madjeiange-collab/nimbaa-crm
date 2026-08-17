'use client';

import { useEffect } from 'react';

/** Registers the thin-offline service worker (public/sw.js). */
export function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
