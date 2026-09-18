/**
 * Feed Name Jump E2E Tests
 *
 * Clicking a blog's name in the Timeline ("feed mode") must switch to
 * the grouped Feeds view ("feed name mode", all feeds separated by
 * name) and scroll straight to that feed's block.
 */

import { test, expect } from '@playwright/test';

/**
 * Seed two feeds with several unread articles each and render the
 * Timeline view.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function seedTimeline(page) {
  const component = page.locator('rss-feed-component');
  await expect(component).toHaveJSProperty('initialized', true);
  await component.evaluate((el) => {
    el.viewMode = 'timeline';
    el._syncViewToggle();
    el.feeds = [
      {
        feedID: 'feed-1',
        name: 'Alpha Blog',
        articles: [
          {
            articleID: 'a1',
            title: 'Alpha newest',
            datePublished: new Date('2026-01-05T00:00:00Z'),
            read: false,
            authors: [],
            tags: [],
          },
          {
            articleID: 'a2',
            title: 'Alpha older',
            datePublished: new Date('2026-01-01T00:00:00Z'),
            read: false,
            authors: [],
            tags: [],
          },
        ],
      },
      {
        feedID: 'feed-2',
        name: 'Beta Blog',
        articles: [
          {
            articleID: 'b1',
            title: 'Beta newest',
            datePublished: new Date('2026-01-06T00:00:00Z'),
            read: false,
            authors: [],
            tags: [],
          },
        ],
      },
      {
        feedID: 'feed-3',
        name: 'Gamma Blog',
        articles: [],
      },
    ];
    el.settings = { maxArticlesPerFeed: 50 };
    el.renderFeeds();
  });
}

test.describe('feed name jump from timeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await seedTimeline(page);
  });

  test('timeline feed names render as clickable links', async ({ page }) => {
    const nameLink = page.locator('.rss-timeline .rss-article-feed-name.rss-feed-name-link', {
      hasText: 'Beta Blog',
    });
    await expect(nameLink).toBeVisible();
    await expect(nameLink).toHaveAttribute('data-action', 'open-feed');
    await expect(nameLink).toHaveAttribute('title', 'Show Beta Blog in Feeds view');
  });

  test('clicking a feed name switches to the feeds view and opens that feed', async ({ page }) => {
    await page
      .locator('.rss-timeline .rss-article-feed-name.rss-feed-name-link', { hasText: 'Beta Blog' })
      .click();

    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('viewMode', 'feeds');

    // The grouped view rendered, and the clicked feed's block exists with
    // its articles visible.
    const betaBlock = page.locator('.rss-feed[data-feed-id="feed-2"]');
    await expect(betaBlock).toBeVisible();
    await expect(betaBlock.locator('.rss-feed-details')).toHaveJSProperty('open', true);
    await expect(betaBlock.locator('.rss-article')).toHaveCount(1);

    // The timeline list is gone.
    await expect(page.locator('.rss-timeline')).toHaveCount(0);
  });

  test('the target feed is scrolled into view', async ({ page }) => {
    // Enough scrollable content that the second feed starts off-screen, with
    // a third feed below it so the target can align to the viewport top.
    const component = page.locator('rss-feed-component');
    await component.evaluate((el) => {
      const filler = [];
      for (let i = 0; i < 40; i++) {
        filler.push({
          articleID: `f${i}`,
          title: `Filler ${i}`,
          datePublished: new Date(Date.UTC(2026, 0, 10 + i)),
          read: false,
          authors: [],
          tags: [],
        });
      }
      el.feeds[0].articles = filler.concat(el.feeds[0].articles);
      const gammaFiller = [];
      for (let i = 0; i < 40; i++) {
        gammaFiller.push({
          articleID: `g${i}`,
          title: `Gamma filler ${i}`,
          datePublished: new Date(Date.UTC(2026, 1, 10 + i)),
          read: false,
          authors: [],
          tags: [],
        });
      }
      el.feeds[2].articles = gammaFiller;
      el.renderFeeds();
    });

    await page
      .locator('.rss-timeline .rss-article-feed-name.rss-feed-name-link', { hasText: 'Beta Blog' })
      .click();

    const betaBlock = page.locator('.rss-feed[data-feed-id="feed-2"]');
    await expect(betaBlock).toBeVisible();

    // scrollIntoView is smooth; poll until the block's top sits within
    // the viewport (allowing the sticky header's overlap).
    await expect
      .poll(async () => {
        return betaBlock.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top >= -60 && rect.top < window.innerHeight / 2;
        });
      })
      .toBe(true);

    // The view actually jumped down from the top of the timeline.
    const scrollTop = await page.evaluate(() =>
      Math.round(document.scrollingElement.scrollTop)
    );
    expect(scrollTop).toBeGreaterThan(1000);
  });
});
