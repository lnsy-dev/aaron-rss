/**
 * Original-Site Fail States E2E Tests
 *
 * When an article's original page is gone (404) or refuses in-app
 * rendering, the app must fail silently:
 *
 * - no browser window may open for the dead page (the old behavior
 *   popped the system browser on a "site not found" error page),
 * - the main feed stays visible and the app does not crash.
 *
 * These scenarios run on a fresh first load: the feed is added, its
 * articles render, and the viewer is driven into every fail state.
 */

import { test, expect } from '@playwright/test';

test.describe('original-site fail states fail silently on first load', () => {
  test.use({ bypassCSP: true });

  const FEED_XML = [
    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
    '<title>Dead Links Feed</title>',
    '<link>https://dead-links.example.com/</link>',
    '<description>test</description>',
    '<item><title>Gone Article</title>',
    '<link>https://gone-publisher.example.com/posts/gone</link>',
    '<guid>gone-1</guid>',
    '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
    '<description><![CDATA[<p>Stored summary of a page that is gone.</p>]]></description>',
    '</item>',
    '</channel></rss>',
  ].join('');

  /**
   * Load the app with one feed whose article pages answer 404, and
   * install spies that record any attempt to open the page externally.
   *
   * @param {import('@playwright/test').Page} page
   * @returns {Promise<import('@playwright/test').Locator>} The app component
   */
  async function loadAppWithDeadArticle(page) {
    // Record every external-window attempt: the Electron bridge and the
    // plain window.open fallback both have to stay silent.
    await page.addInitScript(() => {
      window.__openedExternalUrls = [];
      window.electron = {
        openExternal: async (url) => {
          window.__openedExternalUrls.push(url);
        },
      };
      window.open = (url) => {
        window.__openedExternalUrls.push(url);
        return null;
      };
    });
    await page.route('https://dead-links.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: FEED_XML,
      });
    });
    // The article's original page is gone: hard 404 for every fetch.
    await page.route('https://gone-publisher.example.com/**', async (route) => {
      await route.fulfill({ status: 404, body: 'Not Found' });
    });

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.addFeedInBackground('https://dead-links.example.com/feed.xml'));
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), { timeout: 15000 })
      .toBe(1);
    return component;
  }

  test('404 article pages on first load keep the main feed visible and open no window', async ({ page }) => {
    test.setTimeout(60000);

    const component = await loadAppWithDeadArticle(page);

    // Main feed is rendered with its article before anything is opened.
    await expect(page.locator('.rss-article-title strong').first()).toBeVisible();

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // Extraction fails on the 404: the viewer degrades to the stored
    // copy (the feed's description), the app does not crash, and no
    // external window opens.
    const notice = viewer.locator('.rss-article-viewer-cached-notice');
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(notice).toContainText('saved copy');

    const opened = await page.evaluate(() => window.__openedExternalUrls);
    expect(opened).toEqual([]);
    await expect(component).toBeVisible();
  });

  test('blocked original embed during first open fails silently and keeps the feed visible', async ({ page }) => {
    test.setTimeout(60000);

    const component = await loadAppWithDeadArticle(page);

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-cached-notice')).toBeVisible({ timeout: 15000 });

    // The dead page also refuses in-app rendering: the embed reports
    // blocked and the viewer must revert to the article view without
    // opening a browser window.
    await viewer.locator('button', { hasText: 'Open Original' }).click();
    const frame = viewer.locator('.rss-article-viewer-frame');
    await expect(frame).toBeVisible();

    await expect(viewer.locator('.rss-article-viewer-body')).toBeVisible({ timeout: 15000 });
    await expect(frame).not.toBeVisible();

    const opened = await page.evaluate(() => window.__openedExternalUrls);
    expect(opened).toEqual([]);
    // The main feed is still behind the viewer and usable after closing.
    await page.locator('.rss-article-viewer-close').click();
    await expect(viewer).not.toBeVisible();
    await expect(component).toBeVisible();
    await expect(page.locator('.rss-article-title strong').first()).toBeVisible();
  });

  test('standalone original viewer on a framing-refusing page closes silently back to the feed', async ({ page }) => {
    test.setTimeout(60000);

    const component = await loadAppWithDeadArticle(page);

    // Route the article straight to the standalone original viewer.
    await component.evaluate((el) => {
      el.feeds[0].openOriginalByDefault = true;
    });
    await page.locator('.rss-article-title strong').click();

    const viewer = page.locator('.rss-original-viewer-overlay');
    await expect(viewer).toBeVisible();

    // Simulate the site refusing to render in-app (frame-ancestors in a
    // real browser; a load failure under the Electron webview).
    await viewer.locator('.rss-article-viewer-frame').evaluate((frame) => {
      frame.dispatchEvent(
        new CustomEvent('original-embed-blocked', { detail: { url: 'https://gone-publisher.example.com/posts/gone' } })
      );
    });

    // Fail silently: viewer closes, main feed is back, no window opened.
    await expect(viewer).not.toBeVisible();
    await expect(component).toBeVisible();
    await expect(page.locator('.rss-article-title strong').first()).toBeVisible();
    const opened = await page.evaluate(() => window.__openedExternalUrls);
    expect(opened).toEqual([]);
  });

  test('a feed host that is unreachable on first load does not crash the app', async ({ page }) => {
    test.setTimeout(60000);

    await page.addInitScript(() => {
      window.__openedExternalUrls = [];
      window.open = (url) => {
        window.__openedExternalUrls.push(url);
        return null;
      };
    });
    await page.route('https://unreachable-feed.example.com/**', async (route) => {
      await route.abort('connectionrefused');
    });

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.addFeedInBackground('https://unreachable-feed.example.com/feed.xml'));

    // The failure surfaces as a toast; the app shell stays intact with
    // no items scraped and no external window.
    await expect(page.locator('.app-toast')).toBeVisible({ timeout: 15000 });
    await expect(component).toBeVisible();
    const feedCount = await component.evaluate((el) => el.feeds.length);
    expect(feedCount).toBe(0);
    const opened = await page.evaluate(() => window.__openedExternalUrls);
    expect(opened).toEqual([]);
  });
});
