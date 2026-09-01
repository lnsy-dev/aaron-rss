/**
 * Article Processor
 *
 * Merges newly parsed articles with existing ones, preserving read/starred
 * state and limiting the total number of articles kept per feed.
 */

/**
 * Compute a cheap fingerprint of an article's content.
 *
 * Used by the refresh merge to detect unchanged articles: when the stored
 * hash matches the hash of the freshly parsed content, the article does
 * not need to be re-written to the database. FNV-1a is fast, dependency
 * free, and sufficient for change detection (not cryptographic).
 *
 * @param {object} item - Parsed feed item or article-like object
 * @returns {string} Hex string fingerprint
 */
export function hashArticleContent(item) {
  const key = [
    item.title,
    item.contentHTML,
    item.contentText,
    item.summary,
    item.url,
    item.externalURL,
    item.imageURL,
    item.bannerImageURL,
    item.authors ? JSON.stringify(item.authors) : '',
    item.tags ? JSON.stringify(item.tags) : '',
  ]
    .map((part) => part || '')
    .join('\u0000');

  // 32-bit FNV-1a over the UTF-16 code units.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }

  // Mix in the length so collisions across truncated keys are unlikely.
  return `${hash.toString(16)}-${key.length}`;
}

/**
 * Mark an article record as already persisted. Skipped articles are not
 * written back by saveArticles, which keeps refresh write bursts off the
 * sqlite worker and protects slim (content-less) records from clobbering
 * stored content with NULLs.
 *
 * @param {object} article
 * @returns {object} Shallow copy flagged skipPersist
 */
export function skipPersist(article) {
  return { ...article, skipPersist: true };
}

/**
 * Build new Article objects from parsed items that are not already present.
 *
 * @param {Array<object>} parsedItems
 * @param {object} existingFeed
 * @returns {Array<object>}
 */
export function processNewArticles(parsedItems, existingFeed) {
  const existingArticleIDs = new Set(existingFeed.articles.map((a) => a.uniqueID));
  const newArticles = [];

  for (const item of parsedItems) {
    if (!existingArticleIDs.has(item.uniqueID)) {
      newArticles.push(convertToArticle(item, existingFeed.url));
    }
  }

  return newArticles;
}

/**
 * Update existing articles from parsed items while preserving read/starred state.
 *
 * @param {Array<object>} parsedItems
 * @param {object} existingFeed
 * @returns {Array<object>}
 */
export function updateExistingArticles(parsedItems, existingFeed) {
  const itemMap = new Map(parsedItems.map((item) => [item.uniqueID, item]));
  const updatedArticles = [];

  for (const article of existingFeed.articles) {
    const parsedItem = itemMap.get(article.uniqueID);
    if (!parsedItem) {
      // Article fell out of the feed source. Its stored row is already
      // correct, so it must not be re-written (refresh-loaded records
      // carry no content columns).
      updatedArticles.push(skipPersist(article));
      continue;
    }

    const newHash = hashArticleContent(parsedItem);
    if (article.contentHash && article.contentHash === newHash) {
      // Content unchanged — keep stored metadata (including dateModified)
      // and skip the database write entirely.
      updatedArticles.push(skipPersist(article));
      continue;
    }

    updatedArticles.push(updateArticleFromParsedItem(article, parsedItem, newHash));
  }

  return updatedArticles;
}

/**
 * Merge existing and new articles, dedupe by uniqueID, sort by date, and limit count.
 *
 * Starred articles are always preserved. Unstarred articles are sorted by
 * date (newest first) and capped to maxArticles after the starred set. This
 * prevents starred items from silently disappearing when a feed refreshes.
 *
 * @param {Array<object>} existingArticles
 * @param {Array<object>} newArticles
 * @param {number} maxArticles
 * @returns {Array<object>}
 */
export function mergeArticles(existingArticles, newArticles, maxArticles) {
  const allArticles = [...newArticles, ...existingArticles];

  const uniqueArticles = new Map();
  for (const article of allArticles) {
    if (!uniqueArticles.has(article.uniqueID)) {
      uniqueArticles.set(article.uniqueID, article);
    }
  }

  const articles = Array.from(uniqueArticles.values());
  const starred = articles.filter((article) => article.starred);
  const unstarred = articles.filter((article) => !article.starred);

  unstarred.sort((a, b) => {
    const dateA = a.datePublished || a.dateArrived;
    const dateB = b.datePublished || b.dateArrived;
    return dateB.getTime() - dateA.getTime();
  });

  return [...starred, ...unstarred].slice(0, maxArticles);
}

/**
 * Convert a parsed item into a fresh Article record.
 *
 * @param {object} item
 * @param {string} feedURL
 * @returns {object}
 */
function convertToArticle(item, feedURL) {
  return {
    articleID: generateArticleID(),
    feedURL,
    uniqueID: item.uniqueID,
    title: item.title,
    contentHTML: item.contentHTML,
    contentText: item.contentText,
    url: item.url,
    externalURL: item.externalURL,
    summary: item.summary,
    imageURL: item.imageURL,
    bannerImageURL: item.bannerImageURL,
    datePublished: item.datePublished,
    dateModified: item.dateModified,
    authors: item.authors,
    tags: item.tags,
    read: false,
    starred: false,
    dateArrived: new Date(),
    contentHash: hashArticleContent(item),
  };
}

/**
 * Update an existing article from a parsed item.
 *
 * @param {object} article - Existing article (may lack content columns when
 *   loaded via the refresh-slim query)
 * @param {object} item - Parsed feed item
 * @param {string} newHash - Precomputed hash of the parsed item's content
 * @returns {object}
 */
function updateArticleFromParsedItem(article, item, newHash) {
  // Content columns may be absent on refresh-slim records, so detect
  // content changes via the hash: the caller only routes articles here
  // when the parsed hash differs from the stored hash (or no hash was
  // stored yet). A missing stored hash means legacy data — fall back to
  // comparing the small metadata fields so unchanged legacy articles do
  // not get their dateModified bumped on every refresh.
  const metadataChanged =
    article.title !== item.title ||
    article.summary !== item.summary;
  const contentChanged = metadataChanged || Boolean(article.contentHash);

  return {
    ...article,
    title: item.title,
    contentHTML: item.contentHTML,
    contentText: item.contentText,
    url: item.url,
    externalURL: item.externalURL,
    summary: item.summary,
    imageURL: item.imageURL,
    bannerImageURL: item.bannerImageURL,
    datePublished: item.datePublished,
    dateModified: contentChanged ? new Date() : article.dateModified,
    authors: item.authors,
    tags: item.tags,
    contentHash: newHash,
  };
}

/**
 * Generate a unique article ID.
 *
 * @returns {string}
 */
function generateArticleID() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
