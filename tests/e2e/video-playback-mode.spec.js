/**
 * Video Playback Mode E2E Tests
 *
 * When a downloaded video plays in the article viewer, the video must
 * take up the entire window with the viewer buttons floating above it
 * at the top in white. The chrome must fade away after 10 seconds
 * without mouse movement and come back as soon as the mouse moves.
 *
 * The embedded downloaded-video path needs Electron (media:// protocol),
 * which the Playwright chromium project does not have, so these tests
 * build the same DOM the viewer produces (wrapper + <video>) and invoke
 * the real _enterVideoPlaybackMode / _setupVideoChromeAutoHide methods
 * against it. The auto-hide delay is shortened through the overridable
 * _videoChromeHideDelayMs property so the fade can be asserted quickly.
 */

import { test, expect } from '@playwright/test';

test.describe('video playback mode', () => {
  let component;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });
  });

  /**
   * Open a real article viewer and add the downloaded-video DOM the
   * external YouTube panel would produce, then switch it to playback
   * mode via the component method under test.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<void>}
   */
  async function openVideoPlaybackViewer(page) {
    await component.evaluate((el) => {
      const { overlay } = el.createArticleViewer(
        {
          articleID: 'video-article-1',
          title: 'Playback Mode Test Video',
          url: 'https://example.com/watch?v=test',
          downloadPath: '/tmp/aaron-test-video.mp4',
        },
        { name: 'Video Feed' }
      );

      const wrapper = document.createElement('div');
      wrapper.className = 'rss-youtube-external';

      const video = document.createElement('video');
      video.className = 'rss-youtube-external-video';
      video.controls = true;
      wrapper.appendChild(video);

      const deleteButton = document.createElement('button');
      deleteButton.className = 'rss-action-button rss-button-danger rss-youtube-external-button rss-youtube-delete-button';
      deleteButton.textContent = 'Delete Video';
      wrapper.appendChild(deleteButton);

      const downloadButton = document.createElement('button');
      downloadButton.className = 'rss-action-button rss-youtube-download-button';
      downloadButton.textContent = 'Downloaded ✓';
      overlay.querySelector('.rss-article-viewer-actions').appendChild(downloadButton);

      overlay._articleBody.appendChild(wrapper);
      el._enterVideoPlaybackMode(overlay);
      // Kept for post-close cleanup assertions; removed when the page goes.
      window.__playbackOverlay = overlay;
    });
  }

  test('video fills the entire window', async ({ page }) => {
    await openVideoPlaybackViewer(page);

    const overlay = page.locator('.rss-article-viewer-overlay');
    await expect(overlay).toHaveClass(/rss-article-viewer-overlay--video/);

    const size = await page.evaluate(() => {
      const video = document.querySelector('.rss-youtube-external-video');
      const rect = video.getBoundingClientRect();
      return { width: rect.width, height: rect.height, vw: window.innerWidth, vh: window.innerHeight };
    });
    expect(size.width).toBe(size.vw);
    expect(size.height).toBe(size.vh);
  });

  test('buttons float above the video at the top in white', async ({ page }) => {
    await openVideoPlaybackViewer(page);

    const chrome = page.locator('.rss-video-chrome');
    await expect(chrome).toBeVisible();

    // The chrome stack is pinned to the top of the window and holds the
    // header and action rows above the video.
    const layout = await page.evaluate(() => {
      const chromeEl = document.querySelector('.rss-video-chrome');
      const rect = chromeEl.getBoundingClientRect();
      const holdsHeader = Boolean(chromeEl.querySelector('.rss-article-viewer-header'));
      const holdsActions = Boolean(chromeEl.querySelector('.rss-article-viewer-actions'));
      const buttonColor = getComputedStyle(
        chromeEl.querySelector('.rss-action-button')
      ).color;
      const titleColor = getComputedStyle(chromeEl.querySelector('h2')).color;
      const videoBottom = document
        .querySelector('.rss-youtube-external-video')
        .getBoundingClientRect().top;
      return { top: rect.top, holdsHeader, holdsActions, buttonColor, titleColor, videoTop: videoBottom };
    });

    expect(layout.top).toBe(0);
    expect(layout.holdsHeader).toBe(true);
    expect(layout.holdsActions).toBe(true);
    expect(layout.buttonColor).toBe('rgb(255, 255, 255)');
    expect(layout.titleColor).toBe('rgb(255, 255, 255)');
    // The chrome overlays the video rather than sitting above it.
    expect(layout.videoTop).toBeLessThan(layout.top + 1);
  });

  test('Delete Video joins the floating actions and Download is removed', async ({ page }) => {
    await openVideoPlaybackViewer(page);

    await expect(page.locator('.rss-article-viewer-actions .rss-youtube-delete-button')).toHaveCount(1);
    await expect(page.locator('.rss-article-viewer-actions .rss-youtube-download-button')).toHaveCount(0);
  });

  test('chrome fades away after the idle delay and returns on mouse movement', async ({ page }) => {
    // Shorten the 10s fade delay so the test stays fast.
    await component.evaluate((el) => {
      el._videoChromeHideDelayMs = 50;
    });

    await openVideoPlaybackViewer(page);

    const chrome = page.locator('.rss-video-chrome');
    await expect(chrome).toBeVisible();
    await expect(chrome).not.toHaveClass(/rss-video-chrome--hidden/);

    // After the idle delay the chrome fades out…
    await expect(chrome).toHaveClass(/rss-video-chrome--hidden/, { timeout: 3000 });

    // …and any mouse movement brings it straight back.
    await page.mouse.move(400, 300);
    await expect(chrome).not.toHaveClass(/rss-video-chrome--hidden/);
  });

  test('closing the viewer stops the auto-hide timer', async ({ page }) => {
    await component.evaluate((el) => {
      el._videoChromeHideDelayMs = 50;
    });

    await openVideoPlaybackViewer(page);

    await page.keyboard.press('Escape');
    await expect(page.locator('.rss-article-viewer-overlay')).toHaveCount(0);

    // closeModal must have run the cleanup handle: no dangling timer,
    // no listener on the (now detached) overlay node.
    const cleaned = await page.evaluate(() => window.__playbackOverlay._videoChromeCleanup === null);
    expect(cleaned).toBe(true);
  });

  test('viewer without a downloaded video stays in the normal layout', async ({ page }) => {
    await component.evaluate((el) => {
      el.showYouTubeExternalViewer(
        {
          articleID: 'video-article-2',
          title: 'Not Downloaded Video',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        },
        { name: 'Video Feed' }
      );
    });

    const overlay = page.locator('.rss-article-viewer-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).not.toHaveClass(/rss-article-viewer-overlay--video/);
    await expect(page.locator('.rss-video-chrome')).toHaveCount(0);
    // The panel keeps its non-playback call to action.
    await expect(page.locator('.rss-youtube-external-button', { hasText: 'View on YouTube' })).toBeVisible();
  });
});
