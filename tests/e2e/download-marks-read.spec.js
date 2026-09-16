/**
 * Download Marks Read E2E Tests
 *
 * Clicking "Download Video" on an article in the feed list is the user
 * dealing with the item: the article must be marked read immediately —
 * before the download's outcome is known — so it leaves the unread
 * list even when the download itself fails (e.g. FFmpeg missing).
 *
 * The Electron download bridge is stubbed with page.evaluate (checked
 * at call time), matching the pattern in rss-feed-component.spec.js.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Download Read Feed</title>',
  '<link>https://download-read.example.com/</link>',
  '<description>test</description>',
  '<item><title>Download Read Video</title>',
  '<link>https://www.youtube.com/watch?v=e2eDlRead11</link>',
  '<guid>download-read-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
  '</channel></rss>',
].join('');

async function seedFeed(page) {
  await page.route('https://download-read.example.com/**', async (route) => {
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
    el.addFeedInBackground('https://download-read.example.com/feed.xml')
  );
  await expect
    .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
    .toBe(1);
  return component;
}

test.describe('clicking Download Video marks the article read', () => {
  test.use({ bypassCSP: true });

  test('marks the article read even when the download fails', async ({ page }) => {
    await page.evaluate(() => {
      window.electron = {
        downloadYouTubeVideo: async () => ({
          error: 'Requested format is not available',
          ffmpegMissing: true,
        }),
      };
    });

    const component = await seedFeed(page);

    // The article row shows its Download Video button in the feed list.
    const downloadButton = page.locator('.rss-article .rss-youtube-download-button');
    await expect(downloadButton).toBeVisible();
    await downloadButton.click();

    // Marked read immediately, despite the failing download: the row
    // leaves the unread list and the in-memory article carries read.
    await expect
      .poll(
        async () =>
          component.evaluate((el) => {
            const article = el.feeds[0].articles[0];
            return {
              read: article.read,
              rows: el.querySelectorAll('.rss-feed .rss-article').length,
            };
          }),
        { timeout: 15000 }
      )
      .toEqual({ read: true, rows: 0 });
  });

  test('marks the article read when the download succeeds', async ({ page }) => {
    await page.evaluate(() => {
      window.electron = {
        downloadYouTubeVideo: async () => ({
          filePath: '/downloads/Aaron-RSS-YouTube/e2e-dl-read.mp4',
          videoID: 'e2eDlRead11',
          title: 'Download Read Video',
        }),
      };
    });

    const component = await seedFeed(page);

    const downloadButton = page.locator('.rss-article .rss-youtube-download-button');
    await expect(downloadButton).toBeVisible();
    await downloadButton.click();

    await expect
      .poll(
        async () =>
          component.evaluate((el) => {
            const article = el.feeds[0].articles[0];
            return { read: article.read, rows: el.querySelectorAll('.rss-feed .rss-article').length };
          }),
        { timeout: 15000 }
      )
      .toEqual({ read: true, rows: 0 });
  });
});
