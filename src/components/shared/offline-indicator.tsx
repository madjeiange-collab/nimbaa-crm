'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CloudOff, RefreshCw, Loader2 } from 'lucide-react';
import { countQueuedTotal, QUEUE_EVENT } from '@/lib/offline/queue';
import { flushVisitQueue } from '@/lib/offline/sync';

/**
 * Slim banner under the app header: shows offline state and the number of
 * visits waiting to sync. Auto-flushes when connectivity returns, when the
 * app regains focus, and on mount; renders nothing when all is well.
 */
export function OfflineIndicator() {
  const t = useTranslations('offline');
  const [online, setOnline] = useState(true);
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    countQueuedTotal()
      .then(setCount)
      .catch(() => undefined);
  }, []);

  const flush = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await flushVisitQueue();
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [syncing, refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    // A moment after load, quietly push anything left from a previous outing.
    const kick = window.setTimeout(() => void flush(), 2500);

    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);
    const onQueue = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        if (navigator.onLine) void flush();
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(QUEUE_EVENT, onQueue);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(kick);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(QUEUE_EVENT, onQueue);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (online && count === 0) return null;

  return (
    <div
      className={`border-b px-4 py-1.5 text-xs font-medium ${
        online ? 'bg-brand-amber/15 text-brand-brown' : 'bg-destructive/10 text-destructive'
      }`}
      role="status"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          {online ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <CloudOff className="h-3.5 w-3.5" />
          )}
          {online
            ? t('pending', { count })
            : count > 0
              ? t('offlineWithPending', { count })
              : t('offline')}
        </span>
        {online && count > 0 && (
          <button
            type="button"
            onClick={() => void flush()}
            disabled={syncing}
            className="flex items-center gap-1 underline"
          >
            {syncing && <Loader2 className="h-3 w-3 animate-spin" />}
            {syncing ? t('syncing') : t('syncNow')}
          </button>
        )}
      </div>
    </div>
  );
}
