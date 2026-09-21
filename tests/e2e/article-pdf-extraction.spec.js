/**
 * PDF Article Extraction E2E Tests
 *
 * Feed items whose links point at PDF documents — like the USDA NASS
 * reports — must open as readable text in the article viewer instead of
 * failing HTML extraction. The publisher here serves a structurally
 * valid minimal PDF built in-memory; the app fetches its bytes, extracts
 * the text with unpdf, and renders it as Markdown.
 */

import { test, expect } from '@playwright/test';
import { buildMinimalPDF } from '../helpers/minimal-pdf.js';

test.describe('PDF articles extract to readable text', () => {
  test.use({ bypassCSP: true });

  const FEED_XML = [
    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
    '<title>PDF Test Feed</title>',
    '<link>https://pdf-feed.example.com/</link>',
    '<description>test</description>',
    '<item><title>Crop Production Report</title>',
    '<link>https://pdf-publisher.example.com/reports/cropprog.pdf</link>',
    '<guid>pdf-article-1</guid>',
    '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
    '<description><![CDATA[<p>A NASS-style report delivered as a PDF.</p>]]></description>',
    '</item>',
    '</channel></rss>',
  ].join('');

  test('opening a .pdf article renders its extracted text', async ({ page }) => {
    test.setTimeout(60000);

    await page.route('https://pdf-feed.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: FEED_XML,
      });
    });
    await page.route('https://pdf-publisher.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          buildMinimalPDF({
            lines: [
              'Corn production is forecast at 15 billion bushels.',
              'This paragraph travels inside the test PDF document.',
            ],
            title: 'Crop Production',
            author: 'USDA NASS',
          })
        ),
      });
    });

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.addFeedInBackground('https://pdf-feed.example.com/feed.xml'));
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), { timeout: 15000 })
      .toBe(1);

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // The PDF's text — not an extraction error — renders as the body.
    const content = viewer.locator('.rss-markdown-content');
    await expect(content).toBeVisible({ timeout: 15000 });
    await expect(content).toContainText('Corn production is forecast at 15 billion bushels.');
    await expect(content).toContainText('This paragraph travels inside the test PDF document.');
    await expect(viewer.locator('.rss-article-viewer-error')).toHaveCount(0);
  });
});
