/**
 * Read Later Scroll Memory E2E Tests
 *
 * A saved (Read Later) article remembers where the user stopped
 * reading: the viewer body's scroll offset is persisted per article
 * and restored when the article is opened again — including when it
 * is reopened from the archive after being read (the Feeds view only
 * lists unread articles). Unflagging erases the memory; re-flagging
 * starts fresh from the top.
 *
 * Data is seeded through the app's own pipeline (addFeedInBackground
 * against a routed feed URL); the article content is served by a
 * routed page tall enough to scroll. bypassCSP is required for the
 * cross-origin fetches (dev-server CSP is connect-src 'self').
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Scroll Memory Feed</title>',
  '<link>https://reader.example.com/</link>',
  '<description>test</description>',
  '<item><title>Long Saved Article</title>',
  '<link>https://reader.example.com/articles/long-one</link>',
  '<guid>scroll-1</guid><pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate></item>',
  '</channel></rss>',
].join('');

const ARTICLE_PAGE = [
  '<!doctype html><html><head><title>Long Saved Article</title></head><body>',
  '<article>',
  '<h1>Long Saved Article</h1>',
  ...Array.from(
    { length: 120 },
    (_, i) =>
      `<p>Paragraph ${i + 1} keeps the extracted article tall enough to scroll well past any viewport height.</p>`
  ),
  '</article></body></html>',
].join('');

test.describe('read later scroll memory', () => {
  test.use({ bypassCSP: true });

  /**
   * Seed one feed with one long article and flag it for Read Later.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<void>}
   */
  async function seedAndFlag(page) {
    await page.route('https://reader.example.com/feed.xml', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: FEED_XML,
      });
    });
    await page.route('https://reader.example.com/articles/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: ARTICLE_PAGE,
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
      el.addFeedInBackground('https://reader.example.com/feed.xml')
    );
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);

    const article = page.locator('.rss-article', { hasText: 'Long Saved Article' });
    await article.locator('[data-action="toggle-read-later"]').click();
    await expect(article.locator('[data-action="toggle-read-later"]')).toHaveText('Saved ✓');
  }

  /**
   * Open the article viewer (from the currently rendered list) and wait
   * for the extracted content.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @param {import('@playwright/test').Locator} row Locator for the list row
   * @returns {Promise<import('@playwright/test').Locator>} The viewer body
   */
  async function openViewer(page, row) {
    await row.locator('[data-action="open-article"]').first().click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    const body = viewer.locator('.rss-article-viewer-body');
    await expect(body.locator('.rss-markdown-content')).toBeVisible();
    return body;
  }

  /**
   * Switch to the Read Later view and return the archive row for the
   * article (the archive lists read articles too).
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<import('@playwright/test').Locator>} The archive row
   */
  async function openArchiveRow(page) {
    await page.locator('.rss-view-toggle-option--read-later .rss-view-toggle-option-label').click();
    const view = page.locator('.rss-read-later-view');
    await expect(view).toBeVisible();
    const row = view.locator('.rss-read-later-view-item', { hasText: 'Long Saved Article' });
    await expect(row).toHaveCount(1);
    return row;
  }

  test('a saved article reopens at the scroll position it was left at', async ({ page }) => {
    test.setTimeout(60000);
    await seedAndFlag(page);

    // Read partway, then leave.
    const feedsRow = page.locator('.rss-article', { hasText: 'Long Saved Article' });
    const body = await openViewer(page, feedsRow);
    await body.evaluate((el) => {
      el.scrollTop = 400;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.locator('.rss-article-viewer-close').click();
    await expect(page.locator('.rss-article-viewer-overlay')).toHaveCount(0);

    // Reading marked the article read, so the Feeds view no longer lists
    // it — reopen from the archive (the natural get-back-to-it flow).
    const archiveRow = await openArchiveRow(page);
    const reopened = await openViewer(page, archiveRow);
    await expect
      .poll(async () => reopened.evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBeGreaterThan(300);

    await page.locator('.rss-article-viewer-close').click();
  });

  test('unflagging erases the memory; re-flagging starts fresh', async ({ page }) => {
    test.setTimeout(60000);
    await seedAndFlag(page);

    // Save a scroll position.
    const feedsRow = page.locator('.rss-article', { hasText: 'Long Saved Article' });
    const body = await openViewer(page, feedsRow);
    await body.evaluate((el) => {
      el.scrollTop = 400;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.locator('.rss-article-viewer-close').click();
    await expect(page.locator('.rss-article-viewer-overlay')).toHaveCount(0);

    // Continue in the archive (the read article no longer lists in Feeds).
    const archiveRow = await openArchiveRow(page);

    // Mark it unread again so it returns to the Feeds view afterwards.
    await archiveRow.locator('[data-action="mark-read"]').click();
    await expect(archiveRow.locator('[data-action="mark-read"]')).toHaveText('Mark Read');

    // Unflag: the memory goes with the archive membership.
    await archiveRow.locator('[data-action="toggle-read-later"]').click();
    await expect(archiveRow).toHaveCount(0);

    // Re-flag from the Feeds view (the article is unread there again).
    await page.locator('.rss-view-toggle-option--feeds .rss-view-toggle-option-label').click();
    const reflagRow = page.locator('.rss-article', { hasText: 'Long Saved Article' });
    await expect(reflagRow).toHaveCount(1);
    await reflagRow.locator('[data-action="toggle-read-later"]').click();
    await expect(reflagRow.locator('[data-action="toggle-read-later"]')).toHaveText('Saved ✓');

    // A fresh archive entry starts from the top.
    const reopened = await openViewer(page, reflagRow);
    await page.waitForTimeout(400);
    expect(await reopened.evaluate((el) => el.scrollTop)).toBe(0);
  });
});
