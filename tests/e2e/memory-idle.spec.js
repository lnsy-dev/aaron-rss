/**
 * Memory / idle behavior E2E tests
 *
 * Verifies that the RSS component pauses background work when the page is
 * hidden, which is the main defense against idle memory growth.
 */

import { test, expect } from '@playwright/test';

test.describe('idle memory behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('rss-feed-component')).toHaveJSProperty('initialized', true);
  });

  test('pauses the auto-refresh timer while hidden', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    // The component should have scheduled a refresh timer on init.
    let timerActive = await component.evaluate((el) => el._refreshTimer !== null);
    expect(timerActive).toBe(true);

    // Simulate the page becoming hidden.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    timerActive = await component.evaluate((el) => el._refreshTimer !== null);
    expect(timerActive).toBe(false);

    // Simulate returning to visibility.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    timerActive = await component.evaluate((el) => el._refreshTimer !== null);
    expect(timerActive).toBe(true);
  });
});
