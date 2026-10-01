/**
 * Modal Backdrop Across Color Schemes E2E Tests
 *
 * The modal overlay paints the theme's --scrim at 0.7 opacity. It used
 * to paint var(--foreground-color), which the dark theme flips to a
 * light cream — so modals in dark mode opened over a jarring light
 * overlay. These tests emulate prefers-color-scheme and measure the
 * real computed ::before style: the backdrop must read as a dark dim
 * in BOTH schemes while staying translucent (an article viewer left
 * open underneath remains visible).
 */

import { test, expect } from '@playwright/test';

/** Above this luminance the backdrop reads as a light wash, not a dim. */
const MAX_DIM_LUMINANCE = 0.1;

test.describe('modal backdrop across color schemes', () => {
  /**
   * Open the thanks modal and measure its ::before backdrop.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @returns {Promise<{luminance: number, opacity: string, backgroundColor: string}>}
   */
  async function measureModalBackdrop(page) {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.showThanksModal());
    const overlay = page.locator('.rss-modal-overlay');
    await expect(overlay).toBeVisible();

    return overlay.evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      const [r, g, b] = before.backgroundColor.match(/\d+(\.\d+)?/g).map(Number);
      const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return {
        backgroundColor: before.backgroundColor,
        opacity: before.opacity,
        luminance: 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b),
      };
    });
  }

  for (const scheme of ['light', 'dark']) {
    test(`the modal backdrop is a dark dim in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');

      const backdrop = await measureModalBackdrop(page);

      // Dark in both schemes: in dark mode the old rule painted the
      // cream --foreground here (luminance ~0.6).
      expect(backdrop.luminance).toBeLessThan(MAX_DIM_LUMINANCE);
      // Still translucent so content underneath stays visible.
      expect(backdrop.opacity).toBe('0.7');
    });
  }
});
