/**
 * Full Screen Escape Navigation E2E Tests
 *
 * In Distraction Free Mode, Escape is the only way to close the
 * article viewer (the app chrome with the back button is hidden), so
 * Escape must keep navigating backwards even while full screen is up —
 * it must never be the thing that leaves full screen. Only the command
 * panel's "Toggle Full Screen" command exits full screen.
 *
 * The spec runs against the browser build (no Electron preload): the
 * renderer routes Escape through _handleKeyDown → _runEscapeAction,
 * and Escape capture (src/lib/escape-capture.js) degrades gracefully
 * in environments without the Keyboard Lock API.
 */

import { test, expect } from '@playwright/test';

const FEED = {
  feedID: 'feed-escape-fullscreen',
  url: 'https://escape-fullscreen.example.com/feed.xml',
  name: 'Escape Full Screen Feed',
  articles: [
    {
      articleID: 'esc1',
      title: 'An article to read full screen',
      url: 'https://escape-fullscreen.example.com/article-1',
      summary: 'Reading this without chrome.',
      read: false,
      starred: false,
    },
  ],
};

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
}

test.describe('Full Screen Escape navigation', () => {
  test.use({ bypassCSP: true });

  test('Escape closes the article in Distraction Free Mode and full screen stays up', async ({
    page,
  }) => {
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });
    await component.evaluate((el, feed) => {
      el.feeds = [feed];
      el.renderFeeds();
    }, FEED);

    await runCommand(page, 'Toggle Distraction Free Mode');
    await expect(page.locator('body')).toHaveClass(/distraction-free/);

    // Enter full screen through the command panel — the only in-app way
    // in and out.
    await runCommand(page, 'Toggle Full Screen');
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(true);

    // Open the article viewer: with the chrome hidden, Escape is the
    // only way back to the feed.
    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // Escape navigates backwards (closes the article) — and full screen
    // must stay up.
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(component).toHaveJSProperty('activeModal', null);
    await expect(component.evaluate((el) => el.isFullScreen())).resolves.toBe(true);

    // A second Escape falls through to the feed-list navigation and
    // still must not leave full screen.
    await page.keyboard.press('Escape');
    await expect(component.evaluate((el) => el.isFullScreen())).resolves.toBe(true);

    // Only the command panel leaves full screen.
    await runCommand(page, 'Toggle Full Screen');
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(false);
  });

  test('Escape capture follows Distraction Free Mode and full screen state', async ({
    page,
  }) => {
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Environments without the Keyboard Lock API (Electron windows) can
    // never capture; environments with it capture exactly while both
    // Distraction Free Mode and full screen are active.
    const hasKeyboardLock = await page.evaluate(() => Boolean(navigator.keyboard?.lock));

    // Distraction Free Mode alone (windowed) must not capture.
    await component.evaluate((el) => el.setDistractionFreeMode(true));
    await expect(component.evaluate((el) => el._escapeCaptured)).resolves.toBe(false);

    // Full screen with the mode on captures Escape where the API exists.
    await runCommand(page, 'Toggle Full Screen');
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(true);
    await expect(component.evaluate((el) => el._escapeCaptured)).resolves.toBe(hasKeyboardLock);

    // Leaving full screen releases the capture again.
    await runCommand(page, 'Toggle Full Screen');
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(false);
    await expect(component.evaluate((el) => el._escapeCaptured)).resolves.toBe(false);
  });
});
