/**
 * Article Processor Unit Tests
 *
 * Tests the article merge/update helpers in src/lib/article-processor.js.
 */

import { describe, it, expect } from 'vitest';
import { mergeArticles } from '../../src/lib/article-processor.js';

function makeArticle(uniqueID, overrides = {}) {
  return {
    articleID: `id-${uniqueID}`,
    uniqueID,
    title: `Article ${uniqueID}`,
    datePublished: new Date('2026-01-01T00:00:00.000Z'),
    dateArrived: new Date('2026-01-01T00:00:00.000Z'),
    read: false,
    starred: false,
    ...overrides,
  };
}

describe('article processor', () => {
  it('mergeArticles preserves all starred articles', () => {
    const existing = [
      makeArticle('old', { starred: true, datePublished: new Date('2025-01-01T00:00:00.000Z') }),
    ];
    const fresh = [
      makeArticle('new-1', { datePublished: new Date('2026-01-02T00:00:00.000Z') }),
      makeArticle('new-2', { datePublished: new Date('2026-01-03T00:00:00.000Z') }),
      makeArticle('new-3', { datePublished: new Date('2026-01-04T00:00:00.000Z') }),
    ];

    const merged = mergeArticles(existing, fresh, 2);
    const ids = merged.map((a) => a.uniqueID);

    expect(ids).toContain('old');
    expect(merged.length).toBeLessThanOrEqual(2);
  });

  it('mergeArticles caps unstarred articles to maxArticles', () => {
    const existing = [
      makeArticle('e1', { datePublished: new Date('2026-01-01T00:00:00.000Z') }),
    ];
    const fresh = Array.from({ length: 10 }, (_, i) =>
      makeArticle(`f${i}`, { datePublished: new Date(`2026-01-${10 + i}T00:00:00.000Z`) })
    );

    const merged = mergeArticles(existing, fresh, 5);
    expect(merged.length).toBe(5);
  });

  it('mergeArticles dedupes by uniqueID and prefers the newer parsed item', () => {
    const existing = [makeArticle('dup', { title: 'Existing' })];
    const fresh = [makeArticle('dup', { title: 'Fresh' })];

    const merged = mergeArticles(existing, fresh, 10);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Fresh');
  });

  it('mergeArticles sorts unstarred articles by date newest first', () => {
    const existing = [
      makeArticle('a', { datePublished: new Date('2026-01-01T00:00:00.000Z') }),
    ];
    const fresh = [
      makeArticle('b', { datePublished: new Date('2026-01-03T00:00:00.000Z') }),
      makeArticle('c', { datePublished: new Date('2026-01-02T00:00:00.000Z') }),
    ];

    const merged = mergeArticles(existing, fresh, 10);
    expect(merged.map((a) => a.uniqueID)).toEqual(['b', 'c', 'a']);
  });
});
