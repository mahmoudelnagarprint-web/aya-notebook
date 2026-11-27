/** Minimal IndexedDB key-value store — no dependencies. */
const DB_NAME = 'ayatodoist';
const STORE = 'kv';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return await tx<T>('readonly', (store) => store.get(key) as IDBRequest<T>);
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    await tx('readwrite', (store) => store.put(value, key) as IDBRequest<unknown>);
  } catch {
    // Storage failures must never break the app; the in-memory kernel stays authoritative.
  }
}

export async function idbDel(key: string): Promise<void> {
  try {
    await tx('readwrite', (store) => store.delete(key) as IDBRequest<undefined>);
  } catch {
    /* ignore */
  }
}

export async function idbKeys(prefix: string): Promise<string[]> {
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>);
    return keys.map(String).filter((key) => key.startsWith(prefix));
  } catch {
    return [];
  }
}

export function createPluginStorage(pluginId: string) {
  const prefix = `plugin:${pluginId}:`;
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return idbGet<T>(`${prefix}${key}`);
    },
    async set<T>(key: string, value: T): Promise<void> {
      await idbSet(`${prefix}${key}`, value);
    },
    async remove(key: string): Promise<void> {
      await idbDel(`${prefix}${key}`);
    },
    async keys(): Promise<string[]> {
      return (await idbKeys(prefix)).map((key) => key.slice(prefix.length));
    },
  };
}
