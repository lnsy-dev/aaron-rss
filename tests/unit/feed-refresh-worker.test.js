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

  beforeAll(async () => {
    postedMessages = [];

    // Minimal worker global: the module registers self.onmessage and
    // posts responses through self.postMessage.
    globalThis.self = {
      onmessage: null,
      postMessage: (msg) => postedMessages.push(msg),
      onerror: null,
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
});
