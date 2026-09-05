/**
 * OPML Import E2E Tests
 *
 * Importing an OPML subscription list drives a progress toast: the status
 * line names the feed currently being imported and the bar fills
 * deterministically. The native open dialog is stubbed via addInitScript
 * (automation cannot click it) and the feed URLs inside the OPML are
 * routed to stubbed RSS documents.
 */

import { test, expect } from '@playwright/test';

const FEED_URLS = [
  'https://opml.example/one.xml',
  'https://opml.example/two.xml',
];

const FEED_XML = (title) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${title}</title>
<link>https://opml.example</link>
<description>Stub feed for OPML import tests</description>
</channel></rss>`;

const OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
<head><title>Subscriptions</title></head>
<body>
<outline text="First Feed" title="First Feed" type="rss" xmlUrl="${FEED_URLS[0]}"/>
<outline text="Second Feed" title="Second Feed" type="rss" xmlUrl="${FEED_URLS[1]}"/>
</body>
</opml>`;

test.describe('OPML import progress', () => {
  test.use({ bypassCSP: true });

  test.beforeEach(async ({ page }) => {
    for (let i = 0; i < FEED_URLS.length; i++) {
      // A small delay stretches the import window so the spec can observe
      // the toast in its determinate progress state.
      await page.route(FEED_URLS[i], async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.fulfill({
          contentType: 'application/rss+xml',
          body: FEED_XML(`Feed ${i + 1}`),
        });
      });
    }

    // Stub the native open dialog so the import can run headlessly.
    await page.addInitScript((opml) => {
      window.showOpenFilePicker = async () => [
        {
          getFile: async () => ({
            name: 'subscriptions.opml',
            text: async () => opml,
          }),
        },
      ];
    }, OPML);

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
  });

  test('shows a progress bar with per-feed status text during import', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    // Fire and forget: evaluate would await the entire import (including
    // the post-import refresh), long past the toast's lifetime.
    await component.evaluate((el) => {
      void el.handleImportOPML();
    });

    const toast = page.locator('.app-toast').last();
    await expect(toast).toBeVisible({ timeout: 15000 });
    // Pin the import toast now: the post-import refresh appends its own
    // toast to the same container, so position-based lookups drift.
    const handle = await toast.elementHandle();
    const toastText = () => handle.$eval('.app-toast-text', (el) => el.textContent);
    const fillClass = () => handle.$eval('.app-toast-progress-fill', (el) => el.className);

    // While importing, the status line names the feed being processed.
    await expect
      .poll(toastText, { timeout: 15000 })
      .toMatch(/Importing [12] of 2: (First|Second) Feed/);

    // The bar is determinate once a feed has been processed.
    await expect.poll(fillClass, { timeout: 15000 }).not.toMatch(/app-toast-indeterminate/);

    // Completes with the added/total count.
    await expect
      .poll(toastText, { timeout: 15000 })
      .toContain('Imported 2/2 subscriptions from subscriptions.opml');

    // Both feeds landed in the database: the Manage Feeds view lists them
    // by name (the default timeline shows articles, and these stub feeds
    // have none).
    await component.evaluate((el) => el.openManageFeedsModal());
    const manageBody = page.locator('.rss-modal-body');
    await expect(manageBody.locator('.rss-manage-feed-info h3', { hasText: 'First Feed' })).toBeVisible({
      timeout: 15000,
    });
    await expect(manageBody.locator('.rss-manage-feed-info h3', { hasText: 'Second Feed' })).toBeVisible({
      timeout: 15000,
    });
  });

  test('skips a feed that fails to fetch and reports the partial import', async ({ page }) => {
    // Unroute one feed so its fetch fails; addFeed skips failed feeds, so
    // the import completes with a partial count instead of erroring out.
    await page.unroute(FEED_URLS[1]);

    const component = page.locator('rss-feed-component');
    await component.evaluate((el) => {
      void el.handleImportOPML();
    });

    const toast = page.locator('.app-toast').last();
    await expect(toast).toBeVisible({ timeout: 15000 });
    // Pin the import toast; the post-import refresh adds its own toast.
    const handle = await toast.elementHandle();
    const toastText = () => handle.$eval('.app-toast-text', (el) => el.textContent);

    await expect
      .poll(toastText, { timeout: 15000 })
      .toContain('Imported 1/2 subscriptions from subscriptions.opml');

    // The good feed landed; the failed one did not. Verified through the
    // Manage Feeds view (the default timeline shows articles, and these
    // stub feeds have none).
    await component.evaluate((el) => el.openManageFeedsModal());
    const manageBody = page.locator('.rss-modal-body');
    await expect(manageBody.locator('.rss-manage-feed-info h3', { hasText: 'First Feed' })).toBeVisible({
      timeout: 15000,
    });
    await expect(manageBody.locator('.rss-manage-feed-info h3', { hasText: 'Second Feed' })).toHaveCount(0);
  });
});
