/**
 * SQLite Worker Unit Tests
 *
 * Unit tests for src/sqlite-worker.js — the worker's message protocol
 * and SQL behavior, exercised against a REAL SQLite database.
 *
 * How this works without a browser:
 *   - Under Vitest (Node), the import of '@sqlite.org/sqlite-wasm'
 *     resolves to the package's Node build (in-memory databases only),
 *     and the '.wasm' import is aliased to the real binary on disk
 *     (see vitest.config.js and tests/helpers/sqlite3-wasm-url.js).
 *   - The worker's globals (`self.onmessage` / `self.postMessage`) are
 *     provided by this test file before importing the worker module.
 *   - OPFS does not exist in Node, so the worker exercises its
 *     transient-database fallback path here. The OPFS path is covered
 *     by the Playwright e2e suite in a real browser.
 *
 * For LLMs: when adding an action to the worker, test it here by
 * sending a message through callWorker() and asserting on real SQL
 * results — not on mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/** Pending response waiters keyed by message id */
const waiters = new Map();
let nextId = 1;

/**
 * Send an action message to the worker and await its response,
 * exactly as src/lib/database.js does in the browser.
 *
 * @param {string} action - Worker action name
 * @param {object} [params={}] - Action parameters
 * @returns {Promise<any>} The action result (rejects on worker error)
 */
function callWorker(action, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiters.set(id, { resolve, reject });
    self.onmessage({ data: { id, action, params } });
  });
}

beforeAll(async () => {
  // Provide the worker globals, then import the worker module.
  // The import kicks off sqlite initialization immediately.
  globalThis.self = globalThis;
  self.postMessage = (message) => {
    const waiter = waiters.get(message.id);
    if (!waiter) {
      return;
    }
    waiters.delete(message.id);
    if (message.ok) {
      waiter.resolve(message.result);
    } else {
      waiter.reject(new Error(message.error));
    }
  };

  await import('../../src/sqlite-worker.js');
});

afterAll(() => {
  delete globalThis.self;
});

describe('sqlite-worker', () => {
  it('reports status with a sqlite version and no persistence in Node', async () => {
    const status = await callWorker('status');

    expect(status.persistent).toBe(false);
    expect(status.filename).toBe('/app.sqlite3');
    expect(status.sqliteVersion).toMatch(/^3\./);
  });

  it('executes DDL and bound-parameter writes, then queries rows as objects', async () => {
    await callWorker('exec', {
      sql: `CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    });

    await callWorker('exec', {
      sql: 'INSERT INTO notes (content, created_at) VALUES (?, ?)',
      params: ['first note', '2026-01-01T00:00:00.000Z'],
    });
    await callWorker('exec', {
      sql: 'INSERT INTO notes (content, created_at) VALUES (?, ?)',
      params: ['second note', '2026-01-02T00:00:00.000Z'],
    });

    const rows = await callWorker('query', {
      sql: 'SELECT id, content, created_at FROM notes ORDER BY id DESC',
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].content).toBe('second note');
    expect(rows[1].content).toBe('first note');
    expect(rows[0].id).toBeGreaterThan(rows[1].id);
  });

  it('binds parameters literally (no SQL interpolation)', async () => {
    await callWorker('exec', {
      sql: 'INSERT INTO notes (content, created_at) VALUES (?, ?)',
      params: ["'); DROP TABLE notes; --", '2026-01-03T00:00:00.000Z'],
    });

    // The table must still exist and contain the hostile string as data
    const rows = await callWorker('query', {
      sql: 'SELECT content FROM notes WHERE content = ?',
      params: ["'); DROP TABLE notes; --"],
    });
    expect(rows).toHaveLength(1);
  });

  it('creates an index visible in sqlite_master', async () => {
    await callWorker('exec', {
      sql: 'CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)',
    });

    const indexes = await callWorker('query', {
      sql: `SELECT name, tbl_name FROM sqlite_master
        WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    });

    expect(indexes).toEqual([{ name: 'idx_notes_created_at', tbl_name: 'notes' }]);
  });

  it('exports a valid SQLite file image', async () => {
    const bytes = await callWorker('export');

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);

    // Every SQLite database file starts with this magic header
    const header = new TextDecoder().decode(bytes.slice(0, 16));
    expect(header).toBe('SQLite format 3\0');
  });

  it('round-trips the database through export and import', async () => {
    const exported = await callWorker('export');

    // Destroy the current state
    await callWorker('exec', { sql: 'DROP TABLE notes' });
    await expect(callWorker('query', { sql: 'SELECT * FROM notes' })).rejects.toThrow();

    // Import the exported image — the data must be back
    await callWorker('import', { bytes: exported });
    const rows = await callWorker('query', {
      sql: 'SELECT content FROM notes ORDER BY id',
    });
    expect(rows.map((r) => r.content)).toContain('first note');
    expect(rows.map((r) => r.content)).toContain('second note');
  });

  it('rejects an import that is not a Uint8Array', async () => {
    await expect(callWorker('import', { bytes: 'not-bytes' })).rejects.toThrow(
      'import expects a Uint8Array'
    );
  });

  it('rejects unknown actions with a descriptive error', async () => {
    await expect(callWorker('definitely-not-an-action')).rejects.toThrow(
      'Unknown sqlite-worker action: definitely-not-an-action'
    );
  });

  it('rejects malformed SQL with the SQLite error message', async () => {
    await expect(callWorker('exec', { sql: 'THIS IS NOT SQL' })).rejects.toThrow();
  });

  it('runs maintenance without error', async () => {
    const result = await callWorker('maintenance');
    expect(result).toBeNull();
  });
});
