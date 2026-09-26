/**
 * Bluesky Link Card Headline E2E Tests
 *
 * The bug report: in Bluesky views an embedded article shows only its
 * splash image, never a clickable headline
 * (https://bsky.app/profile/bencollins.bsky.social/post/3mwgp3xhemk25).
 *
 * That post embeds an `app.bsky.embed.external` card: thumbnail, article
 * headline, description, and link. The headline was always rendered into
 * the DOM — the stylesheet let the thumbnail eat the whole card width,
 * clipping the text body to zero width. These tests pin the visible
 * outcome in both surfaces that render link cards: the social viewer and
 * the enriched feed timeline.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Ben Collins</title>',
  '<link>https://bsky.app/profile/bencollins.bsky.social</link>',
  '<description>test</description>',
  '<item><title>Kids all right.</title>',
  '<link>https://bsky.app/profile/bencollins.bsky.social/post/3mwgp3xhemk25</link>',
  '<guid>bsky-headline-1</guid>',
  '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
  '<description><![CDATA[Kids all right. [contains quote post or other embedded content]]]></description>',
  '</item>',
  '</channel></rss>',
].join('');

// Bluesky profile RSS lives on bsky.app itself; enrichment (and the
// social viewer) only kick in for that host, so the feed is stubbed
// there too.

const THREAD_JSON = {
  thread: {
    post: {
      uri: 'at://did:plc:alice/app.bsky.feed.post/3mwgp3xhemk25',
      author: { handle: 'bencollins.bsky.social', displayName: 'Ben Collins' },
      indexedAt: '2026-09-26T16:24:21.375Z',
      record: { text: 'Kids all right.' },
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://www.theguardian.com/society/2026/sep/24/example',
          title: '‘That’s so AI!’ What gen Alpha’s biggest insult tells us',
          description: 'The year’s most popular slang reveals what young people think about artificial intelligence',
          thumb: 'https://cdn.example.com/external-thumb.jpg',
        },
      },
    },
    replies: [],
  },
};

// The Bluesky public API gets one stub per endpoint: handle resolution
// answers with a DID, the thread fetch backs the social viewer, and the
// batched getPosts call backs the feed-timeline enrichment.
async function stubBlueskyAPI(page) {
  await page.route('https://bsky.app/profile/bencollins.bsky.social/rss', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/rss+xml',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: FEED_XML,
    });
  });
  await page.route('https://public.api.bsky.app/**', async (route) => {
    const url = route.request().url();
    let body = THREAD_JSON;
    if (url.includes('resolveHandle')) {
      body = { did: 'did:plc:alice' };
    } else if (url.includes('getPosts')) {
      body = { posts: [THREAD_JSON.thread.post] };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('Bluesky link card headline', () => {
  test.use({ bypassCSP: true });

  test('social viewer shows a visible clickable headline next to the thumbnail', async ({ page }) => {
    await stubBlueskyAPI(page);

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.addFeedInBackground('https://bsky.app/profile/bencollins.bsky.social/rss'));
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), { timeout: 15000 })
      .toBe(1);

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const card = viewer.locator('.rss-social-link-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });

    // The headline renders (with its typographic quotes) and the card is
    // clickable.
    const title = card.locator('.rss-social-link-card-title');
    await expect(title).toContainText('That’s so AI!');
    await expect(card).toHaveJSProperty('tagName', 'A');

    // The bug was purely visual: assert the headline actually takes
    // layout space beside the thumbnail instead of being clipped.
    const metrics = await card.evaluate((el) => {
      const image = el.querySelector('img');
      const titleEl = el.querySelector('.rss-social-link-card-title');
      const imageRect = image.getBoundingClientRect();
      const titleRect = titleEl.getBoundingClientRect();
      return {
        imageWidth: Math.round(imageRect.width),
        titleWidth: Math.round(titleRect.width),
        titleRight: Math.round(titleRect.right),
        cardRight: Math.round(el.getBoundingClientRect().right),
      };
    });
    expect(metrics.imageWidth).toBeGreaterThan(0);
    expect(metrics.imageWidth).toBeLessThan(300);
    expect(metrics.titleWidth).toBeGreaterThan(20);
    expect(metrics.titleRight).toBeLessThanOrEqual(metrics.cardRight);
  });

  test('feed timeline shows a visible clickable headline next to the thumbnail', async ({ page }) => {
    await stubBlueskyAPI(page);

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.addFeedInBackground('https://bsky.app/profile/bencollins.bsky.social/rss'));
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);

    // Adding a feed parses without enrichment; the refresh pass is what
    // fetches the posts API and rewrites the timeline entry's HTML.
    await component.evaluate((el) => el.handleRefreshAll());

    // The enrichment pass (app.bsky.feed.getPosts) rewrites the timeline
    // entry's contentHTML; wait until the link card appears.
    const card = page.locator('.rss-article-content .rss-social-link-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });

    const title = card.locator('.rss-social-link-card-title');
    await expect(title).toContainText('That’s so AI!');

    const metrics = await card.evaluate((el) => {
      const image = el.querySelector('img');
      const titleEl = el.querySelector('.rss-social-link-card-title');
      return {
        imageWidth: Math.round(image.getBoundingClientRect().width),
        titleWidth: Math.round(titleEl.getBoundingClientRect().width),
      };
    });
    expect(metrics.imageWidth).toBeGreaterThan(0);
    expect(metrics.imageWidth).toBeLessThan(300);
    expect(metrics.titleWidth).toBeGreaterThan(20);
  });
});
