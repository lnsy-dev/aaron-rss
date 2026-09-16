/**
 * Social Post Unit Tests
 *
 * Tests the Bluesky/Mastodon post fetching and Bluesky feed enrichment
 * helpers in src/lib/social-post.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/rss-network.js', () => ({
  fetchText: vi.fn(),
}));

import { fetchText } from '../../src/lib/rss-network.js';
import {
  identifySocialURL,
  fetchSocialPost,
  enrichBlueskyFeedItems,
  renderBlueskyText,
  renderBlueskyPlainText,
  buildBlueskyMediaHTML,
} from '../../src/lib/social-post.js';

describe('social-post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('identifySocialURL', () => {
    it('recognizes Bluesky post URLs', () => {
      expect(identifySocialURL('https://bsky.app/profile/handle.bsky.social/post/3abc123')).toBe('bluesky');
    });

    it('recognizes Mastodon status URLs', () => {
      expect(identifySocialURL('https://mastodon.social/@Mastodon/123456789')).toBe('mastodon');
      expect(identifySocialURL('https://example.com/users/alice/statuses/123456789')).toBe('mastodon');
    });

    it('returns null for unrelated URLs', () => {
      expect(identifySocialURL('https://example.com/blog/post')).toBeNull();
      expect(identifySocialURL('https://bsky.app/profile/handle')).toBeNull();
    });
  });

  describe('renderBlueskyText', () => {
    it('escapes text and preserves line breaks when there are no facets', () => {
      const html = renderBlueskyText('Hello\nWorld');
      expect(html).toBe('Hello<br>World');
    });

    it('replaces link facets with clickable full URLs', () => {
      const html = renderBlueskyText('Check this out: link', [
        {
          index: { byteStart: 16, byteEnd: 20 },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
        },
      ]);

      expect(html).toContain('<a href="https://example.com"');
      expect(html).toContain('>https://example.com</a>');
      expect(html).toContain('Check this out: ');
    });

    it('handles link facets with multi-byte characters', () => {
      // "Hello 🎉 link" — the emoji is 4 UTF-8 bytes.
      const text = 'Hello 🎉 link';
      const byteStart = new TextEncoder().encode('Hello 🎉 ').length;
      const byteEnd = byteStart + new TextEncoder().encode('link').length;

      const html = renderBlueskyText(text, [
        {
          index: { byteStart, byteEnd },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
        },
      ]);

      expect(html).toContain('<a href="https://example.com"');
      expect(html).toContain('>https://example.com</a>');
    });
  });

  describe('renderBlueskyPlainText', () => {
    it('replaces link display text with the full URL', () => {
      const plain = renderBlueskyPlainText('Check this out: link', [
        {
          index: { byteStart: 16, byteEnd: 20 },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
        },
      ]);

      expect(plain).toBe('Check this out: https://example.com');
    });
  });

  describe('buildBlueskyMediaHTML', () => {
    it('renders images as plain img elements', () => {
      const html = buildBlueskyMediaHTML([
        { type: 'image', thumb: 'https://cdn.bsky.app/img.jpg', alt: 'A cat' },
      ]);

      expect(html).toContain('<img src="https://cdn.bsky.app/img.jpg"');
      expect(html).toContain('alt="A cat"');
      expect(html).not.toContain('rss-social-link-card');
    });

    it('renders external link cards as clickable anchors to the linked site', () => {
      const html = buildBlueskyMediaHTML([
        {
          type: 'external',
          uri: 'https://example.com/article',
          title: 'An Article',
          description: 'Some description',
          thumb: 'https://cdn.example.com/thumb.jpg',
        },
      ]);

      expect(html).toContain('<a class="rss-social-link-card" href="https://example.com/article"');
      expect(html).toContain('rss-social-link-card-title">An Article</span>');
      expect(html).toContain('rss-social-link-card-description">Some description</span>');
      expect(html).toContain('<img src="https://cdn.example.com/thumb.jpg"');
    });

    it('escapes HTML in external card fields', () => {
      const html = buildBlueskyMediaHTML([
        {
          type: 'external',
          uri: 'https://example.com/?q=<script>',
          title: '<b>Title</b>',
          description: null,
        },
      ]);

      expect(html).toContain('href="https://example.com/?q=&lt;script&gt;"');
      expect(html).toContain('&lt;b&gt;Title&lt;/b&gt;');
      expect(html).not.toContain('<b>');
      expect(html).not.toContain('rss-social-link-card-description');
    });

    it('returns an empty string for empty or unsupported media', () => {
      expect(buildBlueskyMediaHTML([])).toBe('');
      expect(buildBlueskyMediaHTML(null)).toBe('');
      expect(buildBlueskyMediaHTML([{ type: 'external', uri: '' }])).toBe('');
    });
  });

  describe('fetchSocialPost - Bluesky', () => {
    it('fetches a Bluesky post, embeds, media, and replies', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('resolveHandle?handle=alice.bsky.social')) {
          return { ok: true, status: 200, text: JSON.stringify({ did: 'did:plc:alice' }) };
        }
        if (url.includes('getPostThread')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              thread: {
                post: {
                  uri: 'at://did:plc:alice/app.bsky.feed.post/3abc',
                  author: { handle: 'alice.bsky.social', displayName: 'Alice' },
                  indexedAt: '2026-08-20T12:00:00.000Z',
                  record: { text: 'Hello Bluesky!' },
                  embed: {
                    $type: 'app.bsky.embed.recordWithMedia#view',
                    record: {
                      record: {
                        author: { handle: 'bob.bsky.social', displayName: 'Bob' },
                        value: { text: 'Quoted post text' },
                        embeds: [
                          {
                            images: [
                              { thumb: 'https://cdn.example/quoted-thumb.jpg', fullsize: 'https://cdn.example/quoted.jpg', alt: 'Quoted image' },
                            ],
                          },
                        ],
                      },
                    },
                    media: {
                      images: [
                        { thumb: 'https://cdn.example/main-thumb.jpg', fullsize: 'https://cdn.example/main.jpg', alt: 'Main image' },
                      ],
                    },
                  },
                },
                replies: [
                  {
                    post: {
                      author: { handle: 'carol.bsky.social', displayName: 'Carol' },
                      indexedAt: '2026-08-20T13:00:00.000Z',
                      record: { text: 'Nice post' },
                      embed: {
                        $type: 'app.bsky.embed.images#view',
                        images: [
                          { thumb: 'https://cdn.example/reply-thumb.jpg', fullsize: 'https://cdn.example/reply.jpg', alt: 'Reply photo' },
                        ],
                      },
                    },
                    replies: [],
                  },
                ],
              },
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const post = await fetchSocialPost('https://bsky.app/profile/alice.bsky.social/post/3abc');

      expect(post.platform).toBe('bluesky');
      expect(post.author).toBe('Alice');
      expect(post.handle).toBe('alice.bsky.social');
      expect(post.text).toBe('Hello Bluesky!');
      expect(post.media).toHaveLength(1);
      expect(post.media[0].fullsize).toBe('https://cdn.example/main.jpg');
      expect(post.embeds).toHaveLength(1);
      expect(post.embeds[0].author).toBe('Bob');
      expect(post.embeds[0].text).toBe('Quoted post text');
      expect(post.embeds[0].media).toHaveLength(1);
      expect(post.embeds[0].media[0].alt).toBe('Quoted image');
      expect(post.comments).toHaveLength(1);
      expect(post.comments[0].author).toBe('Carol');
      expect(post.comments[0].text).toBe('Nice post');
      // Replies carry their own attached media so the viewer can show it.
      expect(post.comments[0].media).toHaveLength(1);
      expect(post.comments[0].media[0].fullsize).toBe('https://cdn.example/reply.jpg');
      expect(post.comments[0].media[0].alt).toBe('Reply photo');
    });

    it('returns an empty media list for replies without attachments', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('resolveHandle?handle=alice.bsky.social')) {
          return { ok: true, status: 200, text: JSON.stringify({ did: 'did:plc:alice' }) };
        }
        if (url.includes('getPostThread')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              thread: {
                post: {
                  uri: 'at://did:plc:alice/app.bsky.feed.post/3abc',
                  author: { handle: 'alice.bsky.social' },
                  record: { text: 'Hello!' },
                },
                replies: [
                  {
                    post: {
                      author: { handle: 'bob.bsky.social' },
                      record: { text: 'Plain reply' },
                    },
                    replies: [],
                  },
                ],
              },
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const post = await fetchSocialPost('https://bsky.app/profile/alice.bsky.social/post/3abc');

      expect(post.comments).toHaveLength(1);
      expect(post.comments[0].media).toEqual([]);
    });

    it('shows every post in a quote chain, including quotes with media', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('resolveHandle?handle=alice.bsky.social')) {
          return { ok: true, status: 200, text: JSON.stringify({ did: 'did:plc:alice' }) };
        }
        if (url.includes('getPostThread')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              thread: {
                post: {
                  uri: 'at://did:plc:alice/app.bsky.feed.post/3chain-a',
                  author: { handle: 'alice.bsky.social' },
                  record: { text: 'A quotes B' },
                  embed: {
                    $type: 'app.bsky.embed.record#view',
                    record: {
                      uri: 'at://did:plc:bob/app.bsky.feed.post/3chain-b',
                      author: { handle: 'bob.bsky.social', displayName: 'Bob' },
                      value: { text: 'B quotes C' },
                      embeds: [
                        {
                          $type: 'app.bsky.embed.recordWithMedia#view',
                          record: {
                            record: {
                              uri: 'at://did:plc:carol/app.bsky.feed.post/3chain-c',
                              author: { handle: 'carol.bsky.social', displayName: 'Carol' },
                              value: { text: 'C has a photo' },
                              embeds: [],
                            },
                          },
                          media: {
                            images: [
                              { thumb: 'https://cdn.example/b-photo.jpg', fullsize: 'https://cdn.example/b-photo.jpg', alt: 'B photo' },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
                replies: [],
              },
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const post = await fetchSocialPost('https://bsky.app/profile/alice.bsky.social/post/3chain-a');

      expect(post.embeds).toHaveLength(2);
      expect(post.embeds[0].author).toBe('Bob');
      expect(post.embeds[0].text).toBe('B quotes C');
      expect(post.embeds[0].media).toHaveLength(1);
      expect(post.embeds[0].media[0].alt).toBe('B photo');
      expect(post.embeds[1].author).toBe('Carol');
      expect(post.embeds[1].text).toBe('C has a photo');
    });

    it('does not loop forever on quote cycles', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('resolveHandle?handle=alice.bsky.social')) {
          return { ok: true, status: 200, text: JSON.stringify({ did: 'did:plc:alice' }) };
        }
        if (url.includes('getPostThread')) {
          const uriA = 'at://did:plc:alice/app.bsky.feed.post/3cyc-a';
          const uriB = 'at://did:plc:bob/app.bsky.feed.post/3cyc-b';
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              thread: {
                post: {
                  uri: uriA,
                  author: { handle: 'alice.bsky.social' },
                  record: { text: 'A quotes B' },
                  embed: {
                    $type: 'app.bsky.embed.record#view',
                    record: {
                      uri: uriB,
                      author: { handle: 'bob.bsky.social' },
                      value: { text: 'B quotes A back' },
                      embeds: [
                        {
                          $type: 'app.bsky.embed.record#view',
                          record: {
                            uri: uriA,
                            author: { handle: 'alice.bsky.social' },
                            value: { text: 'A quotes B' },
                            embeds: [],
                          },
                        },
                      ],
                    },
                  },
                },
                replies: [],
              },
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const post = await fetchSocialPost('https://bsky.app/profile/alice.bsky.social/post/3cyc-a');

      expect(post.embeds).toHaveLength(2);
      expect(post.embeds.map((embed) => embed.text)).toEqual(['B quotes A back', 'A quotes B']);
    });
  });

  describe('fetchSocialPost - Mastodon', () => {
    it('fetches a Mastodon status and its reply context', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('/api/v1/statuses/123/context')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              descendants: [
                {
                  content: '<p>Reply one</p>',
                  created_at: '2026-08-20T13:00:00.000Z',
                  account: { display_name: 'Replyer', acct: 'replyer@example.com' },
                },
              ],
            }),
          };
        }
        if (url.includes('/api/v1/statuses/123')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              content: '<p>Hello Mastodon!</p>',
              created_at: '2026-08-20T12:00:00.000Z',
              account: { display_name: 'Alice', acct: 'alice@example.com' },
              media_attachments: [
                { type: 'image', url: 'https://example.com/image.png', preview_url: 'https://example.com/image-preview.png', description: 'A picture' },
              ],
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const post = await fetchSocialPost('https://example.com/@alice/123');

      expect(post.platform).toBe('mastodon');
      expect(post.author).toBe('Alice');
      expect(post.handle).toBe('alice@example.com');
      expect(post.text).toBe('<p>Hello Mastodon!</p>');
      expect(post.media).toHaveLength(1);
      expect(post.media[0].fullsize).toBe('https://example.com/image.png');
      expect(post.media[0].thumb).toBe('https://example.com/image-preview.png');
      expect(post.comments).toHaveLength(1);
      expect(post.comments[0].author).toBe('Replyer');
      expect(post.comments[0].text).toBe('<p>Reply one</p>');
    });

    it('maps video attachments to playable video items', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('/api/v1/statuses/456/context')) {
          return { ok: true, status: 200, text: JSON.stringify({ descendants: [] }) };
        }
        if (url.includes('/api/v1/statuses/456')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              content: '<p>Watch this</p>',
              account: { display_name: 'Alice', acct: 'alice@example.com' },
              media_attachments: [
                {
                  type: 'video',
                  url: 'https://files.example.com/video.mp4',
                  preview_url: 'https://files.example.com/video-thumb.jpg',
                  description: 'A clip',
                },
              ],
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const post = await fetchSocialPost('https://example.com/@alice/456');

      // Videos must map to a video item the viewer can play inline, not
      // to an external card it would drop for lacking a uri.
      expect(post.media).toEqual([
        {
          type: 'video',
          gifv: false,
          thumb: 'https://files.example.com/video-thumb.jpg',
          fullsize: 'https://files.example.com/video.mp4',
          alt: 'A clip',
        },
      ]);
    });

    it('flags gifv attachments as looping videos', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('/api/v1/statuses/789/context')) {
          return { ok: true, status: 200, text: JSON.stringify({ descendants: [] }) };
        }
        if (url.includes('/api/v1/statuses/789')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              content: '<p>Loop</p>',
              account: { acct: 'alice@example.com' },
              media_attachments: [
                { type: 'gifv', url: 'https://files.example.com/clip.mp4', preview_url: null },
              ],
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const post = await fetchSocialPost('https://example.com/@alice/789');

      expect(post.media[0].type).toBe('video');
      expect(post.media[0].gifv).toBe(true);
      expect(post.media[0].fullsize).toBe('https://files.example.com/clip.mp4');
    });

    it('maps audio attachments to audio items', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('/api/v1/statuses/321/context')) {
          return { ok: true, status: 200, text: JSON.stringify({ descendants: [] }) };
        }
        if (url.includes('/api/v1/statuses/321')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              content: '<p>Listen</p>',
              account: { acct: 'alice@example.com' },
              media_attachments: [
                { type: 'audio', url: 'https://files.example.com/voice.mp3', preview_url: null },
              ],
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const post = await fetchSocialPost('https://example.com/@alice/321');

      expect(post.media[0].type).toBe('audio');
      expect(post.media[0].fullsize).toBe('https://files.example.com/voice.mp3');
    });
  });

  describe('enrichBlueskyFeedItems', () => {
    it('replaces the embed placeholder with quoted post text and media', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('resolveHandle?handle=alice')) {
          return { ok: true, status: 200, text: JSON.stringify({ did: 'did:plc:alice' }) };
        }
        if (url.includes('getPosts')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              posts: [
                {
                  uri: 'at://did:plc:alice/app.bsky.feed.post/3abc',
                  embed: {
                    $type: 'app.bsky.embed.recordWithMedia#view',
                    record: {
                      record: {
                        author: { handle: 'bob.bsky.social', displayName: 'Bob' },
                        value: { text: 'Quoted post text' },
                        embeds: [
                          {
                            images: [
                              { thumb: 'https://cdn.example/quoted-thumb.jpg', fullsize: 'https://cdn.example/quoted.jpg', alt: 'Quoted image' },
                            ],
                          },
                        ],
                      },
                    },
                    media: {
                      images: [
                        { thumb: 'https://cdn.example/main-thumb.jpg', fullsize: 'https://cdn.example/main.jpg', alt: 'Main image' },
                      ],
                    },
                  },
                },
              ],
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const items = [
        {
          uniqueID: 'https://bsky.app/profile/alice/post/3abc',
          url: 'https://bsky.app/profile/alice/post/3abc',
          title: 'Post title',
          contentText: 'Main text\n\n[contains quote post or other embedded content]',
          contentHTML: '<p>Main text</p><p>[contains quote post or other embedded content]</p>',
          summary: 'Main text [contains quote post or other embedded content]',
        },
      ];

      const enriched = await enrichBlueskyFeedItems('https://bsky.app/profile/alice/rss', items);

      expect(enriched[0].contentText).toContain('Quoted post text');
      expect(enriched[0].contentText).not.toContain('[contains quote post');
      expect(enriched[0].summary).toContain('Bob');
      expect(enriched[0].contentHTML).toContain('blockquote');
      expect(enriched[0].contentHTML).toContain('main-thumb.jpg');
      expect(enriched[0].contentHTML).toContain('quoted-thumb.jpg');
    });

    it('enriches plain posts with line-break formatting', async () => {
      fetchText.mockImplementation(async (url) => {
        if (url.includes('resolveHandle?handle=alice')) {
          return { ok: true, status: 200, text: JSON.stringify({ did: 'did:plc:alice' }) };
        }
        if (url.includes('getPosts')) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              posts: [
                {
                  uri: 'at://did:plc:alice/app.bsky.feed.post/3def',
                  embed: undefined,
                },
              ],
            }),
          };
        }
        return { ok: false, status: 404, text: 'Not found' };
      });

      const items = [
        {
          uniqueID: 'https://bsky.app/profile/alice/post/3def',
          url: 'https://bsky.app/profile/alice/post/3def',
          title: 'Plain post',
          contentText: 'Line one\nLine two',
          contentHTML: '<p>Line one Line two</p>',
          summary: 'Line one Line two',
        },
      ];

      const enriched = await enrichBlueskyFeedItems('https://bsky.app/profile/alice/rss', items);

      expect(fetchText).toHaveBeenCalled();
      expect(enriched[0].contentHTML).toContain('<br>');
      expect(enriched[0].contentText).toBe('Line one\nLine two');
    });
  });
});
