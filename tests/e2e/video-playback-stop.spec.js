/**
 * Video Playback Stop E2E Tests
 *
 * Exiting the video playback screen must fully stop the video, and at
 * most one video may ever play at a time. Simply removing the viewer
 * overlay from the DOM is not reliable on every platform — detached
 * <video> elements can keep playing until they are garbage collected,
 * which left audio running after the close and doubled up with the
 * playback of the next video. closeModal() must therefore stop the
 * media explicitly.
 *
 * The chromium project has no media:// protocol (the Electron-only way
 * downloaded videos are served), so these tests build the same DOM the
 * external YouTube viewer produces (wrapper + <video>) and attach a
 * REAL, genuinely playing video: a short clip is recorded in-page with
 * MediaRecorder from a canvas capture stream and played muted on loop,
 * so paused/readyState assertions measure actual playback, not stubs.
 */

import { test, expect } from '@playwright/test';

test.describe('video playback stop', () => {
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
   * Record a short real video clip in-page and return its object URL.
   *
   * A canvas animates a few frames while MediaRecorder captures the
   * stream; the resulting WebM blob plays for real in a <video>.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<string>} Object URL of the recorded clip
   */
  async function recordSampleVideo(page) {
    return page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(15);

      let tick = 0;
      const draw = setInterval(() => {
        tick += 1;
        ctx.fillStyle = `hsl(${(tick * 40) % 360}, 80%, 50%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }, 40);

      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 700));
      clearInterval(draw);
      recorder.stop();
      await stopped;

      return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    });
  }

  /**
   * Open a viewer in video playback mode with a real, looping, muted
   * sample video and start playing it, exactly like the downloaded-video
   * path of the external YouTube panel does.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @param {string} articleID Article id for the viewer
   * @returns {Promise<import('@playwright/test').JSHandle>} Handle to
   *   the playing <video> element (kept valid after the overlay closes)
   */
  async function openPlayingVideoViewer(page, articleID) {
    const objectURL = await recordSampleVideo(page);
    const handle = await page.evaluateHandle(async ({ articleID, objectURL }) => {
      const el = document.querySelector('rss-feed-component');
      const { overlay, body } = el.createArticleViewer(
        {
          articleID,
          title: `Stop Test Video ${articleID}`,
          url: 'https://example.com/watch?v=test',
        },
        { name: 'Video Feed' }
      );

      const wrapper = document.createElement('div');
      wrapper.className = 'rss-youtube-external';
      const video = document.createElement('video');
      video.className = 'rss-youtube-external-video';
      video.controls = true;
      video.muted = true;
      video.loop = true;
      video.src = objectURL;
      wrapper.appendChild(video);
      body.appendChild(wrapper);
      el._enterVideoPlaybackMode(overlay);

      await new Promise((resolve, reject) => {
        video.addEventListener('canplay', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('sample video failed to load')), { once: true });
      });
      await video.play();

      // Remember every playing video so it can be inspected after the
      // overlay (and the element with it) is gone.
      window.__playbackVideos = window.__playbackVideos || [];
      window.__playbackVideos.push(video);
      return video;
    }, { articleID, objectURL });

    // Surface a play() rejection as a test failure.
    await handle.evaluate(async (video) => {
      if (video.paused) {
        throw new Error('video did not start playing');
      }
    });
    return handle;
  }

  test('closing the viewer stops the video for good', async ({ page }) => {
    const videoHandle = await openPlayingVideoViewer(page, 'stop-video-1');

    // Sanity: it really is playing before the close.
    await expect
      .poll(() => videoHandle.evaluate((video) => !video.paused && video.readyState > 0))
      .toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.rss-article-viewer-overlay')).toHaveCount(0);

    // The detached element must be fully stopped: paused, no source left
    // to play, and its media pipeline reset (readyState HAVE_NOTHING).
    const stopped = await videoHandle.evaluate((video) => ({
      paused: video.paused,
      readyState: video.readyState,
      hasSrc: video.hasAttribute('src'),
    }));
    expect(stopped.paused).toBe(true);
    expect(stopped.readyState).toBe(0);
    // (currentSrc is not asserted: Chromium keeps it on detached
    // elements even after a source-less load(), but the src attribute —
    // which drives any future playback — is verifiably gone.)
    expect(stopped.hasSrc).toBe(false);
  });

  test('re-entering the video plays a single video, not two', async ({ page }) => {
    const firstVideo = await openPlayingVideoViewer(page, 'stop-video-2a');

    await page.keyboard.press('Escape');
    await expect(page.locator('.rss-article-viewer-overlay')).toHaveCount(0);

    // The user enters the video again: one viewer, one player.
    const secondVideo = await openPlayingVideoViewer(page, 'stop-video-2b');

    const videosInDom = await page.evaluate(() =>
      document.querySelectorAll('video.rss-youtube-external-video').length
    );
    expect(videosInDom).toBe(1);

    // The previous playback is stopped, the new one is the only one.
    const states = await page.evaluate(() =>
      window.__playbackVideos.map((video) => ({
        paused: video.paused,
        readyState: video.readyState,
      }))
    );
    expect(states).toHaveLength(2);
    expect(states[0]).toEqual({ paused: true, readyState: 0 });
    expect(states[1].paused).toBe(false);

    await secondVideo.evaluate((video) => video.pause());
    await firstVideo.evaluate((video) => video.pause());
  });

  test('a lingering player from an earlier viewer is stopped before a new one starts', async ({ page }) => {
    // Simulate a player that survived its viewer's close (the class of
    // leak that doubles up playback on some platforms): it is detached
    // from the DOM but still in the component's tracked players set.
    const lingering = await page.evaluateHandle(() => {
      const el = document.querySelector('rss-feed-component');
      const video = document.createElement('video');
      video.className = 'rss-youtube-external-video';
      video.src = 'https://example.com/lingering.mp4';
      el._videoPlayers.add(video);
      window.__lingeringVideo = video;
      return video;
    });

    // Opening the next video must stop the lingering one first.
    await page.evaluate(() => {
      const el = document.querySelector('rss-feed-component');
      el._stopPreviousVideoPlayers();
    });

    const state = await lingering.evaluate((video) => ({
      paused: video.paused,
      readyState: video.readyState,
      hasSrc: video.hasAttribute('src'),
    }));
    expect(state.paused).toBe(true);
    expect(state.readyState).toBe(0);
    expect(state.hasSrc).toBe(false);

    const tracked = await page.evaluate(() =>
      document.querySelector('rss-feed-component')._videoPlayers.size
    );
    expect(tracked).toBe(0);
  });
});
