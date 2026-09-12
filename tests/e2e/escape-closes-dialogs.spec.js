/**
 * Escape-Closes-Dialogs E2E Tests
 *
 * Every dialog in the app must close when the user presses Escape —
 * the report that motivated this suite was specifically about the
 * Add RSS Feed dialog. The dialogs are all built by
 * rss-feed-component.createModal(), which registers them as
 * `activeModal`; the shared Escape pipeline (_handleKeyDown →
 * _runEscapeAction → closeModal) is what dismisses them, including
 * while focus sits in a dialog input and when the dialog was opened
 * from the command panel.
 *
 * Floating context menus (.rss-kebab-menu: feed kebab menu and image
 * context menu) are transient UI of the same kind and are also
 * expected to dismiss on Escape instead of falling through to the
 * jump-to-top-of-feed action.
 */

import { test, expect } from '@playwright/test';

test.describe('Escape closes every dialog', () => {
  let component;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });
  });

  /**
   * Open a dialog via its component method, press Escape, and assert
   * the component no longer holds an active modal.
   *
   * @param {import('@playwright/test').Page} page Playwright page
   * @param {string} openMethod Component method that opens the dialog
   * @param {string[]} [openArgs] Arguments for the open method
   */
  async function expectEscapeClosesDialog(page, openMethod, openArgs = []) {
    await component.evaluate((el, { method, args }) => {
      el[method](...args);
    }, { method: openMethod, args: openArgs });

    const modal = page.locator('.rss-modal-overlay');
    await expect(modal).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(modal).toHaveCount(0);
    await expect(component).toHaveJSProperty('activeModal', null);
  }

  test('Add RSS Feed opened from the footer button', async ({ page }) => {
    await page.locator('.rss-footer .rss-add-feed-button').click();

    const modal = page.locator('.rss-modal-overlay', { hasText: 'Add RSS Feed' });
    await expect(modal).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(modal).toHaveCount(0);
    await expect(component).toHaveJSProperty('activeModal', null);
  });

  test('Add RSS Feed opened from the command panel', async ({ page }) => {
    await page.keyboard.press('Control+Shift+p');
    const panelDialog = page.locator('command-panel dialog');
    await expect(panelDialog).toBeVisible();

    await page.locator('command-panel .command-item', { hasText: 'Add RSS Feed' }).click();

    const modal = page.locator('.rss-modal-overlay', { hasText: 'Add RSS Feed' });
    await expect(modal).toBeVisible();
    await expect(panelDialog).toBeHidden();

    await page.keyboard.press('Escape');

    await expect(modal).toHaveCount(0);
    await expect(component).toHaveJSProperty('activeModal', null);
  });

  test('Add RSS Feed while the URL input has focus', async ({ page }) => {
    await page.locator('.rss-footer .rss-add-feed-button').click();

    const urlInput = page.locator('.rss-modal-overlay input.rss-add-feed-url');
    await expect(urlInput).toBeFocused();

    // Type into the field first: Escape must dismiss the dialog even
    // while the user is mid-typing in a dialog input.
    await urlInput.fill('https://example.com/feed.xml');
    await page.keyboard.press('Escape');

    await expect(page.locator('.rss-modal-overlay')).toHaveCount(0);
    await expect(component).toHaveJSProperty('activeModal', null);
  });

  test('Download Youtube Video', async ({ page }) => {
    await expectEscapeClosesDialog(page, 'openDownloadYouTubeModal');
  });

  test('Manage Feeds', async ({ page }) => {
    await expectEscapeClosesDialog(page, 'openManageFeedsModal');
  });

  test('Research Topics', async ({ page }) => {
    await expectEscapeClosesDialog(page, 'openResearchTopicsModal');
  });

  test('Settings', async ({ page }) => {
    await expectEscapeClosesDialog(page, 'openSettingsModal');
  });

  test('Quick Keys', async ({ page }) => {
    await expectEscapeClosesDialog(page, 'showQuickKeysModal');
  });

  test('Welcome modal', async ({ page }) => {
    await expectEscapeClosesDialog(page, 'showThanksModal');
  });

  test('Delete Feed confirmation', async ({ page }) => {
    await component.evaluate((el) => {
      el.feeds = [{
        feedID: 'feed-escape-test',
        url: 'https://example.com/feed.xml',
        name: 'Escape Test Feed',
        articles: [],
      }];
    });
    await expectEscapeClosesDialog(page, 'confirmDeleteFeed', ['feed-escape-test']);
  });

  test('feed kebab menu dismisses without jumping the feed to top', async ({ page }) => {
    // Seed a feed so the kebab menu has something to attach to, and spy
    // on the jump-to-top fallback so we can prove Escape dismissing the
    // menu does not also trigger it.
    await component.evaluate((el) => {
      el.feeds = [{
        feedID: 'feed-kebab-test',
        url: 'https://example.com/feed.xml',
        name: 'Kebab Test Feed',
        articles: [],
      }];
      el.renderFeeds();
      el._goToTopCalled = false;
      const original = el._goToTopOfFeed.bind(el);
      el._goToTopOfFeed = () => {
        el._goToTopCalled = true;
        original();
      };
    });

    const kebabButton = page.locator('.rss-kebab-button').first();
    if ((await kebabButton.count()) === 0) {
      // The feed list renders the kebab per feed; if no feed row is
      // visible in this view, open the menu via the component method.
      await component.evaluate((el) => {
        el.showFeedMenu('feed-kebab-test', el.querySelector('.rss-kebab-button') || el.querySelector('.rss-footer .rss-add-feed-button'));
      });
    } else {
      await kebabButton.click();
    }

    const menu = page.locator('.rss-kebab-menu');
    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(menu).toHaveCount(0);
    const jumpCalled = await component.evaluate((el) => el._goToTopCalled);
    expect(jumpCalled).toBe(false);
  });
});
