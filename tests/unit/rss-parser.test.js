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
});
