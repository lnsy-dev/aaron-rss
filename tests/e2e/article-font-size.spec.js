/**
 * Article Font Size E2E Tests
 *
 * Cmd/Ctrl+Plus and Cmd/Ctrl+Minus adjust article text size in steps;
 * Cmd/Ctrl+0 resets it. The chosen step persists in the settings table
 * and is re-applied (via the data-article-font-step attribute) when the
 * app reloads.
 */

import { test, expect } from '@playwright/test';

test.describe('Article font size', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
  });

  test('ctrl+= increases and ctrl+- decreases the step with persistence', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    // Start from the default step.
    await component.evaluate((el) => {
      el.settings.articleFontStep = 0;
      el._applyArticleFontStep();
    });
    await expect(component).toHaveAttribute('data-article-font-step', 'step0');

    await page.keyboard.press('Control+=');
    await expect(component).toHaveAttribute('data-article-font-step', 'step1');

    await page.keyboard.press('Control+=');
    await expect(component).toHaveAttribute('data-article-font-step', 'step2');

    await page.keyboard.press('Control+-');
    await expect(component).toHaveAttribute('data-article-font-step', 'step1');

    // The plain "-" key must also work (the same physical key unshifted).
    await page.keyboard.press('Control+Minus');
    await expect(component).toHaveAttribute('data-article-font-step', 'step0');
  });

  test('ctrl+0 resets the step to the default', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    await component.evaluate((el) => {
      el.settings.articleFontStep = 3;
      el._applyArticleFontStep();
    });
    await expect(component).toHaveAttribute('data-article-font-step', 'step3');

    await page.keyboard.press('Control+0');
    await expect(component).toHaveAttribute('data-article-font-step', 'step0');
  });

  test('the step persists across a reload', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await expect(component).toHaveAttribute('data-article-font-step', 'step2');

    await page.reload();
    const reloaded = page.locator('rss-feed-component');
    await expect(reloaded).toBeVisible();
    await expect(reloaded).toHaveJSProperty('initialized', true);
    await expect(reloaded).toHaveAttribute('data-article-font-step', 'step2');
  });

  test('clamps at the limits instead of growing forever', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    await component.evaluate((el) => {
      el.settings.articleFontStep = 5;
      el._applyArticleFontStep();
    });
    await expect(component).toHaveAttribute('data-article-font-step', 'step5');

    await page.keyboard.press('Control+=');
    await expect(component).toHaveAttribute('data-article-font-step', 'step5');

    await component.evaluate((el) => {
      el.settings.articleFontStep = -3;
      el._applyArticleFontStep();
    });
    await page.keyboard.press('Control+-');
    await expect(component).toHaveAttribute('data-article-font-step', 'step-3');
  });

  test('a non-zero step scales the reader body font from CSS', async ({ page }) => {
    const component = page.locator('rss-feed-component');

    // Build the article viewer DOM directly (createArticleViewer +
    // renderArticleViewerContent): openArticleViewer would try to fetch
    // and extract the article URL, which needs the network.
    await component.evaluate((el) => {
      const article = {
        articleID: 'a1',
        title: 'A readable post',
        url: 'https://example.com/post-1',
        read: false,
      };
      const feed = { feedID: 'feed-1', url: 'https://example.com/feed.xml', name: 'Example Feed' };
      const { body } = el.createArticleViewer(article, feed);
      el.renderArticleViewerContent(body, article, feed, {
        markdown: '# Heading\n\nSome body text to read.',
      });
    });

    const body = page.locator('.rss-article-viewer-body .rss-markdown-content');
    await expect(body).toBeVisible({ timeout: 15000 });

    const defaultSize = await body.evaluate((el) => getComputedStyle(el).fontSize);

    await component.evaluate((el) => {
      el.settings.articleFontStep = 2;
      el._applyArticleFontStep();
    });

    const scaledSize = await body.evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(scaledSize)).toBeGreaterThan(parseFloat(defaultSize));

    // Back to default: the size returns to the unscaled value.
    await component.evaluate((el) => {
      el.settings.articleFontStep = 0;
      el._applyArticleFontStep();
    });
    const resetSize = await body.evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(resetSize)).toBe(parseFloat(defaultSize));
  });
});
