/**
 * Article Viewer Offline Fallback E2E Tests
 *
 * When the live fetch behind an article viewer fails (offline, blocked
 * host, connection timeout — surfacing as "Failed to fetch article: 0"
 * or "HTTP 0 for …"), the viewer must degrade to the article's stored
 * copy instead of rendering an effectively empty error pane. The feed's
 * copy of the content is already on disk, so "certain states" (no
 * network) must still render something readable.
 *
 * The failing host routes are aborted with `connectionrefused`, which
 * makes the network layer report status 0 — the exact state from the
 * bug report.
 */

import { test, expect } from '@playwright/test';

test.describe('article viewer renders cached content when live fetch fails', () => {
  test.use({ bypassCSP: true });

  const FEED_XML = [
    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
    '<title>Offline Test Feed</title>',
    '<link>https://offline-feed.example.com/</link>',
    '<description>test</description>',
    '<item><title>Offline Regular Article</title>',
    '<link>https://publisher.example.com/posts/offline-article</link>',
    '<guid>offline-regular-1</guid>',
    '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
    '<description><![CDATA[<p>Cached body of the regular article.</p>]]></description>',
    '</item>',
    '</channel></rss>',
  ].join('');

  test('regular article viewer shows the stored copy with a notice', async ({ page }) => {
    test.setTimeout(60000);

    await page.route('https://offline-feed.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: FEED_XML,
      });
    });
    // The publisher is unreachable: every fetch for the article page dies
    // with a connection failure, which the network layer reports as
    // status 0 (the exact "Failed to fetch article: 0" state).
    await page.route('https://publisher.example.com/**', async (route) => {
      await route.abort('connectionrefused');
    });

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.addFeedInBackground('https://offline-feed.example.com/feed.xml'));
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), { timeout: 15000 })
      .toBe(1);

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // The cached copy renders with a notice instead of an empty pane.
    const notice = viewer.locator('.rss-article-viewer-cached-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('saved copy');
    await expect(notice).toContainText('Failed to fetch article: 0');

    const content = viewer.locator('.rss-markdown-content');
    await expect(content).toBeVisible();
    await expect(content).toContainText('Cached body of the regular article.');
  });

  test('social viewer shows the stored copy when the platform API is unreachable', async ({ page }) => {
    test.setTimeout(60000);

    const SOCIAL_FEED_XML = [
      '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
      '<title>Offline Social Feed</title>',
      '<link>https://offline-social.example.com/</link>',
      '<description>test</description>',
      '<item><title>Mastodon post by Alice</title>',
      '<link>https://mastodon.social/@alice/110000000000000000</link>',
      '<guid>offline-social-1</guid>',
      '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
      '<description><![CDATA[<p>Cached Mastodon post text.</p>]]></description>',
      '</item>',
      '</channel></rss>',
    ].join('');

    await page.route('https://offline-social.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: SOCIAL_FEED_XML,
      });
    });
    // The instance API is unreachable — the social viewer's live fetch
    // fails (in the Bluesky case from the bug report: "HTTP 0 for
    // public.api.bsky.app/...resolveHandle").
    await page.route('https://mastodon.social/**', async (route) => {
      await route.abort('connectionrefused');
    });

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.addFeedInBackground('https://offline-social.example.com/feed.xml'));
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), { timeout: 15000 })
      .toBe(1);

    // A social URL routes into the social viewer.
    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const notice = viewer.locator('.rss-article-viewer-cached-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('saved copy');

    const content = viewer.locator('.rss-markdown-content');
    await expect(content).toBeVisible();
    await expect(content).toContainText('Cached Mastodon post text.');
  });

  test('viewer keeps the plain error state when nothing is cached', async ({ page }) => {
    test.setTimeout(60000);

    const EMPTY_FEED_XML = [
      '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
      '<title>Offline Empty Feed</title>',
      '<link>https://offline-empty.example.com/</link>',
      '<description>test</description>',
      '<item><title>Offline Bare Article</title>',
      '<link>https://bare-publisher.example.com/posts/bare</link>',
      '<guid>offline-bare-1</guid>',
      '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
      '</item>',
      '</channel></rss>',
    ].join('');

    await page.route('https://offline-empty.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: EMPTY_FEED_XML,
      });
    });
    await page.route('https://bare-publisher.example.com/**', async (route) => {
      await route.abort('connectionrefused');
    });

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.addFeedInBackground('https://offline-empty.example.com/feed.xml'));
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), { timeout: 15000 })
      .toBe(1);

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // No cached content and no summary: the explicit error state remains,
    // with an escape hatch to the original page.
    const error = viewer.locator('.rss-article-viewer-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Could not extract article');
    await expect(viewer.locator('button', { hasText: 'Open original page' })).toBeVisible();
  });
});
