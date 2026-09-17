/**
 * Toggle Full Screen E2E Tests
 *
 * The command-panel command "Toggle Full Screen" must toggle the
 * document in and out of the Fullscreen API. Linux/Windows have no
 * application menu with Electron's `togglefullscreen` role, so this
 * command is their way in and out of full screen.
 */

import { test, expect } from '@playwright/test';

/**
 * Open the command panel with its key event and run the named command.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name - Command name shown in the panel.
 */
async function runCommand(page, name) {
  await page.keyboard.press('Control+Shift+P');
  const panel = page.locator('command-panel dialog[open]');
  await expect(panel).toBeVisible();
  await panel.locator('.command-item', { hasText: name }).first().click();
  await expect(panel).toBeHidden();
}

test.describe('Toggle Full Screen', () => {
  test.use({ bypassCSP: true });

  test('command toggles the document in and out of full screen', async ({ page }) => {
    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Windowed before the command runs.
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(false);

    await runCommand(page, 'Toggle Full Screen');
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(true);

    await runCommand(page, 'Toggle Full Screen');
    await expect
      .poll(async () => component.evaluate((el) => el.isFullScreen()), { timeout: 15000 })
      .toBe(false);
  });
});
