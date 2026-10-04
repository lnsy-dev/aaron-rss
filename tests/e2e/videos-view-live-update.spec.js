/**
 * Videos View Live Update E2E Tests
 *
 * A video that finishes downloading while the Videos view is open must
 * appear in that view immediately — the user must not have to switch to
 * another view and back to see it.
 *
 * The downloads run through the app's real pipeline with
 * window.electron.downloadYouTubeVideo stubbed (same seeding trick as
 * videos-play-all.spec.js), so what is asserted is the genuine
 * record-write → view-refresh chain.
 */

import { test, expect } from '@playwright/test';

test.describe('videos view live update', () => {
  let component;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Electron stub: the download bridge mirrors yt-dlp's result shape,
    // including the title (the Videos view lists entries by it when no
    // article row exists).
    await page.evaluate(() => {
      window.electron = {
        downloadYouTubeVideo: async () => ({
          filePath: '/downloads/Aaron-RSS-YouTube/e2e-live-update.mp4',
          title: 'Live Update Video',
        }),
      };
    });
  });

  test('a finished article download appears in the open Videos view', async ({ page }) => {
    await page.locator('.rss-videos-view-button .rss-view-toggle-option-label').click();
    await expect(page.locator('.rss-videos-view')).toBeVisible();
    await expect(page.locator('.rss-no-articles')).toHaveText('No downloaded videos');

    // The real article-download pipeline (what the "Download Video"
    // button drives): the download finishes and records the video in the
    // library while the Videos view stays open.
    await component.evaluate(async (el) => {
      await el._downloadYouTubeVideo(
        {
          articleID: 'e2e-live-article',
          title: 'Live Update Video',
          url: 'https://www.youtube.com/watch?v=e2eLive1000',
        },
        { feedID: 'e2e-live-feed' }
      );
    });

    // The new video shows up immediately — no view switch needed.
    await expect(page.locator('.rss-videos-view-item')).toHaveCount(1);
    await expect(
      page.locator('.rss-videos-view-item .rss-article-title').first()
    ).toContainText('Live Update Video');
    await expect(page.locator('.rss-videos-view-count')).toHaveText('1 video');
  });

  test('a command-menu download lands in the open Videos view exactly once', async ({ page }) => {
    await page.locator('.rss-videos-view-button .rss-view-toggle-option-label').click();
    await expect(page.locator('.rss-videos-view')).toBeVisible();

    await component.evaluate(async (el) => {
      await el._downloadYouTubeVideoFromURL('https://www.youtube.com/watch?v=e2eLive2000');
    });
    await expect(page.locator('.rss-videos-view-item')).toHaveCount(1);

    // Re-running the same URL must not duplicate the entry.
    await component.evaluate(async (el) => {
      await el._downloadYouTubeVideoFromURL('https://www.youtube.com/watch?v=e2eLive2000');
    });
    await expect(page.locator('.rss-videos-view-item')).toHaveCount(1);
    await expect(page.locator('.rss-videos-view-count')).toHaveText('1 video');
  });
});
