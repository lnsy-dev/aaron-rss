/**
 * Image Context Menu E2E Tests
 *
 * Verifies that right-clicking (and ctrl-clicking) images inside feed
 * content opens the custom image menu offering "Copy Image" and
 * "Save Image…", and that Save drives the File System Access API.
 *
 * The native save dialog cannot be automated, so per project convention
 * window.showSaveFilePicker is stubbed with page.addInitScript() and we
 * assert how the app drives the picker API.
 */

import { test, expect } from '@playwright/test';

/** Minimal valid 1x1 transparent PNG served by the test router. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// Same-origin path so the dev-server CSP connect-src 'self' allows fetch().
const IMAGE_PATH = '/test-image.png';

test.describe('Image context menu', () => {
  test.beforeEach(async ({ page }) => {
    // Serve a fake remote feed image from the dev server origin.
    await page.route(`**${IMAGE_PATH}`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
    });

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);
  });

  /**
   * Inject an <img> into the content area so there is something to
   * right-click without needing live feeds.
   *
   * @param {import('@playwright/test').Page} page
   * @returns {Promise<void>}
   */
  async function injectTestImage(page) {
    await page.locator('rss-feed-component').evaluate((el, src) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'context-menu-test';
      el.contentArea.appendChild(img);
    }, IMAGE_PATH);

    // Wait until the image has actually loaded so currentSrc is set.
    await expect(
      page.locator('rss-feed-component img[alt="context-menu-test"]')
    ).toHaveJSProperty('complete', true);
  }

  test('right-click on an image opens Copy/Save menu', async ({ page }) => {
    await injectTestImage(page);

    const image = page.locator('rss-feed-component img[alt="context-menu-test"]');
    await image.click({ button: 'right' });

    const menu = page.locator('.rss-image-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.rss-menu-item')).toHaveText(['Copy Image', 'Save Image…']);
  });

  test('ctrl-click on an image opens the same menu', async ({ page }) => {
    await injectTestImage(page);

    const image = page.locator('rss-feed-component img[alt="context-menu-test"]');
    await image.click({ modifiers: ['Control'] });

    const menu = page.locator('.rss-image-context-menu');
    await expect(menu).toBeVisible();
  });

  test('clicking elsewhere closes the menu', async ({ page }) => {
    await injectTestImage(page);

    const image = page.locator('rss-feed-component img[alt="context-menu-test"]');
    await image.click({ button: 'right' });
    await expect(page.locator('.rss-image-context-menu')).toBeVisible();

    await page.locator('.rss-header').click();
    await expect(page.locator('.rss-image-context-menu')).toHaveCount(0);
  });

  test('Save Image… drives the File System Access API with fetched bytes', async ({ page }) => {
    await page.addInitScript(() => {
      window.__pickerCalls = [];
      window.__savedBytes = 0;
      // isFileSystemAccessSupported() requires both picker functions.
      window.showOpenFilePicker = async () => [];
      window.showSaveFilePicker = async (options) => {
        window.__pickerCalls.push({
          suggestedName: options.suggestedName,
          types: options.types,
        });
        return {
          name: options.suggestedName || 'image',
          createWritable: async () => ({
            write: async (chunk) => {
              window.__savedBytes += chunk.byteLength ?? chunk.size ?? 0;
            },
            close: async () => {},
          }),
        };
      };
    });

    await page.goto('/');
    await expect(page.locator('rss-feed-component')).toHaveJSProperty('initialized', true);
    await injectTestImage(page);

    const image = page.locator('rss-feed-component img[alt="context-menu-test"]');
    await image.click({ button: 'right' });

    await page
      .locator('.rss-image-context-menu .rss-menu-item')
      .filter({ hasText: 'Save Image…' })
      .click();

    // Bytes should reach the stubbed handle within 15s (fetch + IPC paths).
    await expect
      .poll(async () => page.evaluate(() => window.__savedBytes), { timeout: 15000 })
      .toBe(TINY_PNG.length);

    // The suggested file name comes from deriving it out of the image URL.
    const picker = await page.evaluate(() => window.__pickerCalls.at(-1));
    expect(picker.suggestedName).toBe('test-image.png');
    expect(picker.types[0].accept['image/png']).toContain('.png');
  });
});
