'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface GeoState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  status: 'idle' | 'locating' | 'ready' | 'error';
  error: string | null;
}

/**
 * One-shot + refreshable geolocation for the Quick Knock screen.
 * Auto-locates on mount (the pin should already be dropping when the rep opens
 * the screen — every second counts against the <15s budget).
 */
export function useGeolocation(autoStart = true) {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lng: null,
    accuracy: null,
    status: 'idle',
    error: null,
  });
  const mounted = useRef(true);

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState((s) => ({ ...s, status: 'error', error: 'unsupported' }));
      return;
    }
    setState((s) => ({ ...s, status: 'locating', error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mounted.current) return;
        setState({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          status: 'ready',
          error: null,
        });
      },
      (err) => {
        if (!mounted.current) return;
        setState((s) => ({
          ...s,
          status: 'error',
          error: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable',
        }));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (autoStart) locate();
    return () => {
      mounted.current = false;
    };
  }, [autoStart, locate]);

  return { ...state, locate };
}
