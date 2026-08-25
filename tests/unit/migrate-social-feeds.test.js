/**
 * Migrate Social Feeds Unit Tests
 *
 * Tests the one-time conversion of synthetic Bluesky/Mastodon profile
 * feeds into real RSS/Atom feeds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/database.js', () => ({
  updateFeedOpenOriginalByDefault: vi.fn(),
}));

vi.mock('../../src/lib/feed-manager.js', () => ({
  loadAllFeeds: vi.fn(),
  deleteFeed: vi.fn(),
  addFeed: vi.fn(),
}));

vi.mock('../../src/lib/feed-finder.js', () => ({
  findFeeds: vi.fn(),
}));

import { updateFeedOpenOriginalByDefault } from '../../src/lib/database.js';
import { loadAllFeeds, deleteFeed, addFeed } from '../../src/lib/feed-manager.js';
import { findFeeds } from '../../src/lib/feed-finder.js';
import { convertSyntheticSocialFeeds } from '../../src/lib/migrate-social-feeds.js';

describe('migrate-social-feeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts a synthetic Bluesky profile feed to its RSS feed', async () => {
    loadAllFeeds.mockResolvedValue([
      {
        feedID: 'old-bluesky',
        url: 'https://bsky.app/profile/handle.bsky.social',
        name: 'Bluesky (Generated Feed)',
        synthetic: true,
        openOriginalByDefault: false,
        articles: [],
      },
    ]);

    findFeeds.mockResolvedValue([
      {
        url: 'https://bsky.app/profile/handle.bsky.social/rss',
        title: '@handle.bsky.social on Bluesky',
        score: 95,
      },
    ]);

    addFeed.mockResolvedValue({
      feedID: 'new-bluesky',
      url: 'https://bsky.app/profile/handle.bsky.social/rss',
      name: '@handle.bsky.social on Bluesky',
    });

    const result = await convertSyntheticSocialFeeds();

    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('Bluesky');
    expect(result[0].oldUrl).toBe('https://bsky.app/profile/handle.bsky.social');
    expect(result[0].newUrl).toBe('https://bsky.app/profile/handle.bsky.social/rss');
    expect(addFeed).toHaveBeenCalledWith('https://bsky.app/profile/handle.bsky.social/rss');
    expect(deleteFeed).toHaveBeenCalledWith('old-bluesky');
  });

  it('converts a synthetic Mastodon profile feed to its Atom feed', async () => {
    loadAllFeeds.mockResolvedValue([
      {
        feedID: 'old-mastodon',
        url: 'https://mastodon.social/@handle',
        name: 'Mastodon (Generated Feed)',
        synthetic: true,
        openOriginalByDefault: true,
        articles: [],
      },
    ]);

    findFeeds.mockResolvedValue([
      {
        url: 'https://mastodon.social/@handle.atom',
        title: '@handle on mastodon.social',
        score: 95,
      },
    ]);

    addFeed.mockResolvedValue({
      feedID: 'new-mastodon',
      url: 'https://mastodon.social/@handle.atom',
      name: '@handle on mastodon.social',
    });

    const result = await convertSyntheticSocialFeeds();

    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('Mastodon');
    expect(result[0].newUrl).toBe('https://mastodon.social/@handle.atom');
    expect(updateFeedOpenOriginalByDefault).toHaveBeenCalledWith('new-mastodon', true);
    expect(deleteFeed).toHaveBeenCalledWith('old-mastodon');
  });

  it('skips non-synthetic feeds', async () => {
    loadAllFeeds.mockResolvedValue([
      {
        feedID: 'real-feed',
        url: 'https://bsky.app/profile/handle.bsky.social/rss',
        name: 'Real Bluesky Feed',
        synthetic: false,
        openOriginalByDefault: false,
        articles: [],
      },
    ]);

    const result = await convertSyntheticSocialFeeds();

    expect(result).toHaveLength(0);
    expect(findFeeds).not.toHaveBeenCalled();
    expect(addFeed).not.toHaveBeenCalled();
    expect(deleteFeed).not.toHaveBeenCalled();
  });

  it('skips synthetic feeds that are not Bluesky or Mastodon', async () => {
    loadAllFeeds.mockResolvedValue([
      {
        feedID: 'old-github',
        url: 'https://github.com/user/repo',
        name: 'GitHub (Generated Feed)',
        synthetic: true,
        openOriginalByDefault: false,
        articles: [],
      },
    ]);

    const result = await convertSyntheticSocialFeeds();

    expect(result).toHaveLength(0);
    expect(findFeeds).not.toHaveBeenCalled();
  });

  it('does not delete the old feed when the real feed cannot be validated', async () => {
    loadAllFeeds.mockResolvedValue([
      {
        feedID: 'old-bluesky',
        url: 'https://bsky.app/profile/handle.bsky.social',
        name: 'Bluesky (Generated Feed)',
        synthetic: true,
        openOriginalByDefault: false,
        articles: [],
      },
    ]);

    findFeeds.mockResolvedValue([]);

    const result = await convertSyntheticSocialFeeds();

    expect(result).toHaveLength(0);
    expect(addFeed).not.toHaveBeenCalled();
    expect(deleteFeed).not.toHaveBeenCalled();
  });

  it('does not delete the old feed when adding the real feed fails', async () => {
    loadAllFeeds.mockResolvedValue([
      {
        feedID: 'old-bluesky',
        url: 'https://bsky.app/profile/handle.bsky.social',
        name: 'Bluesky (Generated Feed)',
        synthetic: true,
        openOriginalByDefault: false,
        articles: [],
      },
    ]);

    findFeeds.mockResolvedValue([
      {
        url: 'https://bsky.app/profile/handle.bsky.social/rss',
        title: '@handle.bsky.social on Bluesky',
        score: 95,
      },
    ]);

    addFeed.mockResolvedValue(null);

    const result = await convertSyntheticSocialFeeds();

    expect(result).toHaveLength(0);
    expect(deleteFeed).not.toHaveBeenCalled();
  });
});
