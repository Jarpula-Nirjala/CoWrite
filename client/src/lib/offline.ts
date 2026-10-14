import type { SavedState } from '../../../shared/sync-client.ts';

/**
 * Local copies of documents in IndexedDB, so they open and stay editable
 * with no connection and survive closing the tab. Unsynced edits are kept
 * in the saved outbox and sent the next time the document is online.
 */

export interface OfflineDoc {
  id: string;
  title: string;
  savedAt: number;
  state: SavedState;
}

const DB_NAME = 'cowrite';
const STORE = 'docs';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const loadOffline = (id: string) => run<OfflineDoc | undefined>('readonly', (s) => s.get(id)).then((d) => d ?? null);
export const saveOffline = (doc: OfflineDoc) => run('readwrite', (s) => s.put(doc));
export const removeOffline = (id: string) => run('readwrite', (s) => s.delete(id));
export const listOffline = () => run<OfflineDoc[]>('readonly', (s) => s.getAll()).then((d) => d ?? []);

/**
 * Two tabs must never write under the same site id, so only the tab holding
 * a document's lock resumes from (and saves to) its local copy. Resolves to
 * a release function, or null when another tab holds the lock.
 */
export function lockDoc(id: string): Promise<(() => void) | null> {
  if (!('locks' in navigator)) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    void navigator.locks.request(`cowrite:${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      return new Promise<void>((release) => resolve(release));
    });
  });
}
