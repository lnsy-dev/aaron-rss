/**
 * Database Client Library
 *
 * Promise-based main-thread client for the sqlite worker
 * (src/sqlite-worker.js). All database access in the app should go
 * through this module — components never talk to the worker directly.
 *
 * The lower half of the file is a generic request/response transport;
 * the upper half (exported helpers) is the app's domain API: a `notes`
 * table with create/read/delete plus index generation.
 *
 * For LLMs: when adding a new table or query, add a helper here that
 * composes `callWorker('exec', ...)` / `callWorker('query', ...)`.
 * Always use bound parameters (?) for user input — never string
 * interpolation into SQL.
 */

/**
 * Lazily-created module worker instance.
 *
 * Note the `{ type: 'module' }` option: this worker imports npm modules
 * and a .wasm URL, so it uses webpack 5's native module-worker support
 * instead of the classic inline-worker transform.
 *
 * @type {Worker|null}
 */
let worker = null;

/** @type {number} Monotonic request id counter */
let nextRequestId = 1;

/** @type {Map<number, {resolve: Function, reject: Function, timeout: number}>} In-flight requests */
const pendingRequests = new Map();

/** Default timeout for worker requests so lost responses do not leak memory. */
const WORKER_REQUEST_TIMEOUT_MS = 120000;

/**
 * Get (or create) the sqlite worker and wire up its message handler.
 *
 * @returns {Worker} The sqlite worker instance
 */
function getWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL('../sqlite-worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data;
    const pending = pendingRequests.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    pendingRequests.delete(id);
    if (ok) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error));
    }
  };

  worker.onerror = (error) => {
    // A catastrophic worker failure rejects every in-flight request
    pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error(`SQLite worker error: ${error.message}`));
    });
    pendingRequests.clear();
  };

  return worker;
}

/**
 * Send an action to the worker and await its response.
 *
 * @param {string} action - Action name (see src/sqlite-worker.js)
 * @param {object} [params={}] - Action parameters
 * @returns {Promise<any>} The action result
 */
function callWorker(action, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`SQLite worker request timed out after ${WORKER_REQUEST_TIMEOUT_MS}ms`));
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timeout });
    getWorker().postMessage({ id, action, params });
  });
}

/**
 * Report whether the database is persisted (OPFS) or transient,
 * along with the SQLite version.
 *
 * @returns {Promise<{persistent: boolean, filename: string, sqliteVersion: string}>}
 */
export function getStatus() {
  return callWorker('status');
}

/**
 * Create the notes table if it does not exist yet.
 * Safe to call on every app start.
 *
 * @returns {Promise<void>}
 */
export async function initSchema() {
  await callWorker('exec', {
    sql: `CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  });
}

/**
 * Insert a note and return its new row id.
 *
 * @param {string} content - The note text
 * @returns {Promise<number>} The id of the inserted row
 */
export async function addNote(content) {
  await callWorker('exec', {
    sql: 'INSERT INTO notes (content, created_at) VALUES (?, ?)',
    params: [content, new Date().toISOString()],
  });
  const rows = await callWorker('query', { sql: 'SELECT last_insert_rowid() AS id' });
  return rows[0].id;
}

/**
 * List all notes, newest first.
 *
 * @returns {Promise<Array<{id: number, content: string, created_at: string}>>}
 */
export function listNotes() {
  return callWorker('query', {
    sql: 'SELECT id, content, created_at FROM notes ORDER BY id DESC',
  });
}

/**
 * Delete a note by id.
 *
 * @param {number} id - The note id
 * @returns {Promise<void>}
 */
export async function deleteNote(id) {
  await callWorker('exec', {
    sql: 'DELETE FROM notes WHERE id = ?',
    params: [id],
  });
}

/**
 * Generate an index on the notes table (created_at column).
 * Idempotent: uses CREATE INDEX IF NOT EXISTS.
 *
 * @returns {Promise<void>}
 */
export async function createNotesIndex() {
  await callWorker('exec', {
    sql: 'CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)',
  });
}

/**
 * List the user-created indexes currently in the database.
 *
 * @returns {Promise<Array<{name: string, tbl_name: string}>>}
 */
export function listIndexes() {
  return callWorker('query', {
    sql: `SELECT name, tbl_name FROM sqlite_master
      WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  });
}

/**
 * Serialize the whole database to bytes (SQLite file format).
 * Pair with the File System Access API to save it to disk.
 *
 * @returns {Promise<Uint8Array>} The database file image
 */
export function exportDatabase() {
  return callWorker('export');
}

/**
 * Replace the current database contents with a database file image
 * previously produced by exportDatabase() (or any SQLite file).
 *
 * @param {Uint8Array} bytes - The database file image
 * @returns {Promise<void>}
 */
export async function importDatabase(bytes) {
  await callWorker('import', { bytes });
}

// ============================================================================
// RSS Feed & Article Persistence
// ============================================================================

/**
 * Create the RSS schema if it does not exist.
 *
 * @returns {Promise<void>}
 */
export async function initRSSSchema() {
  await callWorker('exec', {
    sql: `CREATE TABLE IF NOT EXISTS feeds (
      feed_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      name TEXT,
      home_page_url TEXT,
      icon_url TEXT,
      favicon_url TEXT,
      last_fetch_successful INTEGER DEFAULT 1,
      last_fetch_end_time TEXT,
      synthetic INTEGER DEFAULT 0,
      open_original_by_default INTEGER DEFAULT 0,
      auto_download_youtube INTEGER DEFAULT 0
    )`,
  });

  // Migration: add the per-feed "open original by default" column to databases
  // created before this option was introduced. We check PRAGMA table_info first
  // because ADD COLUMN IF NOT EXISTS is not supported by every SQLite build
  // (some wasm/toolchain combinations reject it with a syntax error).
  const columns = await callWorker('query', { sql: 'PRAGMA table_info(feeds)' });
  const hasOpenOriginalColumn = columns.some((col) => col.name === 'open_original_by_default');
  if (!hasOpenOriginalColumn) {
    await callWorker('exec', {
      sql: 'ALTER TABLE feeds ADD COLUMN open_original_by_default INTEGER DEFAULT 0',
    });
  }

  const hasAutoDownloadColumn = columns.some((col) => col.name === 'auto_download_youtube');
  if (!hasAutoDownloadColumn) {
    await callWorker('exec', {
      sql: 'ALTER TABLE feeds ADD COLUMN auto_download_youtube INTEGER DEFAULT 0',
    });
  }

  await callWorker('exec', {
    sql: `CREATE TABLE IF NOT EXISTS articles (
      article_id TEXT PRIMARY KEY,
      feed_id TEXT NOT NULL,
      unique_id TEXT NOT NULL,
      title TEXT,
      content_html TEXT,
      content_text TEXT,
      url TEXT,
      external_url TEXT,
      summary TEXT,
      image_url TEXT,
      banner_image_url TEXT,
      date_published TEXT,
      date_modified TEXT,
      authors TEXT,
      tags TEXT,
      read INTEGER DEFAULT 0,
      starred INTEGER DEFAULT 0,
      download_path TEXT,
      date_arrived TEXT NOT NULL
    )`,
  });

  // Migration: add the article download_path column to databases created
  // before YouTube auto-download was introduced.
  const articleColumns = await callWorker('query', { sql: 'PRAGMA table_info(articles)' });
  const hasDownloadPathColumn = articleColumns.some((col) => col.name === 'download_path');
  if (!hasDownloadPathColumn) {
    await callWorker('exec', {
      sql: 'ALTER TABLE articles ADD COLUMN download_path TEXT',
    });
  }

  await callWorker('exec', {
    sql: `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  });

  await callWorker('exec', {
    sql: `CREATE TABLE IF NOT EXISTS page_snapshots (
      feed_id TEXT PRIMARY KEY,
      links_json TEXT NOT NULL,
      captured_at TEXT NOT NULL
    )`,
  });
}

/**
 * Serialize a feed object into values for an INSERT/UPDATE.
 *
 * @param {object} feed
 * @returns {Array}
 */
function feedToRow(feed) {
  return [
    feed.feedID,
    feed.url,
    feed.name || null,
    feed.homePageURL || null,
    feed.iconURL || null,
    feed.faviconURL || null,
    feed.lastFetchWasSuccessful ? 1 : 0,
    feed.lastFetchEndTime ? feed.lastFetchEndTime.toISOString() : null,
    feed.synthetic ? 1 : 0,
    feed.openOriginalByDefault ? 1 : 0,
    feed.autoDownloadYouTube ? 1 : 0,
  ];
}

/**
 * Serialize an article object into values for an INSERT.
 *
 * @param {object} article
 * @param {string} feedID
 * @returns {Array}
 */
function articleToRow(article, feedID) {
  return [
    article.articleID,
    feedID,
    article.uniqueID,
    article.title || null,
    article.contentHTML || null,
    article.contentText || null,
    article.url || null,
    article.externalURL || null,
    article.summary || null,
    article.imageURL || null,
    article.bannerImageURL || null,
    article.datePublished ? article.datePublished.toISOString() : null,
    article.dateModified ? article.dateModified.toISOString() : null,
    JSON.stringify(article.authors || []),
    JSON.stringify(article.tags || []),
    article.read ? 1 : 0,
    article.starred ? 1 : 0,
    article.downloadPath || null,
    article.dateArrived ? article.dateArrived.toISOString() : new Date().toISOString(),
  ];
}

/**
 * Convert a database row into a feed object with nested articles.
 *
 * @param {Array<object>} rows - Rows from the feed/article join query
 * @returns {Array<object>}
 */
function rowsToFeeds(rows) {
  const feedsById = new Map();

  for (const row of rows) {
    if (!feedsById.has(row.feed_id)) {
      feedsById.set(row.feed_id, {
        feedID: row.feed_id,
        url: row.feed_url,
        name: row.name,
        homePageURL: row.home_page_url,
        iconURL: row.icon_url,
        faviconURL: row.favicon_url,
        lastFetchWasSuccessful: Boolean(row.last_fetch_successful),
        lastFetchEndTime: row.last_fetch_end_time ? new Date(row.last_fetch_end_time) : undefined,
        synthetic: Boolean(row.synthetic),
        openOriginalByDefault: Boolean(row.open_original_by_default),
        autoDownloadYouTube: Boolean(row.auto_download_youtube),
        articles: [],
      });
    }

    if (row.article_id) {
      const feed = feedsById.get(row.feed_id);
      feed.articles.push({
        articleID: row.article_id,
        feedURL: row.feed_url,
        uniqueID: row.unique_id,
        title: row.title,
        contentHTML: row.content_html,
        contentText: row.content_text,
        url: row.article_url,
        externalURL: row.external_url,
        summary: row.summary,
        imageURL: row.image_url,
        bannerImageURL: row.banner_image_url,
        datePublished: row.date_published ? new Date(row.date_published) : undefined,
        dateModified: row.date_modified ? new Date(row.date_modified) : undefined,
        authors: row.authors ? JSON.parse(row.authors) : [],
        tags: row.tags ? JSON.parse(row.tags) : [],
        read: Boolean(row.read),
        starred: Boolean(row.starred),
        downloadPath: row.download_path || undefined,
        dateArrived: new Date(row.date_arrived),
      });
    }
  }

  return Array.from(feedsById.values());
}

/**
 * Save or update a feed and replace its articles.
 *
 * @param {object} feed
 * @returns {Promise<void>}
 */
export async function saveFeed(feed) {
  await callWorker('exec', {
    sql: `INSERT INTO feeds
      (feed_id, url, name, home_page_url, icon_url, favicon_url, last_fetch_successful, last_fetch_end_time, synthetic, open_original_by_default, auto_download_youtube)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feed_id) DO UPDATE SET
        url = excluded.url,
        name = excluded.name,
        home_page_url = excluded.home_page_url,
        icon_url = excluded.icon_url,
        favicon_url = excluded.favicon_url,
        last_fetch_successful = excluded.last_fetch_successful,
        last_fetch_end_time = excluded.last_fetch_end_time,
        synthetic = excluded.synthetic,
        open_original_by_default = excluded.open_original_by_default,
        auto_download_youtube = excluded.auto_download_youtube`,
    params: feedToRow(feed),
  });

  await callWorker('exec', {
    sql: 'DELETE FROM articles WHERE feed_id = ?',
    params: [feed.feedID],
  });

  for (const article of feed.articles) {
    await callWorker('exec', {
      sql: `INSERT INTO articles
        (article_id, feed_id, unique_id, title, content_html, content_text, url, external_url, summary, image_url, banner_image_url, date_published, date_modified, authors, tags, read, starred, download_path, date_arrived)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: articleToRow(article, feed.feedID),
    });
  }
}

/**
 * Default number of days to keep read, unstarred articles before purging.
 *
 * Starred articles are never purged.
 *
 * @type {number}
 */
export const DEFAULT_READ_ARTICLE_RETENTION_DAYS = 30;

/**
 * Save or update only the feed metadata row, without touching articles.
 *
 * @param {object} feed
 * @returns {Promise<void>}
 */
export async function saveFeedMetadata(feed) {
  await callWorker('exec', {
    sql: `INSERT INTO feeds
      (feed_id, url, name, home_page_url, icon_url, favicon_url, last_fetch_successful, last_fetch_end_time, synthetic, open_original_by_default, auto_download_youtube)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feed_id) DO UPDATE SET
        url = excluded.url,
        name = excluded.name,
        home_page_url = excluded.home_page_url,
        icon_url = excluded.icon_url,
        favicon_url = excluded.favicon_url,
        last_fetch_successful = excluded.last_fetch_successful,
        last_fetch_end_time = excluded.last_fetch_end_time,
        synthetic = excluded.synthetic,
        open_original_by_default = excluded.open_original_by_default,
        auto_download_youtube = excluded.auto_download_youtube`,
    params: feedToRow(feed),
  });
}

/**
 * Upsert a batch of articles for a feed.
 *
 * Existing articles are matched by article_id and overwritten with the new
 * values. This avoids the churn of deleting and re-inserting every article
 * on each refresh.
 *
 * @param {string} feedID
 * @param {Array<object>} articles
 * @returns {Promise<void>}
 */
export async function saveArticles(feedID, articles) {
  for (const article of articles) {
    await callWorker('exec', {
      sql: `INSERT INTO articles
        (article_id, feed_id, unique_id, title, content_html, content_text, url, external_url, summary, image_url, banner_image_url, date_published, date_modified, authors, tags, read, starred, download_path, date_arrived)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(article_id) DO UPDATE SET
          feed_id = excluded.feed_id,
          unique_id = excluded.unique_id,
          title = excluded.title,
          content_html = excluded.content_html,
          content_text = excluded.content_text,
          url = excluded.url,
          external_url = excluded.external_url,
          summary = excluded.summary,
          image_url = excluded.image_url,
          banner_image_url = excluded.banner_image_url,
          date_published = excluded.date_published,
          date_modified = excluded.date_modified,
          authors = excluded.authors,
          tags = excluded.tags,
          read = excluded.read,
          starred = excluded.starred,
          download_path = excluded.download_path,
          date_arrived = excluded.date_arrived`,
      params: articleToRow(article, feedID),
    });
  }
}

/**
 * Delete articles for a feed that are no longer in the merged set and are
 * not starred.
 *
 * @param {string} feedID
 * @param {Array<string>} articleIDs
 * @returns {Promise<void>}
 */
export async function deleteArticlesNotInSet(feedID, articleIDs) {
  if (!articleIDs || articleIDs.length === 0) {
    return;
  }

  const placeholders = articleIDs.map(() => '?').join(', ');
  await callWorker('exec', {
    sql: `DELETE FROM articles
      WHERE feed_id = ?
        AND article_id NOT IN (${placeholders})
        AND starred = 0`,
    params: [feedID, ...articleIDs],
  });
}

/**
 * Purge read, unstarred articles older than the retention window.
 *
 * @param {string} feedID
 * @param {number} [retentionDays=DEFAULT_READ_ARTICLE_RETENTION_DAYS]
 * @returns {Promise<void>}
 */
export async function purgeOldReadArticles(feedID, retentionDays = DEFAULT_READ_ARTICLE_RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  await callWorker('exec', {
    sql: `DELETE FROM articles
      WHERE feed_id = ?
        AND read = 1
        AND starred = 0
        AND date_arrived < ?`,
    params: [feedID, cutoff],
  });
}

/**
 * Run SQLite maintenance (WAL checkpoint and optimize).
 *
 * @returns {Promise<void>}
 */
export function runDatabaseMaintenance() {
  return callWorker('maintenance');
}

/**
 * Load every feed with its unread articles for the main list UI.
 *
 * This avoids pulling read articles (which may be numerous and large) into
 * the renderer just to be discarded by the unread-only filter.
 *
 * @returns {Promise<Array<object>>}
 */
export function loadFeedsForDisplay() {
  return callWorker('query', {
    sql: `SELECT
        f.feed_id, f.url AS feed_url, f.name, f.home_page_url, f.icon_url, f.favicon_url,
        f.last_fetch_successful, f.last_fetch_end_time, f.synthetic, f.open_original_by_default, f.auto_download_youtube,
        a.article_id, a.unique_id, a.title, a.content_html, a.content_text,
        a.url AS article_url, a.external_url, a.summary, a.image_url, a.banner_image_url,
        a.date_published, a.date_modified, a.authors, a.tags, a.read, a.starred, a.download_path, a.date_arrived
      FROM feeds f
      LEFT JOIN articles a ON a.feed_id = f.feed_id AND a.read = 0
      ORDER BY f.name, a.date_published DESC, a.date_arrived DESC`,
  }).then(rowsToFeeds);
}

/**
 * Load every feed with its articles.
 *
 * @returns {Promise<Array<object>>}
 */
export function loadAllFeeds() {
  return callWorker('query', {
    sql: `SELECT
        f.feed_id, f.url AS feed_url, f.name, f.home_page_url, f.icon_url, f.favicon_url,
        f.last_fetch_successful, f.last_fetch_end_time, f.synthetic, f.open_original_by_default, f.auto_download_youtube,
        a.article_id, a.unique_id, a.title, a.content_html, a.content_text,
        a.url AS article_url, a.external_url, a.summary, a.image_url, a.banner_image_url,
        a.date_published, a.date_modified, a.authors, a.tags, a.read, a.starred, a.download_path, a.date_arrived
      FROM feeds f
      LEFT JOIN articles a ON a.feed_id = f.feed_id
      ORDER BY f.name`,
  }).then(rowsToFeeds);
}

/**
 * Load a single feed with its articles.
 *
 * @param {string} feedID
 * @returns {Promise<object|null>}
 */
export function loadFeed(feedID) {
  return callWorker('query', {
    sql: `SELECT
        f.feed_id, f.url AS feed_url, f.name, f.home_page_url, f.icon_url, f.favicon_url,
        f.last_fetch_successful, f.last_fetch_end_time, f.synthetic, f.open_original_by_default, f.auto_download_youtube,
        a.article_id, a.unique_id, a.title, a.content_html, a.content_text,
        a.url AS article_url, a.external_url, a.summary, a.image_url, a.banner_image_url,
        a.date_published, a.date_modified, a.authors, a.tags, a.read, a.starred, a.download_path, a.date_arrived
      FROM feeds f
      LEFT JOIN articles a ON a.feed_id = f.feed_id
      WHERE f.feed_id = ?`,
    params: [feedID],
  }).then((rows) => {
    const feeds = rowsToFeeds(rows);
    return feeds.length > 0 ? feeds[0] : null;
  });
}

/**
 * Delete a feed and all of its articles.
 *
 * @param {string} feedID
 * @returns {Promise<void>}
 */
export async function deleteFeed(feedID) {
  await callWorker('exec', {
    sql: 'DELETE FROM articles WHERE feed_id = ?',
    params: [feedID],
  });
  await callWorker('exec', {
    sql: 'DELETE FROM feeds WHERE feed_id = ?',
    params: [feedID],
  });
  await callWorker('exec', {
    sql: 'DELETE FROM page_snapshots WHERE feed_id = ?',
    params: [feedID],
  });
}

/**
 * Store (or replace) the link snapshot for a watched page feed.
 * The presence of a snapshot row marks the feed as a snapshot feed.
 *
 * @param {string} feedID
 * @param {Array<string>} links - Every URL seen on the page so far
 * @returns {Promise<void>}
 */
export async function savePageSnapshot(feedID, links) {
  await callWorker('exec', {
    sql: `INSERT INTO page_snapshots (feed_id, links_json, captured_at)
      VALUES (?, ?, ?)
      ON CONFLICT(feed_id) DO UPDATE SET
        links_json = excluded.links_json,
        captured_at = excluded.captured_at`,
    params: [feedID, JSON.stringify(links), new Date().toISOString()],
  });
}

/**
 * Load the link snapshot for a watched page feed.
 *
 * @param {string} feedID
 * @returns {Promise<{feedID: string, links: Array<string>, capturedAt: Date}|null>}
 */
export async function loadPageSnapshot(feedID) {
  const rows = await callWorker('query', {
    sql: 'SELECT feed_id, links_json, captured_at FROM page_snapshots WHERE feed_id = ?',
    params: [feedID],
  });

  if (!rows || rows.length === 0) {
    return null;
  }

  return {
    feedID: rows[0].feed_id,
    links: JSON.parse(rows[0].links_json),
    capturedAt: new Date(rows[0].captured_at),
  };
}

/**
 * Delete the link snapshot for a feed (used when the feed is removed).
 *
 * @param {string} feedID
 * @returns {Promise<void>}
 */
export async function deletePageSnapshot(feedID) {
  await callWorker('exec', {
    sql: 'DELETE FROM page_snapshots WHERE feed_id = ?',
    params: [feedID],
  });
}

/**
 * Update whether a feed should open the original website by default.
 *
 * @param {string} feedID
 * @param {boolean} value
 * @returns {Promise<void>}
 */
export async function updateFeedOpenOriginalByDefault(feedID, value) {
  await callWorker('exec', {
    sql: 'UPDATE feeds SET open_original_by_default = ? WHERE feed_id = ?',
    params: [value ? 1 : 0, feedID],
  });
}

/**
 * Update whether a feed should automatically download YouTube videos.
 *
 * @param {string} feedID
 * @param {boolean} value
 * @returns {Promise<void>}
 */
export async function updateFeedAutoDownloadYouTube(feedID, value) {
  await callWorker('exec', {
    sql: 'UPDATE feeds SET auto_download_youtube = ? WHERE feed_id = ?',
    params: [value ? 1 : 0, feedID],
  });
}

/**
 * Update the read/starred/download status of an article.
 *
 * @param {string} feedID
 * @param {string} articleID
 * @param {object} updates
 * @returns {Promise<void>}
 */
export async function updateArticleStatus(feedID, articleID, updates) {
  const fields = [];
  const params = [];

  if ('read' in updates) {
    fields.push('read = ?');
    params.push(updates.read ? 1 : 0);
  }
  if ('starred' in updates) {
    fields.push('starred = ?');
    params.push(updates.starred ? 1 : 0);
  }
  if ('downloadPath' in updates) {
    fields.push('download_path = ?');
    params.push(updates.downloadPath || null);
  }

  if (fields.length === 0) {
    return;
  }

  params.push(feedID, articleID);
  await callWorker('exec', {
    sql: `UPDATE articles SET ${fields.join(', ')} WHERE feed_id = ? AND article_id = ?`,
    params,
  });
}

/**
 * Mark every unread article as read.
 *
 * @returns {Promise<number>} The number of articles marked as read
 */
export async function markAllArticlesAsRead() {
  const rows = await callWorker('query', {
    sql: 'UPDATE articles SET read = 1 WHERE read = 0; SELECT changes() AS count',
  });

  return rows[0]?.count || 0;
}

/**
 * Load application settings.
 *
 * @returns {Promise<object>}
 */
export async function loadSettings() {
  const rows = await callWorker('query', { sql: 'SELECT key, value FROM settings' });
  const settings = {
    sourcesFolder: 'sources',
    refreshInterval: 5,
    maxArticlesPerFeed: 50,
    showUnreadOnly: false,
    viewMode: 'timeline',
    theme: '',
  };

  for (const row of rows) {
    const key = row.key;
    const value = row.value;
    if (key === 'maxArticlesPerFeed' || key === 'refreshInterval') {
      settings[key] = parseInt(value, 10);
    } else if (key === 'showUnreadOnly') {
      settings[key] = value === 'true';
    } else {
      settings[key] = value;
    }
  }

  return settings;
}

/**
 * Save application settings.
 *
 * @param {object} settings
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  for (const [key, value] of Object.entries(settings)) {
    await callWorker('exec', {
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      params: [key, String(value)],
    });
  }
}
