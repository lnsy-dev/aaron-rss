/**
 * Feed Manager
 *
 * Orchestrates adding, refreshing, deleting, and updating feeds and
 * articles. Uses the sqlite database helpers for persistence and the
 * parser/discovery modules for fetching.
 */

import {
  saveFeed as dbSaveFeed,
  saveFeedMetadata as dbSaveFeedMetadata,
  saveArticles as dbSaveArticles,
  deleteArticlesNotInSet as dbDeleteArticlesNotInSet,
  purgeOldReadArticles as dbPurgeOldReadArticles,
  listPrunableDownloadedVideos as dbListPrunableDownloadedVideos,
  runDatabaseMaintenance as dbRunDatabaseMaintenance,
  loadAllFeeds as dbLoadAllFeeds,
  loadFeedsForDisplay as dbLoadFeedsForDisplay,
  loadFeed as dbLoadFeed,
  deleteFeed as dbDeleteFeed,
  updateArticleStatus as dbUpdateArticleStatus,
  markAllArticlesAsRead as dbMarkAllArticlesAsRead,
  savePageSnapshot as dbSavePageSnapshot,
  loadPageSnapshot as dbLoadPageSnapshot,
  recordDownloadedVideo as dbRecordDownloadedVideo,
  deleteDownloadedVideosForArticle as dbDeleteDownloadedVideosForArticle,
  deleteDownloadedVideosForFeed as dbDeleteDownloadedVideosForFeed,
  loadDownloadedArticles as dbLoadDownloadedArticles,
} from './database.js';
import { fetchText, normalizeFeedURL } from './rss-network.js';
import { parseFeedText } from './rss-parser.js';
import { findFeeds } from './feed-finder.js';
import { generateRSSFromHTML } from './html-to-rss.js';
import { extractPageLinks, extractPageTitle } from './page-snapshot-feed.js';
import { processNewArticles } from './article-processor.js';
import { refreshFeedInWorker } from './feed-refresh-bridge.js';
import { enrichBlueskyFeedItems } from './social-post.js';
import { downloadYouTubeVideo, deleteDownloadedVideo } from './youtube-bridge.js';
import { isYouTubeURL, isYouTubeStream } from './youtube.js';

/**
 * Generate a feed ID from a URL.
 *
 * @param {string} url
 * @returns {string}
 */
function generateFeedID(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Add a new feed from a URL or discovered feed.
 *
 * @param {string} url - Website or feed URL
 * @param {string} [name] - Optional override name
 * @param {boolean} [synthetic=false] - Generate feed from HTML
 * @returns {Promise<object|null>}
 */
export async function addFeed(url, name, synthetic = false) {
  try {
    let parsedFeed;

    // Scheme-less entries like "example.com/feed" must be resolved to an
    // absolute URL before fetching (and for the feedID/feed record).
    url = normalizeFeedURL(url);

    if (synthetic) {
      parsedFeed = await generateRSSFromHTML(url);
    } else {
      const response = await fetchText(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch feed (${url}): HTTP ${response.status}`);
      }
      parsedFeed = await parseFeedText(response.text, url);
    }

    if (!parsedFeed) {
      throw new Error(synthetic ? 'Failed to generate RSS from HTML' : 'Failed to parse RSS feed');
    }

    const feedID = generateFeedID(url);
    const feed = {
      feedID,
      url,
      name: name || parsedFeed.title || 'Untitled Feed',
      homePageURL: parsedFeed.homePageURL,
      iconURL: parsedFeed.iconURL,
      faviconURL: parsedFeed.faviconURL,
      lastFetchWasSuccessful: true,
      lastFetchEndTime: new Date(),
      articles: parsedFeed.items.map((item) => processNewArticles([item], { url, articles: [] })[0]),
      synthetic,
    };

    await dbSaveFeed(feed);
    return feed;
  } catch (error) {
    console.error('Failed to add feed:', error);
    return null;
  }
}

/**
 * Discover feeds at a URL and add the best match.
 *
 * @param {string} url
 * @returns {Promise<object|null>}
 */
export async function discoverAndAddFeed(url) {
  const discovered = await findFeeds(url);
  if (discovered.length === 0) {
    return null;
  }

  const best = discovered[0];
  return addFeed(best.url, best.title, best.synthetic);
}

/**
 * Add a "watched page" feed for a website that has no RSS feed.
 *
 * Takes an initial snapshot of every link on the page and stores it. The
 * feed starts empty; on each subsequent refresh the page's links are
 * re-extracted and diffed against the snapshot, so only newly-published
 * links appear as feed items. Until the page actually changes, refreshing
 * produces no new content.
 *
 * @param {string} url - The page URL to watch
 * @param {string} [name] - Optional override name
 * @returns {Promise<object|null>} The created feed, or null on failure
 */
export async function addSnapshotFeed(url, name) {
  try {
    const response = await fetchText(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch page: ${response.status}`);
    }

    // Snapshots persist plain URL strings for fast set diffing.
    const links = extractPageLinks(response.text, url).map((link) => link.url);
    const feedID = generateFeedID(url);
    const pageTitle = extractPageTitle(response.text);
    const hostname = hostnameOf(url);

    const feed = {
      feedID,
      url,
      name: name || (pageTitle ? `${pageTitle} (Watched Page)` : `${hostname} (Watched Page)`),
      homePageURL: url,
      iconURL: undefined,
      faviconURL: faviconOf(url),
      lastFetchWasSuccessful: true,
      lastFetchEndTime: new Date(),
      // Deliberately empty: items only appear once the page changes.
      articles: [],
      synthetic: true,
    };

    await dbSaveFeed(feed);
    await dbSavePageSnapshot(feedID, links);
    return feed;
  } catch (error) {
    console.error('Failed to add watched page feed:', error);
    return null;
  }
}

/**
 * Fetch a feed's source text/HTML and mark it failed when the fetch fails.
 *
 * This stays on the main thread because the Electron preload fetch bridge
 * is only available there.
 *
 * @param {object} existingFeed
 * @returns {Promise<{ok: boolean, feedText?: string, htmlText?: string}>}
 */
async function fetchFeedSource(existingFeed) {
  const response = await fetchText(existingFeed.url);
  if (!response.ok) {
    return { ok: false };
  }

  if (existingFeed.synthetic) {
    return { ok: true, htmlText: response.text };
  }
  return { ok: true, feedText: response.text };
}

/**
 * Return the hostname of a URL (or the raw input when unparsable).
 *
 * @param {string} url
 * @returns {string}
 */
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Guess the site's favicon URL.
 *
 * @param {string} url
 * @returns {string|undefined}
 */
function faviconOf(url) {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

/**
 * Check whether a feed URL is a Bluesky profile RSS feed.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isBlueskyFeedURL(url) {
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname === 'bsky.app' &&
      /^\/profile\/[^/]+\/rss\/?$/i.test(urlObj.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Parse and enrich a Bluesky RSS feed on the main thread.
 *
 * Bluesky RSS descriptions only contain plain text and a placeholder for
 * embedded posts. The worker cannot perform network fetches, so enrichment
 * happens here before the parsed feed is handed off for merging.
 *
 * @param {string} feedURL
 * @param {string} feedText
 * @returns {Promise<object|null>}
 */
async function parseAndEnrichBlueskyFeed(feedURL, feedText) {
  const parsedFeed = await parseFeedText(feedText, feedURL);
  if (!parsedFeed) return null;

  parsedFeed.items = await enrichBlueskyFeedItems(feedURL, parsedFeed.items);
  return parsedFeed;
}

/**
 * Refresh a single feed.
 *
 * Network fetching happens on the main thread (it needs the Electron
 * preload bridge), then parsing and article merging are offloaded to the
 * feed-refresh worker so the UI thread stays responsive.
 *
 * @param {string} feedID
 * @param {number} maxArticles
 * @returns {Promise<object|null>}
 */
export async function refreshFeed(feedID, maxArticles = 50) {
  try {
    const existingFeed = await dbLoadFeed(feedID);
    if (!existingFeed) return null;

    // Watched-page feeds refresh by diffing links against their stored
    // snapshot instead of parsing RSS/HTML article structure.
    const snapshot = await dbLoadPageSnapshot(feedID);

    const source = await fetchFeedSource(existingFeed);
    if (!source.ok) {
      existingFeed.lastFetchWasSuccessful = false;
      existingFeed.lastFetchEndTime = new Date();
      await dbSaveFeedMetadata(existingFeed);
      return existingFeed;
    }

    let workerParams;
    if (snapshot && source.htmlText !== undefined) {
      workerParams = {
        feedText: undefined,
        htmlText: source.htmlText,
        snapshotLinks: snapshot.links,
        existingFeed,
        maxArticles,
      };
    } else if (source.feedText && isBlueskyFeedURL(existingFeed.url)) {
      const parsedFeed = await parseAndEnrichBlueskyFeed(existingFeed.url, source.feedText);
      workerParams = { parsedFeed, existingFeed, maxArticles };
    } else {
      workerParams = {
        feedText: source.feedText,
        htmlText: source.htmlText,
        existingFeed,
        maxArticles,
      };
    }

    const updatedFeed = await refreshFeedInWorker(workerParams);

    // Persist the refreshed snapshot so future refreshes diff against it.
    if (Array.isArray(updatedFeed.snapshotLinks)) {
      await dbSavePageSnapshot(feedID, updatedFeed.snapshotLinks);
      delete updatedFeed.snapshotLinks;
    }

    // Upsert feed metadata and articles instead of deleting/re-inserting
    // the whole article set. Then remove articles that fell out of the
    // merged set and purge old read items to keep the DB bounded.
    await dbSaveFeedMetadata(updatedFeed);
    await dbSaveArticles(feedID, updatedFeed.articles);
    await dbDeleteArticlesNotInSet(
      feedID,
      updatedFeed.articles.map((article) => article.articleID)
    );
    await purgeOldReadArticles(feedID);

    return updatedFeed;
  } catch (error) {
    console.error('Failed to refresh feed:', error);
    return null;
  }
}

/**
 * Manually download the YouTube video attached to an article.
 *
 * Downloads only run when the user explicitly clicks the article's
 * Download button; nothing is fetched automatically during refreshes.
 * On success the article's download_path is persisted so the file can be
 * deleted later and the UI can show its downloaded state.
 *
 * @param {object} feed Feed containing the article
 * @param {object} article Article with a YouTube URL
 * @returns {Promise<{filePath?: string, error?: string}>}
 */
export async function downloadArticleYouTubeVideo(feed, article) {
  if (!feed?.feedID || !article?.articleID) {
    return { error: 'Missing feed or article' };
  }
  if (!article.url || !isYouTubeURL(article.url) || isYouTubeStream(article.url)) {
    return { error: 'Not a downloadable YouTube video' };
  }

  if (article.downloadPath) {
    return { filePath: article.downloadPath };
  }

  try {
    const result = await downloadYouTubeVideo(article.url);
    if (result.error) {
      console.error(`Failed to download YouTube video ${article.url}:`, result.error);
      return result;
    }

    article.downloadPath = result.filePath;
    await dbUpdateArticleStatus(feed.feedID, article.articleID, { downloadPath: result.filePath });
    // Queue table record: the article pointer above is a denormalized
    // copy kept in sync; this table is the authoritative video library.
    await dbRecordDownloadedVideo({
      feedID: feed.feedID,
      articleID: article.articleID,
      youtubeURL: article.url,
      filePath: result.filePath,
      title: article.title || null,
    });
    return result;
  } catch (error) {
    console.error(`Unexpected error downloading YouTube video ${article.url}:`, error);
    return { error: error.message || String(error) };
  }
}

/**
 * Refresh every feed.
 *
 * @param {number} maxArticles
 * @param {Function} [onProgress] - Called before each feed is fetched with
 *   `{ feed, index, total }` so the UI can show a progress bar.
 * @param {Function} [onFeedUpdated] - Called after each feed is fetched with
 *   the updated feed object so the UI can be updated incrementally.
 * @returns {Promise<Array<object>>}
 */
export async function refreshAllFeeds(maxArticles = 50, onProgress = null, onFeedUpdated = null) {
  const feeds = await dbLoadAllFeeds();
  const results = [];

  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];

    if (typeof onProgress === 'function') {
      onProgress({ feed, index: i, total: feeds.length });
    }

    try {
      const updated = await refreshFeed(feed.feedID, maxArticles);
      results.push({
        feedID: feed.feedID,
        success: updated?.lastFetchWasSuccessful || false,
      });

      if (typeof onFeedUpdated === 'function' && updated) {
        onFeedUpdated(updated);
      }
    } catch (error) {
      results.push({ feedID: feed.feedID, success: false, error: error.message });
    }
  }

  // Checkpoint the WAL and update query planner stats after a batch of
  // feed writes so the database file does not grow indefinitely.
  try {
    await dbRunDatabaseMaintenance();
  } catch (error) {
    console.error('Database maintenance failed:', error);
  }

  return results;
}

/**
 * Load all feeds with articles.
 *
 * @returns {Promise<Array<object>>}
 */
export function loadAllFeeds() {
  return dbLoadAllFeeds();
}

/**
 * Load feeds with only unread articles for the main list UI.
 *
 * @returns {Promise<Array<object>>}
 */
export function loadFeedsForDisplay() {
  return dbLoadFeedsForDisplay();
}

/**
 * Load every article that has a downloaded video, for the Videos view.
 *
 * @returns {Promise<Array<{feed: object|null, article: object}>>} Newest download first
 */
export function loadDownloadedArticles() {
  return dbLoadDownloadedArticles();
}

/**
 * Mark every unread article across all feeds as read.
 *
 * @returns {Promise<number>} The number of articles marked as read
 */
export async function markAllArticlesAsRead() {
  return dbMarkAllArticlesAsRead();
}

/**
 * Load a single feed.
 *
 * @param {string} feedID
 * @returns {Promise<object|null>}
 */
export function loadFeed(feedID) {
  return dbLoadFeed(feedID);
}

/**
 * Delete a feed's downloaded YouTube video (file + record) and clear the
 * article's denormalized download pointer.
 *
 * @param {string} feedID
 * @param {string} articleID
 * @param {string} filePath - Absolute path of the file to remove
 * @returns {Promise<void>}
 */
export async function deleteArticleYouTubeVideo(feedID, articleID, filePath) {
  if (filePath) {
    try {
      await deleteDownloadedVideo(filePath);
    } catch (error) {
      console.error('Failed to delete downloaded video file:', error);
    }
  }
  try {
    await dbDeleteDownloadedVideosForArticle(feedID, articleID);
    // Clear the article's pointer so the UI stops showing "Downloaded ✓".
    await dbUpdateArticleStatus(feedID, articleID, { downloadPath: null });
  } catch (error) {
    console.error('Failed to clean up downloaded video record:', error);
  }
}

/**
 * Delete a feed and its articles, cleaning up any downloaded YouTube
 * video files and queue records so they do not linger on disk or in the
 * downloaded_videos table.
 *
 * @param {string} feedID
 * @returns {Promise<void>}
 */
export async function deleteFeed(feedID) {
  const feed = await dbLoadFeed(feedID);
  if (feed?.articles) {
    for (const article of feed.articles) {
      if (article.downloadPath) {
        try {
          await deleteDownloadedVideo(article.downloadPath);
        } catch (error) {
          console.error('Failed to delete downloaded video for article:', article.articleID, error);
        }
      }
    }
  }
  try {
    await dbDeleteDownloadedVideosForFeed(feedID);
  } catch (error) {
    console.error('Failed to delete downloaded video records for feed:', feedID, error);
  }
  await dbDeleteFeed(feedID);
}

/**
 * Purge read, unstarred articles older than the retention window,
 * cleaning up any downloaded YouTube videos first. Per product
 * decision, a pruned article's video is deleted entirely — the file on
 * disk and its downloaded_videos record — not kept in the library.
 *
 * @param {string} feedID
 * @param {number} [retentionDays] - Defaults to the standard retention window
 * @returns {Promise<void>}
 */
export async function purgeOldReadArticles(feedID, retentionDays) {
  try {
    const prunable = (await dbListPrunableDownloadedVideos(feedID, retentionDays)) || [];
    for (const item of prunable) {
      try {
        await deleteDownloadedVideo(item.downloadPath);
      } catch (error) {
        console.error('Failed to delete pruned video file:', item.downloadPath, error);
      }
      try {
        await dbDeleteDownloadedVideosForArticle(feedID, item.articleID);
      } catch (error) {
        console.error('Failed to delete pruned video record:', item.articleID, error);
      }
    }
  } catch (error) {
    // Never block pruning of the articles themselves on cleanup failures.
    console.error('Failed to clean up videos for prunable articles:', error);
  }

  const args = retentionDays === undefined ? [feedID] : [feedID, retentionDays];
  await dbPurgeOldReadArticles(...args);
}

/**
 * Mark an article as read.
 *
 * @param {string} feedID
 * @param {string} articleID
 * @returns {Promise<void>}
 */
export async function markArticleAsRead(feedID, articleID) {
  await dbUpdateArticleStatus(feedID, articleID, { read: true });
}

/**
 * Mark an article as unread.
 *
 * @param {string} feedID
 * @param {string} articleID
 * @returns {Promise<void>}
 */
export async function markArticleAsUnread(feedID, articleID) {
  await dbUpdateArticleStatus(feedID, articleID, { read: false });
}

/**
 * Toggle the starred status of an article.
 *
 * @param {string} feedID
 * @param {string} articleID
 * @returns {Promise<void>}
 */
export async function toggleArticleStarred(feedID, articleID) {
  const feed = await dbLoadFeed(feedID);
  if (!feed) return;

  const article = feed.articles.find((a) => a.articleID === articleID);
  if (!article) return;

  await dbUpdateArticleStatus(feedID, articleID, { starred: !article.starred });
}
