/**
 * Fetch Status Non-Blocking E2E Tests
 *
 * Regression tests for the requirement that feed fetching happens off the
 * main thread and that the fetching-status UI neither blocks nor covers
 * the app: while a refresh is fetching, real user interactions — clicking
 * the view toggle, re-clicking the refresh button, clicking a control that
 * sits underneath the progress toast — must land immediately, and the
 * incremental update renders must not monopolize the main thread.
 *
 * Unlike refresh-nonblocking.spec.js (which calls component methods
 * directly), every interaction here goes through real Playwright pointer
 * clicks on the visible buttons, so an overlay or a render loop that eats
 * clicks fails the test.
 */

import { test, expect } from '@playwright/test';

test.describe('fetching does not block the UI', () => {
  test.use({ bypassCSP: true });

  const FEEDS = Array.from({ length: 8 }, (_, i) => `feed${i}`);
  const ARTICLES_PER_FEED = 40;
  const body = `<p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(200)}</p>`.repeat(3);

  const makeFeedXML = (name, count, startId) => {
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push(
        `<item><title>${name} Article ${startId + i}</title>` +
          `<link>https://publisher.example.com/${name}/${startId + i}</link>` +
          `<guid>${name}-${startId + i}</guid>` +
          `<pubDate>${new Date(Date.now() - i * 60000).toUTCString()}</pubDate>` +
          `<description>${body}</description></item>`
      );
    }
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${name}</title><link>https://${name}.example.com</link><description>test</description>${items.join('')}</channel></rss>`;
  };

  const stubFeeds = (page, delayMs, startId) =>
    page.route(/https:\/\/([a-z0-9]+|publisher)\.example\.com\//, async (route) => {
      const url = route.request().url();
      const name = FEEDS.find((n) => url.includes(`https://${n}.`));
      if (!name) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
        return;
      }
      if (delayMs) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: makeFeedXML(name, ARTICLES_PER_FEED, startId),
      });
    });

  test.beforeEach(async ({ page }) => {
    stubFeeds(page, 0, 0);
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    for (const name of FEEDS) {
      await component.evaluate((el, n) => el.addFeedInBackground(`https://${n}.example.com/feed.xml`), name);
    }
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 60000 })
      .toBe(FEEDS.length);

    // Slow the network so the refresh is in-flight while we interact.
    await page.unroute(/https:\/\/([a-z0-9]+|publisher)\.example\.com\//);
    stubFeeds(page, 250, 1000);
  });

  test('progress toast never intercepts clicks and stays a small status badge', async ({ page }) => {
    test.setTimeout(120000);
    const component = page.locator('rss-feed-component');

    await page.locator('.rss-refresh-all-button').click();
    const toastContainer = page.locator('.app-toast-container');
    await expect(toastContainer).toBeVisible();

    // The toast is status output: pointer input must fall through it to
    // whatever interactive element sits underneath.
    await expect(toastContainer).toHaveCSS('pointer-events', 'none');
    const toast = toastContainer.locator('.app-toast').first();
    await expect(toast).toHaveCSS('pointer-events', 'none');

    // A status badge must not cover the app: bounded to a corner of the
    // viewport, never a full-screen overlay.
    const vp = page.viewportSize();
    const box = await toast.boundingBox();
    expect(box.width).toBeLessThan(vp.width / 2);
    expect(box.height).toBeLessThan(vp.height / 4);

    await page.waitForFunction(() => !document.querySelector('rss-feed-component').isRefreshing, { timeout: 90000 });
  });

  test('re-clicking the refresh button mid-fetch lands immediately', async ({ page }) => {
    test.setTimeout(120000);
    const component = page.locator('rss-feed-component');

    await page.locator('.rss-refresh-all-button').click();
    await expect(component.evaluate((el) => el.isRefreshing)).resolves.toBe(true);

    // The button must accept a real pointer click while the fetch runs;
    // the handler answers with the "already in progress" toast.
    const t0 = Date.now();
    await page.locator('.rss-refresh-all-button').click();
    await page.getByText('Refresh already in progress').waitFor({ timeout: 10000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(5000);

    await page.waitForFunction(() => !document.querySelector('rss-feed-component').isRefreshing, { timeout: 90000 });
  });

  test('view switching via real clicks stays responsive during the fetch', async ({ page }) => {
    test.setTimeout(120000);
    const component = page.locator('rss-feed-component');

    await page.locator('.rss-refresh-all-button').click();
    await expect(component.evaluate((el) => el.isRefreshing)).resolves.toBe(true);

    for (const mode of ['timeline', 'feeds', 'timeline']) {
      const t0 = Date.now();
      await page.locator(`label[for="rss-view-mode-${mode}"]`).click();
      await page.waitForFunction(
        (m) => document.querySelector('rss-feed-component').viewMode === m,
        mode,
        { timeout: 10000 }
      );
      // Generous CI-safe bound: a click is an interaction, not a frame.
      expect(Date.now() - t0).toBeLessThan(5000);
    }

    await page.waitForFunction(() => !document.querySelector('rss-feed-component').isRefreshing, { timeout: 90000 });
    // The refresh still completes and the fetched articles render.
    await expect(component.evaluate((el) => el.feeds.length)).resolves.toBe(FEEDS.length);
  });

  test('incremental update renders are coalesced while fetching', async ({ page }) => {
    test.setTimeout(120000);
    const component = page.locator('rss-feed-component');

    await page.locator('.rss-refresh-all-button').click();
    await expect(component.evaluate((el) => el.isRefreshing)).resolves.toBe(true);

    // Count full list renders from now (past the initial refresh render)
    // until the refresh finishes. 8 feeds complete during this window;
    // coalescing bounds the renders to a handful instead of one per
    // animation frame.
    await page.evaluate(() => {
      const el = document.querySelector('rss-feed-component');
      window.__renderCount = 0;
      const orig = el.renderFeeds.bind(el);
      el.renderFeeds = (...args) => {
        window.__renderCount += 1;
        return orig(...args);
      };
    });

    await page.waitForFunction(() => !document.querySelector('rss-feed-component').isRefreshing, { timeout: 90000 });
    const renderCount = await page.evaluate(() => window.__renderCount);

    expect(renderCount).toBeGreaterThan(0);
    expect(renderCount).toBeLessThanOrEqual(8);
  });
});
