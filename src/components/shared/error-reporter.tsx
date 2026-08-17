'use client';

import { useEffect } from 'react';

/** Reports uncaught browser errors to /api/client-error (max 5 per page). */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const report = (message: string, stack?: string) => {
      if (sent >= 5) return;
      sent++;
      try {
        void fetch('/api/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, stack, url: window.location.pathname }),
          keepalive: true,
        });
      } catch {
        // reporting must never break the app
      }
    };
    const onError = (e: ErrorEvent) => report(e.message, e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
