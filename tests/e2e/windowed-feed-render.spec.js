/**
 * Windowed feed rendering E2E Tests
 *
 * The feed views only render a bounded number of article rows at a time
 * and adjust the window as the user scrolls, so very large feeds stay
 * responsive. These specs seed datasets that are far larger than the
 * render window and assert that the DOM stays bounded while scrolling
 * still reaches every item.
 */

import { test, expect } from '@playwright/test';

const ARTICLES_PER_FEED = 100;

/**
 * Seed the component with count feeds of unread articles, each article
 * dated so the timeline ordering is deterministic.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} count - Number of feeds to seed.
 * @param {number} articlesPerFeed - Unread articles per feed.
 * @returns {Promise<number>} Total unread article count.
 */
async function seedFeeds(page, count, articlesPerFeed = ARTICLES_PER_FEED) {
  return page.evaluate(
    ({ count, articlesPerFeed }) => {
      const component = document.querySelector('rss-feed-component');
      component.settings = { ...component.settings, maxArticlesPerFeed: 200 };
      component.feeds = Array.from({ length: count }, (_, feedIndex) => ({
        feedID: `feed-${feedIndex + 1}`,
        name: `Feed ${feedIndex + 1}`,
        articles: Array.from({ length: articlesPerFeed }, (_, articleIndex) => ({
          articleID: `feed-${feedIndex + 1}-a-${articleIndex + 1}`,
          title: `Feed ${feedIndex + 1} article ${articleIndex + 1}`,
          datePublished: new Date(
            Date.UTC(2024, 0, 1, feedIndex, articleIndex)
          ).toISOString(),
          read: false,
          authors: [],
          tags: [],
        })),
      }));
      component.renderFeeds();
      return component.feeds.reduce(
        (total, feed) => total + feed.articles.length,
        0
      );
    },
    { count, articlesPerFeed }
  );
}

/**
 * Scroll the page to the end of the rendered content. One call issues
 * one scroll event, which the windowed renderers answer with a bounded
 * extension chunk — callers poll to keep scrolling further.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function scrollToEnd(page) {
  await page.evaluate(() => {
    const scroller = document.scrollingElement || document.documentElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
}

test.describe('Windowed feed rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
  });

  test('timeline renders a bounded window first and extends on scroll', async ({
    page,
  }) => {
    const component = page.locator('rss-feed-component');
    const total = await seedFeeds(page, 4);

    // The initial window is far smaller than the full item list.
    const initial = await page.locator('.rss-timeline .rss-article').count();
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(total);

    // Scrolling towards the end renders more items without ever
    // building the whole list at once. Each pass scrolls to the end of
    // the rendered content, mimicking a user repeatedly scrolling down;
    // every scroll event extends the window by a bounded chunk.
    await expect
      .poll(
        async () => {
          await scrollToEnd(page);
          return page.evaluate(() => {
            const component = document.querySelector('rss-feed-component');
            return component._flatWindow ? component._flatWindow.end : 0;
          });
        },
        { timeout: 15000 }
      )
      .toBe(total);

    const renderedAtEnd = await page.locator('.rss-timeline .rss-article').count();
    expect(renderedAtEnd).toBeGreaterThan(initial);
    // Trim keeps the DOM bounded: far fewer rows than the full list.
    expect(renderedAtEnd).toBeLessThan(total);
  });

  test('timeline selection extends the window when navigating past the rendered end', async ({
    page,
  }) => {
    const component = page.locator('rss-feed-component');
    const total = await seedFeeds(page, 3);

    const result = await component.evaluate((el) => {
      const articles = el._getVisibleArticles();
      const last = articles[articles.length - 1];
      el._selectedArticle = { feedID: last.feedID, articleID: last.articleID };
      el._restoreSelection();

      const before = el._getVisibleArticles().length;
      el._selectNextArticle();
      return {
        before,
        after: el._getVisibleArticles().length,
        selected: el._selectedArticle,
      };
    });

    expect(result.before).toBeLessThan(total);
    expect(result.after).toBeGreaterThan(result.before);
    expect(result.selected).toBeTruthy();
  });

  test('grouped feeds view defers feeds beyond the budget and renders them on open', async ({
    page,
  }) => {
    const component = page.locator('rss-feed-component');
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });

    // 20 feeds x 30 articles = 600 rows; the up-front budget renders a
    // bounded subset and defers the rest.
    await seedFeeds(page, 20, 30);

    const detailsCount = await page.locator('.rss-feed-details').count();
    expect(detailsCount).toBe(20);

    const renderedCount = await page.locator('.rss-feed .rss-article').count();
    expect(renderedCount).toBeGreaterThan(0);
    expect(renderedCount).toBeLessThan(600);

    // Feeds beyond the budget are collapsed with no rendered rows.
    const deferred = await component.evaluate((el) => {
      const plan = el._groupedRender;
      const feedID = [...plan.deferredFeedIDs][0];
      const details = el.querySelector(
        `.rss-feed[data-feed-id="${feedID}"] .rss-feed-details`
      );
      return {
        feedID,
        open: details?.open ?? null,
        rows: el.querySelectorAll(
          `.rss-feed[data-feed-id="${feedID}"] .rss-article`
        ).length,
      };
    });
    expect(deferred.feedID).toBeTruthy();
    expect(deferred.open).toBe(false);
    expect(deferred.rows).toBe(0);

    // Expanding a deferred feed renders its first rows on demand.
    await page.locator(`.rss-feed[data-feed-id="${deferred.feedID}"] summary`).click();

    await expect
      .poll(
        async () =>
          page.evaluate((feedID) => {
            const component = document.querySelector('rss-feed-component');
            return component.querySelectorAll(
              `.rss-feed[data-feed-id="${feedID}"] .rss-article`
            ).length;
          }, deferred.feedID),
        { timeout: 15000 }
      )
      .toBeGreaterThan(0);

    const openedState = await page.evaluate((feedID) => {
      const details = document
        .querySelector('rss-feed-component')
        .querySelector(
          `.rss-feed[data-feed-id="${feedID}"] .rss-feed-details`
        );
      return details?.open ?? false;
    }, deferred.feedID);
    expect(openedState).toBe(true);
  });

  test('grouped feeds view extends a partially rendered open feed on scroll', async ({
    page,
  }) => {
    const component = page.locator('rss-feed-component');
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });

    // One feed with more articles than the per-feed chunk.
    await page.evaluate(() => {
      const component = document.querySelector('rss-feed-component');
      component.settings = { ...component.settings, maxArticlesPerFeed: 200 };
      component.feeds = [
        {
          feedID: 'feed-big',
          name: 'Big Feed',
          articles: Array.from({ length: 120 }, (_, i) => ({
            articleID: `big-a-${i + 1}`,
            title: `Big feed article ${i + 1}`,
            datePublished: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
            read: false,
            authors: [],
            tags: [],
          })),
        },
      ];
      component.renderFeeds();
    });

    // The feed renders its first chunk, not all 120 rows.
    const initial = await page.locator('.rss-feed .rss-article').count();
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(120);

    // Scroll near the feed's rendered end; each scroll event extends it
    // by one bounded chunk until the whole feed is rendered.
    await expect
      .poll(
        async () => {
          await scrollToEnd(page);
          return page.locator('.rss-feed .rss-article').count();
        },
        { timeout: 15000 }
      )
      .toBe(120);
  });
});
