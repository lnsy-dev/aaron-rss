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

/**
 * Playback position memory tests.
 *
 * A downloaded video must resume where the user last stopped when it is
 * closed and re-opened. The chromium project has no media:// protocol,
 * so the component method under test (_attachPlaybackPositionMemory) is
 * invoked directly against a <video> with a captured currentTime (a
 * source-less element cannot really seek, so the property is shadowed
 * with an own accessor).
 *
 * Unlike the playback-mode tests above, these DO exercise the real
 * database: the sqlite worker is captured through a Worker wrapper and
 * rows are seeded/verified over its {id, action, params} protocol.
 */
test.describe('video playback position memory', () => {
  let component;

  test.beforeEach(async ({ page }) => {
    // Capture the app's sqlite worker so tests can seed and verify
    // downloaded_videos rows directly. The dev bundle constructs the
    // worker with empty options (the chunk is fully bundled), so match
    // on the chunk URL rather than the module-worker type flag.
    await page.addInitScript(() => {
      const OriginalWorker = window.Worker;
      window.__dbWorkerPromise = new Promise((resolve) => {
        window.__resolveDbWorker = resolve;
      });
      window.Worker = class extends OriginalWorker {
        constructor(url, options) {
          super(url, options);
          if (String(url).includes('sqlite-worker')) {
            window.__resolveDbWorker(this);
          }
        }
      };
    });

    await page.goto('/');
    component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
  });

  /**
   * Run one SQL statement against the app's own sqlite worker.
   *
   * Negative ids never collide with the database client's positive,
   * incrementing request ids; the extra message listener ignores
   * responses meant for the app.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @param {string} action 'exec' or 'query'
   * @param {string} sql SQL text
   * @param {Array} params Bound parameters
   * @returns {Promise<unknown>} Query rows (exec resolves null)
   */
  async function runWorkerSQL(page, action, sql, params = []) {
    return page.evaluate(({ action, sql, params }) => {
      return window.__dbWorkerPromise.then((worker) => new Promise((resolve, reject) => {
        const id = -Math.floor(Math.random() * 1e9) - 1;
        worker.addEventListener('message', function handler(event) {
          const data = event.data;
          if (!data || data.id !== id) {
            return;
          }
          worker.removeEventListener('message', handler);
          if (data.ok) {
            resolve(data.result);
          } else {
            reject(new Error(data.error));
          }
        });
        worker.postMessage({ id, action, params: { sql, params } });
      }));
    }, { action, sql, params });
  }

  /**
   * Seed one downloaded_videos row with a saved playback position.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @param {string} feedID Feed id for the row
   * @param {string} articleID Article id for the row
   * @param {number|null} positionSeconds Position to store (null = none)
   * @returns {Promise<void>}
   */
  async function seedVideoRow(page, feedID, articleID, positionSeconds) {
    await runWorkerSQL(
      page,
      'exec',
      `INSERT OR REPLACE INTO downloaded_videos
        (video_id, feed_id, article_id, youtube_url, file_path, title, downloaded_at, seen, playback_position_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [`e2e-vid-${articleID}`, feedID, articleID, 'https://youtu.be/e2e', `/tmp/e2e-${articleID}.mp4`, 'E2E video', '2026-01-01T00:00:00.000Z', positionSeconds],
    );
  }

  /**
   * Read the saved playback position back from the database.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @param {string} feedID Feed id of the row
   * @param {string} articleID Article id of the row
   * @returns {Promise<number|null>} Saved position or null
   */
  async function readSavedPosition(page, feedID, articleID) {
    const rows = await runWorkerSQL(
      page,
      'query',
      'SELECT playback_position_seconds FROM downloaded_videos WHERE feed_id = ? AND article_id = ?',
      [feedID, articleID],
    );
    return rows && rows.length > 0 ? rows[0].playback_position_seconds : null;
  }

  /**
   * Build a <video> whose currentTime is captured in a plain variable so
   * a source-less element can emulate seeking, and attach the component
   * method under test to it.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @param {string} feedID Feed id passed to the memory hook
   * @param {string} articleID Article id passed to the memory hook
   * @param {object} [options] Extra setup: duration override
   * @returns {Promise<import('@playwright/test').JSHandle>} Handle to a
   *   { video, state } object — state.currentTime mirrors the video's
   */
  async function attachPositionMemory(page, feedID, articleID, options = {}) {
    return page.evaluateHandle(({ feedID, articleID, options }) => {
      const video = document.createElement('video');
      const state = { currentTime: 0 };
      Object.defineProperty(video, 'currentTime', {
        get: () => state.currentTime,
        set: (value) => { state.currentTime = value; },
      });
      if (options.duration !== undefined) {
        Object.defineProperty(video, 'duration', { value: options.duration });
      }
      document.body.appendChild(video);
      const el = document.querySelector('rss-feed-component');
      el._attachPlaybackPositionMemory(video, { feedID }, { articleID });
      return { video, state };
    }, { feedID, articleID, options });
  }

  test('re-opening a video restores the saved position', async ({ page }) => {
    const feedID = `e2e-feed-${Date.now()}`;
    const articleID = `e2e-article-${Date.now()}`;
    await seedVideoRow(page, feedID, articleID, 137.5);

    const handle = await attachPositionMemory(page, feedID, articleID);

    // The restore seeks once the loadedmetadata listener is registered —
    // which happens after the position has been read back from the
    // database, so re-dispatch on every poll until the seek lands (the
    // { once: true } listener makes later dispatches harmless).
    await expect
      .poll(async () => {
        await handle.evaluate(({ video }) => video.dispatchEvent(new Event('loadedmetadata')));
        return handle.evaluate(({ state }) => state.currentTime);
      }, { timeout: 15000 })
      .toBe(137.5);
  });

  test('a position at the very end is treated as finished and not restored', async ({ page }) => {
    const feedID = `e2e-feed-${Date.now()}`;
    const articleID = `e2e-article-${Date.now()}`;
    // Saved 3 seconds before the end of a 300s video.
    await seedVideoRow(page, feedID, articleID, 297);

    const handle = await attachPositionMemory(page, feedID, articleID, { duration: 300 });

    // Let the restore path read its (discarded) position and seek nothing.
    for (let i = 0; i < 3; i += 1) {
      await handle.evaluate(({ video }) => video.dispatchEvent(new Event('loadedmetadata')));
      await page.waitForTimeout(200);
    }
    const position = await handle.evaluate(({ state }) => state.currentTime);
    expect(position).toBe(0);
  });

  test('pausing writes the current position to the database', async ({ page }) => {
    const feedID = `e2e-feed-${Date.now()}`;
    const articleID = `e2e-article-${Date.now()}`;
    await seedVideoRow(page, feedID, articleID, null);

    const handle = await attachPositionMemory(page, feedID, articleID);
    await handle.evaluate(({ video, state }) => {
      state.currentTime = 42;
      video.dispatchEvent(new Event('pause'));
    });

    await expect
      .poll(() => readSavedPosition(page, feedID, articleID), { timeout: 15000 })
      .toBe(42);
  });

  test('ending a video clears the saved position so the next watch restarts', async ({ page }) => {
    const feedID = `e2e-feed-${Date.now()}`;
    const articleID = `e2e-article-${Date.now()}`;
    await seedVideoRow(page, feedID, articleID, 61.5);

    const handle = await attachPositionMemory(page, feedID, articleID);
    await handle.evaluate(({ video }) => video.dispatchEvent(new Event('ended')));

    await expect
      .poll(() => readSavedPosition(page, feedID, articleID), { timeout: 15000 })
      .toBeNull();
  });

  test('closing the viewer flushes the final position', async ({ page }) => {
    const feedID = `e2e-feed-${Date.now()}`;
    const articleID = `e2e-article-${Date.now()}`;
    await seedVideoRow(page, feedID, articleID, null);

    const overlayHandle = await page.evaluateHandle(({ feedID, articleID }) => {
      const el = document.querySelector('rss-feed-component');
      const { overlay, body } = el.createArticleViewer(
        { articleID, title: 'Flush Test Video', url: 'https://example.com/watch?v=test' },
        { feedID, name: 'E2E Feed' }
      );
      const wrapper = document.createElement('div');
      wrapper.className = 'rss-youtube-external';
      const video = document.createElement('video');
      video.className = 'rss-youtube-external-video';
      const state = { currentTime: 0 };
      Object.defineProperty(video, 'currentTime', {
        get: () => state.currentTime,
        set: (value) => { state.currentTime = value; },
      });
      wrapper.appendChild(video);
      body.appendChild(wrapper);
      el._attachPlaybackPositionMemory(video, { feedID }, { articleID }, wrapper);
      state.currentTime = 88;
      return overlay;
    }, { feedID, articleID });

    // The memory hook registers its flush on the overlay…
    const flushIsFunction = await overlayHandle.evaluate(
      (overlay) => typeof overlay._videoPositionFlush === 'function'
    );
    expect(flushIsFunction).toBe(true);

    // …and closeModal runs it before tearing the overlay down.
    await component.evaluate((el) => el.closeModal());
    await expect(page.locator('.rss-article-viewer-overlay')).toHaveCount(0);

    await expect
      .poll(() => readSavedPosition(page, feedID, articleID), { timeout: 15000 })
      .toBe(88);
    const flushCleared = await overlayHandle.evaluate((overlay) => overlay._videoPositionFlush === null);
    expect(flushCleared).toBe(true);
  });
});
