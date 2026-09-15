/**
 * Read-State Retention Tests
 *
 * Regression tests for "marked articles come back as unread" (reported
 * on the feed named "The BL:UF", where the colon in the name was
 * suspected — feed names never touch persistence, so these tests use
 * that name to prove the real mechanism).
 *
 * The purge step (purgeOldReadArticles) deletes read, unstarred articles
 * 30 days after arrival to bound the database. A feed whose XML still
 * lists those items would re-add them on the next refresh as brand-new,
 * UNREAD articles, so read state appeared to be forgotten. The purge now
 * records purged uniqueIDs in the cleared_articles memory, which the
 * refresh merge already consults (listClearedUniqueIDs).
 *
 * These tests run the REAL database code against a REAL in-memory
 * SQLite (the sqlite-worker Node harness from sqlite-worker.test.js)
 * and drive the same merge functions the refresh worker uses, so the
 * whole purge → refresh → re-add cycle is exercised end to end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/** Pending response waiters keyed by message id */
const waiters = new Map();
let nextId = 1;

beforeAll(async () => {
  // Provide the worker globals, then import the worker module.
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

  // Bridge database.js's `new Worker(...)` to the real worker module so
  // the database helpers talk to the same in-memory database.
  class RealWorkerBridge {
    constructor() {
      globalThis.__readStateTestWorker = this;
    }
    postMessage(message) {
      const id = nextId++;
      waiters.set(id, {
        resolve: (result) => this.onmessage?.({ data: { id: message.id, ok: true, result } }),
        reject: (error) => this.onmessage?.({ data: { id: message.id, ok: false, error } }),
      });
      queueMicrotask(() => self.onmessage({ data: { ...message, id } }));
    }
    terminate() {}
  }
  globalThis.Worker = RealWorkerBridge;

  const db = await import('../../src/lib/database.js');
  await db.initRSSSchema();
});

afterAll(() => {
  delete globalThis.self;
  delete globalThis.Worker;
});

/** Days ago helper. */
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Build a parsed feed item shaped like the rss-parser output. */
function parsedItem(uniqueID, title, publishedAt) {
  return {
    uniqueID,
    title,
    contentHTML: `<p>${title}</p>`,
    contentText: title,
    url: `https://the-bluf.example.com/${title.toLowerCase().replace(/\s+/g, '-')}`,
    externalURL: `https://the-bluf.example.com/${title.toLowerCase().replace(/\s+/g, '-')}`,
    summary: title,
    datePublished: publishedAt,
  };
}

describe('read articles survive the purge + refresh cycle', () => {
  it('does not re-add purged read articles as unread on the next refresh', async () => {
    const db = await import('../../src/lib/database.js');
    const { processNewArticles, updateExistingArticles, mergeArticles } = await import(
      '../../src/lib/article-processor.js'
    );

    const feedID = 'bluf-feed';
    const FEED_NAME = 'The BL:UF';
    const OLD_READ_ID = 'tag:the-bluf.example.com,2024:post-1';
    const OLD_UNREAD_ID = 'tag:the-bluf.example.com,2024:post-2';
    const RECENT_READ_ID = 'tag:the-bluf.example.com,2026:post-3';

    // Seed the feed: two long-since-arrived articles (one already read)
    // and a freshly arrived read one. The colon-heavy tag-URI uniqueIDs
    // mirror real newsletter feeds; the colon in the feed name is the
    // user's original red herring.
    await db.saveFeed({
      feedID,
      url: 'https://the-bluf.example.com/feed.xml',
      name: FEED_NAME,
      articles: [
        {
          articleID: 'art-old-read',
          uniqueID: OLD_READ_ID,
          title: 'Issue 1',
          read: true,
          starred: false,
          dateArrived: daysAgo(40),
          datePublished: daysAgo(40),
        },
        {
          articleID: 'art-old-unread',
          uniqueID: OLD_UNREAD_ID,
          title: 'Issue 2',
          read: false,
          starred: false,
          dateArrived: daysAgo(40),
          datePublished: daysAgo(39),
        },
        {
          articleID: 'art-recent-read',
          uniqueID: RECENT_READ_ID,
          title: 'Issue 3',
          read: true,
          starred: false,
          dateArrived: daysAgo(5),
          datePublished: daysAgo(5),
        },
      ],
    });

    // Refresh-day 1: purgeOldReadArticles runs as part of refreshFeed.
    await db.purgeOldReadArticles(feedID);

    // The old read article was purged...
    const afterPurge = await db.loadFeedForRefresh(feedID);
    const afterPurgeIDs = afterPurge.articles.map((a) => a.articleID);
    expect(afterPurgeIDs).not.toContain('art-old-read');
    // ...and its identity is remembered.
    const cleared = await db.listClearedUniqueIDs(feedID);
    expect(cleared).toContain(OLD_READ_ID);

    // Refresh-day 1 continued: the merge sees the same three items from
    // the feed source (newsletters keep their whole history in the XML).
    const sourceItems = [
      parsedItem(OLD_READ_ID, 'Issue 1', daysAgo(40)),
      parsedItem(OLD_UNREAD_ID, 'Issue 2', daysAgo(39)),
      parsedItem(RECENT_READ_ID, 'Issue 3', daysAgo(5)),
    ];
    const existingFeed = await db.loadFeedForRefresh(feedID);
    const clearedSet = new Set(await db.listClearedUniqueIDs(feedID));

    const newArticles = processNewArticles(sourceItems, existingFeed, clearedSet);
    const updatedArticles = updateExistingArticles(sourceItems, existingFeed);
    const merged = mergeArticles(updatedArticles, newArticles, 50);

    await db.saveArticles(feedID, merged);
    await db.deleteArticlesNotInSet(feedID, merged.map((a) => a.articleID));
    await db.purgeOldReadArticles(feedID);

    // The purged read article must NOT have come back as a new unread
    // article; the rest keep their flags.
    const reloaded = await db.loadFeed(feedID);
    expect(reloaded.name).toBe(FEED_NAME);
    const byID = new Map(reloaded.articles.map((a) => [a.articleID, a]));
    expect(byID.has('art-old-read')).toBe(false);
    expect(byID.get('art-recent-read')?.read).toBe(true);
    expect(byID.get('art-old-unread')?.read).toBe(false);

    // The remembered uniqueID must not appear as a fresh unread article
    // under a new articleID either.
    const uniqueIDs = reloaded.articles.map((a) => a.uniqueID);
    expect(uniqueIDs).not.toContain(OLD_READ_ID);
  });

  it('keeps the purge memory when the feed is later deleted', async () => {
    const db = await import('../../src/lib/database.js');

    const feedID = 'bluf-feed-shortlived';
    await db.saveFeed({
      feedID,
      url: 'https://the-bluf.example.com/feed.xml',
      name: 'The BL:UF (temp)',
      articles: [
        {
          articleID: 'art-gone',
          uniqueID: 'tag:the-bluf.example.com,2024:gone',
          title: 'Purged issue',
          read: true,
          starred: false,
          dateArrived: daysAgo(60),
          datePublished: daysAgo(60),
        },
      ],
    });
    await db.purgeOldReadArticles(feedID);
    expect(await db.listClearedUniqueIDs(feedID)).toContain('tag:the-bluf.example.com,2024:gone');

    // Deleting the feed wipes its purge memory with everything else.
    await db.deleteFeed(feedID);
    expect(await db.listClearedUniqueIDs(feedID)).toEqual([]);
  });
});
