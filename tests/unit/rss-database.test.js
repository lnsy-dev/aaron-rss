/**
 * RSS Database Helpers Unit Tests
 *
 * Tests the RSS-specific helpers in src/lib/database.js against a fake
 * Worker global. Asserts exact action names, SQL, and bound parameters.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

async function importDatabaseModule() {
  return await import('../../src/lib/database.js');
}

describe('rss database helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instance = null;
    FakeWorker.onMessage = null;
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates feeds, articles, and settings tables via initRSSSchema', async () => {
    FakeWorker.onMessage = (m) => {
      if (m.action === 'query' && m.params.sql === 'PRAGMA table_info(feeds)') {
        return { id: m.id, ok: true, result: [{ name: 'feed_id' }, { name: 'url' }] };
      }
      if (m.action === 'query' && m.params.sql === 'PRAGMA table_info(articles)') {
        return { id: m.id, ok: true, result: [{ name: 'article_id' }, { name: 'feed_id' }] };
      }
      return { id: m.id, ok: true, result: null };
    };

    const db = await importDatabaseModule();
    await db.initRSSSchema();

    const actions = FakeWorker.instance.messages.map((m) => m.action);
    expect(actions).toEqual(['exec', 'query', 'exec', 'exec', 'exec', 'query', 'exec', 'exec', 'exec']);

    const tables = FakeWorker.instance.messages.map((m) => m.params.sql);
    expect(tables[0]).toContain('CREATE TABLE IF NOT EXISTS feeds');
    expect(tables[0]).toContain('open_original_by_default');
    expect(tables[0]).toContain('auto_download_youtube');
    expect(tables[2]).toContain('ALTER TABLE feeds ADD COLUMN open_original_by_default');
    expect(tables[3]).toContain('ALTER TABLE feeds ADD COLUMN auto_download_youtube');
    expect(tables[4]).toContain('CREATE TABLE IF NOT EXISTS articles');
    expect(tables[6]).toContain('ALTER TABLE articles ADD COLUMN download_path');
    expect(tables[7]).toContain('CREATE TABLE IF NOT EXISTS settings');
    expect(tables[8]).toContain('CREATE TABLE IF NOT EXISTS page_snapshots');
  });

  it('skips migrations when all optional columns already exist', async () => {
    FakeWorker.onMessage = (m) => {
      if (m.action === 'query' && m.params.sql === 'PRAGMA table_info(feeds)') {
        return {
          id: m.id,
          ok: true,
          result: [
            { name: 'feed_id' },
            { name: 'open_original_by_default' },
            { name: 'auto_download_youtube' },
          ],
        };
      }
      if (m.action === 'query' && m.params.sql === 'PRAGMA table_info(articles)') {
        return {
          id: m.id,
          ok: true,
          result: [{ name: 'article_id' }, { name: 'download_path' }],
        };
      }
      return { id: m.id, ok: true, result: null };
    };

    const db = await importDatabaseModule();
    await db.initRSSSchema();

    const actions = FakeWorker.instance.messages.map((m) => m.action);
    expect(actions).toEqual(['exec', 'query', 'exec', 'query', 'exec', 'exec']);

    const alterMessages = FakeWorker.instance.messages.filter((m) =>
      m.params.sql?.includes('ALTER TABLE')
    );
    expect(alterMessages).toHaveLength(0);
  });

  it('saveFeed upserts feed row and inserts articles', async () => {
    const db = await importDatabaseModule();
    const feed = {
      feedID: 'feed123',
      url: 'https://example.com/feed',
      name: 'Example Feed',
      homePageURL: 'https://example.com',
      iconURL: undefined,
      faviconURL: 'https://example.com/favicon.ico',
      lastFetchWasSuccessful: true,
      lastFetchEndTime: new Date('2026-01-01T00:00:00.000Z'),
      synthetic: false,
      articles: [
        {
          articleID: 'art1',
          uniqueID: 'u1',
          title: 'Hello',
          read: false,
          starred: true,
          dateArrived: new Date('2026-01-01T00:00:00.000Z'),
          authors: [{ name: 'Alice' }],
          tags: ['news'],
        },
      ],
    };

    await db.saveFeed(feed);

    const [upsertFeed, deleteArticles, insertArticle] = FakeWorker.instance.messages;

    expect(upsertFeed.action).toBe('exec');
    expect(upsertFeed.params.sql).toContain('INSERT INTO feeds');
    expect(upsertFeed.params.sql).toContain('open_original_by_default');
    expect(upsertFeed.params.params[0]).toBe('feed123');
    expect(upsertFeed.params.params[2]).toBe('Example Feed');
    expect(upsertFeed.params.params).toHaveLength(11);

    expect(deleteArticles.action).toBe('exec');
    expect(deleteArticles.params.sql).toBe('DELETE FROM articles WHERE feed_id = ?');
    expect(deleteArticles.params.params).toEqual(['feed123']);

    expect(insertArticle.action).toBe('exec');
    expect(insertArticle.params.sql).toContain('INSERT INTO articles');
    expect(insertArticle.params.params[0]).toBe('art1');
    expect(insertArticle.params.params[1]).toBe('feed123');
  });

  it('loadAllFeeds queries feeds with articles', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{
        feed_id: 'feed123',
        feed_url: 'https://example.com/feed',
        name: 'Example Feed',
        home_page_url: 'https://example.com',
        icon_url: null,
        favicon_url: null,
        last_fetch_successful: 1,
        last_fetch_end_time: '2026-01-01T00:00:00.000Z',
        synthetic: 0,
        open_original_by_default: 1,
        auto_download_youtube: 1,
        article_id: 'art1',
        article_url: 'https://example.com/post',
        unique_id: 'u1',
        title: 'Hello',
        content_html: null,
        content_text: null,
        external_url: null,
        summary: null,
        image_url: null,
        banner_image_url: null,
        date_published: null,
        date_modified: null,
        authors: '[]',
        tags: '[]',
        read: 0,
        starred: 0,
        download_path: '/downloads/video.mp4',
        date_arrived: '2026-01-01T00:00:00.000Z',
      }],
    });

    const db = await importDatabaseModule();
    const feeds = await db.loadAllFeeds();

    expect(FakeWorker.instance.messages[0].action).toBe('query');
    expect(FakeWorker.instance.messages[0].params.sql).toContain('FROM feeds f');
    expect(FakeWorker.instance.messages[0].params.sql).toContain('LEFT JOIN articles a');

    expect(feeds).toHaveLength(1);
    expect(feeds[0].feedID).toBe('feed123');
    expect(feeds[0].url).toBe('https://example.com/feed');
    expect(feeds[0].openOriginalByDefault).toBe(true);
    expect(feeds[0].autoDownloadYouTube).toBe(true);
    expect(feeds[0].articles).toHaveLength(1);
    expect(feeds[0].articles[0].articleID).toBe('art1');
    expect(feeds[0].articles[0].url).toBe('https://example.com/post');
    expect(feeds[0].articles[0].downloadPath).toBe('/downloads/video.mp4');
  });

  it('deleteFeed removes articles, feed, and page snapshot', async () => {
    const db = await importDatabaseModule();
    await db.deleteFeed('feed123');

    const [deleteArticles, deleteFeed, deleteSnapshot] = FakeWorker.instance.messages;
    expect(deleteArticles.action).toBe('exec');
    expect(deleteArticles.params.sql).toBe('DELETE FROM articles WHERE feed_id = ?');
    expect(deleteArticles.params.params).toEqual(['feed123']);

    expect(deleteFeed.action).toBe('exec');
    expect(deleteFeed.params.sql).toBe('DELETE FROM feeds WHERE feed_id = ?');
    expect(deleteFeed.params.params).toEqual(['feed123']);

    expect(deleteSnapshot.action).toBe('exec');
    expect(deleteSnapshot.params.sql).toBe('DELETE FROM page_snapshots WHERE feed_id = ?');
    expect(deleteSnapshot.params.params).toEqual(['feed123']);
  });

  it('savePageSnapshot upserts the link list with bound params', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const db = await importDatabaseModule();
      await db.savePageSnapshot('feed123', ['https://example.com/a', 'https://example.com/b']);

      const message = FakeWorker.instance.messages[0];
      expect(message.action).toBe('exec');
      expect(message.params.sql).toContain('INSERT INTO page_snapshots');
      expect(message.params.sql).toContain('ON CONFLICT(feed_id) DO UPDATE SET');
      expect(message.params.params).toEqual([
        'feed123',
        JSON.stringify(['https://example.com/a', 'https://example.com/b']),
        '2026-01-01T00:00:00.000Z',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('loadPageSnapshot parses stored links and returns null when absent', async () => {
    const db = await importDatabaseModule();

    // Absent: worker returns null result.
    expect(await db.loadPageSnapshot('feed-none')).toBeNull();

    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{
        feed_id: 'feed123',
        links_json: '["https://example.com/a"]',
        captured_at: '2026-01-01T00:00:00.000Z',
      }],
    });

    const snapshot = await db.loadPageSnapshot('feed123');
    expect(FakeWorker.instance.messages.at(-1).params.params).toEqual(['feed123']);
    expect(snapshot).toEqual({
      feedID: 'feed123',
      links: ['https://example.com/a'],
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('updateFeedOpenOriginalByDefault updates the feed with bound params', async () => {
    const db = await importDatabaseModule();
    await db.updateFeedOpenOriginalByDefault('feed123', true);

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('UPDATE feeds SET');
    expect(message.params.sql).toContain('open_original_by_default = ?');
    expect(message.params.sql).toContain('WHERE feed_id = ?');
    expect(message.params.params).toEqual([1, 'feed123']);
  });

  it('updateArticleStatus updates read and starred with bound params', async () => {
    const db = await importDatabaseModule();
    await db.updateArticleStatus('feed123', 'art1', { read: true, starred: false });

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('UPDATE articles SET');
    expect(message.params.sql).toContain('read = ?');
    expect(message.params.sql).toContain('starred = ?');
    expect(message.params.sql).toContain('WHERE feed_id = ? AND article_id = ?');
    expect(message.params.params).toEqual([1, 0, 'feed123', 'art1']);
  });

  it('updateArticleStatus updates download_path with bound params', async () => {
    const db = await importDatabaseModule();
    await db.updateArticleStatus('feed123', 'art1', { downloadPath: '/downloads/video.mp4' });

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('UPDATE articles SET');
    expect(message.params.sql).toContain('download_path = ?');
    expect(message.params.sql).toContain('WHERE feed_id = ? AND article_id = ?');
    expect(message.params.params).toEqual(['/downloads/video.mp4', 'feed123', 'art1']);
  });

  it('updateFeedAutoDownloadYouTube updates the feed with bound params', async () => {
    const db = await importDatabaseModule();
    await db.updateFeedAutoDownloadYouTube('feed123', true);

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('UPDATE feeds SET');
    expect(message.params.sql).toContain('auto_download_youtube = ?');
    expect(message.params.sql).toContain('WHERE feed_id = ?');
    expect(message.params.params).toEqual([1, 'feed123']);
  });

  it('markAllArticlesAsRead updates all unread articles in one query', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{ count: 5 }],
    });

    const db = await importDatabaseModule();
    const count = await db.markAllArticlesAsRead();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toBe('UPDATE articles SET read = 1 WHERE read = 0; SELECT changes() AS count');
    expect(message.params.params).toBeUndefined();
    expect(count).toBe(5);
  });

  it('loadSettings returns defaults and parses stored values', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [
        { key: 'maxArticlesPerFeed', value: '100' },
        { key: 'showUnreadOnly', value: 'true' },
        { key: 'sourcesFolder', value: 'saved' },
      ],
    });

    const db = await importDatabaseModule();
    const settings = await db.loadSettings();

    expect(FakeWorker.instance.messages[0].action).toBe('query');
    expect(settings.maxArticlesPerFeed).toBe(100);
    expect(settings.showUnreadOnly).toBe(true);
    expect(settings.sourcesFolder).toBe('saved');
    expect(settings.refreshInterval).toBe(5);
  });

  it('saveSettings inserts key/value pairs with bound params', async () => {
    const db = await importDatabaseModule();
    await db.saveSettings({ maxArticlesPerFeed: 75, sourcesFolder: 'feeds', refreshInterval: 30 });

    expect(FakeWorker.instance.messages).toHaveLength(3);
    const [first, second, third] = FakeWorker.instance.messages;
    expect(first.action).toBe('exec');
    expect(first.params.sql).toContain('INSERT INTO settings');
    expect(first.params.params).toEqual(['maxArticlesPerFeed', '75']);
    expect(second.params.params).toEqual(['sourcesFolder', 'feeds']);
    expect(third.params.params).toEqual(['refreshInterval', '30']);
  });

  it('loadSettings parses a stored refreshInterval as an integer', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{ key: 'refreshInterval', value: '15' }],
    });

    const db = await importDatabaseModule();
    const settings = await db.loadSettings();

    expect(settings.refreshInterval).toBe(15);
  });

  it('saveFeedMetadata upserts only the feeds row', async () => {
    const db = await importDatabaseModule();
    const feed = {
      feedID: 'feed123',
      url: 'https://example.com/feed',
      name: 'Example Feed',
      homePageURL: 'https://example.com',
      iconURL: undefined,
      faviconURL: 'https://example.com/favicon.ico',
      lastFetchWasSuccessful: true,
      lastFetchEndTime: new Date('2026-01-01T00:00:00.000Z'),
      synthetic: false,
      articles: [],
    };

    await db.saveFeedMetadata(feed);

    expect(FakeWorker.instance.messages).toHaveLength(1);
    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('INSERT INTO feeds');
    expect(message.params.sql).toContain('ON CONFLICT(feed_id) DO UPDATE SET');
    expect(message.params.params[0]).toBe('feed123');
  });

  it('saveArticles upserts articles with bound parameters', async () => {
    const db = await importDatabaseModule();
    const articles = [
      {
        articleID: 'art1',
        uniqueID: 'u1',
        title: 'Hello',
        read: false,
        starred: true,
        dateArrived: new Date('2026-01-01T00:00:00.000Z'),
        authors: [{ name: 'Alice' }],
        tags: ['news'],
      },
    ];

    await db.saveArticles('feed123', articles);

    expect(FakeWorker.instance.messages).toHaveLength(1);
    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('INSERT INTO articles');
    expect(message.params.sql).toContain('ON CONFLICT(article_id) DO UPDATE SET');
    expect(message.params.params[0]).toBe('art1');
    expect(message.params.params[1]).toBe('feed123');
  });

  it('deleteArticlesNotInSet deletes unstarred articles outside the kept set', async () => {
    const db = await importDatabaseModule();
    await db.deleteArticlesNotInSet('feed123', ['art1', 'art2']);

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('DELETE FROM articles');
    expect(message.params.sql).toContain('feed_id = ?');
    expect(message.params.sql).toContain('article_id NOT IN (?, ?)');
    expect(message.params.sql).toContain('starred = 0');
    expect(message.params.params).toEqual(['feed123', 'art1', 'art2']);
  });

  it('deleteArticlesNotInSet is a no-op for an empty kept set', async () => {
    const db = await importDatabaseModule();
    await db.deleteArticlesNotInSet('feed123', []);

    expect(FakeWorker.instance?.messages ?? []).toHaveLength(0);
  });

  it('purgeOldReadArticles deletes read unstarred articles older than the cutoff', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-02-15T00:00:00.000Z'));
    try {
      const db = await importDatabaseModule();
      await db.purgeOldReadArticles('feed123', 30);

      const message = FakeWorker.instance.messages[0];
      expect(message.action).toBe('exec');
      expect(message.params.sql).toContain('DELETE FROM articles');
      expect(message.params.sql).toContain('read = 1');
      expect(message.params.sql).toContain('starred = 0');
      expect(message.params.sql).toContain('date_arrived < ?');
      expect(message.params.params[0]).toBe('feed123');
      expect(message.params.params[1]).toBe('2026-01-16T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('loadFeedsForDisplay queries only unread articles', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [],
    });

    const db = await importDatabaseModule();
    await db.loadFeedsForDisplay();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toContain('LEFT JOIN articles a ON a.feed_id = f.feed_id AND a.read = 0');
    expect(message.params.sql).toContain('ORDER BY f.name');
  });
});
