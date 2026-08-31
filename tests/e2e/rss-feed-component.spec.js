/**
 * RSS Feed Component E2E Tests
 *
 * Smoke tests for the Aaron RSS app UI. Because feed fetching and the
 * File System Access API depend on network/native dialogs, these tests
 * focus on the static chrome: the hamburger menu opens and contains the
 * expected actions.
 */

import { test, expect } from '@playwright/test';

test.describe('Aaron RSS', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // The Timeline view is the app default; most of these specs exercise
    // the grouped Feeds view, so opt out explicitly before seeding data.
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      if (el.viewToggleInput) {
        el.viewToggleInput.checked = false;
        el._updateViewToggleText();
      }
    });
  });

  test('renders the hamburger menu in the header', async ({ page }) => {
    await expect(page.locator('rss-feed-component')).toBeVisible();
    await expect(page.locator('.rss-hamburger')).toBeVisible();
  });

  test('renders an unread article count in the upper left', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          articles: [
            { articleID: 'a1', title: 'Read post', read: true },
            { articleID: 'a2', title: 'Unread post', read: false },
            { articleID: 'a3', title: 'Another unread', read: false },
          ],
        },
        {
          feedID: 'feed-2',
          url: 'https://other.example.com/feed.xml',
          name: 'Other Feed',
          articles: [
            { articleID: 'a4', title: 'Unread in other', read: false },
          ],
        },
      ];
      el.renderFeeds();
    });

    const badge = page.locator('.rss-header .rss-unread-count');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('3');
    await expect(badge).toHaveAttribute('aria-label', '3 unread articles');
  });

  test('renders a Refresh All Feeds button in the lower left', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    const refreshButton = page.locator('.rss-footer .rss-refresh-all-button');
    await expect(refreshButton).toBeVisible();
    await expect(refreshButton).toHaveText('↻');
    await expect(refreshButton).toHaveAttribute('title', 'Refresh all feeds');
  });

  test('renders an Add RSS Feed button next to Refresh All Feeds', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    const addButton = page.locator('.rss-footer .rss-add-feed-button');
    await expect(addButton).toBeVisible();
    await expect(addButton).toHaveText('⊕');
    await expect(addButton).toHaveAttribute('title', 'Add RSS feed');
  });

  test('renders a view toggle switch at the bottom left before the action buttons', async ({ page }) => {
    // Reload so we observe the untouched default state; the suite-wide
    // beforeEach opts other tests out of the timeline default.
    await page.goto('/');
    await expect(page.locator('rss-feed-component')).toHaveJSProperty('initialized', true);

    const toggle = page.locator('.rss-footer .rss-view-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle.locator('.rss-view-toggle-input')).toBeChecked();
    await expect(toggle.locator('.rss-view-toggle-text')).toHaveText('◴');
    await expect(toggle.locator('.rss-view-toggle-text')).toHaveAttribute('title', 'Timeline view');

    // The switch sits to the left of Refresh All / Add Feed in the footer.
    const order = await page.evaluate(() => {
      const children = Array.from(document.querySelector('.rss-footer').children);
      return children.map((el) => el.className);
    });
    expect(order[0]).toContain('rss-view-toggle');
    expect(order).toContain('rss-refresh-all-button');
    expect(order).toContain('rss-add-feed-button');
  });

  test('timeline is the default view and orders articles by publication date across feeds', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    // Re-enable the default timeline mode (beforeEach opts into feeds).
    await component.evaluate((el) => {
      el.viewMode = 'timeline';
      if (el.viewToggleInput) {
        el.viewToggleInput.checked = true;
        el._updateViewToggleText();
      }
    });

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          name: 'Older Feed',
          articles: [
            {
              articleID: 'old-1',
              title: 'Oldest Article',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              read: false,
              authors: [],
              tags: [],
            },
          ],
        },
        {
          feedID: 'feed-2',
          name: 'Newer Feed',
          articles: [
            {
              articleID: 'new-1',
              title: 'Newest Article',
              datePublished: new Date('2024-06-01T00:00:00Z'),
              read: false,
              authors: [],
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    const timeline = page.locator('.rss-timeline');
    await expect(timeline).toBeVisible();
    await expect(page.locator('.rss-timeline .rss-article')).toHaveCount(2);

    // Items are ordered purely by post time, not by feed.
    const titles = await page.locator('.rss-timeline .rss-article-title').allInnerTexts();
    expect(titles[0]).toContain('Newest Article');
    expect(titles[1]).toContain('Oldest Article');

    // Each timeline entry shows its source feed name.
    const feedNames = await page.locator('.rss-timeline .rss-article-feed-name').allInnerTexts();
    expect(feedNames).toEqual(['Newer Feed', 'Older Feed']);
  });

  test('shows a centered spinner in timeline view while refreshing and empty', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    await component.evaluate((el) => {
      el.viewMode = 'timeline';
      el.feeds = [];
      el.isRefreshing = true;
      el.renderTimeline();
    });

    const spinner = page.locator('.rss-content-area .rss-spinner');
    await expect(spinner).toBeVisible();

    await component.evaluate((el) => {
      el.isRefreshing = false;
      el.renderTimeline();
    });

    await expect(spinner).toHaveCount(0);
    await expect(page.locator('.rss-content-area .rss-empty-state')).toBeVisible();
  });

  test('flipping the view toggle switches between timeline and grouped feeds views', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          name: 'Example Feed',
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              read: false,
              authors: [],
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await component.evaluate((el) => {
      el.viewMode = 'timeline';
      el._syncViewToggle();
      el.renderFeeds();
    });
    await expect(page.locator('.rss-timeline')).toBeVisible();
    await expect(page.locator('.rss-feed')).toHaveCount(0);

    await page.locator('.rss-footer .rss-view-toggle').click();

    await expect(page.locator('.rss-timeline')).toHaveCount(0);
    await expect(page.locator('.rss-feed')).toBeVisible();
    await expect(page.locator('.rss-footer .rss-view-toggle-text')).toHaveText('▤');
    await expect(page.locator('.rss-footer .rss-view-toggle-text')).toHaveAttribute('title', 'Feeds view');
  });

  test('keyboard navigation selects articles in the timeline view', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    await component.evaluate((el) => {
      el.viewMode = 'timeline';
      el.feeds = [
        {
          feedID: 'feed-1',
          name: 'Feed One',
          articles: [
            { articleID: 'a1', title: 'First', datePublished: new Date('2024-02-01T00:00:00Z'), read: false, authors: [], tags: [] },
            { articleID: 'a3', title: 'Third', datePublished: new Date('2024-01-01T00:00:00Z'), read: false, authors: [], tags: [] },
          ],
        },
        {
          feedID: 'feed-2',
          name: 'Feed Two',
          articles: [
            { articleID: 'b2', title: 'Second', datePublished: new Date('2024-01-15T00:00:00Z'), read: false, authors: [], tags: [] },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    // The first article chronologically ('a1') auto-selects; ArrowDown moves
    // to the second-newest item across feeds ('b2').
    await page.keyboard.press('ArrowDown');

    const selectedID = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedID).toBe('b2');
  });

  test('clicking the footer Add RSS Feed button opens the add feed modal', async ({ page }) => {
    await page.locator('.rss-footer .rss-add-feed-button').click();

    const modal = page.locator('.rss-modal-dialog');
    await expect(modal).toBeVisible();
    await expect(modal.locator('h2')).toHaveText('Add RSS Feed');
    await expect(modal.locator('input[type="url"]')).toBeVisible();
  });

  test('hamburger menu opens the command panel and focuses the search input', async ({ page }) => {
    await page.locator('.rss-hamburger').click();

    const dialog = page.locator('command-panel dialog');
    await expect(dialog).toBeVisible();

    const focused = await page.evaluate(() => {
      const panel = document.querySelector('command-panel');
      return document.activeElement === panel.searchInput;
    });
    expect(focused).toBe(true);
  });

  test('command panel shows all expected actions', async ({ page }) => {
    await page.locator('.rss-hamburger').click();

    const dialog = page.locator('command-panel dialog');
    await expect(dialog).toBeVisible();

    await expect(page.locator('command-panel .command-name')).toHaveText([
      'Add RSS Feed',
      'Manage Feeds',
      'Refresh All Feeds',
      'Mark All Read',
      'Settings',
      'Export OPML',
      'Import OPML',
      'Help',
    ]);
  });

  test('clicking Help in the command panel opens the help page', async ({ page }) => {
    await page.evaluate(() => {
      window.__helpOpened = null;
      window.__originalOpen = window.open;
      window.open = (url) => {
        window.__helpOpened = url;
        return null;
      };
    });

    await page.locator('.rss-hamburger').click();
    await page.locator('command-panel .command-item', { hasText: 'Help' }).click();

    const openedUrl = await page.evaluate(() => window.__helpOpened);
    expect(openedUrl).toBe('/help.html');

    await page.evaluate((originalOpen) => {
      window.open = originalOpen;
    }, await page.evaluate(() => window.__originalOpen));
  });

  test('command panel stays on top when feed articles are expanded', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-hamburger').click();

    const dialog = page.locator('command-panel dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeInViewport();
    await expect(dialog).toHaveCSS('z-index', '1000');

    const topElement = await page.evaluate(() => {
      const dialog = document.querySelector('command-panel dialog');
      const rect = dialog.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return document.elementFromPoint(x, y)?.closest('command-panel dialog') === dialog;
    });
    expect(topElement).toBe(true);
  });

  test('keyboard shortcut opens the command panel', async ({ page }) => {
    await page.keyboard.press('Control+Shift+p');

    const dialog = page.locator('command-panel dialog');
    await expect(dialog).toBeVisible();

    const focused = await page.evaluate(() => {
      const panel = document.querySelector('command-panel');
      return document.activeElement === panel.searchInput;
    });
    expect(focused).toBe(true);

    // Close so the next shortcut test starts from a clean state.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('Cmd+P / Ctrl+P opens the command panel', async ({ page }) => {
    // Meta+P is the macOS binding; Playwright maps Meta to the platform
    // modifier. Press both variants to cover the Ctrl path too.
    await page.keyboard.press('Control+p');
    const dialog = page.locator('command-panel dialog');
    await expect(dialog).toBeVisible();

    const focused = await page.evaluate(() => {
      const panel = document.querySelector('command-panel');
      return document.activeElement === panel.searchInput;
    });
    expect(focused).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.keyboard.press('Meta+p');
    await expect(dialog).toBeVisible();
  });

  test('command panel stays on top when the article viewer is open', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-article-title strong').click();

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    await page.keyboard.press('Control+Shift+p');

    const dialog = page.locator('command-panel dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeInViewport();
    await expect(dialog).toHaveCSS('z-index', '1000');

    const topElement = await page.evaluate(() => {
      const dialog = document.querySelector('command-panel dialog');
      const rect = dialog.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return document.elementFromPoint(x, y)?.closest('command-panel dialog') === dialog;
    });
    expect(topElement).toBe(true);
  });

  test('pressing Escape with the command panel over the article viewer closes only the panel', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.createArticleViewer(
        { title: 'Command Panel Escape Test Article', url: 'https://example.com/post' },
        { name: 'Example Feed' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    await page.keyboard.press('Control+Shift+p');

    const dialog = page.locator('command-panel dialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(viewer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(viewer).not.toBeVisible();
  });

  test('clicking Add RSS Feed opens the add feed modal', async ({ page }) => {
    await page.locator('.rss-hamburger').click();
    await page.locator('command-panel .command-item', { hasText: 'Add RSS Feed' }).click();

    const modal = page.locator('.rss-modal-dialog');
    await expect(modal).toBeVisible();
    await expect(modal.locator('h2')).toHaveText('Add RSS Feed');
    await expect(modal.locator('input[type="url"]')).toBeVisible();
  });

  test('clicking Settings opens the full-page settings modal', async ({ page }) => {
    await page.locator('.rss-hamburger').click();
    await page.locator('command-panel .command-item', { hasText: 'Settings' }).click();

    const modal = page.locator('.rss-modal-dialog');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveClass(/rss-modal-dialog--full/);
    await expect(modal.locator('h2')).toHaveText('Settings');
    await expect(modal.locator('input[type="number"]').first()).toBeVisible();

    const closeButton = modal.locator('.rss-modal-close');
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(modal).not.toBeVisible();
  });

  test('settings modal has theme CSS editor and download/upload/reset buttons', async ({ page }) => {
    await page.locator('.rss-hamburger').click();
    await page.locator('command-panel .command-item', { hasText: 'Settings' }).click();

    const modal = page.locator('.rss-modal-dialog--full');
    await expect(modal.locator('.rss-theme-textarea')).toBeVisible();
    await expect(modal.locator('button', { hasText: 'Download theme.css' })).toBeVisible();
    await expect(modal.locator('button', { hasText: 'Upload theme.css' })).toBeVisible();
    await expect(modal.locator('button', { hasText: 'Reset Theme' })).toBeVisible();
  });

  test('settings modal has an auto-refresh interval input defaulting to 5 minutes', async ({ page }) => {
    await page.locator('.rss-hamburger').click();
    await page.locator('command-panel .command-item', { hasText: 'Settings' }).click();

    const input = page.locator('.rss-refresh-interval-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('5');
    await expect(input).toHaveAttribute('min', '0');
    await expect(input).toHaveAttribute('max', '1440');
  });

  test('auto-refresh pauses while the page is hidden', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    const result = await component.evaluate(async (el) => {
      // Simulate a hidden page (minimized window / other tab).
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });

      let refreshCalls = 0;
      el.handleRefreshAll = async () => {
        refreshCalls += 1;
      };

      try {
        await el._runAutoRefresh();
        return { refreshCalls, rescheduled: el._refreshTimer !== null };
      } finally {
        delete document.visibilityState;
        delete el.handleRefreshAll;
        el._stopAutoRefresh();
        el._scheduleAutoRefresh();
      }
    });

    expect(result.refreshCalls).toBe(1);
    expect(result.rescheduled).toBe(false);
  });

  test('hiding the page cancels the background refresh timer', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    const hasTimer = await component.evaluate((el) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });

      try {
        document.dispatchEvent(new Event('visibilitychange'));
        return el._refreshTimer !== null;
      } finally {
        delete document.visibilityState;
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });

    expect(hasTimer).toBe(false);
  });


  test('applyTheme injects custom CSS into the document head', async ({ page }) => {
    await page.evaluate(() => {
      const component = document.querySelector('rss-feed-component');
      component.settings.theme = ':root { --background-color: rgb(255, 0, 0); }';
      component.applyTheme();
    });

    const style = page.locator('style#user-theme-style');
    await expect(style).toHaveCount(1);
    const css = await style.evaluate((el) => el.textContent);
    expect(css).toBe(':root { --background-color: rgb(255, 0, 0); }');
  });

  test('applyTheme removes the injected style when the theme is cleared', async ({ page }) => {
    await page.evaluate(() => {
      const component = document.querySelector('rss-feed-component');
      component.settings.theme = ':root { --background-color: rgb(0, 0, 255); }';
      component.applyTheme();
      component.settings.theme = '';
      component.applyTheme();
    });

    await expect(page.locator('style#user-theme-style')).toHaveCount(0);
  });

  test('article actions include Read and Export Markdown', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    const article = page.locator('.rss-article');
    await expect(article).toBeVisible();

    await expect(article.locator('.rss-action-button')).toHaveText([
      'Mark Read',
      'Star',
      'Read',
      'Export Markdown',
      'Save to File',
    ]);
  });

  test('feed summary title toggles details instead of linking to website', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    const details = page.locator('.rss-feed-details');
    await expect(details).toHaveAttribute('open', '');

    const title = page.locator('.rss-feed-title');
    await expect(title).toHaveText('Example Feed');
    await expect(title).toHaveJSProperty('tagName', 'SPAN');

    await title.click();
    await expect(details).not.toHaveAttribute('open', '');

    await title.click();
    await expect(details).toHaveAttribute('open', '');
  });

  test('feed kebab menu includes Visit Website when homePageURL exists', async ({ page, context }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-kebab-button').click();

    const menu = page.locator('.rss-kebab-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.rss-menu-item')).toHaveText([
      'Mark All Read',
      'Refresh',
      'Mark All Unread',
      'Open Original by Default',
      'Visit Website',
      'Delete',
    ]);

    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      menu.locator('.rss-menu-item', { hasText: 'Visit Website' }).click(),
    ]);
    await expect(newPage).toHaveURL('https://example.com/');
    await newPage.close();
  });

  test('feed kebab menu has an Open Original by Default checkbox', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-kebab-button').click();

    const menu = page.locator('.rss-kebab-menu');
    await expect(menu).toBeVisible();

    const checkboxItem = menu.locator('.rss-menu-item-checkbox', { hasText: 'Open Original by Default' });
    await expect(checkboxItem).toBeVisible();

    const checkbox = checkboxItem.locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();

    await checkboxItem.click();
    await expect(checkbox).toBeChecked();

    const isEnabled = await component.evaluate((el) => el.feeds[0].openOriginalByDefault);
    expect(isEnabled).toBe(true);
  });

  test('clicking an article opens original website when feed setting is enabled', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          openOriginalByDefault: true,
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-article-title strong').click();

    const viewer = page.locator('.rss-original-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-original-viewer-header h2')).toHaveText('Sample Article');

    const frame = viewer.locator('.rss-article-viewer-frame');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('src', 'https://example.com/post');
  });

  test('original viewer back button returns to the feed', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          openOriginalByDefault: true,
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-article-title strong').click();

    const viewer = page.locator('.rss-original-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-back')).toHaveText('←');

    await viewer.locator('.rss-article-viewer-back').click();
    await expect(viewer).not.toBeVisible();
  });

  test('original viewer has an Open in Browser button', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await page.evaluate(() => {
      window.__openedExternalUrls = [];
      window.electron = {
        openExternal: async (url) => {
          window.__openedExternalUrls.push(url);
        },
      };
    });

    await component.evaluate((el) => {
      el.openOriginalViewer(
        { title: 'Sample Article', url: 'https://example.com/post' },
        { feedID: 'feed-1', name: 'Example Feed' }
      );
    });

    const viewer = page.locator('.rss-original-viewer-overlay');
    await expect(viewer).toBeVisible();

    const openButton = viewer.locator('button', { hasText: 'Open in Browser' });
    await expect(openButton).toBeVisible();
    await openButton.click();

    const openedUrls = await page.evaluate(() => window.__openedExternalUrls);
    expect(openedUrls).toEqual(['https://example.com/post']);
  });

  test('clicking an article title opens the in-app article viewer', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-article-title strong').click();

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-header h2')).toHaveText('Sample Article');
  });

  test('article viewer has a back button that returns to the feed', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-article-title strong').click();

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-back')).toHaveText('←');

    await viewer.locator('.rss-article-viewer-back').click();
    await expect(viewer).not.toBeVisible();
  });

  test('article viewer locks the page background so only the article scrolls', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    const originalOverflow = await page.evaluate(() => {
      return {
        body: document.body.style.overflow,
        html: document.documentElement.style.overflow,
      };
    });

    await component.evaluate((el) => {
      el.createArticleViewer(
        { title: 'Scroll Test Article', url: 'https://example.com/post' },
        { name: 'Example Feed' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const lockedOverflow = await page.evaluate(() => {
      return {
        body: document.body.style.overflow,
        html: document.documentElement.style.overflow,
      };
    });
    expect(lockedOverflow.body).toBe('hidden');
    expect(lockedOverflow.html).toBe('hidden');

    await viewer.locator('.rss-article-viewer-close').click();
    await expect(viewer).not.toBeVisible();

    const restoredOverflow = await page.evaluate(() => {
      return {
        body: document.body.style.overflow,
        html: document.documentElement.style.overflow,
      };
    });
    expect(restoredOverflow.body).toBe(originalOverflow.body);
    expect(restoredOverflow.html).toBe(originalOverflow.html);
  });

  test('pressing Escape closes the article viewer', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.createArticleViewer(
        { title: 'Escape Test Article', url: 'https://example.com/post' },
        { name: 'Example Feed' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(viewer).not.toBeVisible();
  });

  test('Open Original shows the website in the same window and Escape returns to the feed', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.createArticleViewer(
        { title: 'Original View Test Article', url: 'https://example.com/post' },
        { name: 'Example Feed' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const body = viewer.locator('.rss-article-viewer-body');
    const frame = viewer.locator('.rss-article-viewer-frame');
    await expect(body).toBeVisible();
    await expect(frame).not.toBeVisible();

    await viewer.locator('button', { hasText: 'Open Original' }).click();
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('src', 'https://example.com/post');
    await expect(body).not.toBeVisible();

    await page.keyboard.press('Escape');
    await expect(viewer).not.toBeVisible();
  });

  test('back button closes the viewer even while showing the original site', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.createArticleViewer(
        { title: 'Back Closes Test Article', url: 'https://example.com/post' },
        { name: 'Example Feed' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // Switch to the original-website view; the action toggle flips so the
    // user can still get back to the extracted article.
    await viewer.locator('button', { hasText: 'Open Original' }).click();
    await expect(viewer.locator('.rss-article-viewer-frame')).toBeVisible();
    await expect(viewer.locator('[data-action="open-original"]')).toHaveText('Show Article');

    // Back must close the whole viewer, not just toggle views.
    await viewer.locator('.rss-article-viewer-back').click();
    await expect(viewer).not.toBeVisible();
  });

  test('Open on YouTube button opens the video in the default browser', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await page.evaluate(() => {
      window.__openedExternalUrls = [];
      window.electron = {
        openExternal: async (url) => {
          window.__openedExternalUrls.push(url);
        },
      };
    });

    await component.evaluate((el) => {
      el.openYouTubeViewer(
        { title: 'YouTube Test', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { name: 'YouTube Feed' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const openButton = viewer.locator('button', { hasText: 'Open on YouTube' });
    await expect(openButton).toBeVisible();
    await openButton.click();

    const openedUrls = await page.evaluate(() => window.__openedExternalUrls);
    expect(openedUrls).toEqual(['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  });

  test('relative links in article content resolve against the article URL and open externally', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await page.evaluate(() => {
      window.__externalUrl = null;
      window.__originalOpen = window.open;
      window.open = (url) => {
        window.__externalUrl = url;
        return null;
      };
    });

    const beforeUrl = page.url();

    await component.evaluate((el) => {
      const { body } = el.createArticleViewer(
        { title: 'Relative Link Test Article', url: 'https://example.com/blog/post' },
        { name: 'Example Feed' }
      );
      el.renderArticleViewerContent(
        body,
        { title: 'Relative Link Test Article', url: 'https://example.com/blog/post' },
        { name: 'Example Feed' },
        { markdown: '[Internal page](/about)' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const link = viewer.locator('.rss-markdown-content a');
    await expect(link).toHaveAttribute('href', '/about');
    await link.click();

    // The relative href resolves against the article's own URL, not the
    // app origin, and never navigates the app window.
    const openedUrl = await page.evaluate(() => window.__externalUrl);
    expect(openedUrl).toBe('https://example.com/about');
    expect(page.url()).toBe(beforeUrl);

    await page.evaluate((originalOpen) => {
      window.open = originalOpen;
    }, await page.evaluate(() => window.__originalOpen));
  });

  test('Escape forwarded from the Electron main process closes the article viewer', async ({ page }) => {
    // Simulate the preload bridge before app code loads, capturing the
    // callbacks that electron/main.js invokes when forwarding Escape over
    // IPC (needed because key events inside a cross-origin iframe never
    // reach document-level listeners).
    await page.addInitScript(() => {
      window.__escapeCallbacks = [];
      window.electron = {
        onEscapePressed(callback) {
          window.__escapeCallbacks.push(callback);
        },
      };
    });
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.createArticleViewer(
        { title: 'IPC Escape Test Article', url: 'https://example.com/post' },
        { name: 'Example Feed' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // Deliver the forwarded Escape press as electron/main.js would.
    await page.evaluate(() => {
      for (const callback of window.__escapeCallbacks) {
        callback();
      }
    });
    await expect(viewer).not.toBeVisible();
  });

  test('article viewer Share button copies the original URL to clipboard', async ({ page }) => {
    await page.evaluate(() => {
      window.__copiedText = null;
      navigator.clipboard.writeText = async (text) => {
        window.__copiedText = text;
      };
    });

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.createArticleViewer(
        { title: 'Share Test Article', url: 'https://example.com/share-me' },
        { name: 'Example Feed' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    await viewer.locator('button', { hasText: 'Share' }).click();

    const copied = await page.evaluate(() => window.__copiedText);
    expect(copied).toBe('https://example.com/share-me');

    const toast = page.locator('.rss-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText('Copied URL to clipboard');
  });

  test('original viewer Share button copies the original URL to clipboard', async ({ page }) => {
    await page.evaluate(() => {
      window.__copiedText = null;
      navigator.clipboard.writeText = async (text) => {
        window.__copiedText = text;
      };
    });

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          openOriginalByDefault: true,
          articles: [
            {
              articleID: 'article-1',
              title: 'Sample Article',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-article-title strong').click();

    const viewer = page.locator('.rss-original-viewer-overlay');
    await expect(viewer).toBeVisible();

    await viewer.locator('button', { hasText: 'Share' }).click();

    const copied = await page.evaluate(() => window.__copiedText);
    expect(copied).toBe('https://example.com/post');

    const toast = page.locator('.rss-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText('Copied URL to clipboard');
  });

  test('clicking an external link in article content opens it externally without navigating the app', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await page.evaluate(() => {
      window.__externalUrl = null;
      window.__originalOpen = window.open;
      window.open = (url) => {
        window.__externalUrl = url;
        return null;
      };
    });

    const beforeUrl = page.url();

    await component.evaluate((el) => {
      const { body } = el.createArticleViewer(
        { title: 'Link Test Article', url: 'https://example.com/post' },
        { name: 'Example Feed' }
      );
      el.renderArticleViewerContent(
        body,
        { title: 'Link Test Article', url: 'https://example.com/post' },
        { name: 'Example Feed' },
        { markdown: '[External site](https://example.com/external)' }
      );
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const link = viewer.locator('.rss-markdown-content a');
    await expect(link).toHaveAttribute('href', 'https://example.com/external');
    await link.click();

    const openedUrl = await page.evaluate(() => window.__externalUrl);
    expect(openedUrl).toBe('https://example.com/external');
    expect(page.url()).toBe(beforeUrl);

    await page.evaluate((originalOpen) => {
      window.open = originalOpen;
    }, await page.evaluate(() => window.__originalOpen));
  });

  test('feed order stays stable when unread counts change', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Start in a non-alphabetical, non-unread-count order to prove
    // renderFeeds() preserves the current order instead of re-sorting.
    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-b',
          url: 'https://beta.example.com/feed.xml',
          name: 'Beta Feed',
          homePageURL: 'https://beta.example.com',
          articles: [
            { articleID: 'b-1', title: 'Beta One', read: false, starred: false },
          ],
        },
        {
          feedID: 'feed-a',
          url: 'https://alpha.example.com/feed.xml',
          name: 'Alpha Feed',
          homePageURL: 'https://alpha.example.com',
          articles: [
            { articleID: 'a-1', title: 'Alpha One', read: false, starred: false },
            { articleID: 'a-2', title: 'Alpha Two', read: false, starred: false },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await expect(page.locator('.rss-feed-title')).toHaveText(['Beta Feed', 'Alpha Feed']);

    await component.evaluate((el) => {
      const feed = el.feeds.find((f) => f.feedID === 'feed-a');
      for (const article of feed.articles) {
        article.read = true;
      }
      el.renderFeeds();
    });

    // Order must not change just because unread counts changed.
    await expect(page.locator('.rss-feed-title')).toHaveText(['Beta Feed', 'Alpha Feed']);
  });

  test('Bluesky post renders full text in the feed list', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-bsky',
          url: 'https://bsky.app/profile/alice/rss',
          name: 'Alice',
          homePageURL: 'https://bsky.app/profile/alice',
          articles: [
            {
              articleID: 'bsky-1',
              title: 'Full post text',
              url: 'https://bsky.app/profile/alice/post/3abc',
              contentText: 'Line one\nLine two\n\n[quoted post] Bob: Quoted text',
              summary: 'Line one Line two [quoted post] Bob: Quoted text',
              datePublished: new Date('2026-08-20T12:00:00Z'),
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    const content = page.locator('.rss-article-content');
    await expect(content).toBeVisible();
    await expect(content).toContainText('Line one');
    await expect(content).toContainText('Quoted text');
  });

  test('clicking a Bluesky post opens the social viewer with comments', async ({ page }) => {
    await page.evaluate(() => {
      const handleResponse = JSON.stringify({ did: 'did:plc:alice' });
      const threadResponse = JSON.stringify({
        thread: {
          post: {
            uri: 'at://did:plc:alice/app.bsky.feed.post/3abc',
            author: { handle: 'alice', displayName: 'Alice' },
            indexedAt: '2026-08-20T12:00:00.000Z',
            record: { text: 'Original post text' },
          },
          replies: [
            {
              post: {
                author: { handle: 'bob', displayName: 'Bob' },
                indexedAt: '2026-08-20T13:00:00.000Z',
                record: { text: 'First reply' },
              },
              replies: [],
            },
          ],
        },
      });

      const originalFetch = window.fetch;
      window.fetch = function (url, options) {
        if (typeof url !== 'string' || !url.startsWith('https://public.api.bsky.app')) {
          return originalFetch(url, options);
        }
        if (url.includes('resolveHandle?handle=alice')) {
          return Promise.resolve(new Response(handleResponse, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        if (url.includes('getPostThread')) {
          return Promise.resolve(new Response(threadResponse, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        return originalFetch(url, options);
      };
    });

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-bsky',
          url: 'https://bsky.app/profile/alice/rss',
          name: 'Alice',
          homePageURL: 'https://bsky.app/profile/alice',
          articles: [
            {
              articleID: 'bsky-1',
              title: 'Post',
              url: 'https://bsky.app/profile/alice/post/3abc',
              contentText: 'Original post text',
              summary: 'Original post text',
              datePublished: new Date('2026-08-20T12:00:00Z'),
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-article-title strong').click();

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const body = viewer.locator('.rss-article-viewer-body');
    await expect(body).toContainText('Original post text');
    await expect(body).toContainText('Comments (1)');
    await expect(body).toContainText('First reply');

    const openButton = viewer.locator('button', { hasText: 'Open on Bluesky' });
    await expect(openButton).toBeVisible();
  });

  test('external link cards in a social post open in a new context', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      const article = {
        articleID: 'bsky-card-1',
        title: 'Post',
        url: 'https://bsky.app/profile/alice/post/3card',
        contentText: 'Read this: Example Site',
        summary: 'Read this: Example Site',
        datePublished: new Date('2026-08-20T12:00:00Z'),
        read: false,
        starred: false,
      };
      const feed = {
        feedID: 'feed-bsky-card',
        url: 'https://bsky.app/profile/alice/rss',
        name: 'Alice',
        homePageURL: 'https://bsky.app/profile/alice',
        articles: [article],
      };
      el.feeds = [feed];
      el.settings = { maxArticlesPerFeed: 50 };

      const post = {
        platform: 'bluesky',
        author: 'Alice',
        handle: 'alice.bsky.social',
        date: '2026-08-20T12:00:00.000Z',
        text: 'Read this:',
        media: [
          {
            type: 'external',
            uri: 'https://example.com/article',
            title: 'Example Site',
            description: 'An external website',
            thumb: '',
          },
        ],
      };
      const { overlay, body } = el.createArticleViewer(article, feed);
      el.renderSocialViewerContent(body, post);
      el.appendChild(overlay);
      el.activeModal = overlay;
      el.renderFeeds();
    });

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const card = viewer.locator('.rss-social-link-card[href="https://example.com/article"]');
    await expect(card).toContainText('Example Site');

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      card.click(),
    ]);
    expect(popup.url()).toBe('https://example.com/article');
  });

  test('clicking an external link in feed-list post text does not navigate the app away', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    // Track where openExternalURL is asked to go.
    await component.evaluate((el) => {
      window.__openedUrls = [];
      el.openExternalURL = (url) => {
        window.__openedUrls.push(url);
      };
    });

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-bsky-links',
          url: 'https://bsky.app/profile/alice/rss',
          name: 'Alice',
          homePageURL: 'https://bsky.app/profile/alice',
          articles: [
            {
              articleID: 'bsky-link-1',
              title: 'Post',
              url: 'https://bsky.app/profile/alice/post/3link',
              contentText: 'Check https://example.com/',
              contentHTML:
                '<p>Check <a href="https://example.com/" target="_blank" rel="noopener noreferrer">https://example.com/</a></p>',
              summary: 'Check',
              datePublished: new Date('2026-08-20T12:00:00Z'),
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    const anchor = page.locator('.rss-article-content a[href="https://example.com/"]').first();
    await expect(anchor).toBeVisible();
    await anchor.click();

    await expect.poll(() => component.evaluate((el) => window.__openedUrls)).toEqual([
      'https://example.com/',
    ]);
    // The app itself must still be loaded — no same-window navigation.
    await expect(page).toHaveURL(/localhost:\d+/);
  });

  test('top post is selected when feeds are rendered', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'First Article',
              url: 'https://example.com/post-1',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
            {
              articleID: 'article-2',
              title: 'Second Article',
              url: 'https://example.com/post-2',
              datePublished: new Date('2024-01-02T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    const firstArticle = page.locator('.rss-article').first();
    await expect(firstArticle).toHaveClass(/rss-article-selected/);

    const focused = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return document.activeElement === selected;
    });
    expect(focused).toBe(true);
  });

  test('Escape on the main feed page scrolls to the top and selects the first article', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      const articles = [];
      for (let i = 1; i <= 10; i++) {
        articles.push({
          articleID: `article-${i}`,
          title: `Article ${i}`,
          url: `https://example.com/post-${i}`,
          summary: `Summary for article ${i}.`,
          datePublished: new Date(`2024-01-${String(i).padStart(2, '0')}T00:00:00Z`),
          read: false,
          starred: false,
        });
      }

      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles,
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
      el._selectArticle('feed-1', 'article-5');
    });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    await page.keyboard.press('Escape');

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    const selectedId = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedId).toBe('article-1');
  });

  test('Escape on the main feed page re-sorts feeds by unread count', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-low',
          url: 'https://low.example.com/feed.xml',
          name: 'Low Feed',
          homePageURL: 'https://low.example.com',
          articles: [
            {
              articleID: 'low-1',
              title: 'Low Article',
              url: 'https://low.example.com/post',
              read: false,
              starred: false,
            },
          ],
        },
        {
          feedID: 'feed-high',
          url: 'https://high.example.com/feed.xml',
          name: 'High Feed',
          homePageURL: 'https://high.example.com',
          articles: [
            {
              articleID: 'high-1',
              title: 'High Article 1',
              url: 'https://high.example.com/post-1',
              read: false,
              starred: false,
            },
            {
              articleID: 'high-2',
              title: 'High Article 2',
              url: 'https://high.example.com/post-2',
              read: false,
              starred: false,
            },
            {
              articleID: 'high-3',
              title: 'High Article 3',
              url: 'https://high.example.com/post-3',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.keyboard.press('Escape');

    const titles = await page.locator('.rss-feed-title').allTextContents();
    expect(titles).toEqual(['High Feed', 'Low Feed']);

    const selectedId = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedId).toBe('high-1');
  });

  test('ArrowDown selects the next post', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'First Article',
              url: 'https://example.com/post-1',
              read: false,
              starred: false,
            },
            {
              articleID: 'article-2',
              title: 'Second Article',
              url: 'https://example.com/post-2',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.keyboard.press('ArrowDown');

    const selectedId = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedId).toBe('article-2');
  });

  test('ArrowUp selects the previous post', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'First Article',
              url: 'https://example.com/post-1',
              read: false,
              starred: false,
            },
            {
              articleID: 'article-2',
              title: 'Second Article',
              url: 'https://example.com/post-2',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
      el._selectArticle('feed-1', 'article-2');
    });

    await page.keyboard.press('ArrowUp');

    const selectedId = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedId).toBe('article-1');
  });

  test('Shift+ArrowDown selects the first post of the next feed', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://alpha.example.com/feed.xml',
          name: 'Alpha Feed',
          homePageURL: 'https://alpha.example.com',
          articles: [
            {
              articleID: 'article-a1',
              title: 'Alpha Article',
              url: 'https://alpha.example.com/post',
              read: false,
              starred: false,
            },
          ],
        },
        {
          feedID: 'feed-2',
          url: 'https://beta.example.com/feed.xml',
          name: 'Beta Feed',
          homePageURL: 'https://beta.example.com',
          articles: [
            {
              articleID: 'article-b1',
              title: 'Beta Article',
              url: 'https://beta.example.com/post',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.keyboard.press('Shift+ArrowDown');

    const selectedId = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedId).toBe('article-b1');
  });

  test('Shift+ArrowUp selects the first post of the previous feed', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://alpha.example.com/feed.xml',
          name: 'Alpha Feed',
          homePageURL: 'https://alpha.example.com',
          articles: [
            {
              articleID: 'article-a1',
              title: 'Alpha Article',
              url: 'https://alpha.example.com/post',
              read: false,
              starred: false,
            },
          ],
        },
        {
          feedID: 'feed-2',
          url: 'https://beta.example.com/feed.xml',
          name: 'Beta Feed',
          homePageURL: 'https://beta.example.com',
          articles: [
            {
              articleID: 'article-b1',
              title: 'Beta Article',
              url: 'https://beta.example.com/post',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
      el._selectArticle('feed-2', 'article-b1');
    });

    await page.keyboard.press('Shift+ArrowUp');

    const selectedId = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedId).toBe('article-a1');
  });

  test('Enter opens the selected article viewer', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'First Article',
              url: 'https://example.com/post-1',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();

      // Avoid network extraction in the test.
      el.openArticleViewer = async (article, feed) => {
        const { overlay, body } = el.createArticleViewer(article, feed);
        body.innerHTML = '';
        const content = document.createElement('article');
        content.className = 'rss-markdown-content';
        content.textContent = article.title || 'Test article';
        body.appendChild(content);
      };
    });

    await page.keyboard.press('Enter');

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-header h2')).toHaveText('First Article');
  });

  test('Escape closes the article viewer and selects the next post', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'First Article',
              url: 'https://example.com/post-1',
              read: false,
              starred: false,
            },
            {
              articleID: 'article-2',
              title: 'Second Article',
              url: 'https://example.com/post-2',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();

      // Avoid network extraction in the test.
      el.openArticleViewer = async (article, feed) => {
        const { overlay, body } = el.createArticleViewer(article, feed);
        body.innerHTML = '';
        const content = document.createElement('article');
        content.className = 'rss-markdown-content';
        content.textContent = article.title || 'Test article';
        body.appendChild(content);
      };
    });

    await page.keyboard.press('Enter');

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(viewer).not.toBeVisible();

    const selectedId = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedId).toBe('article-2');
  });

  test('pressing "m" marks the selected article as read and selects the next one', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'First Article',
              url: 'https://example.com/post-1',
              read: false,
              starred: false,
            },
            {
              articleID: 'article-2',
              title: 'Second Article',
              url: 'https://example.com/post-2',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.keyboard.press('m');

    await expect(page.locator('.rss-article')).toHaveCount(1);

    const selectedId = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedId).toBe('article-2');
  });

  test('clicking Mark Read moves the red highlight to the next article', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'First Article',
              url: 'https://example.com/post-1',
              read: false,
              starred: false,
            },
            {
              articleID: 'article-2',
              title: 'Second Article',
              url: 'https://example.com/post-2',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-article', { hasText: 'First Article' }).locator('button', { hasText: 'Mark Read' }).click();

    await expect(page.locator('.rss-article')).toHaveCount(1);

    const selectedId = await page.evaluate(() => {
      const selected = document.querySelector('.rss-article-selected');
      return selected?.getAttribute('data-article-id');
    });
    expect(selectedId).toBe('article-2');
  });

  test('Ctrl+F opens the find bar and focuses the input', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Ensure the page has focus so the keyboard shortcut is delivered.
    await page.locator('.rss-content-area').click();
    await page.keyboard.press('Control+f');

    const findBar = page.locator('.rss-find-bar');
    await expect(findBar).toBeVisible();
    await expect(findBar).toHaveClass(/rss-find-bar--visible/);

    const input = page.locator('.rss-find-input');
    await input.click();
    await expect(input).toBeFocused();
  });

  test('typing in the find input highlights matches in articles', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'First Article',
              url: 'https://example.com/post-1',
              summary: 'A unique summary for finding text.',
              read: false,
              starred: false,
            },
            {
              articleID: 'article-2',
              title: 'Second Article',
              url: 'https://example.com/post-2',
              summary: 'Another summary with finding text.',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-content-area').click();
    await page.keyboard.press('Control+f');
    await page.locator('.rss-find-input').fill('finding');

    const highlights = page.locator('.rss-find-highlight');
    await expect(highlights).toHaveCount(2);
    await expect(page.locator('.rss-find-counter')).toHaveText('1/2');
  });

  test('Find Next cycles through highlighted matches', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'Alpha Article',
              url: 'https://example.com/post-1',
              summary: 'First mention.',
              read: false,
              starred: false,
            },
            {
              articleID: 'article-2',
              title: 'Another Alpha Article',
              url: 'https://example.com/post-2',
              summary: 'Second mention.',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-content-area').click();
    await page.keyboard.press('Control+f');
    await page.locator('.rss-find-input').fill('alpha');
    await expect(page.locator('.rss-find-counter')).toHaveText('1/2');

    await page.locator('.rss-find-button', { hasText: 'Find Next' }).click();
    await expect(page.locator('.rss-find-counter')).toHaveText('2/2');

    await page.locator('.rss-find-button', { hasText: 'Find Next' }).click();
    await expect(page.locator('.rss-find-counter')).toHaveText('1/2');
  });

  test('Find All button highlights all matches and renders scrollbar markers', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'Unique Article One',
              url: 'https://example.com/post-1',
              summary: 'First unique mention.',
              read: false,
              starred: false,
            },
            {
              articleID: 'article-2',
              title: 'Unique Article Two',
              url: 'https://example.com/post-2',
              summary: 'Second unique mention.',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-content-area').click();
    await page.keyboard.press('Control+f');
    await page.locator('.rss-find-input').fill('unique');
    await page.locator('.rss-find-button', { hasText: 'Find All' }).click();

    await expect(page.locator('.rss-find-highlight')).toHaveCount(4);
    const markers = page.locator('.rss-find-marker');
    await expect(markers).toHaveCount(4);
  });

  test('Escape closes the find bar', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await page.locator('.rss-content-area').click();
    await page.keyboard.press('Control+f');
    await expect(page.locator('.rss-find-bar')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.rss-find-bar')).not.toBeVisible();
  });

  test('find works inside the article viewer', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-1',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-1',
              title: 'Viewer Article',
              url: 'https://example.com/post-1',
              read: false,
              starred: false,
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();

      // Avoid network extraction in the test.
      el.openArticleViewer = async (article, feed) => {
        const { overlay, body } = el.createArticleViewer(article, feed);
        body.innerHTML = '';
        const content = document.createElement('article');
        content.className = 'rss-markdown-content';
        content.textContent = 'Viewer content with searchable text and more searchable text.';
        body.appendChild(content);
      };
    });

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    await viewer.locator('.rss-article-viewer-body').click();
    await page.keyboard.press('Control+f');
    await page.locator('.rss-find-input').fill('searchable');

    await expect(viewer.locator('.rss-find-highlight')).toHaveCount(2);
    await expect(viewer.locator('.rss-find-rail--viewer')).toBeVisible();
    await expect(viewer.locator('.rss-find-marker')).toHaveCount(2);
  });

  test('add feed closes the modal immediately and runs discovery in the background', async ({ page }) => {
    test.setTimeout(30000);

    // Hold the discovery fetch open long enough to prove the modal is
    // already gone while discovery is still pending.
    await page.route('https://slow-discovery.example.com/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: '<html><body>No feeds here</body></html>',
      });
    });

    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    await page.locator('.rss-footer .rss-add-feed-button').click();
    const modal = page.locator('.rss-modal-dialog');
    await expect(modal).toBeVisible();

    await modal.locator('input[type="url"]').fill('https://slow-discovery.example.com/blog');
    await modal.locator('.rss-button-primary').click();

    // The window closes immediately, before discovery has finished.
    await expect(modal).not.toBeVisible({ timeout: 2000 });

    // Discovery eventually fails (no feeds found) — that is the only
    // situation in which the user is notified.
    await expect(page.locator('.rss-toast-error')).toContainText(
      'No RSS feeds found',
      { timeout: 15000 },
    );
  });

  test('successful background feed add does not notify the user', async ({ page }) => {
    test.setTimeout(30000);

    const feedXML = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0"><channel>',
      '<title>Silent Success Feed</title>',
      '<link>https://instant-feed.example.com/</link>',
      '<description>test</description>',
      '<item><title>Hello</title><link>https://instant-feed.example.com/post-1</link>',
      '<guid>post-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
      '</channel></rss>',
    ].join('');

    await page.route('https://instant-feed.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: feedXML,
      });
    });

    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    await page.locator('.rss-footer .rss-add-feed-button').click();
    const modal = page.locator('.rss-modal-dialog');
    await modal.locator('input[type="url"]').fill('https://instant-feed.example.com/feed.xml');
    await modal.locator('.rss-button-primary').click();

    await expect(modal).not.toBeVisible({ timeout: 2000 });

    // Wait out the discovery round trip; success must stay silent.
    await page.waitForTimeout(3000);
    await expect(page.locator('.rss-toast-error')).toHaveCount(0);
  });

  test('adding a feed keeps an open article viewer visible', async ({ page }) => {
    test.setTimeout(30000);

    const feedXML = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0"><channel>',
      '<title>Background Add Feed</title>',
      '<link>https://bg-add.example.com/</link>',
      '<description>test</description>',
      '<item><title>New Item</title><link>https://bg-add.example.com/post-1</link>',
      '<guid>post-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
      '</channel></rss>',
    ].join('');

    await page.route('https://bg-add.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: feedXML,
      });
    });

    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    // Seed a feed with an article and open it in the viewer.
    await component.evaluate((el) => {
      el.feeds = [
        {
          feedID: 'feed-article-open',
          url: 'https://example.com/feed.xml',
          name: 'Example Feed',
          homePageURL: 'https://example.com',
          articles: [
            {
              articleID: 'article-open',
              title: 'Currently Reading',
              url: 'https://example.com/post',
              datePublished: new Date('2024-01-01T00:00:00Z'),
              authors: [{ name: 'Jane Doe' }],
              read: false,
              starred: false,
              tags: [],
            },
          ],
        },
      ];
      el.settings = { maxArticlesPerFeed: 50 };
      el.renderFeeds();
    });

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-header h2')).toHaveText('Currently Reading');

    // Open the Add Feed modal on top of the article viewer via the command
    // palette, since the article viewer overlay covers the footer buttons.
    await page.keyboard.press('Control+Shift+p');
    await page.locator('command-panel .command-item', { hasText: 'Add RSS Feed' }).click();
    const modal = page.locator('.rss-modal-dialog');
    await expect(modal).toBeVisible();

    // The article viewer should stay visible behind the modal.
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-header h2')).toHaveText('Currently Reading');

    // The modal overlay is translucent, not opaque.
    const overlay = page.locator('.rss-modal-overlay');
    const beforeOpacity = await overlay.evaluate((el) => {
      return parseFloat(window.getComputedStyle(el, '::before').opacity);
    });
    expect(beforeOpacity).toBeLessThan(1);

    // Submitting closes only the modal; the article remains open.
    await modal.locator('input[type="url"]').fill('https://bg-add.example.com/feed.xml');
    await modal.locator('.rss-button-primary').click();

    await expect(modal).not.toBeVisible({ timeout: 2000 });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rss-article-viewer-header h2')).toHaveText('Currently Reading');

    // Wait for the background discovery to finish and confirm the article
    // viewer is still the active modal.
    await page.waitForTimeout(3000);
    await expect(viewer).toBeVisible();
    await expect(page.locator('.rss-toast-error')).toHaveCount(0);
  });
});
