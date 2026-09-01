/**
 * Feed Finder Unit Tests
 *
 * Tests RSS/Atom feed discovery from HTML pages, including decoding of
 * HTML entities in feed titles.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('feed-finder', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importFeedFinder() {
    return await import('../../src/lib/feed-finder.js');
  }

  function mockFetchResponse(text, contentType = 'text/html') {
    return {
      ok: true,
      status: 200,
      headers: { 'content-type': contentType },
      text: async () => text,
    };
  }

  function mockNotFound() {
    return { ok: false, status: 404, text: async () => 'Not found' };
  }

  function mockJSONResponse(text, contentType = 'application/json') {
    return { ok: true, status: 200, headers: { 'content-type': contentType }, text: async () => text };
  }

  it('decodes HTML entities in discovered feed titles', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="alternate" type="application/rss+xml"
                title="Hackaday &raquo; Feed"
                href="/rss.xml">
        </head>
        <body></body>
      </html>
    `;
    const rss = `
      <?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Hackaday</title>
          <link>https://hackaday.com</link>
        </channel>
      </rss>
    `;

    fetch.mockImplementation(async (url) => {
      if (url === 'https://hackaday.com/') return mockFetchResponse(html);
      if (url === 'https://hackaday.com/rss.xml') {
        return mockFetchResponse(rss, 'application/rss+xml');
      }
      return mockNotFound();
    });

    const { findFeeds } = await importFeedFinder();
    const feeds = await findFeeds('https://hackaday.com/');

    expect(feeds).toHaveLength(1);
    expect(feeds[0].title).toBe('Hackaday » Feed');
    expect(feeds[0].url).toBe('https://hackaday.com/rss.xml');
  });

  it('decodes multiple named entities in the feed title', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="alternate" type="application/rss+xml"
                title="Tom &amp; Jerry &raquo; Feed"
                href="/rss.xml">
        </head>
      </html>
    `;
    const rss = `
      <?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Example</title>
          <link>https://example.com</link>
        </channel>
      </rss>
    `;

    fetch.mockImplementation(async (url) => {
      if (url === 'https://example.com/') return mockFetchResponse(html);
      if (url === 'https://example.com/rss.xml') {
        return mockFetchResponse(rss, 'application/rss+xml');
      }
      return mockNotFound();
    });

    const { findFeeds } = await importFeedFinder();
    const feeds = await findFeeds('https://example.com/');

    expect(feeds).toHaveLength(1);
    expect(feeds[0].title).toBe('Tom & Jerry » Feed');
  });

  it('discovers Bluesky profile RSS feeds', async () => {
    const profileHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Bluesky Profile</title></head>
        <body></body>
      </html>
    `;
    const rss = `
      <?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>@handle.bsky.social on Bluesky</title>
          <link>https://bsky.app/profile/handle.bsky.social</link>
        </channel>
      </rss>
    `;

    fetch.mockImplementation(async (url) => {
      if (url === 'https://bsky.app/profile/handle.bsky.social') {
        return mockFetchResponse(profileHtml);
      }
      if (url === 'https://bsky.app/profile/handle.bsky.social/rss') {
        return mockFetchResponse(rss, 'application/rss+xml');
      }
      return mockNotFound();
    });

    const { findFeeds } = await importFeedFinder();
    const feeds = await findFeeds('https://bsky.app/profile/handle.bsky.social');

    expect(feeds).toHaveLength(1);
    expect(feeds[0].url).toBe('https://bsky.app/profile/handle.bsky.social/rss');
    expect(feeds[0].title).toBe('@handle.bsky.social on Bluesky');
  });

  it('discovers Mastodon @handle Atom feeds', async () => {
    const profileHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Mastodon Profile</title></head>
        <body></body>
      </html>
    `;
    const atom = `
      <?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>@handle on mastodon.social</title>
        <link href="https://mastodon.social/@handle"/>
      </feed>
    `;

    fetch.mockImplementation(async (url) => {
      if (url === 'https://mastodon.social/@handle') {
        return mockFetchResponse(profileHtml);
      }
      if (url === 'https://mastodon.social/@handle.atom') {
        return mockFetchResponse(atom, 'application/atom+xml');
      }
      return mockNotFound();
    });

    const { findFeeds } = await importFeedFinder();
    const feeds = await findFeeds('https://mastodon.social/@handle');

    expect(feeds).toHaveLength(1);
    expect(feeds[0].url).toBe('https://mastodon.social/@handle.atom');
    expect(feeds[0].title).toBe('@handle on mastodon.social');
  });

  it('discovers Mastodon /users/handle Atom feeds', async () => {
    const profileHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Mastodon Profile</title></head>
        <body></body>
      </html>
    `;
    const atom = `
      <?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>@handle on mastodon.social</title>
        <link href="https://mastodon.social/@handle"/>
      </feed>
    `;

    fetch.mockImplementation(async (url) => {
      if (url === 'https://mastodon.social/users/handle') {
        return mockFetchResponse(profileHtml);
      }
      if (url === 'https://mastodon.social/@handle.atom') {
        return mockFetchResponse(atom, 'application/atom+xml');
      }
      return mockNotFound();
    });

    const { findFeeds } = await importFeedFinder();
    const feeds = await findFeeds('https://mastodon.social/users/handle');

    expect(feeds).toHaveLength(1);
    expect(feeds[0].url).toBe('https://mastodon.social/@handle.atom');
  });

  it('does not treat JSON error bodies as feeds, even when they mention version and items', async () => {
    const junk = JSON.stringify({
      version: 2,
      items: 'not an array',
      error: 'Not found',
    });

    fetch.mockImplementation(async () => mockJSONResponse(junk));

    const { findFeeds } = await importFeedFinder();
    const feeds = await findFeeds('https://example.com/');

    expect(feeds).toHaveLength(0);
  });

  it('does not treat HTML pages as JSON feeds', async () => {
    const junk = '{ "meta": { "version": 3 }, "data": { "items": [1, 2] } }';

    fetch.mockImplementation(async () => mockJSONResponse(junk));

    const { findFeeds } = await importFeedFinder();
    const feeds = await findFeeds('https://example.com/');

    expect(feeds).toHaveLength(0);
  });

  it('discovers JSON Feed documents served as JSON', async () => {
    const jsonFeed = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Example JSON Feed',
      home_page_url: 'https://example.com',
      items: [{ id: '1', title: 'First post', url: 'https://example.com/1' }],
    });

    fetch.mockImplementation(async (url) => {
      if (url === 'https://example.com/feed.json') {
        return mockJSONResponse(jsonFeed, 'application/feed+json');
      }
      return mockNotFound();
    });

    const { findFeeds } = await importFeedFinder();
    const feeds = await findFeeds('https://example.com/feed.json');

    expect(feeds).toHaveLength(1);
    expect(feeds[0].url).toBe('https://example.com/feed.json');
  });

  it('does not crash discovery when a feed content type carries a broken body', async () => {
    fetch.mockImplementation(async () => mockJSONResponse('{not json', 'application/feed+json'));

    const { findFeeds } = await importFeedFinder();
    const feeds = await findFeeds('https://example.com/');

    expect(Array.isArray(feeds)).toBe(true);
  });
});
