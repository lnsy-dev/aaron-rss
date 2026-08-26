/**
 * RSS Parser Unit Tests
 *
 * Tests that RSS/Atom/JSON feed parsing decodes HTML entities in feed
 * titles, descriptions, article titles, content, summaries, authors, and
 * tags.
 */

import { describe, it, expect } from 'vitest';
import { parseFeedText } from '../../src/lib/rss-parser.js';

describe('rss-parser', () => {
  it('decodes HTML entities in RSS feed title and description', async () => {
    const rss = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Hackaday &raquo; Feed</title>
          <link>https://hackaday.com</link>
          <description>Posts from &amp; about Hackaday</description>
          <managingEditor>Al &amp; Jane</managingEditor>
        </channel>
      </rss>`;

    const feed = await parseFeedText(rss, 'https://hackaday.com/rss.xml');

    expect(feed.title).toBe('Hackaday » Feed');
    expect(feed.feedDescription).toBe('Posts from & about Hackaday');
    expect(feed.authors).toEqual([{ name: 'Al & Jane' }]);
  });

  it('decodes HTML entities in RSS article title, content, and summary', async () => {
    const rss = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Example</title>
          <link>https://example.com</link>
          <item>
            <title>Tom &amp; Jerry &raquo; Part 1</title>
            <link>https://example.com/post-1</link>
            <description>Description with &lt;tag&gt; and &quot;quotes&quot;</description>
            <author>Bob &amp; Alice</author>
            <category>News &amp; Updates</category>
            <category>Tech</category>
            <pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;

    const feed = await parseFeedText(rss, 'https://example.com/rss.xml');

    expect(feed.items).toHaveLength(1);
    const [item] = feed.items;
    expect(item.title).toBe('Tom & Jerry » Part 1');
    expect(item.contentText).toBe('Description with  and "quotes"');
    expect(item.summary).toBe('Description with  and "quotes"');
    expect(item.authors).toEqual([{ name: 'Bob & Alice' }]);
    expect(item.tags).toEqual(['News & Updates', 'Tech']);
  });

  it('decodes HTML entities in Atom feeds', async () => {
    const atom = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom &raquo; Feed</title>
        <link href="https://example.com"/>
        <entry>
          <title>Entry &amp; More</title>
          <content type="html">&lt;p&gt;Hello &amp; welcome&lt;/p&gt;</content>
          <author><name>Jane &amp; John</name></author>
          <category term="Science &amp; Tech"/>
        </entry>
      </feed>`;

    const feed = await parseFeedText(atom, 'https://example.com/atom.xml');

    expect(feed.title).toBe('Atom » Feed');
    expect(feed.items).toHaveLength(1);
    const [item] = feed.items;
    expect(item.title).toBe('Entry & More');
    expect(item.contentText).toBe('Hello & welcome');
    expect(item.authors).toEqual([{ name: 'Jane & John' }]);
    expect(item.tags).toEqual(['Science & Tech']);
  });

  it('decodes numeric HTML entities', async () => {
    const rss = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>&#187; Feed</title>
          <link>https://example.com</link>
          <item>
            <title>&#60;tag&#62; &#34;quoted&#34;</title>
            <link>https://example.com/post</link>
            <description>Price: &#36;100</description>
          </item>
        </channel>
      </rss>`;

    const feed = await parseFeedText(rss, 'https://example.com/rss.xml');

    expect(feed.title).toBe('» Feed');
    expect(feed.items[0].title).toBe('<tag> "quoted"');
    expect(feed.items[0].summary).toBe('Price: $100');
    expect(feed.items[0].contentText).toBe('Price: $100');
  });

  it('falls back to id/guid when an Atom entry has no link', async () => {
    const atom = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Jacobin</title>
        <link href="https://jacobin.com"/>
        <entry>
          <id>https://jacobin.com/2026/08/example-article</id>
          <title>Example Article</title>
          <updated>2026-08-16T12:00:00Z</updated>
          <content type="html">&lt;p&gt;Article body.&lt;/p&gt;</content>
        </entry>
      </feed>`;

    const feed = await parseFeedText(atom, 'https://jacobin.com/feed');

    expect(feed.items).toHaveLength(1);
    const [item] = feed.items;
    expect(item.url).toBe('https://jacobin.com/2026/08/example-article');
    expect(item.externalURL).toBe('https://jacobin.com/2026/08/example-article');
    expect(item.uniqueID).toBe('https://jacobin.com/2026/08/example-article');
  });

  it('parses a JSON Feed 1.1 document', async () => {
    const json = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'JSON Feed &amp; Demo',
      home_page_url: 'https://example.com',
      feed_url: 'https://example.com/feed.json',
      description: 'A <em>demo</em> feed',
      icon: 'https://example.com/icon.png',
      favicon: 'https://example.com/favicon.png',
      authors: [{ name: 'Alice &amp; Bob' }],
      items: [
        {
          id: 'post-1',
          title: 'Hello &amp; Welcome',
          url: 'https://example.com/post-1',
          external_url: 'https://external.example.com/post-1',
          content_html: '<p>Body &amp; more</p>',
          summary: 'Summary text',
          image: 'https://example.com/image.png',
          date_published: '2026-01-01T00:00:00Z',
          date_modified: '2026-01-02T00:00:00Z',
          authors: [{ name: 'Carol' }],
          tags: ['news', 'tech'],
        },
      ],
    });

    const feed = await parseFeedText(json, 'https://example.com/feed.json');

    expect(feed.type).toBe('jsonFeed');
    expect(feed.title).toBe('JSON Feed & Demo');
    expect(feed.homePageURL).toBe('https://example.com');
    expect(feed.feedURL).toBe('https://example.com/feed.json');
    expect(feed.feedDescription).toBe('A demo feed');
    expect(feed.iconURL).toBe('https://example.com/icon.png');
    expect(feed.faviconURL).toBe('https://example.com/favicon.png');
    expect(feed.authors).toEqual([{ name: 'Alice & Bob' }]);

    expect(feed.items).toHaveLength(1);
    const [item] = feed.items;
    expect(item.uniqueID).toBe('post-1');
    expect(item.title).toBe('Hello & Welcome');
    expect(item.url).toBe('https://example.com/post-1');
    expect(item.externalURL).toBe('https://external.example.com/post-1');
    expect(item.contentHTML).toBe('<p>Body &amp; more</p>');
    expect(item.contentText).toBe('Body & more');
    expect(item.summary).toBe('Summary text');
    expect(item.imageURL).toBe('https://example.com/image.png');
    expect(item.datePublished).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(item.dateModified).toEqual(new Date('2026-01-02T00:00:00Z'));
    expect(item.authors).toEqual([{ name: 'Carol' }]);
    expect(item.tags).toEqual(['news', 'tech']);
  });

  it('parses a JSON Feed 1.0 document with a string author', async () => {
    const json = JSON.stringify({
      version: 'https://jsonfeed.org/version/1',
      title: 'Legacy Feed',
      author: 'Legacy Author',
      items: [
        {
          id: 'legacy-1',
          content_text: 'Plain text content',
        },
      ],
    });

    const feed = await parseFeedText(json, 'https://example.com/legacy.json');

    expect(feed.title).toBe('Legacy Feed');
    expect(feed.authors).toEqual([{ name: 'Legacy Author' }]);
    expect(feed.items[0].authors).toEqual([{ name: 'Legacy Author' }]);
    expect(feed.items[0].contentText).toBe('Plain text content');
  });

  it('falls back to content text when a JSON Feed item has no title', async () => {
    const json = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Untitled Items',
      items: [
        {
          id: 'no-title',
          content_text: 'This is the content that becomes the title when truncated.',
        },
      ],
    });

    const feed = await parseFeedText(json, 'https://example.com/untitled.json');

    expect(feed.items[0].title).toBe('This is the content that becomes the title when truncated.');
  });

  it('returns null for invalid JSON feed content', async () => {
    const feed = await parseFeedText('not json', 'https://example.com/feed.json');
    expect(feed).toBeNull();
  });

  it('returns null for JSON without an items array', async () => {
    const feed = await parseFeedText('{"version":"1.1","title":"No Items"}', 'https://example.com/feed.json');
    expect(feed).toBeNull();
  });
});
