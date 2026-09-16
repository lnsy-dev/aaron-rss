/**
 * FFmpeg Install Dialog E2E Tests
 *
 * When a video download runs without FFmpeg (not installed and the
 * automatic static-build download failed), the Electron main process
 * marks the download result with `ffmpegMissing` and the renderer shows
 * a dialog directing the user to the official install instructions at
 * https://ffmpeg.org/download.html — at most once per session.
 *
 * The Electron bridge is stubbed with page.evaluate (the bridge checks
 * window.electron at call time), matching the pattern used by the
 * download/delete specs in rss-feed-component.spec.js.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>FFmpeg Dialog Feed</title>',
  '<link>https://ffmpeg-dialog.example.com/</link>',
  '<description>test</description>',
  '<item><title>FFmpeg Dialog Video</title>',
  '<link>https://www.youtube.com/watch?v=e2eFfmpeg11</link>',
  '<guid>ffmpeg-dialog-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
  '</channel></rss>',
].join('');

test.describe('FFmpeg install dialog', () => {
  // The dev server's connect-src CSP blocks the stubbed feed URL, so
  // the CSP is bypassed exactly like the other specs that fetch
  // cross-origin test feeds.
  test.use({ bypassCSP: true });

  test('offers install instructions when a download runs without FFmpeg, once per session', async ({
    page,
  }) => {
    await page.route('https://ffmpeg-dialog.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: FEED_XML,
      });
    });

    await page.goto('/');

    // Late-stub the Electron bridge: downloads fail the FFmpeg-less way
    // on the first call and succeed without the flag on the second, and
    // openExternal records where the dialog sends the user.
    await page.evaluate(() => {
      window.__openExternalCalls = [];
      let downloadCount = 0;
      window.electron = {
        openExternal: async (url) => {
          window.__openExternalCalls.push(url);
        },
        downloadYouTubeVideo: async () => {
          downloadCount += 1;
          if (downloadCount === 1) {
            return {
              error: 'Requested format is not available',
              ffmpegMissing: true,
            };
          }
          return {
            filePath: '/downloads/Aaron-RSS-YouTube/e2e-ffmpeg.mp4',
            videoID: 'e2eFfmpeg11',
            title: 'FFmpeg Dialog Video',
          };
        },
      };
    });

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });
    await component.evaluate((el) =>
      el.addFeedInBackground('https://ffmpeg-dialog.example.com/feed.xml')
    );
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), {
        timeout: 15000,
      })
      .toBe(1);

    // First download: reports the failure and opens the install dialog.
    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await viewer.locator('.rss-youtube-download-button').click();

    const dialog = page.locator('.rss-modal-dialog', {
      has: page.locator('h2', { hasText: 'Install FFmpeg' }),
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator('a[href="https://ffmpeg.org/download.html"]')
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Open Install Instructions' }).click();
    await expect(dialog).toBeHidden();
    const openCalls = await page.evaluate(() => window.__openExternalCalls);
    expect(openCalls).toEqual(['https://ffmpeg.org/download.html']);

    // Second download succeeds — and the dialog must not reappear.
    await viewer.locator('.rss-youtube-download-button').click();
    await expect(viewer.locator('video.rss-youtube-external-video')).toHaveCount(1);
    await expect(dialog).toHaveCount(0);
  });
});
