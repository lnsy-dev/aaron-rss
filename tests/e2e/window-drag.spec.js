/**
 * Window Drag Region E2E Tests
 *
 * Electron creates the window with titleBarStyle: 'hiddenInset', which
 * removes the native title bar. The window can then only be moved by
 * dragging page areas marked with -webkit-app-region: drag. These tests
 * verify that the sticky header is such a drag region and that its
 * interactive children opt back out with -webkit-app-region: no-drag so
 * they remain clickable.
 */

import { test, expect } from '@playwright/test';

test.describe('window drag region', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('header is a window drag region', async ({ page }) => {
    const appRegion = await page
      .locator('.rss-header')
      .evaluate((el) => getComputedStyle(el).webkitAppRegion);
    expect(appRegion).toBe('drag');
  });

  test('hamburger button inside the drag region is clickable (no-drag)', async ({ page }) => {
    const appRegion = await page
      .locator('.rss-hamburger')
      .evaluate((el) => getComputedStyle(el).webkitAppRegion);
    expect(appRegion).toBe('no-drag');
  });
});
