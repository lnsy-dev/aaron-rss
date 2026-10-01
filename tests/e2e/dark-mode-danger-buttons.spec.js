/**
 * Dark-mode Danger Button Contrast E2E Tests
 *
 * --error-color aliases --accent, which flips from red to a light cream
 * in the dark theme. The floating video chrome's Delete Video button
 * filled from it while keeping its hardcoded white text, so under
 * prefers-color-scheme: dark it rendered light-on-light — impossible to
 * read — and danger buttons looked identical to primary ones.
 *
 * These tests emulate both color schemes and measure the real computed
 * colors of the rendered buttons: every danger surface must pair its
 * fill with text at a WCAG contrast ratio of at least 4.5:1 in both
 * themes, and in dark mode the danger fill must stay visually distinct
 * from the primary fill.
 */

import { test, expect } from '@playwright/test';

/** Minimum WCAG AA contrast for normal-size text. */
const MIN_CONTRAST = 4.5;

test.describe('danger buttons across color schemes', () => {
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
   * external YouTube panel produces, then switch it to playback mode
   * via the component method under test — the same construction as
   * video-playback-mode.spec.js, whose subject is layout rather than
   * colors.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<void>}
   */
  async function openVideoPlaybackViewer(page) {
    await component.evaluate((el) => {
      const { overlay } = el.createArticleViewer(
        {
          articleID: 'danger-contrast-video-1',
          title: 'Danger Contrast Test Video',
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
      deleteButton.className =
        'rss-action-button rss-button-danger rss-youtube-external-button rss-youtube-delete-button';
      deleteButton.textContent = 'Delete Video';
      wrapper.appendChild(deleteButton);

      overlay._articleBody.appendChild(wrapper);
      el._enterVideoPlaybackMode(overlay);
    });
  }

  /**
   * Measure the computed fill/text colors of an element and their WCAG
   * contrast ratio.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @param {string} selector Target element selector
   * @returns {Promise<{backgroundColor: string, color: string, bgLuminance: number, ratio: number}|null>}
   */
  function measure(page, selector) {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) {
        return null;
      }
      const styles = getComputedStyle(el);
      const luminance = (cssColor) => {
        const [r, g, b] = cssColor.match(/\d+/g).map(Number);
        const channel = (v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const bg = luminance(styles.backgroundColor);
      const fg = luminance(styles.color);
      const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        bgLuminance: bg,
        ratio,
      };
    }, selector);
  }

  for (const scheme of ['light', 'dark']) {
    test(`Delete Video in the floating chrome stays readable (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openVideoPlaybackViewer(page);

      const chrome = page.locator('.rss-video-chrome');
      await expect(chrome).toBeVisible();

      const measured = await measure(
        page,
        '.rss-video-chrome .rss-youtube-delete-button'
      );
      expect(measured).toBeTruthy();
      expect(measured.ratio).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });

    test(`a danger action button in the viewer stays readable (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await component.evaluate((el) => {
        const { overlay } = el.createArticleViewer(
          {
            articleID: 'danger-contrast-article-1',
            title: 'Danger Contrast Test Article',
            url: 'https://example.com/article',
          },
          { name: 'Test Feed' }
        );
        const deleteButton = document.createElement('button');
        deleteButton.className = 'rss-action-button rss-button-danger';
        deleteButton.textContent = 'Delete Article';
        overlay.querySelector('.rss-article-viewer-actions').appendChild(deleteButton);
      });

      const measured = await measure(page, '.rss-article-viewer-actions .rss-button-danger');
      expect(measured).toBeTruthy();
      expect(measured.ratio).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  }

  test('in dark mode the danger fill stays readable and distinct from the primary fill', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await component.evaluate((el) => {
      const { overlay } = el.createArticleViewer(
        {
          articleID: 'danger-contrast-article-2',
          title: 'Danger vs Primary Test Article',
          url: 'https://example.com/article',
        },
        { name: 'Test Feed' }
      );
      const actions = overlay.querySelector('.rss-article-viewer-actions');
      const primaryButton = document.createElement('button');
      primaryButton.className = 'rss-action-button rss-button-primary';
      primaryButton.textContent = 'View on YouTube';
      actions.appendChild(primaryButton);
      const dangerButton = document.createElement('button');
      dangerButton.className = 'rss-action-button rss-button-danger';
      dangerButton.textContent = 'Delete Video';
      actions.appendChild(dangerButton);
    });

    const primary = await measure(page, '.rss-article-viewer-actions .rss-button-primary');
    const danger = await measure(page, '.rss-article-viewer-actions .rss-button-danger');

    expect(primary).toBeTruthy();
    expect(danger).toBeTruthy();
    // Both controls stay readable…
    expect(primary.ratio).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(danger.ratio).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // …and the destructive one no longer shares the primary's
    // accent-cream fill (they were identical before --danger existed).
    expect(Math.abs(primary.bgLuminance - danger.bgLuminance)).toBeGreaterThan(0.2);
  });
});
