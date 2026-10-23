/**
 * Original Page Escape E2E Tests
 *
 * In Distraction Free Mode the article viewer hides its header, so
 * Escape is the only way back to the feed. When the viewer shows the
 * original website, the guest page takes keyboard focus and its
 * keystrokes never reach the host document — so the embed injects an
 * Escape forwarder into same-origin guest documents that posts a
 * message to the host window (src/lib/original-embed.js), and the
 * Distraction Free CSS keeps the viewer header visible while the
 * original site is shown as a pointer escape hatch.
 *
 * The spec runs against the browser build, where the embed is a
 * sandboxed iframe. The routed guest page is served on the app's own
 * origin, because the same-origin policy is what decides whether the
 * injection can happen.
 */

import { test, expect } from '@playwright/test';

const FEED_HOST = 'https://original-escape.example.com';

/**
 * Open the command panel with its key event and run the named command.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name - Command name shown in the panel.
 */
async function runCommand(page, name) {
  await page.keyboard.press('Control+Shift+P');
  const panel = page.locator('command-panel dialog[open]');
  await expect(panel).toBeVisible();
  await panel.locator('.command-item', { hasText: name }).first().click();
  await expect(panel).toBeHidden();
  await page.mouse.move(0, 0);
}

/**
 * Register the feed and guest-page routes and open the app with the
 * feed loaded, Distraction Free Mode on, and "open original by
 * default" set, so clicking the article lands in the original viewer.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openOriginalViewerInDistractionFreeMode(page) {
  await page.goto('/');

  const appOrigin = await page.evaluate(() => window.location.origin);
  const articleURL = `${appOrigin}/original-escape-test/article`;
  const feedXML = [
    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
    '<title>Original Escape Feed</title>',
    `<link>${FEED_HOST}/</link>`,
    '<description>test</description>',
    '<item><title>Original Escape Article</title>',
    `<link>${articleURL}</link>`,
    '<guid>original-escape-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
    '</channel></rss>',
  ].join('');

  await page.route(`${FEED_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/rss+xml',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: feedXML,
    })
  );
  await page.route(`${articleURL}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: [
        '<!DOCTYPE html><html><head><title>Guest page</title></head>',
        '<body><p id="original-marker">The guest page itself</p></body></html>',
      ].join(''),
    })
  );

  await page.reload();
  const component = page.locator('rss-feed-component');
  await expect(component).toBeVisible();
  await expect(component).toHaveJSProperty('initialized', true);
  await component.evaluate((el) => {
    el.viewMode = 'feeds';
    el._syncViewToggle();
  });
  await component.evaluate((el, url) => el.addFeedInBackground(url), `${FEED_HOST}/feed.xml`);
  await expect
    .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
    .toBe(1);

  await runCommand(page, 'Toggle Distraction Free Mode');
  await expect(page.locator('body')).toHaveClass(/distraction-free/);

  // Point the feed at its original website so the article click opens
  // the original viewer instead of the extracted reading body.
  await component.evaluate((el) => {
    el.feeds[0].openOriginalByDefault = true;
  });

  await page.locator('.rss-article-title strong').click();
  const viewer = page.locator('.rss-original-viewer-overlay');
  await expect(viewer).toBeVisible();
  return viewer;
}

test.describe('Escape out of the original page viewer', () => {
  test.use({ bypassCSP: true });

  test('Escape pressed inside the guest page closes the viewer', async ({ page }) => {
    const viewer = await openOriginalViewerInDistractionFreeMode(page);

    // Wait until the guest document has actually loaded, then click
    // into it: keyboard focus now sits inside the guest, where plain
    // document keydown listeners in the host app cannot hear it.
    const marker = page.frameLocator('.rss-article-viewer-frame').locator('#original-marker');
    await expect(marker).toBeVisible();
    await page.locator('.rss-article-viewer-frame').click();

    // Escape from inside the guest page must still close the viewer and
    // return to the feed list.
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(page.locator('rss-feed-component')).toHaveJSProperty('activeModal', null);
  });

  test('Escape from the app document closes the original viewer too', async ({ page }) => {
    const viewer = await openOriginalViewerInDistractionFreeMode(page);
    const marker = page.frameLocator('.rss-article-viewer-frame').locator('#original-marker');
    await expect(marker).toBeVisible();

    // Focus never entered the guest: the host document handles the key.
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(page.locator('rss-feed-component')).toHaveJSProperty('activeModal', null);
  });

  test('Distraction Free Mode keeps the viewer header visible over the original page', async ({
    page,
  }) => {
    const viewer = await openOriginalViewerInDistractionFreeMode(page);

    // The guest page can swallow Escape, so the header with the back
    // and close buttons — and the viewer actions — stay visible while
    // the original website is shown.
    await expect(viewer.locator('.rss-article-viewer-header')).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-back')).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-close')).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-actions')).toBeVisible();

    // And the back button still leads out of the viewer.
    await viewer.locator('.rss-article-viewer-back').click();
    await expect(viewer).toHaveCount(0);
    await expect(page.locator('rss-feed-component')).toHaveJSProperty('activeModal', null);
  });
});
