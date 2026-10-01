/**
 * Cloudflare-Blocked Article Fallback E2E Tests
 *
 * Opening an article whose site answers plain HTTP clients with a
 * Cloudflare bot challenge (notebookcheck serves one with 403, Slashdot
 * with 200 + a challenge body) used to stall the open while the challenge
 * solver burned its hidden budget and then pop a browser window at the
 * user — instead of showing the website in the article view.
 *
 * Extraction now runs no solver at all: it flags the challenge and the
 * viewer shows the website in the article view through the original-site
 * embed. The non-Electron test runtime embeds an iframe, so assertions
 * target the viewer's original mode (embed visible, body hidden) rather
 * than the webview tag.
 */

import { test, expect } from '@playwright/test';

test.describe('Cloudflare-blocked articles open the website in the article view', () => {
  test.use({ bypassCSP: true });
  test.setTimeout(60000);

  const FEED_ORIGIN = 'https://cf-feed.example.com';
  const ARTICLE_ORIGIN = 'https://cf-publisher.example.com';
  const ARTICLE_URL = `${ARTICLE_ORIGIN}/posts/challenged`;
  const CHALLENGE_PAGE = [
    '<html><head><title>Just a moment...</title>',
    '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>',
    '</head><body>challenge</body></html>',
  ].join('');

  /**
   * Build the one-item feed XML used by every test.
   *
   * @param {boolean} withSummary - Include a description body
   * @returns {string} Feed XML
   */
  function feedXml(withSummary) {
    const description = withSummary
      ? '<description><![CDATA[<p>Saved copy of the article body.</p>]]></description>'
      : '';
    return [
      '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
      `<title>Challenge Test Feed</title><link>${FEED_ORIGIN}/</link><description>test</description>`,
      `<item><title>Challenge Test Article</title><link>${ARTICLE_URL}</link>`,
      '<guid>challenge-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
      description,
      '</item></channel></rss>',
    ].join('');
  }

  /**
   * Route the feed and the article host, add the feed, and open the
   * single article in the viewer.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @param {object} options
   * @param {object} options.articleFulfill - route.fulfill() options for the article page
   * @param {boolean} options.withSummary - Whether the feed item carries a description
   * @returns {Promise<import('@playwright/test').Locator>} The viewer overlay
   */
  async function openChallengedArticle(page, { articleFulfill, withSummary }) {
    await page.route(`${FEED_ORIGIN}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: feedXml(withSummary),
      })
    );
    await page.route(`${ARTICLE_ORIGIN}/**`, (route) =>
      route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        ...articleFulfill,
      })
    );

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate(
      (el, url) => el.addFeedInBackground(url),
      `${FEED_ORIGIN}/feed.xml`
    );
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), { timeout: 15000 })
      .toBe(1);

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    return viewer;
  }

  test('a 403 challenge answer shows the website in the article view', async ({ page }) => {
    const viewer = await openChallengedArticle(page, {
      articleFulfill: { status: 403, contentType: 'text/html', body: CHALLENGE_PAGE },
      withSummary: true,
    });

    // The viewer announces the fallback instead of stalling or popping
    // a browser window. (It stacks under the "Extracting…" toast.)
    await expect(
      page.locator('.app-toast').filter({ hasText: 'showing the website instead' })
    ).toBeVisible();

    // The original-site embed is the visible view: it loads the article
    // URL top-level, where the challenge behaves like in any browser tab.
    const mode = await viewer.evaluate((el) => el._viewerMode);
    expect(mode).toBe('original');
    const embed = viewer.locator('iframe.rss-article-viewer-frame');
    await expect(embed).toBeVisible();
    await expect(embed).toHaveAttribute('src', ARTICLE_URL);
    await expect(viewer.locator('.rss-article-viewer-body')).toBeHidden();

    // The action toggle reads the original view's label and can switch
    // back to the saved copy of the article.
    const toggle = viewer.locator('[data-action="open-original"]');
    await expect(toggle).toHaveText('Show Article');
    await toggle.click();
    await expect(viewer.locator('.rss-article-viewer-body')).toBeVisible();
    await expect(viewer.locator('.rss-markdown-content')).toContainText(
      'Saved copy of the article body.'
    );
  });

  test('a 200 challenge relay page shows the website too (Slashdot case)', async ({ page }) => {
    const viewer = await openChallengedArticle(page, {
      articleFulfill: { status: 200, contentType: 'text/html', body: CHALLENGE_PAGE },
      withSummary: false,
    });

    // Slashdot answers with HTTP 200: without challenge detection the
    // interstitial would be parsed as the article itself.
    const mode = await viewer.evaluate((el) => el._viewerMode);
    expect(mode).toBe('original');
    const embed = viewer.locator('iframe.rss-article-viewer-frame');
    await expect(embed).toBeVisible();
    await expect(embed).toHaveAttribute('src', ARTICLE_URL);
    expect(await viewer.evaluate((el) => el._articleBody.style.display)).toBe('none');

    // With nothing cached behind the toggle, it explains the fallback.
    const toggle = viewer.locator('[data-action="open-original"]');
    await toggle.click();
    await expect(viewer.locator('.rss-article-viewer-cached-notice')).toContainText(
      'showing the website instead'
    );
  });

  test('a plain 403 without challenge markers keeps the extraction error state', async ({ page }) => {
    const viewer = await openChallengedArticle(page, {
      articleFulfill: {
        status: 403,
        contentType: 'text/html',
        body: '<html><body>forbidden</body></html>',
      },
      withSummary: false,
    });

    // Not a challenge: the normal error pane stays, and the original
    // embed is not forced open behind it.
    const mode = await viewer.evaluate((el) => el._viewerMode);
    expect(mode).toBe('article');
    await expect(viewer.locator('.rss-article-viewer-error')).toContainText(
      'Could not extract article'
    );
    await expect(viewer.locator('iframe.rss-article-viewer-frame')).toBeHidden();
  });
});
