/**
 * Podcasts View E2E Tests
 *
 * The Podcasts view (the footer headphones button, next to the Videos
 * and Feeds buttons) lists every podcast episode whose audio has been
 * downloaded, regardless of read state. Entries open the podcast
 * viewer; in Electron the downloaded copy plays inline through the
 * media:// protocol, and "Play All" chains through every downloaded
 * episode, advancing when each one ends.
 *
 * Data is seeded through the app's own pipeline: a feed containing
 * audio enclosures is added with addFeedInBackground, the episodes are
 * downloaded through their Download Podcast buttons, and the view is
 * asserted against the persisted database rows. Downloads run through
 * the File System Access API fallback (the native save picker is
 * stubbed, per the testing conventions). Inline playback needs the
 * media:// protocol, which only exists in Electron, so those tests set
 * window.electron and patch HTMLMediaElement to accept media:// sources
 * paused (mirroring tests/e2e/videos-play-all.spec.js) and drive the
 * Play All chain with 'ended' events.
 */

import { test, expect } from '@playwright/test';

const EP1_PATH = '/podcast-fixtures/view-episode-1.mp3';
const EP2_PATH = '/podcast-fixtures/view-episode-2.mp3';

function podcastFeedXML(origin) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"><channel>',
    '<title>Podcasts View Weekly</title>',
    '<link>https://podcasts-view.example.com/</link>',
    '<description>test</description>',
    '<item><title>View Episode One</title>',
    '<link>https://podcasts-view.example.com/episodes/1</link>',
    '<guid>podcasts-view-1</guid>',
    '<pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>',
    `<enclosure url="${origin}${EP1_PATH}" type="audio/mpeg" length="1024"/>`,
    '</item>',
    '<item><title>View Episode Two</title>',
    '<link>https://podcasts-view.example.com/episodes/2</link>',
    '<guid>podcasts-view-2</guid>',
    '<pubDate>Sun, 01 Feb 2026 00:00:00 GMT</pubDate>',
    `<enclosure url="${origin}${EP2_PATH}" type="audio/mpeg" length="2048"/>`,
    '</item>',
    '</channel></rss>',
  ].join('');
}

test.describe('podcasts view', () => {
  // The seeded feed lives on a routed example.com origin; the dev
  // server's CSP (connect-src 'self') would block fetching it.
  test.use({ bypassCSP: true });

  test.beforeEach(async ({ page }) => {
    // The File System Access save picker is a native dialog automation
    // cannot click; stub it so downloads run through the app's pipeline.
    await page.addInitScript(() => {
      window.showSaveFilePicker = async (options) => ({
        name: options?.suggestedName || 'episode.mp3',
        createWritable: async () => ({
          write: async () => {},
          close: async () => {},
        }),
      });
    });

    // Electron-only media:// playback, made testable: media sources are
    // accepted and play() resolves without actually playing.
    await page.addInitScript(() => {
      const proto = HTMLMediaElement.prototype;
      proto.play = function () {
        return Promise.resolve();
      };
      Object.defineProperty(proto, 'currentSrc', {
        get() {
          return this.getAttribute('src') || '';
        },
        configurable: true,
      });
    });

    for (const path of [EP1_PATH, EP2_PATH]) {
      await page.route(`**${path}`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'audio/mpeg',
          body: `podcast-audio-bytes-${path}`,
        });
      });
    }
  });

  /**
   * Add the podcast feed through the app's own pipeline so the episodes
   * live in the database (the Podcasts view reads persisted rows).
   */
  async function seedPodcastFeed(page) {
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });

    const origin = await page.evaluate(() => window.location.origin);
    await page.route('https://podcasts-view.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: podcastFeedXML(origin),
      });
    });

    await component.evaluate((el) =>
      el.addFeedInBackground('https://podcasts-view.example.com/feed.xml')
    );
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);
  }

  async function downloadEpisode(page, title) {
    const episode = page.locator('.rss-article', { hasText: title });
    await episode.locator('[data-action="download-podcast"]').click();
    await expect(episode.locator('[data-action="download-podcast"]')).toHaveText(
      'Downloaded ✓',
      { timeout: 15000 }
    );
  }

  async function openPodcastsView(page) {
    await page.locator('.rss-view-toggle-option--podcasts .rss-view-toggle-option-label').click();
    const view = page.locator('.rss-podcasts-view');
    await expect(view).toBeVisible();
    return view;
  }

  test('the footer Podcasts button opens a view listing downloaded episodes', async ({ page }) => {
    test.setTimeout(60000);
    const component = page.locator('rss-feed-component');
    await seedPodcastFeed(page);
    await downloadEpisode(page, 'View Episode One');
    await downloadEpisode(page, 'View Episode Two');

    const view = await openPodcastsView(page);

    // The view header counts the downloaded episodes and offers Play All.
    await expect(view.locator('.rss-podcasts-view-count')).toHaveText('2 episodes');
    await expect(view.locator('.rss-podcasts-play-all-button')).toHaveText('▶ Play All');

    // Both episodes are listed, newest first — including any that have
    // already been played (open marks them read; the library keeps them).
    const titles = view.locator('.rss-podcasts-view-item .rss-article-title');
    await expect(titles).toHaveCount(2);
    await expect(titles.first()).toContainText('View Episode Two');
    await expect(titles.last()).toContainText('View Episode One');

    // The podcasts radio is checked and its option carries the active
    // highlight, exactly like the Videos button.
    await expect(component.locator('.rss-view-toggle-input[value="podcasts"]')).toBeChecked();
    await expect(component.locator('.rss-podcasts-view-button')).toHaveClass(
      /rss-podcasts-view-button--active/
    );

    // Leaving happens by selecting another view option.
    await page.locator('.rss-view-toggle-option--feeds .rss-view-toggle-option-label').click();
    await expect(view).toHaveCount(0);
    await expect(component.locator('.rss-view-toggle-input[value="feeds"]')).toBeChecked();
    await expect(component.locator('.rss-podcasts-view-button')).not.toHaveClass(
      /rss-podcasts-view-button--active/
    );
  });

  test('an empty library shows the empty state without Play All', async ({ page }) => {
    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    const view = await openPodcastsView(page);

    await expect(view.locator('.rss-no-articles')).toHaveText('No downloaded podcasts');
    await expect(view.locator('.rss-podcasts-play-all-button')).toHaveCount(0);
  });

  test('opening a downloaded episode outside Electron shows its saved file', async ({ page }) => {
    test.setTimeout(60000);
    await seedPodcastFeed(page);
    await downloadEpisode(page, 'View Episode One');

    const view = await openPodcastsView(page);
    await view
      .locator('.rss-podcasts-view-item', { hasText: 'View Episode One' })
      .locator('[data-action="open-article"]')
      .first()
      .click();

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // Without the media:// protocol the picked file cannot be played
    // inline, so the viewer reports the saved copy instead.
    await expect(viewer.locator('.rss-podcast-audio')).toHaveCount(0);
    await expect(viewer.locator('.rss-podcast-saved-note')).toContainText('Downloaded ✓');
  });

  test('opening a downloaded episode in Electron plays it inline', async ({ page }) => {
    test.setTimeout(60000);
    await seedPodcastFeed(page);
    await downloadEpisode(page, 'View Episode One');

    // Electron exposes window.electron and serves downloads over media://.
    await page.evaluate(() => {
      window.electron = {};
    });

    const view = await openPodcastsView(page);
    await view
      .locator('.rss-podcasts-view-item', { hasText: 'View Episode One' })
      .locator('[data-action="open-article"]')
      .first()
      .click();

    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const audio = viewer.locator('.rss-podcast-audio');
    await expect(audio).toHaveCount(1);
    // In Electron the src is a media:// URL addressing the downloaded
    // file; here it is just the picked file's name (the browser
    // fallback saves through the user's picker and cannot address it).
    expect(await audio.getAttribute('src')).toBe(
      `media://local/${encodeURIComponent('View Episode One.mp3')}`
    );
    await expect(viewer.locator('.rss-podcast-saved-note')).toHaveText(
      'Playing the downloaded copy'
    );
  });

  test('Play All chains through downloaded episodes and stops when the viewer closes', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await seedPodcastFeed(page);
    await downloadEpisode(page, 'View Episode One');
    await downloadEpisode(page, 'View Episode Two');

    await page.evaluate(() => {
      window.electron = {};
    });

    const view = await openPodcastsView(page);
    await view.locator('.rss-podcasts-play-all-button').click();

    // The chain opens the most recent episode first (the order the view
    // lists them), playing inline.
    const chainSrc = async () => decodeURIComponent(
      await viewer.locator('audio.rss-podcast-audio').getAttribute('src')
    );

    // The chain opens the most recent episode first (the order the view
    // lists them), playing inline.
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer.locator('audio.rss-podcast-audio')).toHaveCount(1);
    expect(await chainSrc()).toContain('View Episode Two');

    // When an episode ends, the next one opens automatically.
    await viewer.locator('audio.rss-podcast-audio').evaluate((audio) => {
      audio.dispatchEvent(new Event('ended'));
    });
    await expect(viewer.locator('audio.rss-podcast-audio')).toHaveCount(1);
    expect(await chainSrc()).toContain('View Episode One');

    // Closing the viewer stops the chain: the queue is exhausted, so no
    // further viewer opens.
    await page.locator('.rss-article-viewer-close').click();
    await expect(viewer).toBeHidden();
    await page.waitForTimeout(1100);
    await expect(page.locator('.rss-article-viewer-overlay')).toHaveCount(0);
  });

  test('Play All without Electron explains that nothing can play', async ({ page }) => {
    test.setTimeout(60000);
    await seedPodcastFeed(page);
    await downloadEpisode(page, 'View Episode One');

    const view = await openPodcastsView(page);
    await view.locator('.rss-podcasts-play-all-button').click();

    await expect(
      page.locator('.app-toast-text', { hasText: 'No playable downloaded podcasts' })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.rss-article-viewer-overlay')).toHaveCount(0);
  });
});
