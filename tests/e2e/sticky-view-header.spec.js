/**
 * Sticky View Header E2E Tests
 *
 * The Videos view puts its "Play All" action in a header row at the top of
 * the view. That row used to scroll up under the sticky app header, where
 * the hamburger menu swallowed the clicks, so Play All became unreachable
 * once the list was scrolled. These tests pin the view headers just below
 * the app header and check their buttons stay clickable at any scroll
 * position.
 *
 * Seeded video ids must be exactly 11 characters: that is what the app's
 * YouTube URL check requires before it will download anything.
 *
 * The Podcasts and Read Later view headers share the same row style and are
 * asserted in their own specs (podcasts-view.spec.js, read-later-view.spec.js).
 */

import { test, expect } from '@playwright/test';

/**
 * Geometry and hit test of the app header, the hamburger, and a view header
 * button at the current scroll position.
 *
 * @param {import('@playwright/test').Page} page Playwright page
 * @param {string} buttonSelector Selector for the view header's button
 * @returns {Promise<object>} Measured boxes plus the hit test result
 */
async function probeHeaderLayout(page, buttonSelector) {
  return page.evaluate((selector) => {
    const button = document.querySelector(selector);
    const header = document.querySelector('.rss-header');
    const hamburger = document.querySelector('.rss-hamburger');
    const bb = button.getBoundingClientRect();
    const hb = hamburger.getBoundingClientRect();
    const hr = header.getBoundingClientRect();
    const hit = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2);
    return {
      button: { top: bb.top, bottom: bb.bottom, left: bb.left, right: bb.right },
      hamburger: { top: hb.top, bottom: hb.bottom, left: hb.left, right: hb.right },
      header: { top: hr.top, bottom: hr.bottom },
      // The button is covered when the hamburger and button rectangles meet.
      overlapsHamburger:
        Math.min(hb.bottom, bb.bottom) - Math.max(hb.top, bb.top) > 0 &&
        Math.min(hb.right, bb.right) - Math.max(hb.left, bb.left) > 0,
      // The topmost element at the button's centre must be the button
      // itself, otherwise the hamburger (or the header) eats the click.
      hitIsButton: hit === button,
      hitClass: hit ? `${hit.tagName}.${hit.className}` : null,
    };
  }, buttonSelector);
}

test.describe('sticky view headers', () => {
  let component;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Electron stub: the download bridge mirrors yt-dlp's result shape so
    // the Videos view lists real entries through the normal pipeline.
    await page.evaluate(() => {
      const stubbed = {};
      for (let i = 0; i < 8; i++) {
        stubbed[`https://www.youtube.com/watch?v=stickyVid0${i}`] = {
          filePath: `/downloads/Aaron-RSS-YouTube/sticky-${i}.mp4`,
          title: `Sticky Video ${i}`,
        };
      }
      window.electron = {
        downloadYouTubeVideo: async (url) => stubbed[url] || { filePath: '/unknown.mp4' },
      };
    });
  });

  /**
   * Seed enough videos that the Videos view scrolls, then open it.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<void>}
   */
  async function openScrolledVideosView(page) {
    // One download per evaluate, matching tests/e2e/videos-play-all.spec.js:
    // a batched loop inside a single evaluate does not let the database
    // worker finish each write before the next one starts.
    for (let i = 0; i < 8; i++) {
      const url = `https://www.youtube.com/watch?v=stickyVid0${i}`;
      await component.evaluate((el, target) => el._downloadYouTubeVideoFromURL(target), url);
    }
    await page.locator('.rss-videos-view-button .rss-view-toggle-option-label').click();
    await expect(page.locator('.rss-videos-play-all-button')).toBeVisible();
    // Enough entries to scroll past the header height.
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 100
    );
    expect(scrollable).toBe(true);
  }

  test('the app header publishes its height as --rss-header-height', async ({ page }) => {
    await openScrolledVideosView(page);
    const varHeight = await component.evaluate(
      (el) => parseFloat(getComputedStyle(el).getPropertyValue('--rss-header-height'))
    );
    const headerHeight = await page.evaluate(
      () => document.querySelector('.rss-header').getBoundingClientRect().height
    );
    expect(varHeight).toBeGreaterThan(0);
    expect(Math.abs(varHeight - headerHeight)).toBeLessThanOrEqual(1);
  });

  test('the app header is opaque so content does not render behind it', async ({ page }) => {
    await openScrolledVideosView(page);
    const background = await page.evaluate(
      () => getComputedStyle(document.querySelector('.rss-header')).backgroundColor
    );
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('the Videos view header sticks below the app header', async ({ page }) => {
    await openScrolledVideosView(page);
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(100);

    const layout = await page.evaluate(() => {
      const viewHeader = document.querySelector('.rss-videos-view-header');
      const appHeader = document.querySelector('.rss-header');
      const vr = viewHeader.getBoundingClientRect();
      const ar = appHeader.getBoundingClientRect();
      return {
        position: getComputedStyle(viewHeader).position,
        // Sticking means the row's top edge stops at the app header's bottom
        // edge instead of continuing up behind it.
        viewHeaderTop: vr.top,
        appHeaderBottom: ar.bottom,
        background: getComputedStyle(viewHeader).backgroundColor,
      };
    });
    expect(layout.position).toBe('sticky');
    expect(Math.abs(layout.viewHeaderTop - layout.appHeaderBottom)).toBeLessThanOrEqual(1);
    expect(layout.background).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('the Play All button stays clear of the hamburger at every scroll position', async ({ page }) => {
    await openScrolledVideosView(page);

    for (const scrollY of [0, 40, 80, 200, 500]) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(100);
      const probe = await probeHeaderLayout(page, '.rss-videos-play-all-button');
      expect(probe.overlapsHamburger, `overlapped the hamburger at scrollY ${scrollY}`).toBe(false);
      expect(
        probe.hitIsButton,
        `hamburger ate the click at scrollY ${scrollY}: ${probe.hitClass}`
      ).toBe(true);
    }
  });

  test('Play All still starts the queue after the list is scrolled', async ({ page }) => {
    await openScrolledVideosView(page);
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(100);

    // A real click, not a synthetic dispatch: this is the interaction the
    // hamburger used to intercept.
    await page.locator('.rss-videos-play-all-button').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('video.rss-youtube-external-video')).toHaveCount(1);
    await expect(component).toHaveJSProperty('_playAllActive', true);
  });
});