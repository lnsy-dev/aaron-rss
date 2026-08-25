/**
 * HTML-to-RSS Bridge Unit Tests
 *
 * Tests synthetic feed generation from HTML pages, including decoding of
 * HTML entities in the site title and article titles.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('html-to-rss', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importHtmlToRss() {
    return await import('../../src/lib/html-to-rss.js');
  }

  function mockFetchResponse(text, contentType = 'text/html') {
    return {
      ok: true,
      status: 200,
      headers: { 'content-type': contentType },
      text: async () => text,
    };
  }

  it('decodes HTML entities in the generated feed title', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Hackaday &raquo; Feed</title></head>
        <body>
          <article>
            <h2>First Post</h2>
            <a href="/post-1">Read more</a>
            <p>Summary text here.</p>
          </article>
        </body>
      </html>
    `;

    fetch.mockResolvedValueOnce(mockFetchResponse(html));

    const { generateRSSFromHTML } = await importHtmlToRss();
    const feed = await generateRSSFromHTML('https://example.com/');

    expect(feed.title).toBe('Hackaday » Feed (Generated Feed)');
  });

  it('decodes HTML entities in article titles', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Example</title></head>
        <body>
          <article>
            <h2>Tom &amp; Jerry &raquo; Part 1</h2>
            <a href="/post-1">Read more</a>
            <p>Description text.</p>
          </article>
        </body>
      </html>
    `;

    fetch.mockResolvedValueOnce(mockFetchResponse(html));

    const { generateRSSFromHTML } = await importHtmlToRss();
    const feed = await generateRSSFromHTML('https://example.com/');

    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe('Tom & Jerry » Part 1');
  });
});
