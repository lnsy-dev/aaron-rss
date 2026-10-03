/**
 * Bluesky Link Card Width E2E Tests
 *
 * The bug report: the external link card (`rss-social-link-card`) rendered
 * too small — a thin strip that did not fill the width of the div holding
 * it, with the headline clipped by the card's own `overflow: hidden`.
 *
 * Root cause: `.rss-social-media a` (specificity 0,1,1) set
 * `display: block` on every media anchor, beating the card's own
 * `display: flex` (0,1,0). The thumbnail and the text body therefore
 * stacked vertically, the card collapsed to roughly the thumbnail's
 * height, and the text below the fold was clipped.
 *
 * These tests pin the visible outcome in both surfaces that render link
 * cards: the social viewer and the enriched feed timeline.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Ben Collins</title>',
  '<link>https://bsky.app/profile/bencollins.bsky.social</link>',
  '<description>test</description>',
  '<item><title>Kids all right.</title>',
  '<link>https://bsky.app/profile/bencollins.bsky.social/post/3mwgp3xhemk25</link>',
  '<guid>bsky-width-1</guid>',
  '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
  '<description><![CDATA[Kids all right. [contains quote post or other embedded content]]]></description>',
  '</item>',
  '</channel></rss>',
].join('');

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

/**
 * Stub the Bluesky RSS + public API endpoints the app fetches for a feed.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
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

/**
 * Add the stubbed Bluesky feed and wait until its single article exists.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function addBlueskyFeed(page) {
  await page.goto('/');
  const component = page.locator('rss-feed-component');
  await expect(component).toBeVisible();
  await expect(component).toHaveJSProperty('initialized', true);

  await component.evaluate((el) =>
    el.addFeedInBackground('https://bsky.app/profile/bencollins.bsky.social/rss')
  );
  await expect
    .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
    .toBe(1);
  await expect
    .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), { timeout: 15000 })
    .toBe(1);
}

/**
 * Measure the link card against the div that holds it.
 *
 * @param {import('@playwright/test').Locator} card
 * @returns {Promise<object>}
 */
async function measureCard(card) {
  return card.evaluate((el) => {
    const wrapper = el.parentElement;
    const wrapperStyle = getComputedStyle(wrapper);
    const cardRect = el.getBoundingClientRect();
    const image = el.querySelector('img');
    const body = el.querySelector('.rss-social-link-card-body');
    const title = el.querySelector('.rss-social-link-card-title');
    const description = el.querySelector('.rss-social-link-card-description');
    const rect = (node) => (node ? node.getBoundingClientRect() : null);
    return {
      wrapperInnerWidth: Math.round(
        wrapper.clientWidth -
          parseFloat(wrapperStyle.paddingLeft) -
          parseFloat(wrapperStyle.paddingRight)
      ),
      cardWidth: Math.round(cardRect.width),
      cardHeight: Math.round(cardRect.height),
      cardDisplay: getComputedStyle(el).display,
      imageWidth: Math.round(rect(image)?.width || 0),
      imageHeight: Math.round(rect(image)?.height || 0),
      bodyWidth: Math.round(rect(body)?.width || 0),
      bodyHeight: Math.round(rect(body)?.height || 0),
      titleHeight: Math.round(rect(title)?.height || 0),
      descriptionHeight: Math.round(rect(description)?.height || 0),
      // Any scroll overflow means the card is shorter than its content
      // and is clipping something (the card has `overflow: hidden`).
      cardScrollHeight: el.scrollHeight,
      cardClientHeight: el.clientHeight,
    };
  });
}

test.describe('Bluesky link card width', () => {
  test.use({ bypassCSP: true });

  test('social viewer card fills its container with a natural height', async ({ page }) => {
    await stubBlueskyAPI(page);
    await addBlueskyFeed(page);

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const card = viewer.locator('.rss-social-link-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });

    const metrics = await measureCard(card);

    // A flex row, not the block layout the generic media-anchor rule
    // forced: that is what lets the body share the row with the thumbnail.
    expect(metrics.cardDisplay).toBe('flex');

    // The card spans the full width of the div that holds it.
    expect(metrics.cardWidth).toBeGreaterThanOrEqual(metrics.wrapperInnerWidth - 1);

    // Natural height: the card wraps its content and clips nothing.
    expect(metrics.cardHeight).toBeGreaterThanOrEqual(metrics.bodyHeight);
    expect(metrics.cardHeight).toBeGreaterThanOrEqual(metrics.imageHeight);
    expect(metrics.cardScrollHeight).toBeLessThanOrEqual(metrics.cardClientHeight + 1);

    // The text body actually gets room next to the thumbnail.
    expect(metrics.imageWidth).toBeGreaterThan(0);
    expect(metrics.imageWidth).toBeLessThan(300);
    expect(metrics.bodyWidth).toBeGreaterThan(metrics.imageWidth);
    expect(metrics.titleHeight).toBeGreaterThan(0);
    expect(metrics.descriptionHeight).toBeGreaterThan(0);
  });

  test('timeline card fills its container with a natural height', async ({ page }) => {
    await stubBlueskyAPI(page);
    await addBlueskyFeed(page);

    // Adding a feed parses without enrichment; the refresh pass fetches
    // the posts API and rewrites the timeline entry's HTML.
    await page.locator('rss-feed-component').evaluate((el) => el.handleRefreshAll());

    const card = page.locator('.rss-article-content .rss-social-link-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });

    const metrics = await measureCard(card);

    expect(metrics.cardDisplay).toBe('flex');
    expect(metrics.cardWidth).toBeGreaterThanOrEqual(metrics.wrapperInnerWidth - 1);
    expect(metrics.cardHeight).toBeGreaterThanOrEqual(metrics.bodyHeight);
    expect(metrics.cardHeight).toBeGreaterThanOrEqual(metrics.imageHeight);
    expect(metrics.cardScrollHeight).toBeLessThanOrEqual(metrics.cardClientHeight + 1);
    expect(metrics.bodyWidth).toBeGreaterThan(metrics.imageWidth);
  });
});
