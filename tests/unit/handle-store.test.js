/**
 * Handle Store Unit Tests
 *
 * Unit tests for src/lib/handle-store.js — the tiny IndexedDB wrapper
 * that persists FileSystemHandles between sessions (used by Markdown
 * export to reopen the save dialog in the last-used directory).
 *
 * Node has no IndexedDB, so these tests install a minimal fake that
 * implements just enough of the API: open + upgrade, one object store,
 * get/put via transactions. Callbacks are invoked on a microtask so
 * callers can attach handlers before they fire, like real IndexedDB.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { rememberHandle, recallHandle } from '../../src/lib/handle-store.js';

/**
 * Minimal async request object mirroring IDBRequest semantics.
 *
 * @param {() => *} getResult - Produces the request's eventual result
 * @returns {object} Fake IDBRequest with success already queued
 */
function fakeRequest(getResult) {
  const request = { result: undefined, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    request.result = getResult();
    if (request.onsuccess) request.onsuccess({ target: request });
  });
  return request;
}

/** Build a fresh fake indexedDB backed by an in-memory Map. */
function makeFakeIndexedDB() {
  const data = new Map();

  const db = {
    objectStoreNames: { contains: () => false },
    createObjectStore: () => ({
      put(value, key) {
        data.set(key, value);
        return fakeRequest(() => undefined);
      },
      get(key) {
        return fakeRequest(() => data.get(key));
      },
    }),
    transaction() {
      let storeRef;
      const tx = {
        get objectStore() {
          return () => storeRef ?? (storeRef = db.createObjectStore());
        },
        oncomplete: null,
        onerror: null,
        onabort: null,
      };
      // Transactions complete on a microtask, after put/get requests.
      queueMicrotask(() => {
        if (tx.oncomplete) tx.oncomplete();
      });
      return tx;
    },
    close() {},
  };

  return {
    open() {
      const openRequest = {
        result: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        openRequest.result = db;
        if (openRequest.onupgradeneeded) {
          openRequest.onupgradeneeded({ target: openRequest });
        }
        if (openRequest.onsuccess) {
          openRequest.onsuccess({ target: openRequest });
        }
      });
      return openRequest;
    },
  };
}

describe('handle-store', () => {
  beforeEach(() => {
    globalThis.indexedDB = makeFakeIndexedDB();
  });

  it('recalls a remembered handle under the same key', async () => {
    const handle = { kind: 'file', name: 'article.md' };
    await rememberHandle('markdown-export', handle);

    const recalled = await recallHandle('markdown-export');
    expect(recalled).toBe(handle);
  });

  it('returns null for keys that were never saved', async () => {
    expect(await recallHandle('never-saved')).toBeNull();
  });

  it('overwrites an earlier handle saved under the same key', async () => {
    const first = { kind: 'file', name: 'a.md' };
    const second = { kind: 'file', name: 'b.md' };

    await rememberHandle('key', first);
    await rememberHandle('key', second);

    expect(await recallHandle('key')).toBe(second);
  });

  it('resolves to null when IndexedDB is unavailable', async () => {
    delete globalThis.indexedDB;

    await rememberHandle('key', { kind: 'file' }); // silent no-op
    expect(await recallHandle('key')).toBeNull();
  });
});
