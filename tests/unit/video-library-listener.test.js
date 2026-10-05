/**
 * Video Library Listener Unit Tests
 *
 * Every finished download lands in the library through feed-manager's
 * recordDownloadedVideo calls — the article "Download Video" button, the
 * command-menu download by URL, and the background auto-download during
 * refreshes alike. feed-manager notifies onVideoLibraryChanged
 * subscribers right after the record is written, which is what lets the
 * Videos view re-render in place the moment a download finishes instead
 * of waiting for the next view switch.
 *
 * These tests pin that contract: the notification fires on the two
 * download paths, only after a successful library write, never on
 * failure, and a broken listener cannot break the download itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/database.js', () => ({
  saveFeed: vi.fn(),
  saveFeedMetadata: vi.fn(),
  saveArticles: vi.fn(),
  deleteArticlesNotInSet: vi.fn(),
  deleteArticle: vi.fn(),
  purgeOldReadArticles: vi.fn(),
  listPrunableDownloadedVideos: vi.fn(),
  runDatabaseMaintenance: vi.fn(),
  loadAllFeeds: vi.fn(),
  loadFeedsForDisplay: vi.fn(),
  listFeedsForRefresh: vi.fn(),
  loadFeed: vi.fn(),
  loadFeedForRefresh: vi.fn(),
  deleteFeed: vi.fn(),
  updateArticleStatus: vi.fn(),
  markAllArticlesAsRead: vi.fn(),
  savePageSnapshot: vi.fn(),
  loadPageSnapshot: vi.fn(),
  recordDownloadedVideo: vi.fn(),
  getDownloadedVideoForURL: vi.fn(),
  deleteDownloadedVideosForArticle: vi.fn(),
  deleteDownloadedVideosForFeed: vi.fn(),
  loadDownloadedArticles: vi.fn(),
  loadReadLaterArticles: vi.fn(),
  loadDownloadedPodcastArticles: vi.fn(),
  deleteDownloadedVideoRecordsForArticleID: vi.fn(),
  listFeedIDsInResearchTopics: vi.fn(),
  saveArticleMarkdown: vi.fn(),
  listClearedUniqueIDs: vi.fn(),
  listTopicDownloadedVideos: vi.fn(),
  clearResearchTopicArticles: vi.fn(),
}));

vi.mock('../../src/lib/rss-network.js', () => ({
  fetchText: vi.fn(),
  normalizeFeedURL: (url) => url,
}));

vi.mock('../../src/lib/rss-parser.js', () => ({
  parseFeedText: vi.fn(),
}));

vi.mock('../../src/lib/feed-finder.js', () => ({
  findFeeds: vi.fn(),
}));

vi.mock('../../src/lib/article-extractor.js', () => ({
  extractArticle: vi.fn(),
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

vi.mock('../../src/lib/podcast-bridge.js', () => ({
  downloadPodcastFile: vi.fn(),
  deleteDownloadedPodcast: vi.fn(),
  isPodcastDownloadAvailable: vi.fn(() => true),
}));

import { updateArticleStatus, recordDownloadedVideo, getDownloadedVideoForURL } from '../../src/lib/database.js';
import { downloadYouTubeVideo } from '../../src/lib/youtube-bridge.js';

const ARTICLE = {
  articleID: 'art1',
  title: 'My Video',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
};
const FEED = { feedID: 'feed-yt' };
const DOWNLOAD_URL = 'https://www.youtube.com/watch?v=manual12345';

describe('video library listener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadYouTubeVideo.mockResolvedValue({ filePath: '/downloads/video.mp4' });
    updateArticleStatus.mockResolvedValue(undefined);
    recordDownloadedVideo.mockResolvedValue(undefined);
    getDownloadedVideoForURL.mockResolvedValue(null);
  });

  it('notifies subscribers after an article download is recorded', async () => {
    const { onVideoLibraryChanged, downloadArticleYouTubeVideo } = await import(
      '../../src/lib/feed-manager.js'
    );

    const order = [];
    recordDownloadedVideo.mockImplementation(async () => {
      order.push('record');
    });
    const unsubscribe = onVideoLibraryChanged(() => order.push('notify'));

    try {
      await downloadArticleYouTubeVideo(FEED, { ...ARTICLE });
    } finally {
      unsubscribe();
    }

    expect(order).toEqual(['record', 'notify']);
  });

  it('does not notify when the download fails', async () => {
    const { onVideoLibraryChanged, downloadArticleYouTubeVideo } = await import(
      '../../src/lib/feed-manager.js'
    );

    downloadYouTubeVideo.mockResolvedValue({ error: 'boom' });
    const listener = vi.fn();
    const unsubscribe = onVideoLibraryChanged(listener);

    try {
      const result = await downloadArticleYouTubeVideo(FEED, { ...ARTICLE });
      expect(result.error).toBe('boom');
    } finally {
      unsubscribe();
    }

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies subscribers after a command-menu (by-URL) download is recorded', async () => {
    const { onVideoLibraryChanged, downloadYouTubeVideoFromURL } = await import(
      '../../src/lib/feed-manager.js'
    );

    const listener = vi.fn();
    const unsubscribe = onVideoLibraryChanged(listener);

    try {
      const result = await downloadYouTubeVideoFromURL(DOWNLOAD_URL);
      expect(result.error).toBeUndefined();
    } finally {
      unsubscribe();
    }

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify for an already-downloaded URL (no new record)', async () => {
    const { onVideoLibraryChanged, downloadYouTubeVideoFromURL } = await import(
      '../../src/lib/feed-manager.js'
    );

    getDownloadedVideoForURL.mockResolvedValue({
      filePath: '/downloads/existing.mp4',
      title: 'Existing',
    });
    const listener = vi.fn();
    const unsubscribe = onVideoLibraryChanged(listener);

    try {
      const result = await downloadYouTubeVideoFromURL(DOWNLOAD_URL);
      expect(result.alreadyDownloaded).toBe(true);
    } finally {
      unsubscribe();
    }

    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribing stops the notifications', async () => {
    const { onVideoLibraryChanged, downloadArticleYouTubeVideo } = await import(
      '../../src/lib/feed-manager.js'
    );

    const listener = vi.fn();
    const unsubscribe = onVideoLibraryChanged(listener);
    unsubscribe();

    await downloadArticleYouTubeVideo(FEED, { ...ARTICLE });

    expect(listener).not.toHaveBeenCalled();
  });

  it('a throwing listener does not break the download flow', async () => {
    const { onVideoLibraryChanged, downloadArticleYouTubeVideo } = await import(
      '../../src/lib/feed-manager.js'
    );

    const unsubscribe = onVideoLibraryChanged(() => {
      throw new Error('listener bug');
    });

    try {
      const result = await downloadArticleYouTubeVideo(FEED, { ...ARTICLE });
      expect(result.error).toBeUndefined();
      expect(result.filePath).toBe('/downloads/video.mp4');
      expect(recordDownloadedVideo).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});
