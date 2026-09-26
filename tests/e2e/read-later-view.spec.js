/**
 * Read Later View E2E Tests
 *
 * The Read Later archive is a view with a footer button next to the
 * Videos button, plus a "Read Later" action in every article's actions
 * and in the article viewer header. Flagging an article files it in the
 * archive regardless of read state; the footer button carries an unread
 * badge; removing an article from the archive never touches its read
 * state.
 *
 * Data is seeded through the app's own pipeline (addFeedInBackground
 * against a routed feed URL) so the view reads persisted database rows,
 * mirroring tests/e2e/download-marks-read.spec.js.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Read Later Feed</title>',
  '<link>https://read-later.example.com/</link>',
  '<description>test</description>',
  '<item><title>Later Article One</title>',
  '<link>https://read-later.example.com/posts/1</link>',
  '<guid>read-later-1</guid><pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate></item>',
  '<item><title>Later Article Two</title>',
  '<link>https://read-later.example.com/posts/2</link>',
  '<guid>read-later-2</guid><pubDate>Sun, 01 Feb 2026 00:00:00 GMT</pubDate></item>',
  '</channel></rss>',
].join('');

test.describe('read later view', () => {
  // The seeded feed lives on a routed example.com origin; the dev
  // server's CSP (connect-src 'self') would block fetching it.
  test.use({ bypassCSP: true });

  async function seedFeed(page) {
    await page.route('https://read-later.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: FEED_XML,
      });
    });

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });
    await component.evaluate((el) =>
      el.addFeedInBackground('https://read-later.example.com/feed.xml')
    );
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
    return component;
  }

  async function openReadLaterView(page) {
    await page.locator('.rss-view-toggle-option--read-later .rss-view-toggle-option-label').click();
    const view = page.locator('.rss-read-later-view');
    await expect(view).toBeVisible();
    return view;
  }

  test('the Read Later button files an article into the archive view', async ({ page }) => {
    test.setTimeout(60000);
    const component = await seedFeed(page);

    // Every article row carries the Read Later action, initially unflagged.
    const article = page.locator('.rss-article', { hasText: 'Later Article Two' });
    const rowButton = article.locator('[data-action="toggle-read-later"]');
    await expect(rowButton).toHaveText('Read Later');

    await rowButton.click();
    // Flagging confirms in place and lights the footer unread badge; the
    // article itself keeps its place in the main list.
    await expect(rowButton).toHaveText('Saved ✓');
    await expect(component.locator('.rss-read-later-badge')).toHaveText('1');

    // The footer Read Later button opens the archive view.
    const view = await openReadLaterView(page);
    await expect(view.locator('.rss-read-later-view-count')).toHaveText('1 article');
    await expect(
      view.locator('.rss-read-later-view-item', { hasText: 'Later Article Two' })
    ).toHaveCount(1);
    await expect(
      view.locator('.rss-read-later-view-item', { hasText: 'Later Article One' })
    ).toHaveCount(0);

    // The read-later radio is checked while the view is active.
    await expect(component.locator('.rss-view-toggle-input[value="read-later"]')).toBeChecked();
  });

  test('the archive keeps read articles and the badge tracks unread ones', async ({ page }) => {
    test.setTimeout(60000);
    const component = await seedFeed(page);

    const article = page.locator('.rss-article', { hasText: 'Later Article One' });
    await article.locator('[data-action="toggle-read-later"]').click();
    await expect(article.locator('[data-action="toggle-read-later"]')).toHaveText('Saved ✓');

    // Reading the article (opening it) must not drop it from the archive.
    await article.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await page.locator('.rss-article-viewer-close').click();
    await expect(viewer).toBeHidden();

    // The unread badge cleared (the flagged article is now read) but the
    // archive still lists it — read state is irrelevant to membership.
    await expect(component.locator('.rss-read-later-badge')).toBeHidden();

    const view = await openReadLaterView(page);
    await expect(
      view.locator('.rss-read-later-view-item', { hasText: 'Later Article One' })
    ).toHaveCount(1);
  });

  test('the article viewer header carries the Read Later action', async ({ page }) => {
    test.setTimeout(60000);
    await seedFeed(page);

    await page
      .locator('.rss-article', { hasText: 'Later Article One' })
      .locator('.rss-article-title strong')
      .click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const headerButton = viewer.locator('.rss-read-later-viewer-button');
    await expect(headerButton).toHaveText('Read Later');
    await headerButton.click();
    await expect(headerButton).toHaveText('Saved ✓');

    await page.locator('.rss-article-viewer-close').click();
    await expect(viewer).toBeHidden();

    const view = await openReadLaterView(page);
    await expect(view.locator('.rss-read-later-view-item')).toHaveCount(1);
  });

  test('removing from the archive drops the row without touching read state', async ({ page }) => {
    test.setTimeout(60000);
    const component = await seedFeed(page);

    // Archive both articles; they list newest publication first.
    for (const title of ['Later Article One', 'Later Article Two']) {
      await page
        .locator('.rss-article', { hasText: title })
        .locator('[data-action="toggle-read-later"]')
        .click();
    }

    const view = await openReadLaterView(page);
    await expect(view.locator('.rss-read-later-view-count')).toHaveText('2 articles');
    await expect(view.locator('.rss-read-later-view-item .rss-article-title').first())
      .toContainText('Later Article Two');

    // Remove the first row via its own Saved ✓ action.
    await view
      .locator('.rss-read-later-view-item', { hasText: 'Later Article Two' })
      .locator('[data-action="toggle-read-later"]')
      .click();

    // The row disappears and the header count updates.
    await expect(
      view.locator('.rss-read-later-view-item', { hasText: 'Later Article Two' })
    ).toHaveCount(0);
    await expect(view.locator('.rss-read-later-view-count')).toHaveText('1 article');
    await expect(component.locator('.rss-read-later-badge')).toHaveText('1');

    // Remove the last one: the archive empties into its empty state.
    await view
      .locator('.rss-read-later-view-item', { hasText: 'Later Article One' })
      .locator('[data-action="toggle-read-later"]')
      .click();
    await expect(view.locator('.rss-no-articles')).toHaveText('Nothing saved for later');
    await expect(component.locator('.rss-read-later-badge')).toBeHidden();

    // Back in the main list both articles keep their pre-archive state:
    // they were unread all along and remain unread.
    await page.locator('.rss-view-toggle-option--feeds .rss-view-toggle-option-label').click();
    await expect(
      page.locator('.rss-article', { hasText: 'Later Article Two' })
        .locator('[data-action="mark-read"]')
    ).toHaveText('Mark Read');
  });

  test('an untouched archive shows the empty state', async ({ page }) => {
    await seedFeed(page);

    const view = await openReadLaterView(page);
    await expect(view.locator('.rss-no-articles')).toHaveText('Nothing saved for later');
  });
});
