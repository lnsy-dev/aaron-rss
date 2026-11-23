/**
 * Read Later Offline Copy E2E Tests
 *
 * Saving an article to the Read Later archive ("To Read") must extract
 * the article's full content immediately — the page is fetched and its
 * markdown stored at save time, so the saved article opens instantly and
 * reads with no network at all. Un-saving must remove the stored content
 * immediately, along with the archive membership.
 *
 * Data is seeded through the app's own pipeline (addFeedInBackground
 * against a routed feed URL); the article page itself is routed to a
 * small HTML document the extractor can parse, mirroring
 * tests/e2e/read-later-view.spec.js.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Offline Copy Feed</title>',
  '<link>https://offline-copy.example.com/</link>',
  '<description>test</description>',
  '<item><title>Offline Copy Article</title>',
  '<link>https://publisher.example.com/posts/offline-copy</link>',
  '<guid>offline-copy-1</guid>',
  '<pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>',
  '</item>',
  '</channel></rss>',
].join('');

const ARTICLE_HTML = [
  '<!DOCTYPE html><html><head><title>Offline Copy Article</title></head><body>',
  '<article>',
  '<h1>Offline Copy Article</h1>',
  '<p>The full body of the offline copy article, extracted at save time.</p>',
  '<p>Offline reading marker paragraph with distinctive wording.</p>',
  '</article>',
  '</body></html>',
].join('');

test.describe('read later offline copies', () => {
  // The seeded feed lives on routed example.com origins; the dev
  // server's CSP (connect-src 'self') would block fetching them.
  test.use({ bypassCSP: true });

  async function seedFeed(page) {
    let articlePageFetches = 0;
    await page.route('https://offline-copy.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: FEED_XML,
      });
    });
    await page.route('https://publisher.example.com/**', async (route) => {
      articlePageFetches += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: ARTICLE_HTML,
      });
    });
    return {
      articleFetchCount: () => articlePageFetches,
    };
  }

  /**
   * Wait for the background extraction kicked off by the save toggle to
   * finish. The job promise is assigned a tick after the click, so poll
   * for it before awaiting it.
   */
  async function waitForOfflineSave(component) {
    await expect
      .poll(async () => component.evaluate((el) => Boolean(el._pendingOfflineSave)))
      .toBe(true);
    return component.evaluate((el) => el._pendingOfflineSave);
  }

  async function addFeed(page) {
    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });
    await component.evaluate((el) =>
      el.addFeedInBackground('https://offline-copy.example.com/feed.xml')
    );
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
    await expect
      .poll(async () => component.evaluate((el) => el.feeds[0]?.articles?.length || 0), {
        timeout: 15000,
      })
      .toBe(1);
    return component;
  }

  test('saving an article extracts and stores its content immediately', async ({ page }) => {
    test.setTimeout(60000);
    const tracker = await seedFeed(page);
    const component = await addFeed(page);
    const feedID = await component.evaluate((el) => el.feeds[0].feedID);
    const articleID = await component.evaluate((el) => el.feeds[0].articles[0].articleID);

    // Nothing is stored before the save.
    expect(await component.evaluate((el, [fid, aid]) => el._loadStoredArticleContent(fid, aid), [
      feedID,
      articleID,
    ])).toBeNull();

    // Marking the article "To Read" extracts the page immediately: the
    // fetch fires during the toggle, without opening the article first.
    const article = page.locator('.rss-article', { hasText: 'Offline Copy Article' });
    const rowButton = article.locator('[data-action="toggle-read-later"]');
    await expect(rowButton).toHaveText('Read Later');
    await rowButton.click();
    await expect(rowButton).toHaveText('Saved ✓');

    // Wait for the background extraction to land.
    await waitForOfflineSave(component);
    expect(tracker.articleFetchCount()).toBeGreaterThanOrEqual(1);

    // The extracted full body is stored and retrievable.
    const stored = await component.evaluate((el, [fid, aid]) => el._loadStoredArticleContent(fid, aid), [
      feedID,
      articleID,
    ]);
    expect(stored).not.toBeNull();
    expect(stored.markdown).toContain('extracted at save time');
    expect(stored.markdown).toContain('Offline reading marker paragraph');
  });

  test('a saved article opens instantly from the stored copy, even offline', async ({ page }) => {
    test.setTimeout(60000);
    await seedFeed(page);
    const component = await addFeed(page);

    const article = page.locator('.rss-article', { hasText: 'Offline Copy Article' });
    await article.locator('[data-action="toggle-read-later"]').click();
    await waitForOfflineSave(component);

    // Cut the network: the publisher (and the feed) become unreachable.
    await page.route('https://publisher.example.com/**', (route) => route.abort('connectionrefused'));
    await page.route('https://offline-copy.example.com/**', (route) => route.abort('connectionrefused'));

    // Opening the article renders the stored extraction, not an error.
    await article.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const content = viewer.locator('.rss-markdown-content');
    await expect(content).toBeVisible();
    await expect(content).toContainText('extracted at save time');
    await expect(content).toContainText('Offline reading marker paragraph');
    // No extraction error pane and no "saved copy" degradation notice —
    // the stored copy is the primary render for a saved article.
    await expect(viewer.locator('.rss-article-viewer-error')).toHaveCount(0);
    await expect(viewer.locator('.rss-article-viewer-cached-notice')).toHaveCount(0);
  });

  test('un-saving removes the stored content immediately', async ({ page }) => {
    test.setTimeout(60000);
    await seedFeed(page);
    const component = await addFeed(page);
    const feedID = await component.evaluate((el) => el.feeds[0].feedID);
    const articleID = await component.evaluate((el) => el.feeds[0].articles[0].articleID);

    const article = page.locator('.rss-article', { hasText: 'Offline Copy Article' });
    const rowButton = article.locator('[data-action="toggle-read-later"]');
    await rowButton.click();
    await waitForOfflineSave(component);

    const stored = await component.evaluate((el, [fid, aid]) => el._loadStoredArticleContent(fid, aid), [
      feedID,
      articleID,
    ]);
    expect(stored?.markdown).toContain('extracted at save time');

    // Un-saving purges the stored copy along with the archive membership.
    await expect(rowButton).toHaveText('Saved ✓');
    await rowButton.click();
    await expect(rowButton).toHaveText('Read Later');

    await expect
      .poll(async () =>
        component.evaluate((el, [fid, aid]) => el._loadStoredArticleContent(fid, aid), [
          feedID,
          articleID,
        ])
      )
      .toBeNull();
  });
});
