'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { signOut } from '@/lib/auth/actions';
import { countQueuedTotal } from '@/lib/offline/queue';
import { flushVisitQueue } from '@/lib/offline/sync';
import { Button } from '@/components/ui/button';

/**
 * Signs out and wipes the device-local traces (service-worker page caches +
 * offline queue) so the next user of a shared phone can't see the previous
 * rep's pages. Tries to sync pending offline work first; warns before
 * discarding anything unsynced.
 */
async function clearLocalData() {
  try {
    if ('caches' in window) {
      for (const key of await caches.keys()) await caches.delete(key);
    }
  } catch {
    // cache API unavailable — nothing to clear
  }
  try {
    indexedDB.deleteDatabase('nimbaa-offline');
  } catch {
    // ignore
  }
}

export function LogoutButton() {
  const t = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          // Push any offline-captured visits before the session goes away.
          try {
            if (navigator.onLine) await flushVisitQueue();
            const remaining = await countQueuedTotal().catch(() => 0);
            if (remaining > 0 && !window.confirm(t('logoutUnsynced', { count: remaining }))) {
              return;
            }
          } catch {
            // queue unavailable — proceed with the normal logout
          }
          await signOut();
          await clearLocalData();
          router.replace('/login');
          router.refresh();
        })
      }
      aria-label={t('logout')}
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden sm:inline">{t('logout')}</span>
    </Button>
  );
}
