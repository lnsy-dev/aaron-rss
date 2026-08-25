/**
 * Feed Sorting Unit Tests
 *
 * Tests the pure sorting helpers in src/lib/feed-sorting.js.
 */

import { describe, it, expect } from 'vitest';
import { sortFeedsByUnreadCount, buildTimelineItems } from '../../src/lib/feed-sorting.js';

describe('sortFeedsByUnreadCount', () => {
  it('sorts by unread count descending, then by name', () => {
    const feeds = [
      { feedID: 'a', name: 'Alpha Feed', articles: [{ read: false }, { read: true }] },
      { feedID: 'b', name: 'Beta Feed', articles: [{ read: false }, { read: false }, { read: true }] },
      { feedID: 'c', name: 'Charlie Feed', articles: [{ read: true }] },
    ];

    const sorted = sortFeedsByUnreadCount(feeds);

    expect(sorted.map((f) => f.name)).toEqual(['Beta Feed', 'Alpha Feed', 'Charlie Feed']);
  });

  it('falls back to name when unread counts tie', () => {
    const feeds = [
      { feedID: 'b', name: 'Beta Feed', articles: [{ read: false }] },
      { feedID: 'a', name: 'Alpha Feed', articles: [{ read: false }] },
    ];

    const sorted = sortFeedsByUnreadCount(feeds);

    expect(sorted.map((f) => f.name)).toEqual(['Alpha Feed', 'Beta Feed']);
  });

  it('does not mutate the original array', () => {
    const feeds = [
      { feedID: 'a', name: 'Alpha Feed', articles: [] },
      { feedID: 'b', name: 'Beta Feed', articles: [{ read: false }] },
    ];
    const originalOrder = feeds.map((f) => f.feedID);

    sortFeedsByUnreadCount(feeds);

    expect(feeds.map((f) => f.feedID)).toEqual(originalOrder);
  });
});

describe('buildTimelineItems', () => {
  const feedA = { feedID: 'a', name: 'Alpha Feed', articles: [] };
  const feedB = { feedID: 'b', name: 'Beta Feed', articles: [] };

  it('interleaves articles from all feeds ordered by publication date, newest first', () => {
    const feeds = [
      {
        ...feedA,
        articles: [
          { articleID: 'a1', read: false, datePublished: new Date('2024-01-01T00:00:00Z') },
          { articleID: 'a3', read: false, datePublished: new Date('2024-03-01T00:00:00Z') },
        ],
      },
      {
        ...feedB,
        articles: [
          { articleID: 'b2', read: false, datePublished: new Date('2024-02-01T00:00:00Z') },
        ],
      },
    ];

    const items = buildTimelineItems(feeds);

    expect(items.map((i) => i.article.articleID)).toEqual(['a3', 'b2', 'a1']);
    expect(items[0].feed.feedID).toBe('a');
    expect(items[1].feed.feedID).toBe('b');
  });

  it('excludes read articles', () => {
    const feeds = [
      {
        ...feedA,
        articles: [
          { articleID: 'read-1', read: true, datePublished: new Date('2024-05-01T00:00:00Z') },
          { articleID: 'unread-1', read: false, datePublished: new Date('2024-01-01T00:00:00Z') },
        ],
      },
    ];

    const items = buildTimelineItems(feeds);

    expect(items.map((i) => i.article.articleID)).toEqual(['unread-1']);
  });

  it('falls back to dateArrived when datePublished is missing', () => {
    const feeds = [
      {
        ...feedA,
        articles: [
          { articleID: 'no-date', read: false, dateArrived: new Date('2024-02-01T00:00:00Z') },
          { articleID: 'published', read: false, datePublished: new Date('2024-01-01T00:00:00Z') },
        ],
      },
    ];

    const items = buildTimelineItems(feeds);

    expect(items.map((i) => i.article.articleID)).toEqual(['no-date', 'published']);
  });

  it('sorts articles without any dates last', () => {
    const feeds = [
      {
        ...feedA,
        articles: [
          { articleID: 'undated', read: false },
          { articleID: 'dated', read: false, datePublished: new Date('2024-01-01T00:00:00Z') },
        ],
      },
    ];

    const items = buildTimelineItems(feeds);

    expect(items.map((i) => i.article.articleID)).toEqual(['dated', 'undated']);
  });

  it('caps each feed at maxPerFeed contributions', () => {
    const feeds = [
      {
        ...feedA,
        articles: [
          { articleID: 'a-first', read: false, datePublished: new Date('2024-01-01T00:00:00Z') },
          { articleID: 'a-second', read: false, datePublished: new Date('2024-03-01T00:00:00Z') },
        ],
      },
      {
        ...feedB,
        articles: [
          { articleID: 'b-only', read: false, datePublished: new Date('2024-02-01T00:00:00Z') },
        ],
      },
    ];

    const items = buildTimelineItems(feeds, 1);

    // Each feed keeps its first unread article; the merged list is still
    // ordered by publication date.
    expect(items.map((i) => i.article.articleID)).toEqual(['b-only', 'a-first']);
  });

  it('accepts ISO date strings as well as Date objects', () => {
    const feeds = [
      {
        ...feedA,
        articles: [
          { articleID: 'string-date', read: false, datePublished: '2024-04-01T00:00:00Z' },
          { articleID: 'date-object', read: false, datePublished: new Date('2024-03-01T00:00:00Z') },
        ],
      },
    ];

    const items = buildTimelineItems(feeds);

    expect(items.map((i) => i.article.articleID)).toEqual(['string-date', 'date-object']);
  });

  it('does not mutate the input feeds', () => {
    const feeds = [
      {
        ...feedA,
        articles: [{ articleID: 'a2', read: false, datePublished: new Date('2024-02-01T00:00:00Z') }],
      },
    ];

    buildTimelineItems(feeds);

    expect(feeds[0].articles).toHaveLength(1);
  });
});
