/**
 * Browser-side media store: keeps imported photos and videos in IndexedDB
 * until the API has real storage. Falls back to memory when IndexedDB is
 * unavailable (private windows, tests), so imports still work for the tab.
 */

export interface StoredMedia {
  id: string;
  blob: Blob;
}

const DB_NAME = "bb-media";
const STORE = "files";

const memory = new Map<string, Blob>();
/** Object URLs are cached per id for the life of the tab. */
const urls = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  memory.set(id, blob);
  await run("readwrite", (s) => s.put(blob, id));
}

export async function getBlob(id: string): Promise<Blob | null> {
  const hit = memory.get(id);
  if (hit) return hit;
  const blob = await run<Blob>("readonly", (s) => s.get(id) as IDBRequest<Blob>);
  if (blob) memory.set(id, blob);
  return blob ?? null;
}

export async function deleteBlob(id: string): Promise<void> {
  memory.delete(id);
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  await run("readwrite", (s) => s.delete(id));
}

export async function blobUrl(id: string): Promise<string | null> {
  const cached = urls.get(id);
  if (cached) return cached;
  const blob = await getBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}
