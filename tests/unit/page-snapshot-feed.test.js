/**
 * Page Snapshot Feed Unit Tests
 *
 * Tests link extraction, snapshot diffing, and feed-item conversion for
 * watched-page (no RSS) feeds.
 */

import { describe, it, expect } from 'vitest';

import {
  extractPageLinks,
  diffPageLinks,
  mergePageLinks,
  linkToFeedItem,
  buildSnapshotParsedFeed,
} from '../../src/lib/page-snapshot-feed.js';

const BASE = 'https://example.com/journal/';

function pageWithLinks(...hrefs) {
  const anchors = hrefs.map((href, i) => `<a href="${href}">Link ${i + 1}</a>`).join('\n');
  return `<!DOCTYPE html><html><head><title>Example Journal</title></head><body>${anchors}</body></html>`;
}

describe('extractPageLinks', () => {
  it('extracts and resolves relative links to absolute URLs', () => {
    const html = pageWithLinks('/posts/one.html', 'two.html', 'https://other.org/three');
    const links = extractPageLinks(html, BASE);

    expect(links.map((l) => l.url)).toEqual([
      'https://example.com/posts/one.html',
      'https://example.com/journal/two.html',
      'https://other.org/three',
    ]);
  });

  it('captures anchor text as the link label', () => {
    const html = '<a href="/posts/one.html">My <b>Fancy</b> Post</a>';
    const links = extractPageLinks(html, BASE);

    expect(links[0].text).toBe('My Fancy Post');
  });

  it('skips anchors, non-HTTP schemes, and the page itself', () => {
    const html = pageWithLinks(
      '#section',
      'mailto:someone@example.com',
      'javascript:void(0)',
      'tel:+1234567890',
      'data:text/plain,hi',
      '/journal/',
    );
    const links = extractPageLinks(html, BASE);

    expect(links).toHaveLength(0);
  });

  it('strips fragments and deduplicates by normalized URL', () => {
    const html = pageWithLinks(
      '/posts/one.html#top',
      '/posts/one.html',
      'https://example.com/journal',
    );
    const links = extractPageLinks(html, BASE);

    expect(links.map((l) => l.url)).toEqual(['https://example.com/posts/one.html']);
  });

  it('returns an empty list when there are no anchors', () => {
    expect(extractPageLinks('<p>No links here</p>', BASE)).toEqual([]);
  });
});

describe('diffPageLinks', () => {
  it('reports only links missing from the previous snapshot', () => {
    const previous = [
      'https://example.com/posts/old.html',
      'https://example.com/posts/newer.html',
    ];
    const current = extractPageLinks(
      pageWithLinks('/posts/old.html', '/posts/newer.html', '/posts/brand-new.html'),
      BASE,
    );

    const newLinks = diffPageLinks(previous, current);
    expect(newLinks.map((l) => l.url)).toEqual(['https://example.com/posts/brand-new.html']);
  });

  it('returns nothing new when the page is unchanged', () => {
    const current = extractPageLinks(pageWithLinks('/posts/old.html'), BASE);
    const previous = current.map((l) => l.url);

    expect(diffPageLinks(previous, current)).toEqual([]);
  });

  it('treats an empty previous snapshot as all-new', () => {
    const current = extractPageLinks(pageWithLinks('/posts/a.html', '/posts/b.html'), BASE);

    expect(diffPageLinks([], current)).toHaveLength(2);
  });
});

describe('mergePageLinks', () => {
  it('keeps previous links first and appends newly seen ones', () => {
    const current = extractPageLinks(pageWithLinks('/c.html', '/a.html'), BASE);
    const merged = mergePageLinks(['https://example.com/a.html'], current);

    expect(merged).toEqual([
      'https://example.com/a.html',
      'https://example.com/c.html',
    ]);
  });

  it('caps the merged list to avoid unbounded growth', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/p/${i}`,
      text: '',
    }));

    expect(mergePageLinks([], many, 5)).toHaveLength(5);
  });
});

describe('linkToFeedItem', () => {
  it('prefers anchor text for the title and builds a stable uniqueID', () => {
    const item = linkToFeedItem({ url: 'https://example.com/posts/my-post', text: 'My Post' });

    expect(item.title).toBe('My Post');
    expect(item.uniqueID).toBe(linkToFeedItem({ url: 'https://example.com/posts/my-post', text: 'My Post' }).uniqueID);
    expect(item.url).toBe('https://example.com/posts/my-post');
    expect(item.externalURL).toBe(item.url);
    expect(item.summary).toBe('My Post');
  });

  it('falls back to a prettified URL slug when there is no anchor text', () => {
    const item = linkToFeedItem({ url: 'https://example.com/posts/my_cool-post.html', text: '' });

    expect(item.title).toBe('My cool post');
  });

  it('falls back to the hostname when the path is empty', () => {
    const item = linkToFeedItem({ url: 'https://example.com/', text: '' });

    expect(item.title).toBe('example.com');
  });
});

describe('buildSnapshotParsedFeed', () => {
  it('produces items only for newly seen links plus an updated snapshot', () => {
    const previous = ['https://example.com/posts/old.html'];
    const { parsedFeed, snapshotLinks } = buildSnapshotParsedFeed(
      pageWithLinks('/posts/old.html', '/posts/fresh.html'),
      BASE,
      previous,
    );

    expect(parsedFeed).not.toBeNull();
    expect(parsedFeed.items).toHaveLength(1);
    expect(parsedFeed.items[0].url).toBe('https://example.com/posts/fresh.html');
    expect(parsedFeed.title).toBe('Example Journal (Watched Page)');
    expect(parsedFeed.homePageURL).toBe(BASE);
    // The refreshed snapshot contains both old and new links.
    expect(snapshotLinks.sort()).toEqual([
      'https://example.com/posts/fresh.html',
      'https://example.com/posts/old.html',
    ]);
  });

  it('returns a null parsedFeed (but still grows the snapshot) when nothing changed', () => {
    const initial = buildSnapshotParsedFeed(pageWithLinks('/a.html'), BASE, []);
    const again = buildSnapshotParsedFeed(pageWithLinks('/a.html'), BASE, initial.snapshotLinks);

    expect(initial.parsedFeed).not.toBeNull();
    expect(initial.snapshotLinks).toEqual(['https://example.com/a.html']);
    expect(again.parsedFeed).toBeNull();
    expect(again.snapshotLinks).toEqual(['https://example.com/a.html']);
  });

  it('uses the hostname in the title when the page has no <title>', () => {
    const html = '<html><body><a href="/x">X</a></body></html>';
    const { parsedFeed } = buildSnapshotParsedFeed(html, BASE, []);

    expect(parsedFeed.title).toBe('example.com (Watched Page)');
  });
});
