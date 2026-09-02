/**
 * Quick Keys Dialog E2E Tests
 *
 * The Quick Keys dialog lists every keyboard shortcut the app supports.
 * It must open from:
 *   - the keyboard shortcut itself (Cmd+? on macOS, Ctrl+? elsewhere;
 *     Playwright presses the physical Shift+/ that produces '?'),
 *   - the in-app command panel menu ("Quick Keys").
 *
 * (The native Electron Help menu path is exercised in manual/Electron
 * testing; the Playwright suite runs against the web dev server.)
 */

import { test, expect } from '@playwright/test';

/** Platform-appropriate modifier key for the Cmd/Ctrl part of the shortcut. */
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('quick keys dialog', () => {
  test.use({ bypassCSP: true });

  test('opens with Cmd/Ctrl+? and closes with Escape', async ({ page }) => {
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // The dialog is not open initially.
    await expect(component.locator('.rss-quick-keys')).toHaveCount(0);

    // Press the shortcut: Shift+/ produces the '?' character.
    await page.keyboard.press(`${MODIFIER}+Shift+/`);

    const dialog = component.locator('.rss-quick-keys');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(component.locator('.rss-modal-header h2')).toHaveText('Quick Keys');

    // Shortcut rows render with key caps.
    const findRow = component.locator('.rss-quick-keys-row', { hasText: 'Find in articles' });
    await expect(findRow).toBeVisible();
    await expect(findRow.locator('kbd.rss-quick-keys-key').first()).toBeVisible();

    // Escape closes the dialog again.
    await page.keyboard.press('Escape');
    await expect(component.locator('.rss-quick-keys')).toHaveCount(0);
  });

  test('opens from the command panel menu', async ({ page }) => {
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Open the command panel via the hamburger menu and run the command.
    await component.locator('.rss-hamburger').click();
    const commandItem = page.locator('.command-item', { hasText: 'Quick Keys' });
    await expect(commandItem).toBeVisible({ timeout: 15000 });
    await commandItem.click();

    await expect(component.locator('.rss-quick-keys')).toBeVisible();
    await expect(component.locator('.rss-modal-header h2')).toHaveText('Quick Keys');

    await page.keyboard.press('Escape');
    await expect(component.locator('.rss-quick-keys')).toHaveCount(0);
  });

  test('lists the documented navigation shortcuts', async ({ page }) => {
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await page.keyboard.press(`${MODIFIER}+Shift+/`);
    const dialog = component.locator('.rss-quick-keys');
    await expect(dialog).toBeVisible({ timeout: 15000 });

    for (const description of [
      'Select the next article',
      'Select the previous feed',
      'Open the selected article',
      'Mark the selected article as read',
      'Show this quick keys reference',
    ]) {
      await expect(
        component.locator('.rss-quick-keys-row', { hasText: description })
      ).toBeVisible();
    }
  });
});
