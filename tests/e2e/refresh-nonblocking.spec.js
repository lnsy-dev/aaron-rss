/**
 * Refresh Non-Blocking E2E Tests
 *
 * Regression tests for the non-blocking refresh workflow: while a feed
 * refresh is running, interactive operations — marking articles as read,
 * switching views, opening an article viewer — must stay responsive
 * instead of queuing behind refresh database work.
 *
 * The feed stubs serve deliberately large article bodies so that the
 * pre-fix behavior (full-content loads and per-article rewrites
 * monopolizing the sqlite worker) reproduces the blocking; the asserts
 * bound interaction latency during refresh.
 */

import { test, expect } from '@playwright/test';

test.describe('refresh does not block interactions', () => {
  test.use({ bypassCSP: true });

  test('mark-as-read, view switching, and opening an article stay responsive during refresh', async ({ page }) => {
    test.setTimeout(120000);

    const FEEDS = Array.from({ length: 8 }, (_, i) => `feed${i}`);
    const ARTICLES_PER_FEED = 80;
    // ~60KB of HTML per article body — comparable to content-heavy feeds.
    const body = `<p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(200)}</p>`.repeat(5);

    const makeFeedXML = (name, count, startId) => {
      const items = [];
      for (let i = 0; i < count; i++) {
        items.push(
          `<item><title>${name} Article ${startId + i}</title>` +
            `<link>https://publisher.example.com/${name}/${startId + i}</link>` +
            `<guid>${name}-${startId + i}</guid>` +
            `<pubDate>${new Date(Date.now() - i * 60000).toUTCString()}</pubDate>` +
            `<description>${body}</description></item>`
        );
      }
      return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${name}</title><link>https://${name}.example.com</link><description>test</description>${items.join('')}</channel></rss>`;
    };

    const stubFeeds = (delayMs, startId) =>
      page.route(/https:\/\/[a-z0-9]+\.example\.com\//, async (route) => {
        const url = route.request().url();
        const name = FEEDS.find((n) => url.includes(`https://${n}.`));
        if (!name) {
          // Publisher article URLs (article extraction target).
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<html><body><article><h1>Test Article</h1><p>Hello world</p></article></body></html>',
          });
          return;
        }
        if (delayMs) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/rss+xml',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: makeFeedXML(name, ARTICLES_PER_FEED, startId),
        });
      });

    await stubFeeds(0, 0);
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[browser]', msg.text());
    });
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    for (const name of FEEDS) {
      await component.evaluate((el, n) => el.addFeedInBackground(`https://${n}.example.com/feed.xml`), name);
    }
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 60000 })
      .toBe(FEEDS.length);

    // Slow the network so the refresh is in-flight while we interact.
    await page.unroute(/https:\/\/[a-z0-9]+\.example\.com\//);
    await stubFeeds(150, 1000);

    const timings = await component.evaluate(async (el) => {
      const results = {};

      // Kick off the refresh WITHOUT awaiting it.
      const refreshPromise = el.handleRefreshAll();
      await new Promise((r) => setTimeout(r, 300));

      // 1. Mark an article as read mid-refresh.
      const feed = el.feeds[0];
      const article = feed.articles[2];
      const t0 = performance.now();
      await el.markAsRead(feed.feedID, article.articleID);
      results.markAsReadMs = Math.round(performance.now() - t0);
      results.markAsReadApplied = article.read === true;

      // 2. Switch views mid-refresh.
      const t1 = performance.now();
      el.viewMode = 'timeline';
      el.renderFeeds();
      results.switchViewMs = Math.round(performance.now() - t1);
      results.timelineRendered = el.contentArea.querySelectorAll('.rss-timeline-item, .rss-article').length > 0;
      el.viewMode = 'feeds';
      el.renderFeeds();

      // 3. Open an article viewer mid-refresh (extraction + mark-as-read).
      const t2 = performance.now();
      await el.openArticleViewer(el.feeds[1].articles[3], el.feeds[1]);
      results.openArticleMs = Math.round(performance.now() - t2);
      results.viewerOpened = Boolean(el.querySelector('.rss-article-viewer-overlay'));
      el.closeModal();

      await refreshPromise;
      return results;
    });

    // The interactions must have taken effect…
    expect(timings.markAsReadApplied).toBe(true);
    expect(timings.timelineRendered).toBe(true);
    expect(timings.viewerOpened).toBe(true);

    // …and stay far below the pre-fix blocking latencies (seconds-long
    // sqlite-worker queues). Generous bounds keep the test CI-stable
    // while still catching the monopolized-worker regression.
    expect(timings.markAsReadMs).toBeLessThan(1500);
    expect(timings.switchViewMs).toBeLessThan(1500);
    expect(timings.openArticleMs).toBeLessThan(5000);

    // The refresh itself still completes successfully.
    await expect(component.evaluate((el) => el.isRefreshing)). resolves.toBe(false);
  });
});
