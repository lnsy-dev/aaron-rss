/**
 * Research Topics E2E Tests
 *
 * Research Topics are named groups of feeds scraped together. These
 * specs drive the full-page view through the command panel and exercise
 * the real (OPFS-backed) database: creating a topic, adding a feed by
 * URL (network is stubbed with a route), reading the scrape status,
 * removing the feed, and deleting the topic.
 */

import { test, expect } from '@playwright/test';

const FEED_URL = 'https://research.example/feed.xml';

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Research Example Feed</title>
<link>https://research.example</link>
<description>A feed for research topics</description>
<item>
  <title>Hello Article</title>
  <link>https://research.example/hello</link>
  <guid>hello</guid>
  <pubDate>Wed, 02 Sep 2026 10:00:00 GMT</pubDate>
  <description>Hello world</description>
</item>
</channel></rss>`;

test.describe('Research Topics', () => {
  // Feed discovery fetches external URLs; the app's strict connect-src
  // CSP would block them in the test browser.
  test.use({ bypassCSP: true });

  test.beforeEach(async ({ page }) => {
    await page.route(FEED_URL, (route) =>
      route.fulfill({ contentType: 'application/rss+xml', body: FEED_XML })
    );
    // The article page behind the feed item, for the article viewer.
    await page.route('https://research.example/hello', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><body><article><h1>Hello Article</h1><p>Full scraped body text.</p></article></body></html>',
      })
    );

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
  });

  test('is reachable from the command panel and creates a topic', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    // The command panel has the Research Topics command registered.
    const hasCommand = await component.evaluate((el) =>
      Array.isArray(el.commandPanel?.commands) &&
      el.commandPanel.commands.some((command) => command?.name === 'Research Topics')
    );
    expect(hasCommand).toBe(true);

    // Run the command through the panel UI itself.
    await component.evaluate((el) => el.commandPanel.openPanel());
    await page.locator('.command-search').fill('Research Topics');
    await page.locator('.command-item', { hasText: 'Research Topics' }).click();

    // The full-page view appears.
    const body = page.locator('.rss-modal-dialog--full .rss-modal-body');
    await expect(body).toBeVisible();

    // Create a topic.
    await body.locator('.rss-research-create-name').fill('LLM Papers');
    await body.locator('.rss-research-create-button').click();

    const topic = body.locator('.rss-research-topic');
    await expect(topic).toHaveCount(1, { timeout: 15000 });
    await expect(topic.locator('h3')).toHaveText('LLM Papers');
    await expect(topic.locator('.rss-research-topic-id')).toContainText('#');
    await expect(topic.locator('.rss-research-feed-empty')).toHaveText(
      'No feeds in this topic yet.'
    );
  });

  test('shows watch API endpoints when the Electron bridge is available', async ({ page }) => {
    // Stub the Electron preload bridge so the view can display where the
    // localhost watch API listens (the server itself is Electron-only and
    // covered by unit tests).
    await page.addInitScript(() => {
      window.electron = {
        getResearchApiInfo: async () => ({
          baseUrl: 'http://127.0.0.1:4527',
          endpoints: [],
        }),
        onResearchApiQuery: () => {},
      };
    });
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => el.openResearchTopicsModal());
    const body = page.locator('.rss-modal-dialog--full .rss-modal-body');
    await expect(body).toBeVisible();

    await body.locator('.rss-research-create-name').fill('Watched Topic');
    await body.locator('.rss-research-create-button').click();

    const topic = body.locator('.rss-research-topic');
    await expect(topic).toHaveCount(1, { timeout: 15000 });
    await expect(topic.locator('.rss-research-topic-api')).toContainText(
      'GET http://127.0.0.1:4527/api/research-topics/'
    );
    await expect(topic.locator('.rss-research-topic-api')).toContainText('/articles');
  });

  test('adds a feed by URL, shows its scrape status, and removes it', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await component.evaluate((el) => el.openResearchTopicsModal());

    const body = page.locator('.rss-modal-dialog--full .rss-modal-body');
    await expect(body).toBeVisible();

    await body.locator('.rss-research-create-name').fill('Scrape Test');
    await body.locator('.rss-research-create-button').click();

    const topic = body.locator('.rss-research-topic');
    await expect(topic).toHaveCount(1, { timeout: 15000 });

    // Add by URL: discovery and parsing run against the stubbed route.
    await topic.locator('.rss-research-add-url').fill(FEED_URL);
    await topic.locator('.rss-research-add-url-button').click();

    const feedItem = topic.locator('.rss-research-feed-item');
    await expect(feedItem).toHaveCount(1, { timeout: 15000 });
    await expect(feedItem.locator('.rss-research-feed-name')).toHaveText('Research Example Feed');
    await expect(feedItem.locator('.rss-research-feed-url')).toHaveText(FEED_URL);
    // Status line: article counts plus the last-update timestamp recorded
    // when the feed was added.
    await expect(feedItem.locator('.rss-research-feed-stats')).toContainText('1/1 unread');
    await expect(feedItem.locator('.rss-research-feed-stats')).toContainText('updated');

    // Removing the feed only detaches it from the topic.
    await feedItem.locator('.rss-research-feed-remove').click();
    await expect(topic.locator('.rss-research-feed-empty')).toBeVisible({ timeout: 15000 });
  });

  test('clears a topic\'s articles while keeping the feed', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await component.evaluate((el) => el.openResearchTopicsModal());

    const body = page.locator('.rss-modal-dialog--full .rss-modal-body');
    await expect(body).toBeVisible();

    await body.locator('.rss-research-create-name').fill('Clearable');
    await body.locator('.rss-research-create-button').click();
    const topic = body.locator('.rss-research-topic');
    await expect(topic).toHaveCount(1, { timeout: 15000 });

    await topic.locator('.rss-research-add-url').fill(FEED_URL);
    await topic.locator('.rss-research-add-url-button').click();
    const feedItem = topic.locator('.rss-research-feed-item');
    await expect(feedItem).toHaveCount(1, { timeout: 15000 });
    await expect(feedItem.locator('.rss-research-feed-stats')).toContainText('1/1 unread');

    // Two-step clear confirmation.
    const clearButton = topic.locator('.rss-research-topic-clear');
    await clearButton.click();
    await expect(clearButton).toHaveText('Confirm Clear');
    await clearButton.click();

    // The feed stays in the topic, but its articles are gone and the
    // status line reflects the empty state.
    await expect(feedItem.locator('.rss-research-feed-stats')).toContainText(
      '0/0 unread',
      { timeout: 15000 }
    );
  });

  test('opens a topic as its own feed-like view', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await component.evaluate((el) => el.openResearchTopicsModal());

    const body = page.locator('.rss-modal-dialog--full .rss-modal-body');
    await expect(body).toBeVisible();

    await body.locator('.rss-research-create-name').fill('Readable Topic');
    await body.locator('.rss-research-create-button').click();
    const topic = body.locator('.rss-research-topic');
    await expect(topic).toHaveCount(1, { timeout: 15000 });

    await topic.locator('.rss-research-add-url').fill(FEED_URL);
    await topic.locator('.rss-research-add-url-button').click();
    await expect(topic.locator('.rss-research-feed-item')).toHaveCount(1, { timeout: 15000 });

    // Open the topic view: the modal closes and the articles render as a
    // standard feed list.
    await topic.locator('.rss-research-topic-view').click();

    const view = page.locator('.rss-topic-view');
    await expect(view).toBeVisible();
    await expect(view.locator('.rss-topic-view-header')).toContainText('Readable Topic');

    const article = view.locator('.rss-timeline-item .rss-article');
    await expect(article).toHaveCount(1, { timeout: 15000 });
    await expect(article.locator('.rss-article-title')).toContainText('Hello Article');

    // Opening the article uses the standard viewer (extraction is routed).
    await article.locator('[data-action="open-article"]').first().click();
    await expect(page.locator('.rss-article-viewer-overlay')).toBeVisible({ timeout: 15000 });
  });

  test('deletes a topic through the two-step confirmation', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await component.evaluate((el) => el.openResearchTopicsModal());

    const body = page.locator('.rss-modal-dialog--full .rss-modal-body');
    await expect(body).toBeVisible();

    await body.locator('.rss-research-create-name').fill('Doomed Topic');
    await body.locator('.rss-research-create-button').click();

    const topic = body.locator('.rss-research-topic');
    await expect(topic).toHaveCount(1, { timeout: 15000 });

    // First click arms the button, second click deletes.
    const deleteButton = topic.locator('.rss-research-topic-delete');
    await deleteButton.click();
    await expect(deleteButton).toHaveText('Confirm Delete');
    await deleteButton.click();

    await expect(body.locator('.rss-research-empty')).toHaveText(
      'No research topics yet. Create one above.',
      { timeout: 15000 }
    );
  });
});
