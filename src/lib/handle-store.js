/**
 * Handle Store Library (IndexedDB)
 *
 * Persists FileSystemHandle objects (structured-cloneable in Chromium)
 * across app sessions in a tiny IndexedDB database. Used so features
 * like Markdown export can default their save dialog to the location
 * the user chose last time.
 *
 * Degrades gracefully: when IndexedDB is unavailable (or a handle has
 * been revoked by the browser between sessions) the functions fail
 * soft — rememberHandle() is a silent no-op and recallHandle()
 * resolves to null instead of throwing.
 */

const DB_NAME = 'aaron-rss-handle-store';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

/**
 * Open (and lazily upgrade) the handle store database.
 *
 * @returns {Promise<IDBDatabase>} The opened database connection
 */
function openHandleDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      // First run: create the single object store keyed by string.
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persist a FileSystemHandle under a well-known key.
 *
 * Failures are swallowed deliberately: remembering a location is an
 * optimization, never something the UI should surface as an error.
 *
 * @param {string} key - Stable identifier, e.g. 'markdown-export'
 * @param {FileSystemHandle} handle - The handle chosen by the user
 * @returns {Promise<void>}
 */
export async function rememberHandle(key, handle) {
  let db;
  try {
    db = await openHandleDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // No IndexedDB or write failed — proceed without persistence.
  } finally {
    if (db) db.close();
  }
}

/**
 * Recall a previously persisted FileSystemHandle.
 *
 * Handles can become stale between sessions (e.g. the browser drops
 * them); callers must treat any failure as "no remembered location".
 *
 * @param {string} key - Stable identifier, e.g. 'markdown-export'
 * @returns {Promise<FileSystemHandle|null>} The handle, or null
 */
export async function recallHandle(key) {
  let db;
  try {
    db = await openHandleDatabase();
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    return value;
  } catch {
    return null;
  } finally {
    if (db) db.close();
  }
}
