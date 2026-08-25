/**
 * Database Client Unit Tests
 *
 * Unit tests for src/lib/database.js — the main-thread client that
 * relays database actions to the sqlite worker.
 *
 * The Worker global is replaced with a fake that captures outgoing
 * messages and answers them with scripted responses. These tests pin
 * down:
 *   - the exact action names and SQL each helper sends
 *   - bound parameters (never string interpolation)
 *   - request/response correlation by message id
 *   - error propagation (worker error responses and catastrophic
 *     worker failure)
 *
 * For LLMs: when adding a helper to src/lib/database.js, add the
 * matching test here asserting the exact action + SQL + params.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Fake Worker stand-in. Each instance records every postMessage it
 * receives and replies asynchronously through the handler assigned to
 * FakeWorker.onMessage (default: a generic `ok: true, result: null`).
 */
class FakeWorker {
  static instance = null;
  static onMessage = null;

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    FakeWorker.instance = this;
  }

  postMessage(message) {
    this.messages.push(message);
    const handler = FakeWorker.onMessage || ((m) => ({ id: m.id, ok: true, result: null }));
    const response = handler(message, this);
    if (response) {
      queueMicrotask(() => this.onmessage?.({ data: response }));
    }
  }
}

/** @returns {Promise<object>} The freshly imported database module */
async function importDatabaseModule() {
  return await import('../../src/lib/database.js');
}

describe('database client', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instance = null;
    FakeWorker.onMessage = null;
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a module worker for the sqlite worker script', async () => {
    const db = await importDatabaseModule();
    await db.getStatus();

    expect(FakeWorker.instance).not.toBeNull();
    // Note: the worker URL itself is not asserted — Vitest's Vite
    // pipeline rewrites `new URL(..., import.meta.url)` asset
    // references, so its shape under test is not what the browser sees.
    expect(FakeWorker.instance.options).toEqual({ type: 'module' });
  });

  it('reuses the same worker across calls', async () => {
    const db = await importDatabaseModule();
    await db.getStatus();
    await db.initSchema();

    expect(FakeWorker.instance.messages).toHaveLength(2);
  });

  it('getStatus sends the status action and resolves its result', async () => {
    const status = { persistent: true, filename: '/app.sqlite3', sqliteVersion: '3.53.0' };
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: status });

    const db = await importDatabaseModule();
    const result = await db.getStatus();

    expect(FakeWorker.instance.messages[0].action).toBe('status');
    expect(result).toEqual(status);
  });

  it('initSchema creates the notes table', async () => {
    const db = await importDatabaseModule();
    await db.initSchema();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('CREATE TABLE IF NOT EXISTS notes');
    expect(message.params.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(message.params.sql).toContain('content TEXT NOT NULL');
    expect(message.params.sql).toContain('created_at TEXT NOT NULL');
  });

  it('addNote inserts with bound parameters and returns the new id', async () => {
    FakeWorker.onMessage = (m) => {
      if (m.action === 'query') {
        return { id: m.id, ok: true, result: [{ id: 7 }] };
      }
      return { id: m.id, ok: true, result: null };
    };

    const db = await importDatabaseModule();
    const id = await db.addNote('hello world');

    const [insert, idQuery] = FakeWorker.instance.messages;
    expect(insert.action).toBe('exec');
    expect(insert.params.sql).toBe('INSERT INTO notes (content, created_at) VALUES (?, ?)');
    // First bound parameter is the content; second is an ISO timestamp
    expect(insert.params.params[0]).toBe('hello world');
    expect(insert.params.params[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    expect(idQuery.action).toBe('query');
    expect(idQuery.params.sql).toBe('SELECT last_insert_rowid() AS id');
    expect(id).toBe(7);
  });

  it('listNotes selects all notes newest first', async () => {
    const rows = [{ id: 2, content: 'b', created_at: 't2' }, { id: 1, content: 'a', created_at: 't1' }];
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: rows });

    const db = await importDatabaseModule();
    const result = await db.listNotes();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toBe('SELECT id, content, created_at FROM notes ORDER BY id DESC');
    expect(result).toEqual(rows);
  });

  it('deleteNote deletes by bound id', async () => {
    const db = await importDatabaseModule();
    await db.deleteNote(42);

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toBe('DELETE FROM notes WHERE id = ?');
    expect(message.params.params).toEqual([42]);
  });

  it('createNotesIndex generates the created_at index idempotently', async () => {
    const db = await importDatabaseModule();
    await db.createNotesIndex();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toBe('CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)');
  });

  it('listIndexes queries sqlite_master for user indexes', async () => {
    const rows = [{ name: 'idx_notes_created_at', tbl_name: 'notes' }];
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: rows });

    const db = await importDatabaseModule();
    const result = await db.listIndexes();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toContain("FROM sqlite_master");
    expect(message.params.sql).toContain("type = 'index'");
    expect(message.params.sql).toContain("name NOT LIKE 'sqlite_%'");
    expect(result).toEqual(rows);
  });

  it('exportDatabase resolves the serialized bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: bytes });

    const db = await importDatabaseModule();
    const result = await db.exportDatabase();

    expect(FakeWorker.instance.messages[0].action).toBe('export');
    expect(result).toBe(bytes);
  });

  it('importDatabase sends the bytes to the import action', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const db = await importDatabaseModule();
    await db.importDatabase(bytes);

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('import');
    expect(message.params.bytes).toBe(bytes);
  });

  it('loadSettings includes the theme key with an empty default', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });

    const db = await importDatabaseModule();
    const settings = await db.loadSettings();

    expect(settings.theme).toBe('');
  });

  it('saveSettings upserts every setting including theme with bound parameters', async () => {
    const db = await importDatabaseModule();
    await db.saveSettings({ maxArticlesPerFeed: 25, theme: ':root { --x: 1; }' });

    expect(FakeWorker.instance.messages).toHaveLength(2);

    const [first, second] = FakeWorker.instance.messages;
    expect(first.action).toBe('exec');
    expect(first.params.sql).toBe(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    expect(first.params.params).toEqual(['maxArticlesPerFeed', '25']);

    expect(second.action).toBe('exec');
    expect(second.params.params).toEqual(['theme', ':root { --x: 1; }']);
  });

  it('correlates concurrent responses by message id', async () => {
    FakeWorker.onMessage = (m) => {
      // Answer slower-acting requests first, out of order
      if (m.action === 'status') {
        queueMicrotask(() => { /* answered below after query */ });
        setTimeout(() => {
          FakeWorker.instance.onmessage?.({ data: { id: m.id, ok: true, result: 'status-result' } });
        }, 10);
        return null;
      }
      return { id: m.id, ok: true, result: 'query-result' };
    };

    const db = await importDatabaseModule();
    const [status, notes] = await Promise.all([db.getStatus(), db.listNotes()]);

    expect(status).toBe('status-result');
    expect(notes).toBe('query-result');
  });

  it('rejects when the worker answers with an error', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: false, error: 'SQL syntax error' });

    const db = await importDatabaseModule();
    await expect(db.listNotes()).rejects.toThrow('SQL syntax error');
  });

  it('rejects all pending requests when the worker errors catastrophically', async () => {
    FakeWorker.onMessage = () => null; // never answers

    const db = await importDatabaseModule();
    const pending = db.listNotes();
    // Attach a no-op catch first so Node does not flag an unhandled rejection
    const assertion = expect(pending).rejects.toThrow('SQLite worker error: boom');

    FakeWorker.instance.onerror?.({ message: 'boom' });
    await assertion;
  });

  it('rejects and cleans up pending requests that time out', async () => {
    vi.useFakeTimers();
    FakeWorker.onMessage = () => null; // never answers

    try {
      const db = await importDatabaseModule();
      const pending = db.listNotes();

      vi.advanceTimersByTime(120001);

      await expect(pending).rejects.toThrow('timed out');
    } finally {
      vi.useRealTimers();
    }
  });
});
