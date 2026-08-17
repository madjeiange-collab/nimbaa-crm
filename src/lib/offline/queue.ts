import type { SaveVisitInput } from '@/lib/visits/actions';

/**
 * Thin offline write-queue (Phase 4): visits captured without network are
 * stored in IndexedDB — payload + processed photo blobs — and flushed by
 * lib/offline/sync when connectivity returns. Hand-rolled IndexedDB (no
 * dependency): one store, keyed by the visit's idempotent client_uuid.
 */

const DB_NAME = 'nimbaa-offline';
const STORE = 'pending_visits';

/** Fired on window whenever the queue changes — the indicator listens. */
export const QUEUE_EVENT = 'nimbaa-offline-queue';

export interface QueuedVisit {
  clientUuid: string;
  /** The rep saving the visit — needed for the photo storage path on sync. */
  repId: string;
  payload: Omit<SaveVisitInput, 'photoPaths' | 'clientUuid'>;
  photos: Blob[];
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'clientUuid' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await run(fn(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

export function notifyQueueChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}

export async function enqueueVisit(v: QueuedVisit): Promise<void> {
  await withStore('readwrite', (s) => s.put(v));
  notifyQueueChanged();
}

export async function listQueuedVisits(): Promise<QueuedVisit[]> {
  return withStore('readonly', (s) => s.getAll() as IDBRequest<QueuedVisit[]>);
}

export async function removeQueuedVisit(clientUuid: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(clientUuid));
}

export async function countQueuedVisits(): Promise<number> {
  return withStore('readonly', (s) => s.count());
}
