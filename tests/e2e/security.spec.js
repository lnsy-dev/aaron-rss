/**
 * Security E2E Tests
 *
 * Verifies the Content-Security-Policy meta tag is present and configured
 * to allow WebAssembly without enabling full unsafe-eval.
 */

import { test, expect } from '@playwright/test';

test.describe('security', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('has a Content-Security-Policy meta tag', async ({ page }) => {
    const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(meta).toHaveAttribute('content', /.+/);
  });

  test('CSP allows WebAssembly via wasm-unsafe-eval', async ({ page }) => {
    const content = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(content).toContain("'wasm-unsafe-eval'");
  });

  test('CSP allows Google Fonts stylesheet and font origins', async ({ page }) => {
    const content = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(content).toContain('https://fonts.googleapis.com');
    expect(content).toContain('https://fonts.gstatic.com');
  });

  test('CSP allows the YouTube IFrame API script origins in script-src', async ({ page }) => {
    const content = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    const scriptSrc = content.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).toContain("https://www.youtube.com");
    expect(scriptSrc).toContain("https://s.ytimg.com");
  });

  test('loads without CSP violations', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForSelector('rss-feed-component', { state: 'visible', timeout: 15000 });

    const cspErrors = errors.filter((e) => e.includes('Content Security Policy'));
    expect(cspErrors).toEqual([]);
  });
});
