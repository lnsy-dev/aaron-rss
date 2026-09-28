/**
 * Bluesky Comment Font Size E2E Tests
 *
 * The bug report: Ctrl+Plus / Ctrl+Minus (article font size) must scale
 * the comments in Bluesky posts too, not only the Markdown reader body.
 * The social viewer rendered post text and comments with fixed font
 * sizes, so the shortcuts changed nothing in a comment thread.
 *
 * The first test walks the real flow — stubbed Bluesky RSS + AppView
 * endpoints, post opened from the timeline, comments fetched from
 * getPostThread — and asserts real computed font sizes respond to the
 * keyboard shortcuts. The second builds the social viewer DOM directly
 * (the article-font-size.spec.js pattern) to pin the scale factor down:
 * step +2 must scale the comment thread by 1.3.
 */

import { test, expect } from '@playwright/test';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  '<title>alice</title>',
  '<link>https://bsky.app/profile/alice</link>',
  '<description>test</description>',
  '<item><title>Hello thread</title>',
  '<link>https://bsky.app/profile/alice/post/3fontsize1</link>',
  '<guid>bsky-comment-font-1</guid>',
  '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>',
  '<description><![CDATA[Hello thread]]></description>',
  '</item>',
  '</channel></rss>',
].join('');

const POST_VIEW = {
  uri: 'at://did:plc:alice/app.bsky.feed.post/3fontsize1',
  cid: 'bafypost',
  author: { handle: 'alice.bsky.social', displayName: 'Alice' },
  indexedAt: '2026-09-26T14:45:49.000Z',
  record: { text: 'Hello thread' },
  embed: undefined,
};

const THREAD_VIEW = {
  thread: {
    post: POST_VIEW,
    replies: [
      {
        post: {
          uri: 'at://did:plc:bob/app.bsky.feed.post/3fontrepl1',
          cid: 'bafyreply1',
          author: { handle: 'bob.example', displayName: 'Bob' },
          indexedAt: '2026-09-26T15:00:00.000Z',
          record: { text: 'What a great thread' },
        },
        parent: undefined,
        replies: [],
      },
      {
        post: {
          uri: 'at://did:plc:carol/app.bsky.feed.post/3fontrepl2',
          cid: 'bafyreply2',
          author: { handle: 'carol.example', displayName: 'Carol' },
          indexedAt: '2026-09-26T15:05:00.000Z',
          record: { text: 'Agreed, wonderful' },
        },
        parent: undefined,
        replies: [],
      },
    ],
  },
};

// The Bluesky public API gets one stub per endpoint: handle resolution
// answers with a DID, the thread fetch backs the social viewer, and the
// batched getPosts call backs the feed-timeline enrichment.
async function stubBlueskyAPI(page) {
  await page.route('https://bsky.app/profile/alice/rss', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/rss+xml',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: FEED_XML,
    });
  });
  await page.route('https://public.api.bsky.app/**', async (route) => {
    const url = route.request().url();
    let body = THREAD_VIEW;
    if (url.includes('resolveHandle')) {
      body = { did: 'did:plc:alice' };
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

test.describe('Bluesky comment font size', () => {
  test.use({ bypassCSP: true });

  test('ctrl+= and ctrl+- scale the post text and its comments', async ({ page }) => {
    await stubBlueskyAPI(page);
    await page.goto('/');

    const component = page.locator('rss-feed-component');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);
    await component.evaluate((el) => {
      el.settings.articleFontStep = 0;
      el._applyArticleFontStep();
    });

    // Start from the default step so the first press is a clean +1.
    await expect(component).toHaveAttribute('data-article-font-step', 'step0');

    await component.evaluate((el) =>
      el.addFeedInBackground('https://bsky.app/profile/alice/rss')
    );
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 15000 })
      .toBe(1);

    await page.locator('.rss-article-title strong').click();
    const viewer = page.locator('.rss-article-viewer-overlay');
    await expect(viewer).toBeVisible();

    const postText = viewer.locator('.rss-social-text');
    const comment = viewer.locator('.rss-social-comment', { hasText: 'What a great thread' });
    await expect(postText).toContainText('Hello thread', { timeout: 15000 });
    await expect(comment).toContainText('What a great thread');

    const defaultPostSize = parseFloat(await postText.evaluate((el) => getComputedStyle(el).fontSize));
    const defaultCommentSize = parseFloat(await comment.evaluate((el) => getComputedStyle(el).fontSize));

    // Ctrl+= grows the comments along with the post text.
    await page.keyboard.press('Control+=');
    await expect(component).toHaveAttribute('data-article-font-step', 'step1');

    const step1PostSize = parseFloat(await postText.evaluate((el) => getComputedStyle(el).fontSize));
    const step1CommentSize = parseFloat(await comment.evaluate((el) => getComputedStyle(el).fontSize));
    expect(step1PostSize).toBeGreaterThan(defaultPostSize);
    expect(step1CommentSize).toBeGreaterThan(defaultCommentSize);

    // Two more presses, then back down twice with ctrl+-.
    await page.keyboard.press('Control+=');
    await expect(component).toHaveAttribute('data-article-font-step', 'step2');
    await page.keyboard.press('Control+=');
    const step3CommentSize = parseFloat(await comment.evaluate((el) => getComputedStyle(el).fontSize));
    expect(step3CommentSize).toBeGreaterThan(step1CommentSize);

    await page.keyboard.press('Control+-');
    await expect(component).toHaveAttribute('data-article-font-step', 'step2');
    const step2CommentSize = parseFloat(await comment.evaluate((el) => getComputedStyle(el).fontSize));
    expect(step2CommentSize).toBeLessThan(step3CommentSize);

    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+-');
    await expect(component).toHaveAttribute('data-article-font-step', 'step0');
    const resetCommentSize = parseFloat(await comment.evaluate((el) => getComputedStyle(el).fontSize));
    expect(resetCommentSize).toBe(defaultCommentSize);
  });

  test('step +2 scales the comment thread by the 1.3 factor', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await page.goto('/');
    await expect(component).toBeVisible();
    await expect(component).toHaveJSProperty('initialized', true);

    // Build the social viewer DOM directly: createArticleViewer +
    // renderSocialViewerContent, the pattern the social viewer specs use
    // (openArticleViewer would need the network to resolve the post).
    await component.evaluate((el) => {
      el.settings.articleFontStep = 0;
      el._applyArticleFontStep();

      const article = {
        articleID: 'bsky-font-1',
        title: 'Thread',
        url: 'https://bsky.app/profile/alice/post/3fontsize1',
        contentText: 'Hello thread',
        summary: 'Hello thread',
        datePublished: new Date('2026-08-20T12:00:00Z'),
        read: false,
        starred: false,
      };
      const feed = {
        feedID: 'feed-bsky-font',
        url: 'https://bsky.app/profile/alice/rss',
        name: 'Alice',
        homePageURL: 'https://bsky.app/profile/alice',
        articles: [article],
      };
      el.feeds = [feed];
      el.settings.maxArticlesPerFeed = 50;

      const post = {
        platform: 'bluesky',
        author: 'Alice',
        handle: 'alice.bsky.social',
        date: '2026-08-20T12:00:00.000Z',
        text: 'Hello thread',
        comments: [
          {
            author: 'Bob',
            handle: 'bob.example',
            date: '2026-08-20T13:00:00.000Z',
            text: 'What a great thread',
            depth: 0,
          },
          {
            author: 'Carol',
            handle: 'carol.example',
            date: '2026-08-20T13:05:00.000Z',
            text: 'Agreed, wonderful',
            depth: 1,
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

    const comment = viewer.locator('.rss-social-comment', { hasText: 'Agreed, wonderful' });
    await expect(comment).toBeVisible();

    const defaultSize = parseFloat(await comment.evaluate((el) => getComputedStyle(el).fontSize));

    await component.evaluate((el) => {
      el.settings.articleFontStep = 2;
      el._applyArticleFontStep();
    });
    const step2Size = parseFloat(await comment.evaluate((el) => getComputedStyle(el).fontSize));

    expect(step2Size).toBeCloseTo(defaultSize * 1.3, 1);
  });
});
