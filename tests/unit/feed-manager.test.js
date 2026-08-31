/**
 * Feed Manager Unit Tests
 *
 * Tests the refresh orchestration helpers in src/lib/feed-manager.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/database.js', () => ({
  saveFeed: vi.fn(),
  saveFeedMetadata: vi.fn(),
  saveArticles: vi.fn(),
  deleteArticlesNotInSet: vi.fn(),
  purgeOldReadArticles: vi.fn(),
  listPrunableDownloadedVideos: vi.fn(),
  runDatabaseMaintenance: vi.fn(),
  loadAllFeeds: vi.fn(),
  loadFeedsForDisplay: vi.fn(),
  loadDownloadedArticles: vi.fn(),
  loadFeed: vi.fn(),
  deleteFeed: vi.fn(),
  updateArticleStatus: vi.fn(),
  markAllArticlesAsRead: vi.fn(),
  savePageSnapshot: vi.fn(),
  loadPageSnapshot: vi.fn(),
  recordDownloadedVideo: vi.fn(),
  deleteDownloadedVideosForArticle: vi.fn(),
  deleteDownloadedVideosForFeed: vi.fn(),
}));

vi.mock('../../src/lib/rss-network.js', () => ({
  fetchText: vi.fn(),
}));

vi.mock('../../src/lib/rss-parser.js', () => ({
  parseFeedText: vi.fn(),
}));

vi.mock('../../src/lib/feed-finder.js', () => ({
  findFeeds: vi.fn(),
}));

vi.mock('../../src/lib/html-to-rss.js', () => ({
  generateRSSFromHTML: vi.fn(),
}));

vi.mock('../../src/lib/article-processor.js', () => ({
  processNewArticles: vi.fn(),
  updateExistingArticles: vi.fn(),
  mergeArticles: vi.fn(),
}));

vi.mock('../../src/lib/feed-refresh-bridge.js', () => ({
  refreshFeedInWorker: vi.fn(),
}));

vi.mock('../../src/lib/youtube-bridge.js', () => ({
  downloadYouTubeVideo: vi.fn(),
  deleteDownloadedVideo: vi.fn(),
}));

import {
  loadAllFeeds,
  loadFeed,
  saveFeed,
  saveFeedMetadata,
  saveArticles,
  deleteArticlesNotInSet,
  purgeOldReadArticles,
  runDatabaseMaintenance,
  savePageSnapshot,
  loadPageSnapshot,
  deleteFeed as dbDeleteFeed,
} from '../../src/lib/database.js';
import { fetchText } from '../../src/lib/rss-network.js';
import { parseFeedText } from '../../src/lib/rss-parser.js';
import {
  processNewArticles,
  updateExistingArticles,
  mergeArticles,
} from '../../src/lib/article-processor.js';
import { refreshFeedInWorker } from '../../src/lib/feed-refresh-bridge.js';
import { downloadYouTubeVideo, deleteDownloadedVideo } from '../../src/lib/youtube-bridge.js';

async function importFeedManager() {
  return await import('../../src/lib/feed-manager.js');
}

describe('feed manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    fetchText.mockResolvedValue({ ok: true, status: 200, text: '<rss/>' });
    parseFeedText.mockResolvedValue({
      title: 'Mock Feed',
      homePageURL: 'https://example.com',
      items: [],
    });

    processNewArticles.mockReturnValue([]);
    updateExistingArticles.mockReturnValue([]);
    mergeArticles.mockReturnValue([]);

    saveFeed.mockResolvedValue(undefined);
    saveFeedMetadata.mockResolvedValue(undefined);
    saveArticles.mockResolvedValue(undefined);
    deleteArticlesNotInSet.mockResolvedValue(undefined);
    purgeOldReadArticles.mockResolvedValue(undefined);
    runDatabaseMaintenance.mockResolvedValue(undefined);
    savePageSnapshot.mockResolvedValue(undefined);
    loadPageSnapshot.mockResolvedValue(null);
    downloadYouTubeVideo.mockResolvedValue({ filePath: '/downloads/Aaron-RSS-YouTube/video.mp4' });

    refreshFeedInWorker.mockImplementation(({ existingFeed }) => {
      return Promise.resolve({
        ...existingFeed,
        lastFetchWasSuccessful: true,
        lastFetchEndTime: new Date(),
        articles: existingFeed.articles || [],
      });
    });
  });

  it('refreshAllFeeds reports progress for each feed', async () => {
    const feeds = [
      { feedID: 'feed-a', url: 'https://alpha.example.com/feed', name: 'Alpha', synthetic: false, articles: [] },
      { feedID: 'feed-b', url: 'https://beta.example.com/feed', name: 'Beta', synthetic: false, articles: [] },
    ];

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockImplementation((feedID) => {
      return Promise.resolve(feeds.find((f) => f.feedID === feedID));
    });

    const { refreshAllFeeds } = await importFeedManager();
    const progress = [];

    await refreshAllFeeds(50, (payload) => progress.push(payload));

    expect(progress).toHaveLength(2);
    expect(progress[0]).toEqual({ feed: feeds[0], index: 0, total: 2 });
    expect(progress[1]).toEqual({ feed: feeds[1], index: 1, total: 2 });
    expect(progress[0].feed.name).toBe('Alpha');
    expect(progress[1].feed.name).toBe('Beta');
  });

  it('refreshAllFeeds returns success when a feed refreshes', async () => {
    const feeds = [
      { feedID: 'feed-a', url: 'https://alpha.example.com/feed', name: 'Alpha', synthetic: false, articles: [] },
    ];

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockResolvedValue(feeds[0]);

    const { refreshAllFeeds } = await importFeedManager();
    const results = await refreshAllFeeds(50);

    expect(results).toHaveLength(1);
    expect(results[0].feedID).toBe('feed-a');
    expect(results[0].success).toBe(true);
  });

  it('refreshAllFeeds calls onFeedUpdated after each feed is refreshed', async () => {
    const feeds = [
      { feedID: 'feed-a', url: 'https://alpha.example.com/feed', name: 'Alpha', synthetic: false, articles: [] },
      { feedID: 'feed-b', url: 'https://beta.example.com/feed', name: 'Beta', synthetic: false, articles: [] },
    ];

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockImplementation((feedID) => {
      return Promise.resolve(feeds.find((f) => f.feedID === feedID));
    });

    const { refreshAllFeeds } = await importFeedManager();
    const updatedFeeds = [];

    await refreshAllFeeds(50, null, (feed) => updatedFeeds.push(feed));

    expect(updatedFeeds).toHaveLength(2);
    expect(updatedFeeds[0].feedID).toBe('feed-a');
    expect(updatedFeeds[1].feedID).toBe('feed-b');
  });

  it('refreshFeed offloads parsing and merging to the worker', async () => {
    const feeds = [
      { feedID: 'feed-a', url: 'https://alpha.example.com/feed', name: 'Alpha', synthetic: false, articles: [] },
    ];

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockResolvedValue(feeds[0]);
    fetchText.mockResolvedValue({ ok: true, status: 200, text: '<rss/>' });

    const { refreshFeed } = await importFeedManager();
    await refreshFeed('feed-a', 25);

    expect(refreshFeedInWorker).toHaveBeenCalledWith({
      feedText: '<rss/>',
      htmlText: undefined,
      existingFeed: feeds[0],
      maxArticles: 25,
    });
  });

  it('refreshFeed passes HTML text to the worker for synthetic feeds', async () => {
    const feeds = [
      { feedID: 'feed-a', url: 'https://alpha.example.com', name: 'Alpha', synthetic: true, articles: [] },
    ];

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockResolvedValue(feeds[0]);
    fetchText.mockResolvedValue({ ok: true, status: 200, text: '<html/>' });

    const { refreshFeed } = await importFeedManager();
    await refreshFeed('feed-a', 50);

    expect(refreshFeedInWorker).toHaveBeenCalledWith({
      feedText: undefined,
      htmlText: '<html/>',
      existingFeed: feeds[0],
      maxArticles: 50,
    });
  });

  it('refreshFeed parses and enriches Bluesky feeds on the main thread', async () => {
    const feeds = [
      { feedID: 'feed-bsky', url: 'https://bsky.app/profile/alice/rss', name: 'Alice', synthetic: false, articles: [] },
    ];

    const parsedFeed = {
      title: 'Alice',
      homePageURL: 'https://bsky.app/profile/alice',
      items: [
        {
          uniqueID: 'https://bsky.app/profile/alice/post/3abc',
          url: 'https://bsky.app/profile/alice/post/3abc',
          title: 'Post',
          contentText: 'Hello',
          summary: 'Hello',
        },
      ],
    };

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockResolvedValue(feeds[0]);
    fetchText.mockResolvedValue({ ok: true, status: 200, text: '<rss/>' });
    parseFeedText.mockResolvedValue(parsedFeed);

    const { refreshFeed } = await importFeedManager();
    await refreshFeed('feed-bsky', 25);

    expect(parseFeedText).toHaveBeenCalledWith('<rss/>', feeds[0].url);
    expect(refreshFeedInWorker).toHaveBeenCalledWith({
      parsedFeed,
      existingFeed: feeds[0],
      maxArticles: 25,
    });
  });

  it('refreshFeed saves a failed feed without calling the worker when fetch fails', async () => {
    const feeds = [
      { feedID: 'feed-a', url: 'https://alpha.example.com/feed', name: 'Alpha', synthetic: false, articles: [] },
    ];

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockResolvedValue(feeds[0]);
    fetchText.mockResolvedValue({ ok: false, status: 404, text: 'Not found' });

    const { refreshFeed } = await importFeedManager();
    await refreshFeed('feed-a');

    expect(refreshFeedInWorker).not.toHaveBeenCalled();
    expect(saveFeedMetadata).toHaveBeenCalled();
    expect(saveArticles).not.toHaveBeenCalled();
  });

  it('refreshFeed no longer auto-downloads YouTube videos even when a feed was previously opted in', async () => {
    const feeds = [
      {
        feedID: 'feed-yt',
        url: 'https://example.com/feed',
        name: 'YouTube Feed',
        synthetic: false,
        // Legacy setting may still be stored; it must not trigger downloads.
        autoDownloadYouTube: true,
        articles: [
          {
            articleID: 'art1',
            uniqueID: 'u1',
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            read: false,
            starred: false,
          },
        ],
      },
    ];

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockResolvedValue(feeds[0]);
    fetchText.mockResolvedValue({ ok: true, status: 200, text: '<rss/>' });

    const { refreshFeed } = await importFeedManager();
    await refreshFeed('feed-yt', 50);

    expect(downloadYouTubeVideo).not.toHaveBeenCalled();
  });

  describe('downloadArticleYouTubeVideo (manual downloads)', () => {
    it('downloads the article video and persists the download path', async () => {
      const { updateArticleStatus } = await import('../../src/lib/database.js');
      const { downloadArticleYouTubeVideo } = await importFeedManager();

      const feed = { feedID: 'feed-yt' };
      const article = {
        articleID: 'art1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      };

      const result = await downloadArticleYouTubeVideo(feed, article);

      expect(result.filePath).toBe('/downloads/Aaron-RSS-YouTube/video.mp4');
      expect(downloadYouTubeVideo).toHaveBeenCalledWith(article.url);
      expect(updateArticleStatus).toHaveBeenCalledWith(
        'feed-yt',
        'art1',
        { downloadPath: '/downloads/Aaron-RSS-YouTube/video.mp4' }
      );
      expect(article.downloadPath).toBe('/downloads/Aaron-RSS-YouTube/video.mp4');
    });

    it('rejects non-YouTube URLs without invoking the downloader', async () => {
      const { downloadArticleYouTubeVideo } = await importFeedManager();

      const result = await downloadArticleYouTubeVideo(
        { feedID: 'feed-yt' },
        { articleID: 'art1', url: 'https://example.com/post' }
      );

      expect(result.error).toContain('Not a downloadable YouTube video');
      expect(downloadYouTubeVideo).not.toHaveBeenCalled();
    });

    it('skips re-downloading when the article already has a saved file', async () => {
      const { updateArticleStatus } = await import('../../src/lib/database.js');
      const { downloadArticleYouTubeVideo } = await importFeedManager();

      const article = {
        articleID: 'art1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        downloadPath: '/downloads/Aaron-RSS-YouTube/existing.mp4',
      };

      const result = await downloadArticleYouTubeVideo({ feedID: 'feed-yt' }, article);

      expect(result.filePath).toBe('/downloads/Aaron-RSS-YouTube/existing.mp4');
      expect(downloadYouTubeVideo).not.toHaveBeenCalled();
      expect(updateArticleStatus).not.toHaveBeenCalled();
    });

    it('surfaces downloader errors without persisting a path', async () => {
      const { updateArticleStatus } = await import('../../src/lib/database.js');
      downloadYouTubeVideo.mockResolvedValueOnce({ error: 'boom' });
      const { downloadArticleYouTubeVideo } = await importFeedManager();

      const article = {
        articleID: 'art1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      };

      const result = await downloadArticleYouTubeVideo({ feedID: 'feed-yt' }, article);

      expect(result.error).toBe('boom');
      expect(updateArticleStatus).not.toHaveBeenCalled();
      expect(article.downloadPath).toBeUndefined();
    });

    it('records a downloaded_videos queue row on success', async () => {
      const { recordDownloadedVideo } = await import('../../src/lib/database.js');
      const { downloadArticleYouTubeVideo } = await importFeedManager();

      const feed = { feedID: 'feed-yt' };
      const article = {
        articleID: 'art1',
        title: 'My Video',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      };

      await downloadArticleYouTubeVideo(feed, article);

      expect(recordDownloadedVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          feedID: 'feed-yt',
          articleID: 'art1',
          youtubeURL: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          filePath: '/downloads/Aaron-RSS-YouTube/video.mp4',
          title: 'My Video',
        })
      );
    });

    it('does not record a queue row when the download fails', async () => {
      const { recordDownloadedVideo } = await import('../../src/lib/database.js');
      const { downloadArticleYouTubeVideo } = await importFeedManager();

      downloadYouTubeVideo.mockResolvedValue({ error: 'boom' });
      const feed = { feedID: 'feed-yt' };
      const article = {
        articleID: 'art1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      };

      const result = await downloadArticleYouTubeVideo(feed, article);

      expect(result.error).toBe('boom');
      expect(recordDownloadedVideo).not.toHaveBeenCalled();
    });

    it('deleteArticleYouTubeVideo removes file, record, and clears the article pointer', async () => {
      const { deleteDownloadedVideosForArticle, updateArticleStatus } = await import(
        '../../src/lib/database.js'
      );
      const { deleteArticleYouTubeVideo } = await importFeedManager();

      await deleteArticleYouTubeVideo('feed-yt', 'art1', '/downloads/Aaron-RSS-YouTube/video.mp4');

      expect(deleteDownloadedVideo).toHaveBeenCalledWith('/downloads/Aaron-RSS-YouTube/video.mp4');
      expect(deleteDownloadedVideosForArticle).toHaveBeenCalledWith('feed-yt', 'art1');
      expect(updateArticleStatus).toHaveBeenCalledWith('feed-yt', 'art1', { downloadPath: null });
    });

    it('deleteFeed removes downloaded_videos records for the feed', async () => {
      const { deleteDownloadedVideosForFeed } = await import('../../src/lib/database.js');
      const { deleteFeed } = await importFeedManager();

      await deleteFeed('feed-yt');

      expect(deleteDownloadedVideosForFeed).toHaveBeenCalledWith('feed-yt');
    });

    it('purgeOldReadArticles deletes pruned videos (file + record) before purging articles', async () => {
      const { listPrunableDownloadedVideos, deleteDownloadedVideosForArticle, purgeOldReadArticles } =
        await import('../../src/lib/database.js');
      const { purgeOldReadArticles: purgeWithCleanup } = await importFeedManager();

      listPrunableDownloadedVideos.mockResolvedValue([
        { articleID: 'art1', downloadPath: '/downloads/a.mp4' },
        { articleID: 'art2', downloadPath: '/downloads/b.mp4' },
      ]);

      await purgeWithCleanup('feed-yt', 45);

      expect(deleteDownloadedVideo).toHaveBeenCalledWith('/downloads/a.mp4');
      expect(deleteDownloadedVideo).toHaveBeenCalledWith('/downloads/b.mp4');
      expect(deleteDownloadedVideosForArticle).toHaveBeenCalledWith('feed-yt', 'art1');
      expect(deleteDownloadedVideosForArticle).toHaveBeenCalledWith('feed-yt', 'art2');
      expect(purgeOldReadArticles).toHaveBeenCalledWith('feed-yt', 45);
    });

    it('purgeOldReadArticles still purges articles when a video file delete fails', async () => {
      const { listPrunableDownloadedVideos, deleteDownloadedVideosForArticle, purgeOldReadArticles } =
        await import('../../src/lib/database.js');
      const { purgeOldReadArticles: purgeWithCleanup } = await importFeedManager();

      listPrunableDownloadedVideos.mockResolvedValue([
        { articleID: 'art1', downloadPath: '/downloads/a.mp4' },
      ]);
      deleteDownloadedVideo.mockRejectedValue(new Error('ENOENT'));

      await purgeWithCleanup('feed-yt');

      expect(deleteDownloadedVideosForArticle).toHaveBeenCalledWith('feed-yt', 'art1');
      expect(purgeOldReadArticles).toHaveBeenCalledWith('feed-yt');
    });

    it('purgeOldReadArticles purges articles when no videos are prunable', async () => {
      const { listPrunableDownloadedVideos, purgeOldReadArticles } = await import(
        '../../src/lib/database.js'
      );
      const { purgeOldReadArticles: purgeWithCleanup } = await importFeedManager();

      listPrunableDownloadedVideos.mockResolvedValue([]);

      await purgeWithCleanup('feed-yt');

      expect(deleteDownloadedVideo).not.toHaveBeenCalled();
      expect(purgeOldReadArticles).toHaveBeenCalledWith('feed-yt');
    });
  });

  describe('snapshot feeds (watched pages)', () => {
    const SNAPSHOT_HTML = `
      <html>
        <head><title>Watched Journal</title></head>
        <body>
          <a href="/posts/old.html">Old Post</a>
          <a href="/posts/fresh.html">Fresh Post</a>
        </body>
      </html>
    `;

    it('addSnapshotFeed stores an initial link snapshot with an empty feed', async () => {
      fetchText.mockResolvedValue({ ok: true, status: 200, text: SNAPSHOT_HTML });
      const { addSnapshotFeed } = await importFeedManager();

      const feed = await addSnapshotFeed('https://example.com/journal/');

      expect(feed).not.toBeNull();
      expect(feed.name).toBe('Watched Journal (Watched Page)');
      // Deliberately empty until the page changes.
      expect(feed.articles).toEqual([]);
      expect(feed.synthetic).toBe(true);
      expect(savePageSnapshot).toHaveBeenCalledWith(
        feed.feedID,
        expect.arrayContaining([
          'https://example.com/posts/old.html',
          'https://example.com/posts/fresh.html',
        ]),
      );
      expect(saveFeed).toHaveBeenCalled();
    });

    it('addSnapshotFeed returns null when the page cannot be fetched', async () => {
      fetchText.mockResolvedValue({ ok: false, status: 404, text: 'nope' });
      const { addSnapshotFeed } = await importFeedManager();

      const feed = await addSnapshotFeed('https://example.com/journal/');

      expect(feed).toBeNull();
      expect(savePageSnapshot).not.toHaveBeenCalled();
      expect(saveFeed).not.toHaveBeenCalled();
    });

    it('refreshFeed diffs links against the stored snapshot for watched pages', async () => {
      const feeds = [
        {
          feedID: 'feed-snap',
          url: 'https://example.com/journal/',
          name: 'Journal',
          synthetic: true,
          articles: [],
        },
      ];

      loadFeed.mockResolvedValue(feeds[0]);
      loadPageSnapshot.mockResolvedValue({
        feedID: 'feed-snap',
        links: ['https://example.com/posts/old.html'],
        capturedAt: new Date('2025-01-01T00:00:00Z'),
      });
      fetchText.mockResolvedValue({ ok: true, status: 200, text: SNAPSHOT_HTML });
      // Echo the refreshed snapshot back the way the real worker does.
      refreshFeedInWorker.mockImplementationOnce(({ existingFeed }) =>
        Promise.resolve({
          ...existingFeed,
          snapshotLinks: [
            'https://example.com/posts/old.html',
            'https://example.com/posts/fresh.html',
          ],
        }),
      );

      const { refreshFeed } = await importFeedManager();
      await refreshFeed('feed-snap', 50);

      // The worker receives the previous snapshot for link diffing.
      expect(refreshFeedInWorker).toHaveBeenCalledWith({
        feedText: undefined,
        htmlText: SNAPSHOT_HTML,
        snapshotLinks: ['https://example.com/posts/old.html'],
        existingFeed: feeds[0],
        maxArticles: 50,
      });

      // The refreshed snapshot is persisted before saving the feed.
      expect(savePageSnapshot).toHaveBeenCalledWith(
        'feed-snap',
        expect.arrayContaining([
          'https://example.com/posts/old.html',
          'https://example.com/posts/fresh.html',
        ]),
      );
    });

    it('refreshFeed uses the plain HTML path for non-snapshot synthetic feeds', async () => {
      const feeds = [
        { feedID: 'feed-html', url: 'https://example.com', name: 'HTML', synthetic: true, articles: [] },
      ];

      loadFeed.mockResolvedValue(feeds[0]);
      fetchText.mockResolvedValue({ ok: true, status: 200, text: '<html/>' });

      const { refreshFeed } = await importFeedManager();
      await refreshFeed('feed-html', 50);

      expect(loadPageSnapshot).toHaveBeenCalledWith('feed-html');
      expect(refreshFeedInWorker).toHaveBeenCalledWith({
        feedText: undefined,
        htmlText: '<html/>',
        existingFeed: feeds[0],
        maxArticles: 50,
      });
    });
  });

  it('refreshFeed upserts articles and cleans up old read items after worker returns', async () => {
    const feeds = [
      { feedID: 'feed-a', url: 'https://alpha.example.com/feed', name: 'Alpha', synthetic: false, articles: [] },
    ];

    const updatedArticles = [
      {
        articleID: 'art1',
        uniqueID: 'u1',
        title: 'New Article',
        read: false,
        starred: false,
        dateArrived: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockResolvedValue(feeds[0]);
    fetchText.mockResolvedValue({ ok: true, status: 200, text: '<rss/>' });
    refreshFeedInWorker.mockResolvedValue({
      ...feeds[0],
      articles: updatedArticles,
      lastFetchWasSuccessful: true,
      lastFetchEndTime: new Date(),
    });

    const { refreshFeed } = await importFeedManager();
    await refreshFeed('feed-a', 50);

    expect(saveFeedMetadata).toHaveBeenCalled();
    expect(saveArticles).toHaveBeenCalledWith('feed-a', updatedArticles);
    expect(deleteArticlesNotInSet).toHaveBeenCalledWith('feed-a', ['art1']);
    expect(purgeOldReadArticles).toHaveBeenCalledWith('feed-a');
  });

  it('refreshAllFeeds runs database maintenance after finishing', async () => {
    const feeds = [
      { feedID: 'feed-a', url: 'https://alpha.example.com/feed', name: 'Alpha', synthetic: false, articles: [] },
    ];

    loadAllFeeds.mockResolvedValue(feeds);
    loadFeed.mockResolvedValue(feeds[0]);

    const { refreshAllFeeds } = await importFeedManager();
    await refreshAllFeeds(50);

    expect(runDatabaseMaintenance).toHaveBeenCalledTimes(1);
  });

  describe('deleteFeed (storage cleanup)', () => {
    it('deletes downloaded YouTube videos before removing the feed from the database', async () => {
      const feed = {
        feedID: 'feed-yt',
        url: 'https://example.com/feed',
        name: 'YouTube Feed',
        articles: [
          { articleID: 'art1', downloadPath: '/downloads/Aaron-RSS-YouTube/video1.mp4' },
          { articleID: 'art2', downloadPath: '/downloads/Aaron-RSS-YouTube/video2.mp4' },
          { articleID: 'art3' },
        ],
      };

      loadFeed.mockResolvedValue(feed);
      dbDeleteFeed.mockResolvedValue(undefined);
      deleteDownloadedVideo.mockResolvedValue(true);

      const { deleteFeed } = await importFeedManager();
      await deleteFeed('feed-yt');

      expect(loadFeed).toHaveBeenCalledWith('feed-yt');
      expect(deleteDownloadedVideo).toHaveBeenCalledTimes(2);
      expect(deleteDownloadedVideo).toHaveBeenCalledWith('/downloads/Aaron-RSS-YouTube/video1.mp4');
      expect(deleteDownloadedVideo).toHaveBeenCalledWith('/downloads/Aaron-RSS-YouTube/video2.mp4');
      expect(dbDeleteFeed).toHaveBeenCalledWith('feed-yt');
    });

    it('continues deleting the feed even when video deletion fails', async () => {
      const feed = {
        feedID: 'feed-yt',
        url: 'https://example.com/feed',
        name: 'YouTube Feed',
        articles: [
          { articleID: 'art1', downloadPath: '/downloads/Aaron-RSS-YouTube/video1.mp4' },
        ],
      };

      loadFeed.mockResolvedValue(feed);
      dbDeleteFeed.mockResolvedValue(undefined);
      deleteDownloadedVideo.mockRejectedValue(new Error('disk busy'));

      const { deleteFeed } = await importFeedManager();
      await expect(deleteFeed('feed-yt')).resolves.toBeUndefined();

      expect(deleteDownloadedVideo).toHaveBeenCalledWith('/downloads/Aaron-RSS-YouTube/video1.mp4');
      expect(dbDeleteFeed).toHaveBeenCalledWith('feed-yt');
    });

    it('removes the feed from the database when there are no downloaded videos', async () => {
      const feed = {
        feedID: 'feed-text',
        url: 'https://example.com/feed',
        name: 'Text Feed',
        articles: [{ articleID: 'art1' }],
      };

      loadFeed.mockResolvedValue(feed);
      dbDeleteFeed.mockResolvedValue(undefined);

      const { deleteFeed } = await importFeedManager();
      await deleteFeed('feed-text');

      expect(deleteDownloadedVideo).not.toHaveBeenCalled();
      expect(dbDeleteFeed).toHaveBeenCalledWith('feed-text');
    });
  });
});
