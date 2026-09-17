/**
 * Distraction Free Mode Download Hover E2E Tests
 *
 * In Distraction Free Mode the per-article actions are hidden chrome.
 * Hovering a podcast or YouTube video article summary must still reveal
 * its "Download Podcast" / "Download Video" button (and only that
 * button); plain articles reveal nothing, and normal mode is unchanged.
 */

import { test, expect } from '@playwright/test';

const FEED = {
  feedID: 'feed-hover',
  url: 'https://hover.example.com/feed.xml',
  name: 'Hover Feed',
  articles: [
    {
      articleID: 'yt1',
      title: 'A YouTube video',
      url: 'https://www.youtube.com/watch?v=abc12345678',
      summary: 'Watch this video about things.',
      read: false,
      starred: false,
    },
    {
      articleID: 'pod1',
      title: 'A podcast episode',
      url: 'https://hover.example.com/episodes/1',
      summary: 'Listen to this episode.',
      enclosureURL: 'https://hover.example.com/episode-1.mp3',
      enclosureType: 'audio/mpeg',
      enclosureLength: 1024,
      read: false,
      starred: false,
    },
    {
      articleID: 'post1',
      title: 'A plain blog post',
      url: 'https://hover.example.com/posts/1',
      summary: 'Just text, no media.',
      read: false,
      starred: false,
    },
  ],
};

/**
 * Open the command panel with its key event and run the named command.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name - Command name shown in the panel.
 */
async function runCommand(page, name) {
  await page.keyboard.press('Control+Shift+P');
  const panel = page.locator('command-panel dialog[open]');
  await expect(panel).toBeVisible();
  await panel.locator('.command-item', { hasText: name }).first().click();
  await expect(panel).toBeHidden();
}

test.describe('Distraction Free download hover', () => {
  test.use({ bypassCSP: true });

  test('hovering a podcast or video summary reveals only its download button', async ({
    page,
  }) => {
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });
    await component.evaluate((el, feed) => {
      el.feeds = [feed];
      el.renderFeeds();
    }, FEED);

    const videoArticle = page.locator('.rss-article[data-article-id="yt1"]');
    const podcastArticle = page.locator('.rss-article[data-article-id="pod1"]');
    const plainArticle = page.locator('.rss-article[data-article-id="post1"]');

    // Normal mode: everything visible without hovering.
    await expect(videoArticle.locator('[data-action="download-youtube"]')).toBeVisible();
    await expect(podcastArticle.locator('[data-action="download-podcast"]')).toBeVisible();

    await runCommand(page, 'Toggle Distraction Free Mode');
    await expect(page.locator('body')).toHaveClass(/distraction-free/);

    // Mode on, no hover: the download buttons are hidden with the rest.
    await expect(videoArticle.locator('[data-action="download-youtube"]')).toBeHidden();
    await expect(podcastArticle.locator('[data-action="download-podcast"]')).toBeHidden();

    // Hovering the video summary reveals "Download Video" — and only it.
    await videoArticle.locator('.rss-article-summary').hover();
    const videoActions = videoArticle.locator('.rss-article-actions');
    await expect(videoActions.locator('[data-action="download-youtube"]')).toBeVisible();
    await expect(videoActions.locator('[data-action="open-article"]')).toBeHidden();
    await expect(videoActions.locator('[data-action="mark-read"]')).toBeHidden();
    await expect(videoActions.locator('[data-action="save-file"]')).toBeHidden();

    // Hovering the podcast summary reveals "Download Podcast".
    await podcastArticle.locator('.rss-article-summary').hover();
    const podcastActions = podcastArticle.locator('.rss-article-actions');
    await expect(podcastActions.locator('[data-action="download-podcast"]')).toBeVisible();
    await expect(podcastActions.locator('[data-action="mark-read"]')).toBeHidden();

    // Moving off to a plain article hides the revealed buttons again,
    // and the plain article reveals nothing.
    await plainArticle.locator('.rss-article-summary').hover();
    await expect(videoArticle.locator('[data-action="download-youtube"]')).toBeHidden();
    await expect(podcastArticle.locator('[data-action="download-podcast"]')).toBeHidden();
    await expect(plainArticle.locator('[data-action="download-youtube"]')).toHaveCount(0);

    // Toggling the mode off restores the always-visible actions.
    await runCommand(page, 'Toggle Distraction Free Mode');
    await expect(page.locator('body')).not.toHaveClass(/distraction-free/);
    await expect(videoArticle.locator('[data-action="download-youtube"]')).toBeVisible();
    await expect(podcastArticle.locator('[data-action="download-podcast"]')).toBeVisible();
  });
});
