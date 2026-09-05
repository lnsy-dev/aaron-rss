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

  it('loadSettings defaults refreshConcurrency to 4 and parses stored values', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{ key: 'refreshConcurrency', value: '8' }],
    });

    const db = await importDatabaseModule();
    const settings = await db.loadSettings();

    expect(settings.refreshConcurrency).toBe(8);

    // No stored row falls back to the default.
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });
    const fresh = await db.loadSettings();
    expect(fresh.refreshConcurrency).toBe(4);
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

describe('research topics', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instance = null;
    FakeWorker.onMessage = null;
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initRSSSchema creates the research_topics and research_topic_feeds tables', async () => {
    // The migration probes need PRAGMA answers; every other query can be empty.
    FakeWorker.onMessage = (m) => {
      if (m.action === 'query' && m.params.sql?.startsWith('PRAGMA')) {
        return { id: m.id, ok: true, result: [] };
      }
      return { id: m.id, ok: true, result: null };
    };

    const db = await importDatabaseModule();
    await db.initRSSSchema();

    const createStatements = FakeWorker.instance.messages
      .filter((m) => m.action === 'exec')
      .map((m) => m.params.sql);

    expect(
      createStatements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS research_topics'))
    ).toBe(true);
    expect(
      createStatements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS research_topic_feeds'))
    ).toBe(true);

    // Research topics carry a human-readable summary alongside the name.
    const topicsTable = createStatements.find((sql) => sql.includes('research_topics'));
    expect(topicsTable).toContain('summary TEXT');

    // Membership is keyed by (topic_id, feed_id) so re-adding cannot duplicate.
    const membership = createStatements.find((sql) => sql.includes('research_topic_feeds'));
    expect(membership).toContain('PRIMARY KEY (topic_id, feed_id)');

    // Scraped article markdown is keyed by (feed_id, article_id) too.
    expect(
      createStatements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS article_markdown'))
    ).toBe(true);
  });

  it('createResearchTopic inserts a row with bound parameters and returns the topic', async () => {
    const db = await importDatabaseModule();
    const topic = await db.createResearchTopic('Web Agents', 'Papers about web agents');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toBe(
      'INSERT INTO research_topics (topic_id, name, summary, created_at) VALUES (?, ?, ?, ?)'
    );
    // Bound parameters: topic id, name, summary, ISO timestamp
    expect(message.params.params[1]).toBe('Web Agents');
    expect(message.params.params[2]).toBe('Papers about web agents');
    expect(message.params.params[3]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    expect(topic.name).toBe('Web Agents');
    expect(topic.summary).toBe('Papers about web agents');
    expect(topic.topicID).toBe(message.params.params[0]);
    expect(topic.feeds).toEqual([]);
  });

  it('createResearchTopic defaults the summary to an empty string', async () => {
    const db = await importDatabaseModule();
    const topic = await db.createResearchTopic('Web Agents');

    const message = FakeWorker.instance.messages[0];
    expect(message.params.params[2]).toBe('');
    expect(topic.summary).toBe('');
  });

  it('updateResearchTopic updates only the fields that are provided', async () => {
    const db = await importDatabaseModule();
    await db.updateResearchTopic('topic-1', { summary: 'Updated summary' });
    await db.updateResearchTopic('topic-1', { name: 'New Name', summary: '' });

    const [first, second, third] = FakeWorker.instance.messages;
    expect(first.action).toBe('exec');
    expect(first.params.sql).toBe('UPDATE research_topics SET summary = ? WHERE topic_id = ?');
    expect(first.params.params).toEqual(['Updated summary', 'topic-1']);

    expect(second.params.sql).toBe('UPDATE research_topics SET name = ? WHERE topic_id = ?');
    expect(second.params.params).toEqual(['New Name', 'topic-1']);

    expect(third.params.sql).toBe('UPDATE research_topics SET summary = ? WHERE topic_id = ?');
    expect(third.params.params).toEqual(['', 'topic-1']);
  });

  it('updateResearchTopic with no changes sends nothing', async () => {
    const db = await importDatabaseModule();
    await db.updateResearchTopic('topic-1', {});
    expect(FakeWorker.instance?.messages ?? []).toHaveLength(0);
  });

  it('generates unique topic ids for consecutive topics', async () => {
    const db = await importDatabaseModule();
    const first = await db.createResearchTopic('a');
    const second = await db.createResearchTopic('b');

    expect(first.topicID).not.toBe(second.topicID);
  });

  it('deleteResearchTopic removes membership rows before the topic row', async () => {
    const db = await importDatabaseModule();
    await db.deleteResearchTopic('topic-1');

    const [membership, topic] = FakeWorker.instance.messages;
    expect(membership.action).toBe('exec');
    expect(membership.params.sql).toBe('DELETE FROM research_topic_feeds WHERE topic_id = ?');
    expect(membership.params.params).toEqual(['topic-1']);

    expect(topic.action).toBe('exec');
    expect(topic.params.sql).toBe('DELETE FROM research_topics WHERE topic_id = ?');
    expect(topic.params.params).toEqual(['topic-1']);
  });

  it('addFeedToResearchTopic inserts membership with bound parameters', async () => {
    vi.useFakeTimers();
    try {
      const db = await importDatabaseModule();
      await db.addFeedToResearchTopic('topic-1', 'feed-9');

      const message = FakeWorker.instance.messages[0];
      expect(message.action).toBe('exec');
      expect(message.params.sql).toBe(
        'INSERT OR IGNORE INTO research_topic_feeds (topic_id, feed_id, added_at) VALUES (?, ?, ?)'
      );
      expect(message.params.params[0]).toBe('topic-1');
      expect(message.params.params[1]).toBe('feed-9');
      expect(message.params.params[2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removeFeedFromResearchTopic deletes the membership row by both keys', async () => {
    const db = await importDatabaseModule();
    await db.removeFeedFromResearchTopic('topic-1', 'feed-9');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toBe(
      'DELETE FROM research_topic_feeds WHERE topic_id = ? AND feed_id = ?'
    );
    expect(message.params.params).toEqual(['topic-1', 'feed-9']);
  });

  it('listResearchTopics joins feeds and article counts into topic objects', async () => {
    const rows = [
      {
        topic_id: 'topic-1',
        name: 'Web Agents',
        summary: 'Papers about web agents',
        created_at: '2026-09-03T00:00:00.000Z',
        feed_id: 'feed-1',
        feed_url: 'https://example.com/feed.xml',
        feed_name: 'Example Feed',
        last_fetch_successful: 1,
        last_fetch_end_time: '2026-09-03T01:00:00.000Z',
        article_count: 12,
        unread_count: 4,
      },
      {
        topic_id: 'topic-2',
        name: 'Empty Topic',
        summary: null,
        created_at: '2026-09-03T02:00:00.000Z',
        feed_id: null,
        feed_url: null,
        feed_name: null,
        last_fetch_successful: null,
        last_fetch_end_time: null,
        article_count: null,
        unread_count: null,
      },
    ];
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: rows });

    const db = await importDatabaseModule();
    const topics = await db.listResearchTopics();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toContain('FROM research_topics t');
    expect(message.params.sql).toContain('LEFT JOIN research_topic_feeds tf');
    expect(message.params.sql).toContain('LEFT JOIN feeds f');
    expect(message.params.sql).toContain('unread_count');

    expect(topics).toHaveLength(2);
    expect(topics[0]).toMatchObject({
      topicID: 'topic-1',
      name: 'Web Agents',
      summary: 'Papers about web agents',
    });
    expect(topics[1].summary).toBe('');
    expect(topics[0].feeds).toHaveLength(1);
    expect(topics[0].feeds[0]).toEqual({
      feedID: 'feed-1',
      url: 'https://example.com/feed.xml',
      name: 'Example Feed',
      lastFetchSuccessful: true,
      lastFetchEndTime: new Date('2026-09-03T01:00:00.000Z'),
      articleCount: 12,
      unreadCount: 4,
    });
    expect(topics[1].feeds).toEqual([]);
  });

  it('listResearchTopics skips memberships whose feed no longer exists', async () => {
    const rows = [
      {
        topic_id: 'topic-1',
        name: 'Web Agents',
        created_at: '2026-09-03T00:00:00.000Z',
        feed_id: 'gone',
        feed_url: null,
        feed_name: null,
        last_fetch_successful: null,
        last_fetch_end_time: null,
        article_count: 0,
        unread_count: 0,
      },
      {
        topic_id: 'topic-1',
        name: 'Web Agents',
        created_at: '2026-09-03T00:00:00.000Z',
        feed_id: 'feed-1',
        feed_url: 'https://example.com/feed.xml',
        feed_name: 'Example Feed',
        last_fetch_successful: 0,
        last_fetch_end_time: null,
        article_count: 3,
        unread_count: 3,
      },
    ];
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: rows });

    const db = await importDatabaseModule();
    const topics = await db.listResearchTopics();

    expect(topics).toHaveLength(1);
    expect(topics[0].feeds).toHaveLength(1);
    expect(topics[0].feeds[0].feedID).toBe('feed-1');
    // Failed fetch flag survives the mapping.
    expect(topics[0].feeds[0].lastFetchSuccessful).toBe(false);
  });

  it('listFeedIDsInResearchTopics returns distinct member feed ids', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{ feed_id: 'feed-1' }, { feed_id: 'feed-2' }],
    });

    const db = await importDatabaseModule();
    const feedIDs = await db.listFeedIDsInResearchTopics();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toBe('SELECT DISTINCT feed_id FROM research_topic_feeds');
    expect(feedIDs).toEqual(['feed-1', 'feed-2']);
  });

  it('saveArticleMarkdown upserts the scraped markdown with bound parameters', async () => {
    vi.useFakeTimers();
    try {
      const db = await importDatabaseModule();
      await db.saveArticleMarkdown('feed-1', 'art-1', 'https://example.com/post', '# Hello');

      const message = FakeWorker.instance.messages[0];
      expect(message.action).toBe('exec');
      expect(message.params.sql).toContain('INSERT INTO article_markdown');
      expect(message.params.sql).toContain('ON CONFLICT(feed_id, article_id) DO UPDATE SET');
      expect(message.params.params[0]).toBe('feed-1');
      expect(message.params.params[1]).toBe('art-1');
      expect(message.params.params[2]).toBe('https://example.com/post');
      expect(message.params.params[3]).toBe('# Hello');
      expect(message.params.params[4]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('getArticleMarkdown returns the scraped row or null', async () => {
    const row = {
      feed_id: 'feed-1',
      article_id: 'art-1',
      url: 'https://example.com/post',
      markdown: '# Hello',
      scraped_at: '2026-09-03T00:00:00.000Z',
    };
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [row] });

    const db = await importDatabaseModule();
    const result = await db.getArticleMarkdown('feed-1', 'art-1');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toBe(
      'SELECT feed_id, article_id, url, markdown, scraped_at FROM article_markdown WHERE feed_id = ? AND article_id = ?'
    );
    expect(message.params.params).toEqual(['feed-1', 'art-1']);
    expect(result).toEqual({
      feedID: 'feed-1',
      articleID: 'art-1',
      url: 'https://example.com/post',
      markdown: '# Hello',
      scrapedAt: '2026-09-03T00:00:00.000Z',
    });

    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });
    const db2 = await importDatabaseModule();
    expect(await db2.getArticleMarkdown('feed-1', 'missing')).toBeNull();
  });

  it('getFeedName returns the display name or null for unknown feeds', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [{ name: 'Example Feed' }] });

    const db = await importDatabaseModule();
    const name = await db.getFeedName('feed-1');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toBe('SELECT name FROM feeds WHERE feed_id = ?');
    expect(message.params.params).toEqual(['feed-1']);
    expect(name).toBe('Example Feed');

    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });
    const db2 = await importDatabaseModule();
    expect(await db2.getFeedName('missing')).toBeNull();
  });

  it('listFeedArticles selects articles with markdown readiness, newest first', async () => {
    const rows = [
      {
        article_id: 'a1',
        feed_id: 'feed-1',
        unique_id: 'u1',
        title: 'Post',
        url: 'https://example.com/post',
        external_url: null,
        summary: null,
        image_url: null,
        banner_image_url: null,
        date_published: '2026-09-03T00:00:00.000Z',
        date_arrived: '2026-09-03T00:01:00.000Z',
        read: 0,
        starred: 1,
        feed_name: 'Example Feed',
        feed_url: 'https://example.com/feed.xml',
        markdown_scraped_at: '2026-09-03T00:02:00.000Z',
      },
      {
        article_id: 'a2',
        feed_id: 'feed-1',
        unique_id: 'u2',
        title: 'Pending',
        url: 'https://example.com/pending',
        external_url: null,
        summary: null,
        image_url: null,
        banner_image_url: null,
        date_published: null,
        date_arrived: '2026-09-03T00:03:00.000Z',
        read: 1,
        starred: 0,
        feed_name: 'Example Feed',
        feed_url: 'https://example.com/feed.xml',
        markdown_scraped_at: null,
      },
    ];
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: rows });

    const db = await importDatabaseModule();
    const articles = await db.listFeedArticles('feed-1');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toContain('FROM articles a');
    expect(message.params.sql).toContain('LEFT JOIN article_markdown m');
    expect(message.params.sql).toContain('WHERE a.feed_id = ?');
    expect(message.params.sql).toContain('ORDER BY COALESCE(a.date_published, a.date_arrived) DESC');
    expect(message.params.params).toEqual(['feed-1']);

    expect(articles).toHaveLength(2);
    expect(articles[0]).toEqual({
      articleID: 'a1',
      feedID: 'feed-1',
      feedName: 'Example Feed',
      feedURL: 'https://example.com/feed.xml',
      uniqueID: 'u1',
      title: 'Post',
      url: 'https://example.com/post',
      externalURL: null,
      summary: null,
      imageURL: null,
      bannerImageURL: null,
      datePublished: '2026-09-03T00:00:00.000Z',
      dateArrived: '2026-09-03T00:01:00.000Z',
      read: false,
      starred: true,
      markdownReady: true,
      markdownScrapedAt: '2026-09-03T00:02:00.000Z',
    });
    // Not-yet-scraped articles are flagged, never omitted.
    expect(articles[1].markdownReady).toBe(false);
    expect(articles[1].markdownScrapedAt).toBeNull();
  });

  it('listResearchTopicArticles joins through the membership table', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });

    const db = await importDatabaseModule();
    const articles = await db.listResearchTopicArticles('topic-1');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toContain('JOIN research_topic_feeds tf ON tf.feed_id = a.feed_id AND tf.topic_id = ?');
    expect(message.params.params).toEqual(['topic-1']);
    expect(articles).toEqual([]);
  });

  it('clearResearchTopicArticles remembers articles before deleting them', async () => {
    vi.useFakeTimers();
    try {
      FakeWorker.onMessage = (m) => {
        if (m.action === 'query') {
          return { id: m.id, ok: true, result: [{ count: 5 }] };
        }
        return { id: m.id, ok: true, result: null };
      };

      const db = await importDatabaseModule();
      const count = await db.clearResearchTopicArticles('topic-1');
      expect(count).toBe(5);

      const [remember, markdown, articles] = FakeWorker.instance.messages;

      // Step 1: record every article (what it was + when) before wiping.
      expect(remember.action).toBe('exec');
      expect(remember.params.sql).toContain(
        'INSERT OR REPLACE INTO cleared_articles (feed_id, article_id, unique_id, url, title, cleared_at)'
      );
      expect(remember.params.sql).toContain('FROM articles a');
      expect(remember.params.sql).toContain('JOIN research_topic_feeds tf');
      expect(remember.params.params[1]).toBe('topic-1');
      expect(remember.params.params[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Step 2: scraped markdown of the member feeds goes too.
      expect(markdown.action).toBe('exec');
      expect(markdown.params.sql).toBe(
        'DELETE FROM article_markdown WHERE feed_id IN (SELECT feed_id FROM research_topic_feeds WHERE topic_id = ?)'
      );
      expect(markdown.params.params).toEqual(['topic-1']);

      // Step 3: the articles themselves, returning how many were cleared.
      expect(articles.action).toBe('query');
      expect(articles.params.sql).toContain(
        'DELETE FROM articles WHERE feed_id IN (SELECT feed_id FROM research_topic_feeds WHERE topic_id = ?)'
      );
      expect(articles.params.sql).toContain('SELECT changes() AS count');
      expect(articles.params.params).toEqual(['topic-1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('listClearedUniqueIDs returns the remembered unique ids', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{ unique_id: 'u1' }, { unique_id: 'u2' }, { unique_id: null }],
    });

    const db = await importDatabaseModule();
    const uniqueIDs = await db.listClearedUniqueIDs('feed-1');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toBe('SELECT unique_id FROM cleared_articles WHERE feed_id = ?');
    expect(message.params.params).toEqual(['feed-1']);
    expect(uniqueIDs).toEqual(['u1', 'u2']);
  });

  it('listTopicDownloadedVideos returns download pointers for member feeds', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{ feed_id: 'feed-1', article_id: 'a1', download_path: '/downloads/video.mp4' }],
    });

    const db = await importDatabaseModule();
    const videos = await db.listTopicDownloadedVideos('topic-1');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toContain('JOIN research_topic_feeds tf');
    expect(message.params.sql).toContain('a.download_path IS NOT NULL');
    expect(message.params.params).toEqual(['topic-1']);
    expect(videos).toEqual([
      { feedID: 'feed-1', articleID: 'a1', downloadPath: '/downloads/video.mp4' },
    ]);
  });

  it('initRSSSchema creates the cleared_articles memory table', async () => {
    FakeWorker.onMessage = (m) => {
      if (m.action === 'query' && m.params.sql?.startsWith('PRAGMA')) {
        return { id: m.id, ok: true, result: [] };
      }
      return { id: m.id, ok: true, result: null };
    };

    const db = await importDatabaseModule();
    await db.initRSSSchema();

    const createStatements = FakeWorker.instance.messages
      .filter((m) => m.action === 'exec')
      .map((m) => m.params.sql);
    expect(
      createStatements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS cleared_articles'))
    ).toBe(true);
  });
});
