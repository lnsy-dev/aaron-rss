/**
 * Mastodon Post Media E2E Tests
 *
 * Opening a Mastodon post routes through the social viewer, which
 * fetches the status over its instance API. Video/gifv attachments must
 * render as inline playable <video> elements (they used to map to
 * external cards the renderer dropped entirely) and image attachments
 * keep rendering.
 *
 * The Mastodon API is stubbed with page.route; the renderer's fetchText
 * falls back to plain fetch when the Electron bridge is absent.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>Mastodon Media Feed</title>',
  '<link>https://mastodon-social-feed.example.com/</link>',
  '<description>test</description>',
  '<item><title>Mastodon post by Alice</title>',
  '<link>https://mastodon.social/@alice/110000000000000000</link>',
  '<guid>mastodon-media-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
  '</channel></rss>',
].join('');

const STATUS_JSON = {
  content: '<p>Behind the scenes 🎬</p>',
  created_at: '2026-08-20T12:00:00.000Z',
  account: { display_name: 'Alice', acct: 'alice@mastodon.social' },
  media_attachments: [
    {
      type: 'image',
      url: 'https://files.mastodon.social/photo.png',
      preview_url: 'https://files.mastodon.social/photo-small.png',
      description: 'A still frame',
    },
    {
      type: 'video',
      url: 'https://files.mastodon.social/clip.mp4',
      preview_url: 'https://files.mastodon.social/clip-thumb.jpg',
      description: 'The clip',
    },
  ],
};

const CONTEXT_JSON = { descendants: [] };

test.describe('Mastodon post media', () => {
  test.use({ bypassCSP: true });

  test('renders image and playable video attachments in the social viewer', async ({
    page,
  }) => {
    await page.route('https://mastodon-social-feed.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: FEED_XML,
      });
    });
    await page.route('https://mastodon.social/api/v1/statuses/110000000000000000', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(STATUS_JSON),
      });
    });
    await page.route(
      'https://mastodon.social/api/v1/statuses/110000000000000000/context',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(CONTEXT_JSON),
        });
      }
    );

    await page.goto('/');
    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.viewMode = 'feeds';
      el._syncViewToggle();
    });
    await component.evaluate((el) =>
      el.addFeedInBackground('https://mastodon-social-feed.example.com/feed.xml')
    );
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);

    // Opening the post routes into the social viewer.
    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    // The image attachment renders.
    const media = viewer.locator('.rss-social-media');
    await expect(media).toBeVisible();
    await expect(media.locator('img[src="https://files.mastodon.social/photo.png"]')).toHaveCount(1);

    // The video attachment renders as an inline player with poster and
    // source, not as a dropped external card.
    const video = media.locator('video.rss-social-video');
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAttribute('src', 'https://files.mastodon.social/clip.mp4');
    await expect(video).toHaveAttribute('poster', 'https://files.mastodon.social/clip-thumb.jpg');
    await expect(video).toHaveAttribute('controls', '');
  });
});
