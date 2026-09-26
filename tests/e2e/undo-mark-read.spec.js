/**
 * Undo Mark Read E2E Tests
 *
 * Ctrl/Cmd+Z must undo the most recent "mark as read": the article
 * becomes unread again, shows up in the list once more, is selected and
 * scrolled into view, and a toast confirms the undo. The read mark comes
 * from pressing M on the selected row — the same key the Quick Keys
 * reference documents.
 *
 * Data is seeded through the app's own pipeline (addFeedInBackground
 * against a routed feed URL), mirroring download-marks-read.spec.js.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Undo Feed</title>',
  '<link>https://undo-read.example.com/</link>',
  '<description>test</description>',
  '<item><title>Undo Article One</title>',
  '<link>https://undo-read.example.com/posts/1</link>',
  '<guid>undo-read-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
  '<item><title>Undo Article Two</title>',
  '<link>https://undo-read.example.com/posts/2</link>',
  '<guid>undo-read-2</guid><pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate></item>',
  '</channel></rss>',
].join('');

async function seedFeed(page) {
  await page.route('https://undo-read.example.com/**', async (route) => {
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
    el.addFeedInBackground('https://undo-read.example.com/feed.xml')
  );
  await expect
    .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
    .toBe(1);
  await expect
    .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), { timeout: 15000 })
    .toBe(2);
  return component;
}

test.describe('undo mark-as-read with Ctrl/Cmd+Z', () => {
  test.use({ bypassCSP: true });

  test('M then Ctrl+Z restores the article as unread and selected', async ({ page }) => {
    const component = await seedFeed(page);

    // Select the first article and mark it read with the M key.
    await component.evaluate((el) => {
      el._clearSelection();
      el._selectArticle(el.feeds[0].feedID, el.feeds[0].articles[0].articleID);
    });
    await page.keyboard.press('m');

    // The row left the unread list and the in-memory article carries read.
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0].articles[0].read), { timeout: 15000 })
      .toBe(true);

    // Undo with Ctrl+Z.
    await page.keyboard.press('Control+z');
    await expect(page.locator('.app-toast-text', { hasText: 'Undid mark as read' }).first()).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0].articles[0].read), { timeout: 15000 })
      .toBe(false);

    // The restored row is visible again and selected.
    const row = page.locator(
      '.rss-article[data-article-id="' + (await component.evaluate((el) => el.feeds[0].articles[0].articleID)) + '"]'
    );
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/rss-article-unread/);
    await expect(row).toHaveClass(/rss-article-selected/);

    // Nothing left to undo: a second press only hints.
    await page.keyboard.press('Control+z');
    await expect(page.locator('.app-toast-text', { hasText: 'Nothing to undo' }).first()).toBeVisible({ timeout: 15000 });
  });

  test('undo works while the article viewer is open', async ({ page }) => {
    const component = await seedFeed(page);

    // Opening the viewer marks the article read (reading = read).
    await page.locator('.rss-article-title strong').first().click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0].articles[0].read), { timeout: 15000 })
      .toBe(true);

    // The undo shortcut works while the viewer is open and the row comes
    // back (the viewer stays up; the list underneath re-renders).
    await page.keyboard.press('Control+z');
    await expect(page.locator('.app-toast-text', { hasText: 'Undid mark as read' }).first()).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0].articles[0].read), { timeout: 15000 })
      .toBe(false);
  });
});
