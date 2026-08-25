/**
 * OPML Library Unit Tests
 *
 * Tests for src/lib/opml.js — parsing and generating OPML subscription
 * lists without a browser DOM.
 */

import { describe, it, expect } from 'vitest';
import { exportOPML, parseOPML } from '../../src/lib/opml.js';

describe('opml', () => {
  describe('exportOPML', () => {
    it('generates a valid OPML document for feeds', () => {
      const feeds = [
        {
          name: 'Example Feed',
          url: 'https://example.com/rss.xml',
          homePageURL: 'https://example.com',
        },
        {
          name: 'Untitled',
          url: 'https://another.example/atom.xml',
        },
      ];

      const opml = exportOPML(feeds, 'My Subscriptions');

      expect(opml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(opml).toContain('<opml version="2.0">');
      expect(opml).toContain('<title>My Subscriptions</title>');
      expect(opml).toContain('<outline type="rss"');
      expect(opml).toContain('text="Example Feed"');
      expect(opml).toContain('title="Example Feed"');
      expect(opml).toContain('xmlUrl="https://example.com/rss.xml"');
      expect(opml).toContain('htmlUrl="https://example.com"');
      expect(opml).toContain('xmlUrl="https://another.example/atom.xml"');
    });

    it('escapes special XML characters in feed names and URLs', () => {
      const feeds = [
        {
          name: 'Tom & Jerry "News"',
          url: 'https://example.com/?a=1&b=2',
          homePageURL: 'https://example.com/?x=<tag>',
        },
      ];

      const opml = exportOPML(feeds);

      expect(opml).toContain('text="Tom &amp; Jerry &quot;News&quot;"');
      expect(opml).toContain('xmlUrl="https://example.com/?a=1&amp;b=2"');
      expect(opml).toContain('htmlUrl="https://example.com/?x=&lt;tag&gt;"');
    });

    it('skips feeds without a URL', () => {
      const feeds = [
        { name: 'Valid Feed', url: 'https://example.com/rss.xml' },
        { name: 'Missing URL' },
      ];

      const opml = exportOPML(feeds);
      const matches = opml.match(/<outline/g);
      expect(matches).toHaveLength(1);
      expect(opml).toContain('Valid Feed');
      expect(opml).not.toContain('Missing URL');
    });

    it('uses a default title when none is provided', () => {
      const opml = exportOPML([]);
      expect(opml).toContain('<title>Subscriptions</title>');
    });
  });

  describe('parseOPML', () => {
    it('extracts RSS subscription outlines', () => {
      const opml = `<?xml version="1.0"?>
        <opml version="2.0">
          <head><title>Subscriptions</title></head>
          <body>
            <outline type="rss" text="Example Feed" title="Example Feed"
                     xmlUrl="https://example.com/rss.xml"
                     htmlUrl="https://example.com"/>
            <outline type="rss" text="Another Feed"
                     xmlUrl="https://another.example/feed"/>
          </body>
        </opml>`;

      const subscriptions = parseOPML(opml);

      expect(subscriptions).toHaveLength(2);
      expect(subscriptions[0]).toEqual({
        name: 'Example Feed',
        url: 'https://example.com/rss.xml',
        homePageURL: 'https://example.com',
      });
      expect(subscriptions[1]).toEqual({
        name: 'Another Feed',
        url: 'https://another.example/feed',
        homePageURL: undefined,
      });
    });

    it('decodes HTML entities in attributes', () => {
      const opml = `<?xml version="1.0"?>
        <opml version="2.0">
          <body>
            <outline type="rss" text="Tom &amp; Jerry &raquo; Feed"
                     xmlUrl="https://example.com/rss.xml?a=1&amp;b=2"
                     htmlUrl="https://example.com/?x=&lt;tag&gt;"/>
          </body>
        </opml>`;

      const [sub] = parseOPML(opml);

      expect(sub.name).toBe('Tom & Jerry » Feed');
      expect(sub.url).toBe('https://example.com/rss.xml?a=1&b=2');
      expect(sub.homePageURL).toBe('https://example.com/?x=<tag>');
    });

    it('handles mixed-case attribute names', () => {
      const opml = `<?xml version="1.0"?>
        <opml version="2.0">
          <body>
            <outline type="rss" TEXT="Named Feed" XMLURL="https://example.com/rss.xml"/>
          </body>
        </opml>`;

      const [sub] = parseOPML(opml);

      expect(sub.name).toBe('Named Feed');
      expect(sub.url).toBe('https://example.com/rss.xml');
    });

    it('falls back to title, name, or URL when text is absent', () => {
      const opml = `<?xml version="1.0"?>
        <opml version="2.0">
          <body>
            <outline type="rss" title="Title Feed" xmlUrl="https://example.com/1"/>
            <outline type="rss" name="Name Feed" xmlUrl="https://example.com/2"/>
            <outline type="rss" xmlUrl="https://example.com/3"/>
          </body>
        </opml>`;

      const subscriptions = parseOPML(opml);

      expect(subscriptions[0].name).toBe('Title Feed');
      expect(subscriptions[1].name).toBe('Name Feed');
      expect(subscriptions[2].name).toBe('https://example.com/3');
    });

    it('returns an empty array for empty or non-OPML text', () => {
      expect(parseOPML('')).toEqual([]);
      expect(parseOPML('<html><body>not opml</body></html>')).toEqual([]);
    });

    it('round-trips through export and parse', () => {
      const feeds = [
        { name: 'Feed A', url: 'https://a.example/rss.xml', homePageURL: 'https://a.example' },
        { name: 'Feed B', url: 'https://b.example/rss.xml' },
      ];

      const subscriptions = parseOPML(exportOPML(feeds, 'Round Trip'));

      expect(subscriptions).toHaveLength(2);
      expect(subscriptions[0].name).toBe('Feed A');
      expect(subscriptions[0].url).toBe('https://a.example/rss.xml');
      expect(subscriptions[0].homePageURL).toBe('https://a.example');
      expect(subscriptions[1].name).toBe('Feed B');
      expect(subscriptions[1].url).toBe('https://b.example/rss.xml');
    });
  });
});
