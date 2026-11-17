import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import {
  closeLibraryDatabase,
  initializeLibrary,
  LIBRARY_DB_NAME,
} from '../../src/board/storage.ts';
export async function freshLibrary() {
  await closeLibraryDatabase();
  vi.stubGlobal('indexedDB', new IDBFactory());
  return initializeLibrary();
}
export async function rawDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LIBRARY_DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
