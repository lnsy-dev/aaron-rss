/**
 * Article Processor
 *
 * Merges newly parsed articles with existing ones, preserving read/starred
 * state and limiting the total number of articles kept per feed.
 */

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
    if (parsedItem) {
      updatedArticles.push(updateArticleFromParsedItem(article, parsedItem));
    } else {
      updatedArticles.push(article);
    }
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
  };
}

/**
 * Update an existing article from a parsed item.
 *
 * @param {object} article
 * @param {object} item
 * @returns {object}
 */
function updateArticleFromParsedItem(article, item) {
  const contentChanged =
    article.title !== item.title ||
    article.contentHTML !== item.contentHTML ||
    article.summary !== item.summary;

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
