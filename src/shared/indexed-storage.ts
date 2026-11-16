export function hasIndexedDbSupport(): boolean {
  return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
}

interface IndexedStoreOptions {
  dbName: string;
  dbVersion?: number;
  storeName: string;
}

export function createIndexedJsonKeyValueStore({
  dbName,
  dbVersion = 1,
  storeName,
}: IndexedStoreOptions) {
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  async function openDatabase(): Promise<IDBDatabase | null> {
    if (!hasIndexedDbSupport()) {
      return null;
    }

    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const request = indexedDB.open(dbName, dbVersion);

          request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(storeName)) {
              database.createObjectStore(storeName);
            }
          };

          request.onsuccess = () => {
            resolve(request.result);
          };

          request.onerror = () => {
            dbPromise = Promise.resolve(null);
            resolve(null);
          };

          request.onblocked = () => {
            dbPromise = Promise.resolve(null);
            resolve(null);
          };
        } catch {
          dbPromise = Promise.resolve(null);
          resolve(null);
        }
      });
    }

    return dbPromise;
  }

  async function getValue(key: string): Promise<unknown> {
    const database = await openDatabase();
    if (!database) return undefined;

    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result ?? undefined);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error ?? request.error);
      });
    } catch {
      return undefined;
    }
  }

  async function setValue(key: string, value: unknown): Promise<boolean> {
    const database = await openDatabase();
    if (!database) return false;

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        const request = transaction.objectStore(storeName).put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error ?? request.error);
      });
      return true;
    } catch {
      return false;
    }
  }

  async function deleteValue(key: string): Promise<boolean> {
    const database = await openDatabase();
    if (!database) return false;

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        const request = transaction.objectStore(storeName).delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error ?? request.error);
      });
      return true;
    } catch {
      return false;
    }
  }

  return {
    deleteValue,
    getValue,
    hasSupport: hasIndexedDbSupport,
    openDatabase,
    setValue,
  };
}
