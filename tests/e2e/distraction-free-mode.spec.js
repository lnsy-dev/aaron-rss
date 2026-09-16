/**
 * Distraction Free Mode E2E Tests
 *
 * The command-panel command "Toggle Distraction Free Mode" hides the
 * app chrome — header with the hamburger menu, footer, and article
 * action buttons — and, while an article viewer is open, everything
 * except the reading body. The command panel must still open with its
 * key event (Ctrl+Shift+P) so the mode can be toggled back off, and all
 * key controls keep working.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Distraction Free Feed</title>',
  '<link>https://distraction-free.example.com/</link>',
  '<description>test</description>',
  '<item><title>Distraction Free Article</title>',
  '<link>https://distraction-free.example.com/article-1</link>',
  '<guid>distraction-free-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
  '</channel></rss>',
].join('');

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

test.describe('Distraction Free Mode', () => {
  test.use({ bypassCSP: true });

  test('hides the app chrome, keeps the command panel and viewer body working', async ({
    page,
  }) => {
    await page.route('https://distraction-free.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: FEED_XML,
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
    await component.evaluate((el) =>
      el.addFeedInBackground('https://distraction-free.example.com/feed.xml')
    );
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);

    // Chrome is visible before the mode is on.
    await expect(page.locator('.rss-header')).toBeVisible();
    await expect(page.locator('.rss-footer')).toBeVisible();

    await runCommand(page, 'Toggle Distraction Free Mode');

    // Header (with the hamburger), footer, and article action buttons
    // are hidden; the flag is on the body for the CSS rules.
    await expect(page.locator('body')).toHaveClass(/distraction-free/);
    await expect(page.locator('.rss-header')).toBeHidden();
    await expect(page.locator('.rss-footer')).toBeHidden();
    await expect(page.locator('.rss-article-actions').first()).toBeHidden();

    // Opening an article still works (the title is not chrome), and the
    // viewer is stripped down to its reading body.
    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-body')).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-header')).toBeHidden();
    await expect(viewer.locator('.rss-article-viewer-actions')).toBeHidden();

    // The command panel still opens with its key event while the mode
    // is on, and toggling off restores the chrome (with the viewer
    // closed first so its overlay does not cover the page).
    await page.keyboard.press('Escape');
    await runCommand(page, 'Toggle Distraction Free Mode');
    await expect(page.locator('body')).not.toHaveClass(/distraction-free/);
    await expect(page.locator('.rss-header')).toBeVisible();
    await expect(page.locator('.rss-footer')).toBeVisible();
  });
});
