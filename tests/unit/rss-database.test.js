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
      if (m.action === 'query' && m.params.sql === 'PRAGMA table_info(downloaded_videos)') {
        return { id: m.id, ok: true, result: [{ name: 'video_id' }, { name: 'file_path' }] };
      }
      return { id: m.id, ok: true, result: null };
    };

    const db = await importDatabaseModule();
    await db.initRSSSchema();

    const actions = FakeWorker.instance.messages.map((m) => m.action);
    expect(actions).toEqual(['exec', 'query', 'exec', 'exec', 'exec', 'query', 'exec', 'exec', 'exec', 'exec', 'exec', 'exec', 'query', 'exec', 'exec']);

    const tables = FakeWorker.instance.messages.map((m) => m.params.sql);
    expect(tables[0]).toContain('CREATE TABLE IF NOT EXISTS feeds');
    expect(tables[0]).toContain('open_original_by_default');
    expect(tables[0]).toContain('auto_download_youtube');
    expect(tables[2]).toContain('ALTER TABLE feeds ADD COLUMN open_original_by_default');
    expect(tables[3]).toContain('ALTER TABLE feeds ADD COLUMN auto_download_youtube');
    expect(tables[4]).toContain('CREATE TABLE IF NOT EXISTS articles');
    expect(tables[6]).toContain('ALTER TABLE articles ADD COLUMN download_path');
    expect(tables[7]).toContain('ALTER TABLE articles ADD COLUMN content_hash');
    expect(tables[8]).toContain('CREATE INDEX IF NOT EXISTS idx_articles_feed_id');
    expect(tables[9]).toContain('CREATE TABLE IF NOT EXISTS settings');
    expect(tables[10]).toContain('CREATE TABLE IF NOT EXISTS page_snapshots');
    expect(tables[11]).toContain('CREATE TABLE IF NOT EXISTS downloaded_videos');
    expect(tables[11]).toContain('seen INTEGER NOT NULL DEFAULT 0');
    expect(tables[11]).toContain('UNIQUE (feed_id, article_id)');
    expect(tables[12]).toContain('PRAGMA table_info(downloaded_videos)');
    expect(tables[13]).toContain('ALTER TABLE downloaded_videos ADD COLUMN seen');
    expect(tables[14]).toContain('INSERT OR IGNORE INTO downloaded_videos');
    expect(tables[14]).toContain('FROM articles');
    expect(tables[14]).toContain('download_path IS NOT NULL');
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
          result: [{ name: 'article_id' }, { name: 'download_path' }, { name: 'content_hash' }],
        };
      }
      if (m.action === 'query' && m.params.sql === 'PRAGMA table_info(downloaded_videos)') {
        return {
          id: m.id,
          ok: true,
          result: [{ name: 'video_id' }, { name: 'file_path' }, { name: 'seen' }],
        };
      }
      return { id: m.id, ok: true, result: null };
    };

    const db = await importDatabaseModule();
    await db.initRSSSchema();

    const actions = FakeWorker.instance.messages.map((m) => m.action);
    expect(actions).toEqual(['exec', 'query', 'exec', 'query', 'exec', 'exec', 'exec', 'exec', 'query', 'exec']);

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

  it('recordDownloadedVideo inserts a row with bound params and generated id', async () => {
    const db = await importDatabaseModule();
    await db.recordDownloadedVideo({
      feedID: 'feed123',
      articleID: 'art1',
      youtubeURL: 'https://www.youtube.com/watch?v=abc',
      filePath: '/downloads/Aaron-RSS-YouTube/abc.mp4',
      title: 'My Video',
      downloadedAt: new Date('2026-01-01T00:00:00.000Z'),
      fileSizeBytes: 12345,
    });

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('INSERT OR REPLACE INTO downloaded_videos');
    expect(message.params.sql).toContain('(video_id, feed_id, article_id, youtube_url, file_path, title, downloaded_at, file_size_bytes, seen)');
    // A fresh download record is always ready (unwatched).
    expect(message.params.sql).toContain('VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)');
    expect(message.params.params[0]).toEqual(expect.any(String));
    expect(message.params.params.slice(1)).toEqual([
      'feed123',
      'art1',
      'https://www.youtube.com/watch?v=abc',
      '/downloads/Aaron-RSS-YouTube/abc.mp4',
      'My Video',
      '2026-01-01T00:00:00.000Z',
      12345,
    ]);
  });

  it('recordDownloadedVideo tolerates null crypto.randomUUID', async () => {
    const db = await importDatabaseModule();
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {});

    await db.recordDownloadedVideo({
      feedID: null,
      articleID: 'art1',
      youtubeURL: 'https://www.youtube.com/watch?v=abc',
      filePath: '/downloads/Aaron-RSS-YouTube/abc.mp4',
      title: null,
    });

    const params = FakeWorker.instance.messages[0].params.params;
    expect(typeof params[0]).toBe('string');
    expect(params[0].length).toBeGreaterThan(0);
    expect(params[6]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(params[7]).toBeNull();
    vi.stubGlobal('crypto', originalCrypto);
  });

  it('listDownloadedVideos maps rows to camelCase objects', async () => {
    const db = await importDatabaseModule();
    await db.listDownloadedVideos();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toContain('SELECT * FROM downloaded_videos ORDER BY downloaded_at DESC');
  });

  it('getDownloadedVideoForArticle queries by feed and article id', async () => {
    const db = await importDatabaseModule();
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [
        {
          video_id: 'vid1',
          feed_id: 'feed123',
          article_id: 'art1',
          youtube_url: 'https://www.youtube.com/watch?v=abc',
          file_path: '/downloads/Aaron-RSS-YouTube/abc.mp4',
          title: 'My Video',
          downloaded_at: '2026-01-01T00:00:00.000Z',
          file_size_bytes: 42,
        },
      ],
    });

    const record = await db.getDownloadedVideoForArticle('feed123', 'art1');

    const message = FakeWorker.instance.messages[0];
    expect(message.params.sql).toContain('WHERE feed_id = ? AND article_id = ?');
    expect(message.params.params).toEqual(['feed123', 'art1']);
    expect(record).toEqual({
      videoID: 'vid1',
      feedID: 'feed123',
      articleID: 'art1',
      youtubeURL: 'https://www.youtube.com/watch?v=abc',
      filePath: '/downloads/Aaron-RSS-YouTube/abc.mp4',
      title: 'My Video',
      downloadedAt: '2026-01-01T00:00:00.000Z',
      fileSizeBytes: 42,
    });
  });

  it('getDownloadedVideoForArticle returns null when no record exists', async () => {
    const db = await importDatabaseModule();

    const record = await db.getDownloadedVideoForArticle('feed123', 'art1');

    expect(record).toBeNull();
  });

  it('deleteDownloadedVideosForArticle deletes by feed and article id', async () => {
    const db = await importDatabaseModule();
    await db.deleteDownloadedVideosForArticle('feed123', 'art1');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('DELETE FROM downloaded_videos WHERE feed_id = ? AND article_id = ?');
    expect(message.params.params).toEqual(['feed123', 'art1']);
  });

  it('deleteDownloadedVideosForFeed deletes by feed id', async () => {
    const db = await importDatabaseModule();
    await db.deleteDownloadedVideosForFeed('feed123');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('exec');
    expect(message.params.sql).toContain('DELETE FROM downloaded_videos WHERE feed_id = ?');
    expect(message.params.params).toEqual(['feed123']);
  });

  it('article load queries COALESCE the downloaded_videos table over the article column', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });
    const db = await importDatabaseModule();
    await db.loadFeedsForDisplay();
    await db.loadAllFeeds();
    await db.loadFeed('feed123');

    for (const message of FakeWorker.instance.messages) {
      expect(message.params.sql).toContain('COALESCE(v.file_path, a.download_path) AS download_path');
      expect(message.params.sql).toContain(
        'LEFT JOIN downloaded_videos v ON v.feed_id = a.feed_id AND v.article_id = a.article_id'
      );
    }
  });

  it('loadFeedsForDisplay excludes ready (unwatched) downloaded videos from the main feed', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });
    const db = await importDatabaseModule();
    await db.loadFeedsForDisplay();

    const sql = FakeWorker.instance.messages[0].params.sql;
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('rv.feed_id = a.feed_id AND rv.article_id = a.article_id');
    expect(sql).toContain('rv.seen = 0');
    expect(sql).toContain("rv.file_path IS NOT NULL AND rv.file_path != ''");
  });

  it('other feed loaders do not exclude ready downloaded videos', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });
    const db = await importDatabaseModule();
    await db.loadAllFeeds();
    await db.loadFeed('feed123');

    for (const message of FakeWorker.instance.messages) {
      expect(message.params.sql).not.toContain('NOT EXISTS');
    }
  });

  it('countUnseenDownloadedVideos returns the ready count', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{ ready_count: 3 }],
    });

    const db = await importDatabaseModule();
    const count = await db.countUnseenDownloadedVideos();

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).toContain('SELECT COUNT(*) AS ready_count FROM downloaded_videos');
    expect(message.params.sql).toContain('WHERE seen = 0');
    expect(message.params.sql).toContain("file_path IS NOT NULL AND file_path != ''");
    expect(count).toBe(3);
  });

  it('countUnseenDownloadedVideos returns 0 when no rows come back', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: null });

    const db = await importDatabaseModule();
    const count = await db.countUnseenDownloadedVideos();

    expect(count).toBe(0);
  });

  it('markDownloadedVideoSeen updates the seen flag with bound params', async () => {
    const db = await importDatabaseModule();
    await db.markDownloadedVideoSeen('feed123', 'art1', true);
    await db.markDownloadedVideoSeen('feed123', 'art2', false);
    await db.markDownloadedVideoSeen('feed123', 'art3');

    const [seenMessage, unseenMessage, defaultMessage] = FakeWorker.instance.messages;
    expect(seenMessage.action).toBe('exec');
    expect(seenMessage.params.sql).toBe('UPDATE downloaded_videos SET seen = ? WHERE feed_id = ? AND article_id = ?');
    expect(seenMessage.params.params).toEqual([1, 'feed123', 'art1']);
    expect(unseenMessage.params.params).toEqual([0, 'feed123', 'art2']);
    // Defaults to seen (watched).
    expect(defaultMessage.params.params).toEqual([1, 'feed123', 'art3']);
  });

  it('listPrunableDownloadedVideos selects old read unstarred articles with downloads', async () => {
    const db = await importDatabaseModule();
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [
        { article_id: 'art1', download_path: '/downloads/a.mp4' },
        { article_id: 'art2', download_path: '/downloads/b.mp4' },
      ],
    });

    const items = await db.listPrunableDownloadedVideos('feed123', 30);

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.sql).not.toContain('DELETE');
    expect(message.params.sql).toContain('read = 1');
    expect(message.params.sql).toContain('starred = 0');
    expect(message.params.sql).toContain('date_arrived < ?');
    expect(message.params.sql).toContain('download_path IS NOT NULL');
    expect(message.params.sql).toContain('download_path != ' + "''");
    expect(message.params.params[0]).toBe('feed123');
    expect(items).toEqual([
      { articleID: 'art1', downloadPath: '/downloads/a.mp4' },
      { articleID: 'art2', downloadPath: '/downloads/b.mp4' },
    ]);
  });

  it('listPrunableDownloadedVideos uses the default retention window when omitted', async () => {
    const db = await importDatabaseModule();
    await db.listPrunableDownloadedVideos('feed123');

    const message = FakeWorker.instance.messages[0];
    expect(message.params.params).toHaveLength(2);
    // Cutoff should be roughly now minus 30 days (default retention).
    const cutoff = new Date(message.params.params[1]);
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(60 * 1000);
  });

  it('loadDownloadedArticles joins downloaded_videos with feeds and articles', async () => {
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
        last_fetch_end_time: null,
        synthetic: 0,
        open_original_by_default: 0,
        auto_download_youtube: 0,
        article_id: 'art1',
        article_url: 'https://www.youtube.com/watch?v=e2eVideosV1',
        unique_id: 'u1',
        title: 'Downloaded Post',
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
    const items = await db.loadDownloadedArticles();

    expect(FakeWorker.instance.messages[0].action).toBe('query');
    expect(FakeWorker.instance.messages[0].params.sql).toContain('FROM downloaded_videos v');
    expect(FakeWorker.instance.messages[0].params.sql).toContain('LEFT JOIN feeds f ON f.feed_id = v.feed_id');
    expect(FakeWorker.instance.messages[0].params.sql).toContain('LEFT JOIN articles a ON a.feed_id = v.feed_id AND a.article_id = v.article_id');
    expect(FakeWorker.instance.messages[0].params.sql).toContain('ORDER BY v.downloaded_at DESC');

    expect(items).toHaveLength(1);
    expect(items[0].feed.feedID).toBe('feed123');
    expect(items[0].article.articleID).toBe('art1');
    expect(items[0].article.downloadPath).toBe('/downloads/video.mp4');
  });

  it('loadDownloadedArticles surfaces dangling video rows with fallback metadata', async () => {
    // Simulates a video whose article row was deleted but whose
    // downloaded_videos row and file remain: feed and article columns are
    // NULL and the title/URL come from the video queue via COALESCE. The
    // queue row's own feed_id/article_id are exposed so the entry can
    // still be opened and deleted from the Videos view.
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{
        feed_id: null,
        feed_url: null,
        name: null,
        home_page_url: null,
        icon_url: null,
        favicon_url: null,
        last_fetch_successful: null,
        last_fetch_end_time: null,
        synthetic: null,
        open_original_by_default: null,
        auto_download_youtube: null,
        article_id: null,
        article_url: 'https://www.youtube.com/watch?v=e2eVideosV1',
        unique_id: null,
        title: 'Dangling Video',
        content_html: null,
        content_text: null,
        external_url: null,
        summary: null,
        image_url: null,
        banner_image_url: null,
        date_published: null,
        date_modified: null,
        authors: null,
        tags: null,
        read: 0,
        starred: 0,
        download_path: '/downloads/dangling.mp4',
        date_arrived: '2026-01-01T00:00:00.000Z',
        video_feed_id: 'queueFeed1',
        video_article_id: 'queueArt1',
      }],
    });

    const db = await importDatabaseModule();
    const items = await db.loadDownloadedArticles();

    expect(items).toHaveLength(1);
    expect(items[0].feed).toBeNull();
    expect(items[0].article.articleID).toBe('queueArt1');
    expect(items[0].article.feedID).toBe('queueFeed1');
    expect(items[0].article.title).toBe('Dangling Video');
    expect(items[0].article.url).toBe('https://www.youtube.com/watch?v=e2eVideosV1');
    expect(items[0].article.downloadPath).toBe('/downloads/dangling.mp4');
  });

  it('loadDownloadedArticles selects the queue row feed/article IDs', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });
    const db = await importDatabaseModule();
    await db.loadDownloadedArticles();

    const sql = FakeWorker.instance.messages[0].params.sql;
    expect(sql).toContain('v.feed_id AS video_feed_id');
    expect(sql).toContain('v.article_id AS video_article_id');
  });

  it('loadDownloadedArticles keeps the feed attached when only the article row is gone', async () => {
    // Feed still alive but its article row vanished: the video entry keeps
    // the feed for name display and still shows the video metadata.
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{
        feed_id: 'feed123',
        feed_url: 'https://example.com/feed',
        name: 'Example Feed',
        home_page_url: null,
        icon_url: null,
        favicon_url: null,
        last_fetch_successful: 1,
        last_fetch_end_time: null,
        synthetic: 0,
        open_original_by_default: 0,
        auto_download_youtube: 0,
        article_id: null,
        article_url: 'https://www.youtube.com/watch?v=e2eVideosV1',
        unique_id: null,
        title: 'Video Queue Title',
        content_html: null,
        content_text: null,
        external_url: null,
        summary: null,
        image_url: null,
        banner_image_url: null,
        date_published: null,
        date_modified: null,
        authors: null,
        tags: null,
        read: 0,
        starred: 0,
        download_path: '/downloads/orphan.mp4',
        date_arrived: '2026-01-01T00:00:00.000Z',
      }],
    });

    const db = await importDatabaseModule();
    const items = await db.loadDownloadedArticles();

    expect(items).toHaveLength(1);
    expect(items[0].feed.feedID).toBe('feed123');
    expect(items[0].feed.articles).toHaveLength(0);
    expect(items[0].article.title).toBe('Video Queue Title');
    expect(items[0].article.downloadPath).toBe('/downloads/orphan.mp4');
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
    expect(message.params.sql).toContain('content_hash');
    expect(message.params.params[0]).toBe('art1');
    expect(message.params.params[1]).toBe('feed123');
  });

  it('saveArticles skips articles flagged skipPersist', async () => {
    const db = await importDatabaseModule();
    const articles = [
      {
        articleID: 'unchanged',
        uniqueID: 'u1',
        title: 'Unchanged',
        read: false,
        starred: false,
        skipPersist: true,
        dateArrived: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        articleID: 'changed',
        uniqueID: 'u2',
        title: 'Changed',
        read: false,
        starred: false,
        contentHash: 'deadbeef-42',
        dateArrived: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    await db.saveArticles('feed123', articles);

    // Only the changed article is written.
    expect(FakeWorker.instance.messages).toHaveLength(1);
    const message = FakeWorker.instance.messages[0];
    expect(message.params.params[0]).toBe('changed');
    // Content hash is bound so future refreshes can detect no-op saves.
    expect(message.params.params.at(-1)).toBe('deadbeef-42');
  });

  it('loadFeedsForDisplay omits regular article content but keeps social posts', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });

    const db = await importDatabaseModule();
    await db.loadFeedsForDisplay();

    const sql = FakeWorker.instance.messages[0].params.sql;
    // Content columns are selected via a social-URL CASE guard, not raw.
    expect(sql).toContain('CASE WHEN');
    expect(sql).toContain("LIKE 'https://bsky.app/profile/%/post/%'");
    expect(sql).toContain('THEN a.content_html END AS content_html');
    expect(sql).not.toMatch(/a\.content_html, a\.content_text/);
    expect(sql).toContain('a.read = 0');
  });

  it('loadFeedForRefresh queries a feed without article content columns', async () => {
    FakeWorker.onMessage = (m) => ({ id: m.id, ok: true, result: [] });

    const db = await importDatabaseModule();
    await db.loadFeedForRefresh('feed123');

    const message = FakeWorker.instance.messages[0];
    expect(message.action).toBe('query');
    expect(message.params.params).toEqual(['feed123']);
    expect(message.params.sql).toContain('WHERE f.feed_id = ?');
    expect(message.params.sql).not.toContain('content_html');
    expect(message.params.sql).not.toContain('content_text');
    expect(message.params.sql).toContain('a.content_hash');
    expect(message.params.sql).toContain('COALESCE(v.file_path, a.download_path)');
  });

  it('loadArticleContent returns only the content columns for one article', async () => {
    FakeWorker.onMessage = (m) => ({
      id: m.id,
      ok: true,
      result: [{ content_html: '<p>Hi</p>', content_text: 'Hi' }],
    });

    const db = await importDatabaseModule();
    const content = await db.loadArticleContent('feed123', 'art1');

    const message = FakeWorker.instance.messages[0];
    expect(message.params.sql).toBe('SELECT content_html, content_text FROM articles WHERE feed_id = ? AND article_id = ?');
    expect(message.params.params).toEqual(['feed123', 'art1']);
    expect(content).toEqual({ contentHTML: '<p>Hi</p>', contentText: 'Hi' });
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

  describe('write amplification analysis', () => {
    it('saveArticles performs one worker round-trip per article', async () => {
      const db = await importDatabaseModule();
      const articles = [
        { articleID: 'art1', uniqueID: 'u1', dateArrived: new Date('2026-01-01T00:00:00.000Z') },
        { articleID: 'art2', uniqueID: 'u2', dateArrived: new Date('2026-01-02T00:00:00.000Z') },
        { articleID: 'art3', uniqueID: 'u3', dateArrived: new Date('2026-01-03T00:00:00.000Z') },
      ];

      await db.saveArticles('feed123', articles);

      expect(FakeWorker.instance.messages).toHaveLength(articles.length);
      FakeWorker.instance.messages.forEach((message) => {
        expect(message.action).toBe('exec');
        expect(message.params.sql).toContain('INSERT INTO articles');
      });
    });

    it('saveSettings performs one worker round-trip per setting', async () => {
      const db = await importDatabaseModule();
      await db.saveSettings({ a: '1', b: '2', c: '3' });

      expect(FakeWorker.instance.messages).toHaveLength(3);
      FakeWorker.instance.messages.forEach((message) => {
        expect(message.action).toBe('exec');
        expect(message.params.sql).toContain('INSERT INTO settings');
      });
    });

    it('saveFeed rewrites every article with one exec per article', async () => {
      const db = await importDatabaseModule();
      const feed = {
        feedID: 'feed123',
        url: 'https://example.com/feed',
        name: 'Example Feed',
        homePageURL: 'https://example.com',
        lastFetchWasSuccessful: true,
        synthetic: false,
        articles: [
          { articleID: 'art1', uniqueID: 'u1', dateArrived: new Date('2026-01-01T00:00:00.000Z') },
          { articleID: 'art2', uniqueID: 'u2', dateArrived: new Date('2026-01-02T00:00:00.000Z') },
        ],
      };

      await db.saveFeed(feed);

      // One feed upsert, one bulk delete of existing articles, then one
      // insert per article. This documents the current per-article write
      // cost; a future batch-exec worker action could reduce it.
      expect(FakeWorker.instance.messages).toHaveLength(1 + 1 + feed.articles.length);
    });
  });
});
