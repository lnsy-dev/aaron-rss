/**
 * User Theme E2E Tests
 *
 * The Electron app applies ~/.config/theme.css as the last stylesheet
 * of the document so its :root variables re-theme the app (see
 * src/lib/user-theme.js). The spec runs against the browser build with
 * a stubbed window.electron bridge: the renderer must inject the
 * bridged stylesheet and drop the theme's variables onto
 * documentElement — and do nothing when no theme exists.
 */

import { test, expect } from '@playwright/test';

test.describe('User theme', () => {
  test('injects the theme from the electron bridge as the last stylesheet', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.electron = {
        getUserThemeCss: async () =>
          ':root { --background: #123456; --accent: #654321; }',
      };
    });
    await page.goto('/');

    const style = page.locator('#user-theme');
    await expect(style).toHaveCount(1);
    // <style> elements have empty innerText, so read textContent directly.
    await expect(style.evaluate((el) => el.textContent)).resolves.toBe(
      ':root { --background: #123456; --accent: #654321; }',
    );

    // The variables must actually apply: the last-stylesheet position
    // wins the cascade over the bundled theme.
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
        ),
      )
      .toBe('#123456');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        ),
      )
      .toBe('#654321');
  });

  test('no theme style exists when the app runs without the bridge', async ({ page }) => {
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await expect(page.locator('#user-theme')).toHaveCount(0);
  });
});
