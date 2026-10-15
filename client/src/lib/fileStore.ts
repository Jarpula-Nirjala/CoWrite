/**
 * Attachment contents for the assistant, kept in IndexedDB (hundreds of MB) rather than localStorage (about 5 MB),
 * so a chat's PDFs, images and text files are still there after a reload.
 */
const DB = 'cowrite-assistant';
const STORE = 'files';

export interface StoredFile {
  text?: string;
  data?: string;
}

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opening ??= new Promise((ok, no) => {
    if (typeof indexedDB === 'undefined') return no(new Error('IndexedDB is not available.'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });
  // A failed open (private mode, blocked storage) is retried next time instead of being remembered.
  opening.catch(() => (opening = null));
  return opening;
}

function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((ok, no) => {
        const tx = d.transaction(STORE, mode);
        const req = work(tx.objectStore(STORE));
        tx.oncomplete = () => ok(req ? req.result : undefined);
        tx.onerror = () => no(tx.error);
        tx.onabort = () => no(tx.error);
      }),
  );
}

export const putFile = (id: string, f: StoredFile) => run('readwrite', (s) => void s.put(f, id)).then(() => true, () => false);
export const getFile = (id: string) => run<StoredFile>('readonly', (s) => s.get(id)).catch(() => undefined);
export const deleteFiles = (ids: string[]) => (ids.length ? run('readwrite', (s) => ids.forEach((id) => s.delete(id))).catch(() => undefined) : Promise.resolve(undefined));
