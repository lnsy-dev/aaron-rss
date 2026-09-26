/**
 * Bluesky Embedded Post Media E2E Tests
 *
 * The bug report: embedded posts inside Bluesky feed items must show
 * their images, videos and links
 * (https://bsky.app/profile/jamellebouie.net/post/3mwgjlrw7pc2h — a post
 * quoting a video post).
 *
 * Two problems bit here: the AppView stopped returning the blob record
 * on video embed views (so videos were silently dropped — only the HLS
 * playlist and thumbnail come back), and quote-post media never rendered
 * in the enriched timeline HTML (only in the social viewer). The lib now
 * recovers the MP4 stream from the playlist path and the timeline builds
 * embed media into its HTML.
 *
 * The bsky.app RSS feed and the public Bluesky API are stubbed per
 * endpoint with page.route; shapes mirror the live API responses.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>jamelle</title>',
  '<link>https://bsky.app/profile/jamellebouie.net</link>',
  '<description>test</description>',
  '<item><title>peter thiel is another one of those guys…</title>',
  '<link>https://bsky.app/profile/jamellebouie.net/post/3mwgjlrw7pc2h</link>',
  '<guid>bsky-embed-media-1</guid>',
  '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
  '<description><![CDATA[peter thiel is another one of those guys [contains quote post or other embedded content]]]></description>',
  '</item>',
  '</channel></rss>',
].join('');

const POST_VIEW = {
  uri: 'at://did:plc:jb/app.bsky.feed.post/3mwgjlrw7pc2h',
  cid: 'bafypost',
  author: { handle: 'jamellebouie.net', displayName: 'jamelle' },
  indexedAt: '2026-09-26T14:45:49.000Z',
  record: {
    text: 'peter thiel is another one of those guys',
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: 'at://did:plc:cw/app.bsky.feed.post/3mwf7aaizy22e' },
    },
  },
  embed: {
    $type: 'app.bsky.embed.record#view',
    record: {
      uri: 'at://did:plc:cw/app.bsky.feed.post/3mwf7aaizy22e',
      author: { handle: 'cwebbonline.com', displayName: 'Christopher Webb' },
      value: { text: 'This is actually hell, right?' },
      embeds: [
        {
          $type: 'app.bsky.embed.video#view',
          playlist: 'https://video.bsky.app/watch/did%3Aplc%3Acw/bafkquotevideo/playlist.m3u8',
          thumbnail: 'https://video.bsky.app/watch/did%3Aplc%3Acw/bafkquotevideo/thumbnail.jpg',
          aspectRatio: { height: 1280, width: 720 },
        },
      ],
    },
  },
};

// The Bluesky public API gets one stub per endpoint: handle resolution
// answers with a DID, the thread fetch backs the social viewer, and the
// batched getPosts call backs the feed-timeline enrichment.
async function stubBlueskyAPI(page) {
  await page.route('https://bsky.app/profile/jamellebouie.net/rss', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/rss+xml',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: FEED_XML,
    });
  });
  await page.route('https://public.api.bsky.app/**', async (route) => {
    const url = route.request().url();
    let body = { thread: { post: POST_VIEW, replies: [] } };
    if (url.includes('resolveHandle')) {
      body = { did: 'did:plc:jb' };
    } else if (url.includes('getPosts')) {
      body = { posts: [POST_VIEW] };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function seedFeed(page) {
  const component = page.locator('rss-feed-component');
  await expect(component).toBeVisible();
  await expect(component).toHaveJSProperty('initialized', true);
  await component.evaluate((el) =>
    el.addFeedInBackground('https://bsky.app/profile/jamellebouie.net/rss')
  );
  await expect
    .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
    .toBe(1);
  return component;
}

test.describe('Bluesky embedded post media', () => {
  test.use({ bypassCSP: true });

  test('social viewer plays the quoted post video', async ({ page }) => {
    await stubBlueskyAPI(page);
    await page.goto('/');
    const component = await seedFeed(page);

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const embed = viewer.locator('.rss-social-embed');
    await expect(embed).toContainText('Christopher Webb', { timeout: 15000 });
    await expect(embed).toContainText('This is actually hell, right?');

    // The quoted video renders as a playable element streaming the MP4
    // blob recovered from the playlist path.
    const video = embed.locator('video');
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAttribute(
      'src',
      'https://bsky.social/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Acw&cid=bafkquotevideo'
    );
    await expect(video).toHaveAttribute(
      'poster',
      'https://video.bsky.app/watch/did%3Aplc%3Acw/bafkquotevideo/thumbnail.jpg'
    );
    await expect(video).toHaveJSProperty('controls', true);
  });

  test('enriched timeline shows the quoted post video and link cards', async ({ page }) => {
    await stubBlueskyAPI(page);
    await page.goto('/');
    const component = await seedFeed(page);

    // Adding a feed parses without enrichment; the refresh pass fetches
    // the posts API and rewrites the timeline entry's HTML.
    await component.evaluate((el) => el.handleRefreshAll());

    const content = page.locator('.rss-article-content').first();
    const video = content.locator('video');
    await expect(video).toHaveCount(1, { timeout: 15000 });
    await expect(video).toHaveAttribute(
      'src',
      'https://bsky.social/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Acw&cid=bafkquotevideo'
    );

    // The quote block renders inside the timeline entry with its author
    // and caption, and the video stays playable.
    const embed = content.locator('.rss-social-embed');
    await expect(embed).toContainText('Christopher Webb');
    await expect(embed).toContainText('This is actually hell, right?');
    await expect(video).toHaveJSProperty('controls', true);
  });
});
