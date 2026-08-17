import type { SaveVisitInput } from '@/lib/visits/actions';
import type { SaveInstallationInput } from '@/lib/installations/actions';

/**
 * Thin offline write-queue (Phase 4): visits captured without network are
 * stored in IndexedDB — payload + processed photo blobs — and flushed by
 * lib/offline/sync when connectivity returns. Hand-rolled IndexedDB (no
 * dependency): one store, keyed by the visit's idempotent client_uuid.
 */

const DB_NAME = 'nimbaa-offline';
const STORE = 'pending_visits';
const INSTALL_STORE = 'pending_installs';

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

export interface QueuedInstall {
  clientUuid: string;
  installerId: string;
  payload: Omit<SaveInstallationInput, 'photoPaths' | 'clientUuid'>;
  photos: Blob[];
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'clientUuid' });
      }
      if (!req.result.objectStoreNames.contains(INSTALL_STORE)) {
        req.result.createObjectStore(INSTALL_STORE, { keyPath: 'clientUuid' });
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
  storeName: string = STORE,
): Promise<T> {
  const db = await openDb();
  try {
    return await run(fn(db.transaction(storeName, mode).objectStore(storeName)));
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

export async function enqueueInstall(v: QueuedInstall): Promise<void> {
  await withStore('readwrite', (s) => s.put(v), INSTALL_STORE);
  notifyQueueChanged();
}

export async function listQueuedInstalls(): Promise<QueuedInstall[]> {
  return withStore('readonly', (s) => s.getAll() as IDBRequest<QueuedInstall[]>, INSTALL_STORE);
}

export async function removeQueuedInstall(clientUuid: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(clientUuid), INSTALL_STORE);
}

/** Everything waiting to sync (visits + installations). */
export async function countQueuedTotal(): Promise<number> {
  const visits = await countQueuedVisits().catch(() => 0);
  const installs = await withStore('readonly', (s) => s.count(), INSTALL_STORE).catch(() => 0);
  return visits + installs;
}
