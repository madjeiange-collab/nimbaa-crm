import { saveVisit } from '@/lib/visits/actions';
import { saveInstallation } from '@/lib/installations/actions';
import { uploadVisitPhoto } from '@/lib/visits/upload';
import {
  listQueuedVisits,
  removeQueuedVisit,
  listQueuedInstalls,
  removeQueuedInstall,
  countQueuedTotal,
  notifyQueueChanged,
} from '@/lib/offline/queue';

export interface FlushResult {
  synced: number;
  /** Dropped permanently (e.g. do-not-knock rejection while queued). */
  blocked: number;
  remaining: number;
}

let flushing = false;

/**
 * Pushes queued visits to the server: uploads the stored photo blobs, then
 * calls the normal saveVisit action (idempotent via client_uuid, so a retry
 * after a lost response can't duplicate). Stops at the first network failure
 * and leaves the rest queued for the next attempt.
 */
export async function flushVisitQueue(): Promise<FlushResult> {
  if (flushing || typeof navigator === 'undefined' || !navigator.onLine) {
    const remaining = await countQueuedTotal().catch(() => 0);
    return { synced: 0, blocked: 0, remaining };
  }
  flushing = true;
  let synced = 0;
  let blocked = 0;
  try {
    const queued = await listQueuedVisits();
    for (const q of queued) {
      try {
        const photoPaths = await Promise.all(
          q.photos.map((blob, i) => uploadVisitPhoto(q.repId, q.clientUuid, i, blob)),
        );
        const res = await saveVisit({ ...q.payload, clientUuid: q.clientUuid, photoPaths });
        if (res.ok) {
          await removeQueuedVisit(q.clientUuid);
          synced++;
        } else if (res.error === 'do_not_knock') {
          // Authoritative rejection — keeping it queued would retry forever.
          await removeQueuedVisit(q.clientUuid);
          blocked++;
        } else if (res.error === 'unauthenticated') {
          break; // session expired — keep the queue, retry after next login
        }
        // save_failed: transient (e.g. DB hiccup) — keep it for the next round.
      } catch {
        break; // network dropped mid-flush — stop, the rest stays queued
      }
    }
    // Installation trips queue the same way (idempotent via client_uuid).
    for (const q of await listQueuedInstalls()) {
      try {
        const photoPaths = await Promise.all(
          q.photos.map((blob, i) => uploadVisitPhoto(q.installerId, q.clientUuid, i, blob)),
        );
        const res = await saveInstallation({ ...q.payload, clientUuid: q.clientUuid, photoPaths });
        if (res.ok) {
          await removeQueuedInstall(q.clientUuid);
          synced++;
        } else if (res.error === 'unauthenticated') {
          break;
        }
      } catch {
        break;
      }
    }

    const remaining = await countQueuedTotal();
    if (synced + blocked > 0) notifyQueueChanged();
    return { synced, blocked, remaining };
  } finally {
    flushing = false;
  }
}
