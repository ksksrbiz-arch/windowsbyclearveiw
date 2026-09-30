/**
 * The phone-side photo store shared by the Photos tool and Field mode.
 *
 * Photos live in this browser's IndexedDB (they are not uploaded). Both pages must
 * open it the same way: a page that opens the database without creating the
 * `photos` store leaves an empty database behind at the current version, the
 * browser never runs the upgrade again, and every later photo read or write fails
 * with "object store not found". Opening here creates the store when the database
 * is new, and repairs a database that was already left without it.
 */

export const PHOTO_DB_NAME = 'clearview-field-tools';
export const PHOTO_STORE = 'photos';

function open(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(PHOTO_DB_NAME) : indexedDB.open(PHOTO_DB_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local photo storage.'));
    request.onblocked = () => reject(new Error('Close other Clearview tabs, then try again.'));
  });
}

export async function openPhotoDb(): Promise<IDBDatabase> {
  // No version: use whatever exists, or create version 1 (with the store) when there is none.
  const db = await open();
  if (db.objectStoreNames.contains(PHOTO_STORE)) return db;
  // Left behind without the store: bump the version so the upgrade runs, keeping anything else in it.
  const next = db.version + 1;
  db.close();
  return open(next);
}
