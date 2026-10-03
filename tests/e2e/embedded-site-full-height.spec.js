/**
 * Embedded-Site Full-Height E2E Tests
 *
 * The bug report: sites like slashdot.org open in the app, but the
 * embedded page is "very small" — a strip at the top of the viewer
 * instead of the full window height.
 *
 * Cause: the original-site embed was the viewer's flex item, and a
 * <webview> does not stretch its guest object when the <webview> element
 * is itself a flex item (electron/electron#3948). The embed now lives in
 * a `.rss-article-viewer-embed` container that claims the remaining
 * viewer height, with the frame absolutely filling it.
 *
 * These tests pin the geometry in both runtime shapes: the sandboxed
 * iframe (plain browser) and the Electron webview.
 */

import { test, expect } from '@playwright/test';

/**
 * Force the renderer to report itself as Electron.
 *
 * original-embed.js picks the <webview> embed from
 * `navigator.userAgent.includes('Electron')`; the browser runtime
 * otherwise only ever gets the sandboxed iframe.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function forceElectronRuntime(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36 Electron/43',
    });
  });
}

/**
 * Open the article viewer's original-site view for a stub article.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('@playwright/test').Locator>} The viewer overlay
 */
async function openOriginalView(page) {
  await page.goto('/');
  const component = page.locator('rss-feed-component');
  await expect(component).toBeVisible();
  await expect(component).toHaveJSProperty('initialized', true);

  await component.evaluate((el) => {
    el.createArticleViewer(
      { title: 'Slashdot Story', url: 'https://slashdot.org/story/example' },
      { feedID: 'feed-1', name: 'Slashdot' }
    );
  });

  const viewer = page.locator('.rss-article-viewer-overlay');
  await expect(viewer).toBeVisible();

  await viewer.locator('button', { hasText: 'Open Original' }).click();
  return viewer;
}

/**
 * Measure the embed container against the viewer dialog.
 *
 * @param {import('@playwright/test').Locator} viewer
 * @returns {Promise<object>}
 */
async function measureEmbed(viewer) {
  return viewer.evaluate((overlay) => {
    const dialog = overlay.querySelector('.rss-article-viewer-dialog');
    const container = overlay.querySelector('.rss-article-viewer-embed');
    const frame = overlay.querySelector('.rss-article-viewer-frame');
    const containerRect = container.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    return {
      dialogHeight: Math.round(dialogRect.height),
      containerDisplay: getComputedStyle(container).display,
      containerFlex: getComputedStyle(container).flex,
      containerHeight: Math.round(containerRect.height),
      containerWidth: Math.round(containerRect.width),
      frameTag: frame.tagName,
      frameDisplay: getComputedStyle(frame).display,
      frameHeight: Math.round(frameRect.height),
      frameWidth: Math.round(frameRect.width),
      frameBottom: Math.round(frameRect.bottom),
      dialogBottom: Math.round(dialogRect.bottom),
    };
  });
}

test.describe('embedded site full height', () => {
  test.use({ bypassCSP: true });

  test('browser iframe embed fills the viewer height', async ({ page }) => {
    const viewer = await openOriginalView(page);
    const frame = viewer.locator('.rss-article-viewer-frame');
    await expect(frame).toBeVisible();

    const metrics = await measureEmbed(viewer);
    expect(metrics.frameTag).toBe('IFRAME');

    // The embed fills the viewer's remaining height, not a thin strip.
    expect(metrics.containerHeight).toBeGreaterThan(metrics.dialogHeight * 0.6);
    expect(metrics.frameHeight).toBe(metrics.containerHeight);
    expect(metrics.frameWidth).toBe(metrics.containerWidth);
    // The bottom of the frame reaches the bottom of the viewer.
    expect(metrics.frameBottom).toBeGreaterThanOrEqual(metrics.dialogBottom - 1);
  });

  test('Electron webview embed fills the viewer height', async ({ page }) => {
    await forceElectronRuntime(page);
    const viewer = await openOriginalView(page);

    const frame = viewer.locator('.rss-article-viewer-frame');
    await expect(frame).toBeVisible();

    const metrics = await measureEmbed(viewer);
    expect(metrics.frameTag).toBe('WEBVIEW');

    // The container is a plain block that claims the remaining height,
    // and the webview inside it is a flex container so Electron
    // stretches the guest object (electron/electron#3948).
    expect(metrics.containerDisplay).toBe('block');
    expect(metrics.frameDisplay).toBe('flex');
    expect(metrics.containerHeight).toBeGreaterThan(metrics.dialogHeight * 0.6);
    expect(metrics.frameHeight).toBe(metrics.containerHeight);
    expect(metrics.frameBottom).toBeGreaterThanOrEqual(metrics.dialogBottom - 1);
  });

  test('switching back to the article hides the embed again', async ({ page }) => {
    const viewer = await openOriginalView(page);
    await expect(viewer.locator('.rss-article-viewer-frame')).toBeVisible();

    await viewer.locator('button', { hasText: 'Show Article' }).click();
    await expect(viewer.locator('.rss-article-viewer-frame')).not.toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-body')).toBeVisible();
    await expect(viewer.locator('[data-action="open-original"]')).toHaveText('Open Original');
  });
});
