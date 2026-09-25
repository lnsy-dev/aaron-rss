/**
 * Play All E2E Tests
 *
 * The Videos view (the app's downloaded-video panel) gets a "Play All"
 * button that plays every downloaded video one after the other: each
 * video opens in the normal article viewer, and when its embedded
 * <video> fires "ended" the next one opens automatically. Closing the
 * viewer stops the chain; finishing the queue closes the viewer.
 *
 * The videos are seeded through the app's real download pipeline (the
 * command-menu download path with window.electron.downloadYouTubeVideo
 * stubbed), so the Play All queue is the genuine database-backed list.
 */

import { test, expect } from '@playwright/test';

/** Titles of the two videos seeded into the queue. */
const VIDEO_1_TITLE = 'Play All First Video';
const VIDEO_2_TITLE = 'Play All Second Video';

test.describe('videos play all', () => {
  let component;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Electron stub: the embedded player only renders when the media://
    // protocol exists (window.electron present). The download bridge
    // mirrors yt-dlp's result shape, including the video title — the
    // Videos view lists manual downloads through that metadata.
    await page.evaluate(() => {
      const stubbed = {
        'https://www.youtube.com/watch?v=e2ePlayAll1': {
          filePath: '/downloads/Aaron-RSS-YouTube/e2e-play-all-1.mp4',
          title: 'Play All First Video',
        },
        'https://www.youtube.com/watch?v=e2ePlayAll2': {
          filePath: '/downloads/Aaron-RSS-YouTube/e2e-play-all-2.mp4',
          title: 'Play All Second Video',
        },
      };
      window.electron = {
        downloadYouTubeVideo: async (url) => stubbed[url] || { filePath: '/downloads/Aaron-RSS-YouTube/unknown.mp4' },
      };
    });
  });

  /**
   * Seed two downloaded videos through the real pipeline. Downloads run
   * sequentially, so the second one is the newest (listed first in the
   * Videos view and played first by Play All).
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<void>}
   */
  async function seedTwoVideos(page) {
    await component.evaluate(async (el) => {
      await el._downloadYouTubeVideoFromURL('https://www.youtube.com/watch?v=e2ePlayAll2');
    });
    await component.evaluate(async (el) => {
      await el._downloadYouTubeVideoFromURL('https://www.youtube.com/watch?v=e2ePlayAll1');
    });
  }

  /**
   * Enter the Videos view and wait for its entries to render.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<void>}
   */
  async function openVideosView(page) {
    await page.locator('.rss-videos-view-button .rss-view-toggle-option-label').click();
    await expect(page.locator('.rss-videos-view')).toBeVisible();
  }

  test('empty Videos view shows no Play All button', async ({ page }) => {
    await openVideosView(page);
    await expect(page.locator('.rss-no-articles')).toHaveText('No downloaded videos');
    await expect(page.locator('.rss-videos-view-header')).toHaveCount(0);
    await expect(page.locator('.rss-videos-play-all-button')).toHaveCount(0);
  });

  test('Videos view header shows the count and a Play All button', async ({ page }) => {
    await seedTwoVideos(page);
    await openVideosView(page);

    const header = page.locator('.rss-videos-view-header');
    await expect(header).toBeVisible();
    await expect(header.locator('.rss-videos-view-count')).toHaveText('2 videos');
    await expect(header.locator('.rss-videos-play-all-button')).toHaveText('▶ Play All');
    // The newest download is listed first (played first by Play All).
    await expect(
      page.locator('.rss-videos-view-item .rss-article-title').first()
    ).toContainText(VIDEO_1_TITLE);
  });

  test('Play All opens the first video and advances on ended', async ({ page }) => {
    await seedTwoVideos(page);
    await openVideosView(page);
    await page.locator('.rss-videos-play-all-button').click();

    // The newest video opens in the article viewer, in full-window
    // playback mode with the embedded downloaded copy.
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('video.rss-youtube-external-video')).toHaveCount(1);
    await expect(viewer).toHaveClass(/rss-article-viewer-overlay--video/);
    await expect(viewer.locator('h2')).toHaveText(VIDEO_1_TITLE);
    await expect(component).toHaveJSProperty('_playAllActive', true);
    await expect(component).toHaveJSProperty('_playAllQueue.length', 1);

    // The video ends: the next queued video opens automatically.
    await viewer.locator('video.rss-youtube-external-video').evaluate((video) => {
      video.dispatchEvent(new Event('ended'));
    });
    await expect(viewer.locator('h2')).toHaveText(VIDEO_2_TITLE, { timeout: 10000 });
    await expect(viewer.locator('video.rss-youtube-external-video')).toHaveCount(1);

    // The queue is now exhausted: one more "ended" closes the viewer.
    await viewer.locator('video.rss-youtube-external-video').evaluate((video) => {
      video.dispatchEvent(new Event('ended'));
    });
    await expect(viewer).toHaveCount(0);
    await expect(component).toHaveJSProperty('_playAllActive', false);
  });

  test('closing the viewer mid-chain stops the chain', async ({ page }) => {
    await seedTwoVideos(page);
    await openVideosView(page);
    await page.locator('.rss-videos-play-all-button').click();

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer.locator('h2')).toHaveText(VIDEO_1_TITLE);

    // The user closes the viewer while a second video is still queued.
    await page.locator('.rss-article-viewer-close').click();
    await expect(viewer).toHaveCount(0);
    await expect(component).toHaveJSProperty('_playAllActive', false);
    await expect(component).toHaveJSProperty('_playAllQueue.length', 0);

    // A late "ended" event must not reopen anything.
    await page.evaluate(() => document.dispatchEvent(new Event('ended')));
    await expect(page.locator('.rss-article-viewer-overlay')).toHaveCount(0);
  });

  test('header survives a refresh and updates its count', async ({ page }) => {
    await seedTwoVideos(page);
    await openVideosView(page);
    await expect(page.locator('.rss-videos-view-count')).toHaveText('2 videos');

    // Re-render the view (as a background refresh would): the same
    // header node survives with an updated count and a working button.
    await component.evaluate((el) => el.renderVideosView());
    const header = page.locator('.rss-videos-view-header');
    await expect(header.locator('.rss-videos-view-count')).toHaveText('2 videos');
    await expect(header.locator('.rss-videos-play-all-button')).toHaveCount(1);
    await expect(page.locator('.rss-videos-view-item')).toHaveCount(2);
  });

  test('command panel exposes Play All Videos', async ({ page }) => {
    await seedTwoVideos(page);
    await openVideosView(page);
    await page.locator('.rss-article-viewer-overlay').waitFor({ state: 'detached' }).catch(() => {});

    await page.keyboard.press('Control+Shift+P');
    await page.locator('command-panel input').fill('Play All Videos');
    await page.keyboard.press('Enter');

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('h2')).toHaveText(VIDEO_1_TITLE);
  });
});
