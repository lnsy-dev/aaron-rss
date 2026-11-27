/**
 * Show-Original Escape Navigation E2E Tests
 *
 * The "Open Original" viewer embeds the article's real website. Once
 * the user is reading that site, Escape must always navigate back —
 * closing the viewer to the article, or straight back to the main feed
 * in Distraction Free Mode where Escape is the only way out without
 * the menu chrome.
 *
 * The two runtimes split the work:
 *
 * - Electron relays Escape over IPC: the main window's
 *   before-input-event listener covers keydowns on the wrapper, and
 *   every <webview> guest gets its own relay (electron/escape-forwarding.js),
 *   because a focused guest's key events never reach the window's
 *   listener. These tests drive the renderer half of that relay by
 *   stubbing window.electron.onEscapePressed and invoking it the way
 *   the main process would (the real cross-process wiring is unit
 *   tested in tests/unit/escape-forwarding.test.js).
 * - Plain browsers cannot hear keys typed inside a cross-origin
 *   iframe at all, so there Escape works while the wrapper document
 *   has focus — the path tests 1 and 2 pin — and the iframe path is
 *   Electron-only.
 *
 * The embedded site's own keyboard handling must stay intact: these
 * tests also press the site's keys inside the embed and assert the
 * site sees every one of them.
 */

import { test, expect } from '@playwright/test';

const SITE_URL = 'https://original-escape.example.com';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Original Escape Feed</title>',
  `<link>${SITE_URL}/</link>`,
  '<description>test</description>',
  '<item><title>Original Site Story</title>',
  `<link>${SITE_URL}/story</link>`,
  '<guid>original-escape-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
  '</channel></rss>',
].join('');

const ARTICLE_HTML = [
  '<html><head><title>Original Site Story</title></head><body>',
  '<article><h1>Original Site Story</h1>',
  '<p>Site paragraph the user reads in the embedded viewer.</p>',
  '</article>',
  '<script>',
  'window.__siteKeys = [];',
  "document.addEventListener('keydown', (event) => window.__siteKeys.push(event.key));",
  '</script>',
  '</body></html>',
].join('');

/**
 * Install a window.electron stub that records the renderer's Escape
 * relay callback, so a test can invoke it the way the Electron main
 * process does when Escape is seen on the main window or a webview
 * guest webContents.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function stubEscapeRelay(page) {
  await page.addInitScript(() => {
    window.electron = {
      onEscapePressed: (callback) => {
        window.__escapeRelayCallbacks = window.__escapeRelayCallbacks || [];
        window.__escapeRelayCallbacks.push(callback);
      },
    };
  });
}

/**
 * Fire the Escape relay exactly like the Electron main process would.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function fireEscapeRelay(page) {
  await page.evaluate(() => {
    for (const callback of window.__escapeRelayCallbacks || []) {
      callback();
    }
  });
}

/**
 * Seed one feed and open its article in the original-site viewer.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{component: Locator, viewer: Locator}>}
 */
async function openShowOriginal(page) {
  await page.route(`${SITE_URL}/feed.xml`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/rss+xml',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: FEED_XML,
    });
  });
  await page.route(`${SITE_URL}/story`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: ARTICLE_HTML,
    });
  });

  await page.goto('/');
  const component = page.locator('rss-feed-component');
  await expect(component).toBeVisible();
  await expect(component).toHaveJSProperty('initialized', true);
  await component.evaluate((el) => {
    el.viewMode = 'feeds';
    el._syncViewToggle();
  });
  await component.evaluate((el, url) => el.addFeedInBackground(url), `${SITE_URL}/feed.xml`);
  await expect
    .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
    .toBe(1);

  // Open the article viewer from the feed, then switch to the original
  // website view like a user would.
  await page.locator('.rss-article-title strong').click();
  const viewer = page.locator('.rss-article-viewer-overlay');
  await expect(viewer).toBeVisible();
  await viewer.locator('button', { hasText: 'Open Original' }).click();
  await expect(viewer.locator('.rss-article-viewer-frame')).toBeVisible();

  // Wait until the embedded site really loaded and its key logger runs.
  await expect
    .poll(async () => {
      const frame = page
        .frames()
        .find((f) => f.url().startsWith(SITE_URL));
      if (!frame) {
        return false;
      }
      try {
        return await frame.evaluate(() => Array.isArray(window.__siteKeys));
      } catch {
        return false;
      }
    })
    .toBe(true);

  return { component, viewer };
}

test.describe('Show Original Escape navigation', () => {
  test.use({ bypassCSP: true });

  test('Escape in Show Original returns to the main feed view', async ({ page }) => {
    const { component, viewer } = await openShowOriginal(page);

    await page.keyboard.press('Escape');

    // The viewer is gone and the component is back on the main feed.
    await expect(viewer).toHaveCount(0);
    await expect(component).toHaveJSProperty('activeModal', null);
    await expect(page.locator('.rss-feed').first()).toBeVisible();
  });

  test('Escape in Distraction Free Mode leaves Show Original for the feed, mode still on', async ({
    page,
  }) => {
    const { component, viewer } = await openShowOriginal(page);

    // Turn Distraction Free Mode on while the original site is showing.
    await page.keyboard.press('Control+D');
    await expect(page.locator('body')).toHaveClass(/distraction-free/);

    await page.keyboard.press('Escape');

    // Back to the feed page, without the mode being toggled off by the
    // escape: Escape navigates, it does not leave Distraction Free Mode.
    await expect(viewer).toHaveCount(0);
    await expect(component).toHaveJSProperty('activeModal', null);
    await expect(page.locator('body')).toHaveClass(/distraction-free/);
    await expect(page.locator('.rss-feed').first()).toBeVisible();
  });

  test('Electron relay closes the viewer while the embedded site has focus', async ({
    page,
  }) => {
    await stubEscapeRelay(page);
    const { component, viewer } = await openShowOriginal(page);

    // Move keyboard focus into the embedded site, like a user who has
    // clicked into the article they are reading. In Electron this is
    // exactly the state where the wrapper cannot hear any keydowns.
    await viewer.locator('.rss-article-viewer-frame').click();
    // The viewer is still open while the site holds focus.
    await expect
      .poll(async () => component.evaluate((el) => Boolean(el.activeModal)))
      .toBe(true);
    const siteFrame = page.frames().find((f) => f.url().startsWith(SITE_URL));
    // Snapshot the site's key log now; the frame detaches with the
    // viewer once the relay closes it.
    const siteKeysBeforeRelay = await siteFrame.evaluate(() => window.__siteKeys);

    // The main process sees the guest's Escape and relays it; the
    // renderer closes the viewer even though it never saw a keydown.
    await fireEscapeRelay(page);

    await expect(viewer).toHaveCount(0);
    await expect(component).toHaveJSProperty('activeModal', null);
    // Sanity: the relay really was the app-side path (the site's own
    // logger saw nothing — the relay fires without a key event).
    expect(siteKeysBeforeRelay).toEqual([]);
  });

  test('double-delivered Escape (keydown + relay) runs the escape action once', async ({
    page,
  }) => {
    await stubEscapeRelay(page);
    const { component, viewer } = await openShowOriginal(page);

    // Count every execution of the shared escape action's effects.
    await component.evaluate((el) => {
      window.__closeModalCalls = 0;
      window.__goToTopCalls = 0;
      const originalClose = el.closeModal.bind(el);
      el.closeModal = (...args) => {
        window.__closeModalCalls += 1;
        return originalClose(...args);
      };
      const originalTop = el._goToTopOfFeed.bind(el);
      el._goToTopOfFeed = (...args) => {
        window.__goToTopCalls += 1;
        return originalTop(...args);
      };
    });

    // Electron can deliver one physical press twice: as a document
    // keydown (wrapper had focus) and as the IPC relay (guest/webview
    // path). Both inside one JS turn — far inside the 250 ms guard.
    await page.evaluate(() => {
      for (const callback of window.__escapeRelayCallbacks || []) {
        callback();
      }
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    // The viewer closed exactly once, and the deduplicated second
    // delivery did not fall through to the main-feed escape action.
    await expect.poll(
      async () => page.evaluate(() => window.__closeModalCalls)
    ).toBe(1);
    expect(await page.evaluate(() => window.__goToTopCalls)).toBe(0);
    await expect(viewer).toHaveCount(0);
  });

  test('the embedded site keeps its own keyboard handling', async ({ page }) => {
    const { component, viewer } = await openShowOriginal(page);

    // Read inside the site: click into it and type the site's keys.
    await viewer.locator('.rss-article-viewer-frame').click();
    await page.keyboard.press('x');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const siteFrame = page.frames().find((f) => f.url().startsWith(SITE_URL));
    // Every key reached the site's own keydown listener: the wrapper
    // neither swallows nor rewrites keys aimed at the embed.
    await expect.poll(
      async () => siteFrame.evaluate(() => window.__siteKeys)
    ).toEqual(['x', 'ArrowDown', 'Enter']);

    // Non-Escape keys do not act as app navigation while the viewer is
    // open in Show Original mode.
    await expect
      .poll(async () => component.evaluate((el) => Boolean(el.activeModal)))
      .toBe(true);
    await expect(viewer).toBeVisible();
  });
});
