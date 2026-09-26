/**
 * Subscribe to Channel RSS Feed E2E Tests
 *
 * A downloaded video knows its YouTube channel (yt-dlp's channel_id,
 * recorded on the downloaded_videos queue row at download time). When
 * that channel's RSS feed is not subscribed, the video's viewer offers a
 * "Subscribe to RSS Feed" action; clicking it adds the canonical
 * https://www.youtube.com/feeds/videos.xml?channel_id=... feed and the
 * button flips to a "Subscribed ✓" confirmation. When the channel is
 * unknown or already subscribed, no button renders.
 *
 * Everything runs through the app's real pipelines: the video is
 * downloaded via the command-menu path (window.electron stubbed,
 * mirroring yt-dlp's result shape), opened from the Videos view like a
 * user would, and the subscription is verified in the Manage Feeds
 * modal. bypassCSP is required: the dev server's CSP (connect-src
 * 'self') would block the channel-feed fetch.
 */

import { test, expect } from '@playwright/test';

const CHANNEL_ID = 'UCtestchannel12345';
const CHANNEL_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const VIDEO_URL = 'https://www.youtube.com/watch?v=abc12345678';
const VIDEO_TITLE = 'Channel Test Video';

test.describe('subscribe to channel rss feed', () => {
  test.use({ bypassCSP: true });

  let component;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Electron stub: inline playback only renders when the media://
    // protocol exists (window.electron present). The download bridge
    // mirrors yt-dlp's result shape, including the channel metadata the
    // subscription offer reads.
    await page.evaluate(() => {
      const proto = HTMLMediaElement.prototype;
      proto.play = function () {
        return Promise.resolve();
      };
      Object.defineProperty(proto, 'currentSrc', {
        get() {
          return this.getAttribute('src') || '';
        },
        configurable: true,
      });
      window.electron = {
        downloadYouTubeVideo: async () => ({
          filePath: '/downloads/Aaron-RSS-YouTube/abc12345678.mp4',
          videoID: 'abc12345678',
          title: 'Channel Test Video',
          channelID: 'UCtestchannel12345',
          channelName: 'Test Channel',
        }),
      };
    });

    // The channel feed added by the Subscribe button.
    await page.route('https://www.youtube.com/feeds/videos.xml**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: [
          '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
          '<title>Test Channel</title>',
          `<link>https://www.youtube.com/channel/${CHANNEL_ID}</link>`,
          '<description>test</description>',
          '</channel></rss>',
        ].join(''),
      });
    });
  });

  /**
   * Download the video through the command-menu pipeline (which records
   * the queue row with its channel), then open its viewer from the
   * Videos view — the real user path. Manual downloads have no feed row,
   * which exercises the queue record's URL-keyed lookup.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<import('@playwright/test').Locator>} The viewer overlay
   */
  async function downloadAndOpenVideo(page) {
    await component.evaluate(async (el) => {
      await el._downloadYouTubeVideoFromURL('https://www.youtube.com/watch?v=abc12345678');
    });

    await page.locator('.rss-videos-view-button .rss-view-toggle-option-label').click();
    await expect(page.locator('.rss-videos-view')).toBeVisible();

    const item = page.locator('.rss-videos-view-item', { hasText: VIDEO_TITLE });
    await expect(item).toHaveCount(1);
    await item.locator('[data-action="open-article"]').first().click();

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('video.rss-youtube-external-video')).toHaveCount(1);
    return viewer;
  }

  test('a downloaded video from an unsubscribed channel offers Subscribe to RSS Feed', async ({
    page,
  }) => {
    const viewer = await downloadAndOpenVideo(page);

    const subscribeButton = viewer.locator('.rss-youtube-subscribe-button');
    await expect(subscribeButton).toHaveText('Subscribe to RSS Feed');

    // Subscribing adds the channel feed...
    await subscribeButton.click();
    await expect(subscribeButton).toHaveText('Subscribed ✓');

    // ...and the app now lists the channel feed (Manage Feeds shows the
    // subscribed URL, named after the channel).
    await page.locator('.rss-article-viewer-close').click();
    await page.locator('.rss-hamburger').click();
    await page
      .locator('command-panel .command-item .command-name', { hasText: 'Manage Feeds' })
      .click();
    const modal = page.locator('.rss-modal-dialog');
    await expect(modal.locator('.rss-manage-feed-item', { hasText: CHANNEL_FEED_URL })).toHaveCount(
      1
    );
  });

  test('a video whose channel feed is already subscribed shows no button', async ({ page }) => {
    // Subscribe through the app's own pipeline first (the real "already
    // subscribed" situation: the user follows the channel already).
    await page.locator('.rss-footer .rss-add-feed-button').click();
    const modal = page.locator('.rss-modal-dialog');
    await modal.locator('input[type="url"]').fill(CHANNEL_FEED_URL);
    await modal.locator('.rss-button-primary').click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect.poll(() => component.evaluate((el) => el.feeds.length)).toBe(1);

    await downloadAndOpenVideo(page);

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer.locator('.rss-youtube-subscribe-button')).toHaveCount(0);
  });

  test('a video with no known channel shows no button', async ({ page }) => {
    // Mirror yt-dlp failing to report the channel for this download.
    await page.evaluate((title) => {
      window.electron.downloadYouTubeVideo = async () => ({
        filePath: '/downloads/Aaron-RSS-YouTube/abc12345678.mp4',
        videoID: 'abc12345678',
        title,
      });
    }, VIDEO_TITLE);

    await downloadAndOpenVideo(page);

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer.locator('.rss-youtube-subscribe-button')).toHaveCount(0);
  });
});
