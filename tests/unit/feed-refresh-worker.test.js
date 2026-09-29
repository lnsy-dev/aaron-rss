/**
 * Feed Refresh Worker Unit Tests
 *
 * Tests the failure/no-new-item merge paths in src/feed-refresh-worker.js.
 * The worker module is imported directly with `self` stubbed so the
 * message handler can be driven without a real Worker environment.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

describe('feed refresh worker', () => {
  let postedMessages;
  let fetchPort;

  beforeAll(async () => {
    postedMessages = [];

    // Minimal worker global: the module registers self.onmessage and
    // posts responses through self.postMessage.
    globalThis.self = {
      onmessage: null,
      postMessage: (msg) => postedMessages.push(msg),
      onerror: null,
    };

    // Fake relay port: records worker requests and lets each test answer
    // them through a scripted handler, mirroring the main-thread relay.
    fetchPort = {
      messages: [],
      onmessage: null,
      onReply: null,
      postMessage(msg) {
        this.messages.push(msg);
        if (this.onReply) {
          // The real port dispatches onmessage; answer synchronously so
          // the awaited relayFetchText resolves inside send().
          this.onmessage({ data: this.onReply(msg) });
        }
      },
    };

    await import('../../src/feed-refresh-worker.js');
  });

  afterAll(() => {
    delete globalThis.self;
  });

  function send(params) {
    postedMessages.length = 0;
    return globalThis.self.onmessage({ data: { id: 1, action: 'refreshFeed', params } });
  }

  function lastResult() {
    return postedMessages[postedMessages.length - 1];
  }

  function installPort() {
    postedMessages.length = 0;
    fetchPort.messages.length = 0;
    fetchPort.onReply = null;
    globalThis.self.onmessage({ data: { id: 0, action: 'setFetchPort' }, ports: [fetchPort] });
    return fetchPort;
  }

  const RSS_FEED_TEXT = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Relayed Feed',
    home_page_url: 'https://example.com',
    items: [{ id: 'u1', url: 'https://example.com/1', title: 'One' }],
  });

  it('marks articles skipPersist when parsing fails so stored content survives', async () => {
    const existingFeed = {
      feedID: 'feed-a',
      url: 'https://example.com/feed',
      articles: [
        // Refresh-slim record: no content columns on purpose.
        { articleID: 'art1', uniqueID: 'u1', read: true, starred: true, contentHash: 'h1' },
      ],
    };

    await send({ feedText: 'not-a-feed', existingFeed, maxArticles: 50 });

    const response = lastResult();
    expect(response.ok).toBe(true);
    expect(response.result.lastFetchWasSuccessful).toBe(false);
    expect(response.result.articles[0].skipPersist).toBe(true);
    expect(response.result.articles[0].uniqueID).toBe('u1');
  });

  it('marks articles skipPersist for snapshot refreshes with no new items', async () => {
    const existingFeed = {
      feedID: 'feed-snap',
      url: 'https://example.com/journal/',
      synthetic: true,
      articles: [
        { articleID: 'art1', uniqueID: 'u1', read: true, starred: true, contentHash: 'h1' },
      ],
    };

    await send({
      // Unchanged page: the link diff produces no new items.
      htmlText: '<html><body><a href="https://example.com/posts/old.html">Old</a></body></html>',
      snapshotLinks: ['https://example.com/posts/old.html'],
      existingFeed,
      maxArticles: 50,
    });

    const response = lastResult();
    expect(response.ok).toBe(true);
    expect(response.result.noNewItems).toBe(true);
    expect(response.result.lastFetchWasSuccessful).toBe(true);
    expect(response.result.articles[0].skipPersist).toBe(true);
  });

  it('rejects with an error message for unknown actions', async () => {
    await globalThis.self.onmessage({ data: { id: 2, action: 'bogus', params: {} } });
    const response = lastResult();
    expect(response.ok).toBe(false);
    expect(response.error).toContain('Unknown feed-refresh-worker action');
  });

  it('does not re-add cleared articles as new items', async () => {
    const existingFeed = {
      feedID: 'feed-clear',
      url: 'https://example.com/feed',
      articles: [],
    };

    const feedText = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Test Feed',
      home_page_url: 'https://example.com',
      items: [
        { id: 'u1', url: 'https://example.com/1', title: 'Kept' },
        { id: 'u2', url: 'https://example.com/2', title: 'Cleared earlier' },
      ],
    });

    await send({
      feedText,
      existingFeed,
      maxArticles: 50,
      // u2 was deliberately cleared from a research topic; it must not
      // come back as a new article.
      clearedUniqueIDs: ['u2'],
    });

    const response = lastResult();
    expect(response.ok).toBe(true);
    const uniqueIDs = response.result.articles.map((article) => article.uniqueID);
    expect(uniqueIDs).toContain('u1');
    expect(uniqueIDs).not.toContain('u2');
  });

  it('rejects the refresh when no fetch relay port is installed yet', async () => {
    // Runs before any setFetchPort message, mirroring a refresh racing
    // the relay installation.
    const existingFeed = { feedID: 'feed-remote', url: 'https://example.com/feed', articles: [] };
    await send({ fetchFromURL: existingFeed.url, existingFeed, maxArticles: 50 });

    const response = lastResult();
    expect(response.ok).toBe(false);
    expect(response.error).toContain('Fetch relay port is not installed');
  });

  it('installs a fetch relay port via the setFetchPort action', () => {
    const port = installPort();

    expect(port).toBe(fetchPort);
    // setFetchPort must not post a correlated reply.
    expect(postedMessages).toHaveLength(0);
  });

  it('rejects setFetchPort without a transferred port', async () => {
    await globalThis.self.onmessage({ data: { id: 3, action: 'setFetchPort', params: {} }, ports: [] });

    const response = lastResult();
    expect(response.ok).toBe(false);
    expect(response.error).toContain('setFetchPort requires a transferred MessagePort');
  });

  it('fetches the feed source through the relay when fetchFromURL is set', async () => {
    const port = installPort();
    port.onReply = (msg) => ({ id: msg.id, ok: true, result: { ok: true, status: 200, text: RSS_FEED_TEXT } });

    const existingFeed = { feedID: 'feed-remote', url: 'https://example.com/feed', articles: [] };
    await send({ fetchFromURL: existingFeed.url, existingFeed, maxArticles: 50 });

    // The worker asked the relay for exactly the feed URL.
    expect(port.messages).toHaveLength(1);
    expect(port.messages[0].url).toBe('https://example.com/feed');

    const response = lastResult();
    expect(response.ok).toBe(true);
    expect(response.result.lastFetchWasSuccessful).toBe(true);
    expect(response.result.name).toBe('Relayed Feed');
    expect(response.result.articles.map((a) => a.uniqueID)).toEqual(['u1']);
  });

  it('returns a failed feed when the relayed fetch reports !ok', async () => {
    const port = installPort();
    port.onReply = (msg) => ({ id: msg.id, ok: true, result: { ok: false, status: 404, text: 'Not found' } });

    const existingFeed = {
      feedID: 'feed-remote',
      url: 'https://example.com/feed',
      articles: [
        { articleID: 'art1', uniqueID: 'u1', read: true, starred: false, contentHash: 'h1' },
      ],
    };
    await send({ fetchFromURL: existingFeed.url, existingFeed, maxArticles: 50 });

    const response = lastResult();
    expect(response.ok).toBe(true);
    expect(response.result.lastFetchWasSuccessful).toBe(false);
    // Existing articles are kept with skipPersist so stored content survives.
    expect(response.result.articles[0].uniqueID).toBe('u1');
    expect(response.result.articles[0].skipPersist).toBe(true);
  });

  it('rejects the refresh when the relay fetch itself errors', async () => {
    const port = installPort();
    port.onReply = (msg) => ({ id: msg.id, ok: false, error: 'relay bridge exploded' });

    const existingFeed = { feedID: 'feed-remote', url: 'https://example.com/feed', articles: [] };
    await send({ fetchFromURL: existingFeed.url, existingFeed, maxArticles: 50 });

    const response = lastResult();
    expect(response.ok).toBe(false);
    expect(response.error).toContain('relay bridge exploded');
  });

  it('uses the relayed HTML for synthetic feeds fetched via fetchFromURL', async () => {
    const port = installPort();
    port.onReply = (msg) => ({
      id: msg.id,
      ok: true,
      result: {
        ok: true,
        status: 200,
        text: '<html><body><article><h1>Watcher</h1><a href="https://example.com/posts/1">Post 1</a></article></body></html>',
      },
    });

    const existingFeed = {
      feedID: 'feed-synth',
      url: 'https://example.com/journal/',
      synthetic: true,
      articles: [],
    };
    await send({ fetchFromURL: existingFeed.url, existingFeed, maxArticles: 50 });

    const response = lastResult();
    expect(response.ok).toBe(true);
    expect(response.result.lastFetchWasSuccessful).toBe(true);
    expect(response.result.articles.length).toBeGreaterThan(0);
  });

  it('link-diffs a relayed snapshot fetch against the stored snapshot', async () => {
    const port = installPort();
    port.onReply = (msg) => ({
      id: msg.id,
      ok: true,
      result: {
        ok: true,
        status: 200,
        text: '<html><body><a href="https://example.com/posts/old.html">Old</a>' +
          '<a href="https://example.com/posts/new.html">New</a></body></html>',
      },
    });

    const existingFeed = {
      feedID: 'feed-snap',
      url: 'https://example.com/journal/',
      synthetic: true,
      articles: [],
    };
    await send({
      fetchFromURL: existingFeed.url,
      snapshotLinks: ['https://example.com/posts/old.html'],
      existingFeed,
      maxArticles: 50,
    });

    const response = lastResult();
    expect(response.ok).toBe(true);
    // Only the link missing from the snapshot becomes an article, and the
    // grown snapshot is handed back for persistence.
    expect(response.result.articles).toHaveLength(1);
    expect(response.result.snapshotLinks).toEqual([
      'https://example.com/posts/old.html',
      'https://example.com/posts/new.html',
    ]);
  });

  describe('YouTube feed-URL fallback during channel_id outages', () => {
    const CANONICAL_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc123def456';
    const UU_URL = 'https://www.youtube.com/feeds/videos.xml?playlist_id=UUabc123def456';
    const UULF_URL = 'https://www.youtube.com/feeds/videos.xml?playlist_id=UULFabc123def456';

    function feedTextFor(url) {
      return JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: `Feed ${url}`,
        home_page_url: 'https://example.com',
        items: [{ id: 'u1', url: 'https://example.com/1', title: 'One' }],
      });
    }

    it('fetches the uploads-playlist twin when the canonical feed 404s', async () => {
      const port = installPort();
      const fetchedURLs = [];
      port.onReply = (msg) => {
        fetchedURLs.push(msg.url);
        if (msg.url === CANONICAL_URL) {
          return { id: msg.id, ok: true, result: { ok: false, status: 404, text: 'Not Found' } };
        }
        return { id: msg.id, ok: true, result: { ok: true, status: 200, text: feedTextFor(msg.url) } };
      };

      const existingFeed = { feedID: 'feed-yt', url: CANONICAL_URL, articles: [] };
      await send({ fetchFromURL: existingFeed.url, existingFeed, maxArticles: 50 });

      // Canonical first, then the UU twin; UULF never needed.
      expect(fetchedURLs).toEqual([CANONICAL_URL, UU_URL]);

      const response = lastResult();
      expect(response.ok).toBe(true);
      expect(response.result.lastFetchWasSuccessful).toBe(true);
      // The feed identity stays canonical even though the twin answered.
      expect(response.result.url).toBe(CANONICAL_URL);
    });

    it('keeps the refresh failing when every candidate 404s', async () => {
      const port = installPort();
      const fetchedURLs = [];
      port.onReply = (msg) => {
        fetchedURLs.push(msg.url);
        return { id: msg.id, ok: true, result: { ok: false, status: 404, text: 'Not Found' } };
      };

      const existingFeed = {
        feedID: 'feed-yt',
        url: CANONICAL_URL,
        articles: [
          { articleID: 'art1', uniqueID: 'u1', read: true, starred: false, contentHash: 'h1' },
        ],
      };
      await send({ fetchFromURL: existingFeed.url, existingFeed, maxArticles: 50 });

      expect(fetchedURLs).toEqual([CANONICAL_URL, UU_URL, UULF_URL]);

      const response = lastResult();
      expect(response.ok).toBe(true);
      expect(response.result.lastFetchWasSuccessful).toBe(false);
      expect(response.result.articles[0].skipPersist).toBe(true);
    });

    it('never tries alternates for non-YouTube feeds', async () => {
      const port = installPort();
      const fetchedURLs = [];
      port.onReply = (msg) => {
        fetchedURLs.push(msg.url);
        return { id: msg.id, ok: true, result: { ok: true, status: 200, text: feedTextFor(msg.url) } };
      };

      const existingFeed = { feedID: 'feed-x', url: 'https://example.com/feed', articles: [] };
      await send({ fetchFromURL: existingFeed.url, existingFeed, maxArticles: 50 });

      expect(fetchedURLs).toEqual(['https://example.com/feed']);
    });
  });
});
