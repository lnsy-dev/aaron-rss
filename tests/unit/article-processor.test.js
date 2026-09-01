/**
 * Article Processor Unit Tests
 *
 * Tests the article merge/update helpers in src/lib/article-processor.js.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeArticles,
  processNewArticles,
  updateExistingArticles,
  hashArticleContent,
  skipPersist,
} from '../../src/lib/article-processor.js';

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

  describe('refresh change detection (content hashing + skipPersist)', () => {
    const feedURL = 'https://example.com/feed';

    function makeParsedItem(uniqueID, overrides = {}) {
      return {
        uniqueID,
        title: `Article ${uniqueID}`,
        contentHTML: `<p>Body ${uniqueID}</p>`,
        contentText: `Body ${uniqueID}`,
        summary: `Summary ${uniqueID}`,
        url: `https://example.com/posts/${uniqueID}`,
        datePublished: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
      };
    }

    it('hashArticleContent is stable for identical content and differs on change', () => {
      const item = makeParsedItem('a');
      const same = makeParsedItem('a');
      const changed = makeParsedItem('a', { contentHTML: '<p>Edited</p>' });

      expect(hashArticleContent(item)).toBe(hashArticleContent(same));
      expect(hashArticleContent(item)).not.toBe(hashArticleContent(changed));
    });

    it('processNewArticles stamps fresh articles with a content hash', () => {
      const existingFeed = { url: feedURL, articles: [] };
      const [article] = processNewArticles([makeParsedItem('a')], existingFeed);

      expect(article.contentHash).toBe(hashArticleContent(makeParsedItem('a')));
      expect(article.skipPersist).toBeUndefined();
    });

    it('updateExistingArticles skips persisting articles whose content hash matches', () => {
      const parsedItem = makeParsedItem('a');
      const existingFeed = {
        url: feedURL,
        articles: [
          makeArticle('a', {
            contentHash: hashArticleContent(parsedItem),
            dateModified: new Date('2025-06-01T00:00:00.000Z'),
          }),
        ],
      };

      const [updated] = updateExistingArticles([parsedItem], existingFeed);

      expect(updated.skipPersist).toBe(true);
      // Content unchanged, so dateModified must not be bumped.
      expect(updated.dateModified).toEqual(new Date('2025-06-01T00:00:00.000Z'));
    });

    it('updateExistingArticles rewrites and re-hashes articles whose content changed', () => {
      const parsedItem = makeParsedItem('a', { contentHTML: '<p>New body</p>', contentText: 'New body' });
      const existingFeed = {
        url: feedURL,
        articles: [
          makeArticle('a', {
            contentHash: hashArticleContent(makeParsedItem('a')),
            read: true,
            dateModified: new Date('2025-06-01T00:00:00.000Z'),
          }),
        ],
      };

      const [updated] = updateExistingArticles([parsedItem], existingFeed);

      expect(updated.skipPersist).toBeUndefined();
      expect(updated.contentHTML).toBe('<p>New body</p>');
      expect(updated.contentHash).toBe(hashArticleContent(parsedItem));
      // Read state and identity survive the merge.
      expect(updated.read).toBe(true);
      expect(updated.articleID).toBe('id-a');
      expect(updated.dateModified?.getTime()).toBeGreaterThan(new Date('2025-06-01T00:00:00.000Z').getTime());
    });

    it('updateExistingArticles marks pass-through articles skipPersist so slim records never clobber content', () => {
      const existingFeed = {
        url: feedURL,
        // Refresh-slim record: identity fields + hash, NO content columns.
        articles: [
          makeArticle('gone', {
            contentHash: 'abc-123',
            starred: true,
          }),
        ],
      };

      const [updated] = updateExistingArticles([makeParsedItem('still-there')], existingFeed);

      expect(updated.uniqueID).toBe('gone');
      expect(updated.skipPersist).toBe(true);
      expect(updated.contentHTML).toBeUndefined();
    });

    it('legacy rows without a stored hash are rewritten once and do not bump dateModified when metadata is unchanged', () => {
      const parsedItem = makeParsedItem('a');
      const existingFeed = {
        url: feedURL,
        articles: [
          makeArticle('a', {
            title: parsedItem.title,
            summary: parsedItem.summary,
            dateModified: new Date('2025-06-01T00:00:00.000Z'),
            // No contentHash: pre-upgrade row.
          }),
        ],
      };

      const [updated] = updateExistingArticles([parsedItem], existingFeed);

      expect(updated.skipPersist).toBeUndefined();
      expect(updated.contentHash).toBe(hashArticleContent(parsedItem));
      expect(updated.dateModified).toEqual(new Date('2025-06-01T00:00:00.000Z'));
    });

    it('skipPersist flags a copy of the article without mutating the original', () => {
      const article = makeArticle('a', { contentHash: 'x' });
      const flagged = skipPersist(article);

      expect(flagged.skipPersist).toBe(true);
      expect(article.skipPersist).toBeUndefined();
    });
  });
});
