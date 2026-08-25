/**
 * YAML Front Matter Unit Tests
 *
 * Tests for src/lib/yaml-front-matter.js.
 */

import { describe, it, expect } from 'vitest';
import { generateFrontMatter } from '../../src/lib/yaml-front-matter.js';

describe('yaml-front-matter', () => {
  it('includes extensive metadata keys', () => {
    const article = {
      articleID: 'abc123',
      title: 'Test Article',
      url: 'https://example.com/post',
      datePublished: new Date('2024-06-15T10:00:00Z'),
      authors: [{ name: 'Jane Doe' }],
      tags: ['rss', 'test'],
      starred: true,
      imageURL: 'https://example.com/image.png',
    };

    const feed = {
      feedID: 'feed456',
      name: 'Example Feed',
      url: 'https://example.com/feed.xml',
    };

    const extracted = {
      title: 'Extracted Title',
      url: 'https://example.com/post',
      domain: 'example.com',
      site: 'Example Site',
      description: 'Extracted description',
      language: 'en',
      wordCount: 123,
      image: 'https://example.com/extracted.png',
      favicon: 'https://example.com/favicon.ico',
    };

    const frontMatter = generateFrontMatter(article, feed, extracted);

    expect(frontMatter.startsWith('---')).toBe(true);
    expect(frontMatter.endsWith('---')).toBe(true);
    expect(frontMatter).toContain('title: "Extracted Title"');
    expect(frontMatter).toContain('url: "https://example.com/post"');
    expect(frontMatter).toContain('source: "Example Feed"');
    expect(frontMatter).toContain('feed_url: "https://example.com/feed.xml"');
    expect(frontMatter).toContain('feed_id: "feed456"');
    expect(frontMatter).toContain('article_id: "abc123"');
    expect(frontMatter).toContain('published: "2024-06-15T10:00:00.000Z"');
    expect(frontMatter).toContain('domain: "example.com"');
    expect(frontMatter).toContain('site: "Example Site"');
    expect(frontMatter).toContain('language: "en"');
    expect(frontMatter).toContain('word_count: 123');
    expect(frontMatter).toContain('starred: true');
    expect(frontMatter).toContain('- "rss"');
    expect(frontMatter).toContain('- "test"');
    expect(frontMatter).toContain('image: "https://example.com/image.png"');
    expect(frontMatter).toContain('favicon: "https://example.com/favicon.ico"');
  });

  it('falls back to article metadata when extracted metadata is missing', () => {
    const article = {
      articleID: 'id',
      title: 'Fallback Title',
      url: 'https://example.com/fallback',
      summary: 'Fallback summary',
    };

    const feed = {
      feedID: 'feed',
      name: 'Feed',
      url: 'https://example.com/feed',
    };

    const extracted = {};

    const frontMatter = generateFrontMatter(article, feed, extracted);

    expect(frontMatter).toContain('title: "Fallback Title"');
    expect(frontMatter).toContain('description: "Fallback summary"');
    expect(frontMatter).toContain('image: ""');
    expect(frontMatter).toContain('word_count: 0');
  });
});
