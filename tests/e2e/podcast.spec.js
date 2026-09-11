/**
 * Podcast Feature E2E Tests
 *
 * Podcast episodes (articles carrying an audio enclosure) are detected
 * from seeded feed data and render a 🎙 Podcast badge plus a "Download
 * Podcast" action. The download runs through the File System Access API
 * fallback (the native save picker is stubbed, per the testing
 * conventions) and streams a stubbed network response into the picked
 * file.
 *
 * The enclosure is served from a same-origin path because the dev
 * server's Content-Security-Policy (connect-src 'self') blocks
 * cross-origin renderer fetches — matching the production CSP. In
 * Electron, downloads stream through the main process and are not
 * subject to CSP.
 */

import { test, expect } from '@playwright/test';

const ENCLOSURE_PATH = '/podcast-fixtures/episode-1.mp3';

const PODCAST_FEEDS = [
  {
    feedID: 'feed-podcast',
    url: 'https://example.com/podcast.xml',
    name: 'Example Podcast',
    articles: [
      {
        articleID: 'ep1',
        title: 'Episode 1: The Beginning',
        url: 'https://example.com/episodes/1',
        enclosurePath: ENCLOSURE_PATH,
        enclosureType: 'audio/mpeg',
        enclosureLength: 1024,
        read: false,
        starred: false,
      },
      {
        articleID: 'post1',
        title: 'A plain blog post',
        url: 'https://example.com/posts/1',
        read: false,
        starred: false,
      },
    ],
  },
];

test.describe('podcast detection and download', () => {
  test.beforeEach(async ({ page }) => {
    // The File System Access save picker is a native dialog automation
    // cannot click; stub it and record what the app writes.
    await page.addInitScript(() => {
      window.__podcastWrites = [];
      window.showSaveFilePicker = async (options) => ({
        name: options?.suggestedName || 'episode.mp3',
        createWritable: async () => ({
          write: async (chunk) => {
            window.__podcastWrites.push(chunk);
          },
          close: async () => {},
        }),
      });
    });

    await page.route(`**${ENCLOSURE_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        body: 'fake-podcast-audio-bytes',
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
  });

  async function seedPodcastFeed(page) {
    const component = page.locator('rss-feed-component');
    await component.evaluate((el, feeds) => {
      const seeded = feeds.map((feed) => ({
        ...feed,
        articles: feed.articles.map((article) => ({
          ...article,
          enclosureURL: article.enclosurePath
            ? `${window.location.origin}${article.enclosurePath}`
            : undefined,
        })),
      }));
      el.feeds = seeded;
      el.renderFeeds();
    }, PODCAST_FEEDS);
  }

  test('marks podcast episodes with a badge and a Download Podcast button', async ({ page }) => {
    await seedPodcastFeed(page);

    const episode = page.locator('.rss-article[data-article-id="ep1"]');
    await expect(episode.locator('.rss-podcast-badge')).toHaveText('🎙 Podcast');

    const downloadButton = episode.locator('[data-action="download-podcast"]');
    await expect(downloadButton).toHaveText('Download Podcast');

    // Plain articles are unaffected.
    const plain = page.locator('.rss-article[data-article-id="post1"]');
    await expect(plain.locator('.rss-podcast-badge')).toHaveCount(0);
    await expect(plain.locator('[data-action="download-podcast"]')).toHaveCount(0);
  });

  test('downloads an episode through the save picker and shows the downloaded state', async ({ page }) => {
    await seedPodcastFeed(page);

    const episode = page.locator('.rss-article[data-article-id="ep1"]');
    await episode.locator('[data-action="download-podcast"]').click();

    // The downloaded state replaces the button label and adds a
    // Delete Audio action, without hiding the episode from the feed.
    const downloadButton = episode.locator('[data-action="download-podcast"]');
    await expect(downloadButton).toHaveText('Downloaded ✓', { timeout: 15000 });
    await expect(episode.locator('[data-action="delete-podcast"]')).toHaveText('Delete Audio');
    await expect(episode.locator('[data-action="mark-read"]')).toBeVisible();

    // The audio bytes were streamed into the stubbed file handle.
    const writes = await page.evaluate(() =>
      window.__podcastWrites.map((chunk) => new TextDecoder().decode(chunk))
    );
    expect(writes.join('')).toBe('fake-podcast-audio-bytes');

    // The download path was persisted on the article record (the title
    // is sanitized: filesystem-hostile characters are stripped).
    const storedPath = await page.locator('rss-feed-component').evaluate((el) =>
      el.feeds.find((f) => f.feedID === 'feed-podcast').articles.find((a) => a.articleID === 'ep1').downloadPath
    );
    expect(storedPath).toBe('Episode 1 The Beginning.mp3');
  });

  test('the podcast viewer shows a download action and show notes instead of extraction', async ({ page }) => {
    await seedPodcastFeed(page);

    const component = page.locator('rss-feed-component');
    await component.evaluate((el) => {
      const feed = el.feeds.find((f) => f.feedID === 'feed-podcast');
      const episode = feed.articles.find((a) => a.articleID === 'ep1');
      episode.contentHTML = '<p>Show notes for episode 1</p>';
      el.renderFeeds();
    });

    await page
      .locator('.rss-article[data-article-id="ep1"] button[data-action="open-article"]')
      .click();

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // The player section offers the download; no page extraction happens.
    const player = viewer.locator('.rss-podcast-player');
    await expect(player.locator('.rss-podcast-download-button')).toHaveText('Download Podcast');
    await expect(player.locator('audio')).toHaveCount(0);

    await expect(viewer.locator('.rss-podcast-notes')).toContainText('Show notes for episode 1');
  });
});
