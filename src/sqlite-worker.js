/**
 * SQLite Web Worker
 *
 * Runs sqlite-wasm inside a dedicated module worker so that:
 *   1. Database work never blocks the UI thread.
 *   2. The OPFS (Origin Private File System) storage back-end is
 *      available — OPFS sync access handles only exist inside workers.
 *
 * Persistence uses sqlite-wasm's "opfs-sahpool" VFS
 * (sqlite3.installOpfsSAHPoolVfs), which stores the database in OPFS
 * via synchronous access handles. Unlike the classic "opfs" VFS it
 * needs NO cross-origin isolation (no COOP/COEP headers, no
 * SharedArrayBuffer) and spawns no nested worker, which makes it
 * robust under bundlers like webpack.
 *
 * When OPFS is unavailable (very old browsers), the worker falls back
 * to a transient in-memory database. The app stays fully functional;
 * data just does not survive a reload. Use the export/import actions
 * (File System Access API) to persist it.
 *
 * Message protocol (main thread -> worker):
 *   { id: number, action: string, params: object }
 * Response (worker -> main thread):
 *   { id: number, ok: true, result: any } | { id: number, ok: false, error: string }
 *
 * For LLMs: this file is bundled by webpack 5's native module-worker
 * support (`new Worker(new URL('./sqlite-worker.js', import.meta.url), { type: 'module' })`
 * in src/lib/database.js). It must NOT use the classic inline-worker
 * syntax, because it imports an npm module and a .wasm URL.
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm';

/** @type {object|null} The initialized sqlite3 module (oo1 + capi APIs) */
let sqlite3 = null;

/** @type {object|null} The open database (OpfsSAHPoolDb when possible) */
let db = null;

/** @type {boolean} Whether the database is persisted in OPFS */
let persistent = false;

const DB_NAME = '/app.sqlite3';

/**
 * Initialize the sqlite-wasm module and open the database.
 *
 * `locateFile` points the wasm loader at the URL webpack emitted for
 * sqlite3.wasm (see the asset/resource rule in webpack.config.js).
 *
 * @returns {Promise<void>}
 */
async function initialize() {
  sqlite3 = await sqlite3InitModule({ locateFile: () => wasmUrl });

  /**
   * Try the OPFS SAH-pool VFS for persistent storage. It requires the
   * OPFS sync-access-handle APIs (worker context), but not
   * SharedArrayBuffer or cross-origin isolation. installOpfsSAHPoolVfs()
   * rejects with a descriptive error when those APIs are missing.
   */
  try {
    const poolUtil = await sqlite3.installOpfsSAHPoolVfs();
    db = new poolUtil.OpfsSAHPoolDb(DB_NAME);
    persistent = true;
    console.log(`[sqlite-worker] OPFS persistent database opened at ${DB_NAME}`);
    return;
  } catch (error) {
    console.warn('[sqlite-worker] OPFS unavailable, falling back to transient DB:', error.message);
  }

  db = new sqlite3.oo1.DB(DB_NAME, 'c');
  persistent = false;
  console.log('[sqlite-worker] Transient in-memory database opened (OPFS unavailable)');
}

/**
 * Action handlers. Each receives the message `params` object and returns
 * a structured-clone-safe result.
 */
const actions = {
  /**
   * Report storage status and version info.
   *
   * @returns {{persistent: boolean, filename: string, sqliteVersion: string}}
   */
  status() {
    return {
      persistent,
      filename: db.filename,
      sqliteVersion: sqlite3.version.libVersion,
    };
  },

  /**
   * Execute SQL without returning rows (DDL, INSERT, UPDATE, DELETE).
   *
   * @param {{sql: string, params?: Array}} params - SQL text and optional bind parameters
   * @returns {null}
   */
  exec({ sql, params = [] }) {
    db.exec({ sql, bind: params });
    return null;
  },

  /**
   * Execute SQL and return the result rows as an array of objects.
   *
   * @param {{sql: string, params?: Array}} params - SQL text and optional bind parameters
   * @returns {Array<object>} Result rows keyed by column name
   */
  query({ sql, params = [] }) {
    return db.exec({ sql, bind: params, rowMode: 'object', returnValue: 'resultRows' });
  },

  /**
   * Serialize the whole database to a byte array (for export to disk
   * via the File System Access API). Uses the high-level capi helper
   * sqlite3_js_db_export(), which accepts an oo1.DB instance.
   *
   * @returns {Uint8Array} The database image in SQLite file format
   */
  export() {
    return sqlite3.capi.sqlite3_js_db_export(db, 'main');
  },

  /**
   * Replace the current database contents with a serialized database
   * image (the counterpart of `export`). The image is copied into the
   * wasm heap and ownership passes to SQLite (FREEONCLOSE).
   *
   * @param {{bytes: Uint8Array}} params - The database image to load
   * @returns {null}
   */
  import({ bytes }) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('import expects a Uint8Array');
    }
    const pData = sqlite3.wasm.allocFromTypedArray(bytes);
    const flags =
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
      sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      'main',
      pData,
      bytes.byteLength,
      bytes.byteLength,
      flags
    );
    if (rc !== sqlite3.capi.SQLITE_OK) {
      // FREEONCLOSE only takes ownership on success, so free manually
      sqlite3.wasm.dealloc(pData);
      throw new Error(`Database deserialization failed (code ${rc})`);
    }
    return null;
  },

  /**
   * Run periodic SQLite maintenance after large write batches.
   *
   * TRUNCATE checkpoint reclaims WAL space; PRAGMA optimize updates
   * internal statistics for future queries.
   *
   * @returns {null}
   */
  maintenance() {
    db.exec({ sql: 'PRAGMA wal_checkpoint(TRUNCATE)' });
    db.exec({ sql: 'PRAGMA optimize' });
    return null;
  },
};

/** Initialization promise: every message awaits this before touching the DB. */
const ready = initialize();

/**
 * Message handler. Dispatches to the action handlers above and always
 * answers with the matching message id so the main thread can correlate
 * requests and responses.
 *
 * @param {MessageEvent} event - { id, action, params }
 * @returns {Promise<void>}
 */
self.onmessage = async (event) => {
  const { id, action, params = {} } = event.data;

  try {
    await ready;

    if (typeof actions[action] !== 'function') {
      throw new Error(`Unknown sqlite-worker action: ${action}`);
    }

    const result = actions[action](params);

    // Transfer the export buffer instead of copying it
    if (result instanceof Uint8Array) {
      self.postMessage({ id, ok: true, result }, [result.buffer]);
    } else {
      self.postMessage({ id, ok: true, result });
    }
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
};

/**
 * Error handler for uncaught exceptions inside the worker.
 * Without this, worker errors fail silently from the main thread.
 */
self.onerror = (error) => {
  console.error('[sqlite-worker] Unhandled error:', error);
};
