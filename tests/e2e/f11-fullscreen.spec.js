/**
 * F11 Full Screen E2E Tests
 *
 * F11 must toggle full screen. Linux and Windows builds run without an
 * application menu, so Electron's `togglefullscreen` menu role is
 * unreachable there — F11 is the standard key users expect, wired to the
 * same toggleFullScreen() path as the command-panel command. A toast
 * confirms the state change.
 */

import { test, expect } from '@playwright/test';

test.describe('F11 full screen toggle', () => {
  test.use({ bypassCSP: true });

  test('F11 toggles the document in and out of full screen with a toast', async ({ page }) => {
    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Windowed before the key press.
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(false);

    await page.keyboard.press('F11');
    await expect(page.locator('.app-toast-text', { hasText: 'Full screen on' }).first()).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(true);

    // The state change also re-evaluates Escape capture (fullscreenchange).
    await page.keyboard.press('F11');
    await expect(page.locator('.app-toast-text', { hasText: 'Full screen off' }).first()).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(false);
  });

  test('F11 still toggles while typing in an input field', async ({ page }) => {
    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Focus a text input like the add-feed or find field; the toggle is
    // deliberately reachable before the typing guard, matching browsers.
    await component.evaluate((el) => {
      const input = document.createElement('input');
      input.id = 'f11-typing-probe';
      el.appendChild(input);
      input.focus();
    });
    await expect(page.locator('#f11-typing-probe')).toBeFocused();

    await page.keyboard.press('F11');
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(true);
  });
});
