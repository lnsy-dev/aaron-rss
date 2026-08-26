/**
 * RSS/Atom/JSON Feed Parser
 *
 * Wraps the `rss-parser` npm package and normalizes its output into the
 * app's `ParsedFeed` / `ParsedItem` shape.
 */

import Parser from 'rss-parser';
import { decodeHTMLEntities, stripHTML } from './html-utils.js';

const parser = new Parser({
  customFields: {
    feed: ['language', 'copyright', 'managingEditor', 'webMaster'],
    item: ['author', 'category', 'comments', 'enclosure', 'guid', 'source'],
  },
});

const FEED_TYPES = {
  RSS: 'rss',
  ATOM: 'atom',
  JSON: 'jsonFeed',
  UNKNOWN: 'unknown',
};

/**
 * Parse a feed from its XML or JSON text.
 *
 * @param {string} feedContent - Raw feed body
 * @param {string} feedURL - The feed URL
 * @returns {Promise<object|null>} ParsedFeed or null on failure
 */
export async function parseFeedText(feedContent, feedURL) {
  try {
    const type = detectFeedType(feedContent);

    if (type === FEED_TYPES.JSON) {
      return parseJSONFeed(feedContent, feedURL);
    }

    const parsed = await parser.parseString(feedContent);

    return {
      type,
      title: parsed.title ? decodeHTMLEntities(parsed.title).trim() : '',
      homePageURL: parsed.link,
      feedURL,
      feedDescription: parsed.description ? stripHTML(parsed.description) : '',
      iconURL: parsed.image?.url,
      faviconURL: extractFaviconURL(feedURL),
      authors: extractAuthors(parsed),
      items: (parsed.items || []).map(convertToParsedItem),
    };
  } catch (error) {
    console.error('Feed parsing failed:', error);
    return null;
  }
}

/**
 * Parse a JSON Feed 1.0/1.1 document into the app's ParsedFeed shape.
 *
 * @param {string} feedContent - Raw JSON feed body
 * @param {string} feedURL - The feed URL
 * @returns {object|null} ParsedFeed or null on failure
 */
function parseJSONFeed(feedContent, feedURL) {
  const json = JSON.parse(feedContent);

  if (!json || typeof json !== 'object' || !Array.isArray(json.items)) {
    return null;
  }

  const feedAuthors = extractJSONAuthors(json.authors || json.author);

  return {
    type: FEED_TYPES.JSON,
    title: typeof json.title === 'string' ? decodeHTMLEntities(json.title).trim() : '',
    homePageURL: json.home_page_url,
    feedURL: json.feed_url || feedURL,
    feedDescription: typeof json.description === 'string' ? stripHTML(json.description) : '',
    iconURL: json.icon,
    faviconURL: json.favicon || extractFaviconURL(feedURL),
    authors: feedAuthors,
    items: json.items.map((item) => convertJSONItem(item, feedAuthors)),
  };
}

/**
 * Convert a JSON Feed item into the app's ParsedItem shape.
 *
 * @param {object} item
 * @param {Array<object>} feedAuthors - Feed-level authors to fall back to
 * @returns {object}
 */
function convertJSONItem(item, feedAuthors) {
  const contentHTML = typeof item.content_html === 'string' ? item.content_html : '';
  const contentText = typeof item.content_text === 'string'
    ? item.content_text
    : stripHTML(contentHTML);
  let title = typeof item.title === 'string' ? decodeHTMLEntities(item.title).trim() : '';

  if (!title || title.toLowerCase() === 'untitled') {
    title = truncateText(contentText, 300);
  }

  const itemURL = item.url && isURL(item.url) ? item.url : undefined;
  const uniqueID = typeof item.id === 'string' ? item.id : (itemURL || simpleHash(title + contentText));
  const itemAuthors = extractJSONAuthors(item.authors || item.author);

  return {
    uniqueID,
    title,
    contentHTML: contentHTML || item.content_text,
    contentText,
    url: itemURL,
    externalURL: item.external_url && isURL(item.external_url) ? item.external_url : itemURL,
    summary: typeof item.summary === 'string' ? stripHTML(item.summary) : truncateText(contentText, 200),
    imageURL: item.image || item.banner_image,
    datePublished: item.date_published ? new Date(item.date_published) : undefined,
    dateModified: item.date_modified ? new Date(item.date_modified) : undefined,
    authors: itemAuthors.length > 0 ? itemAuthors : feedAuthors,
    tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string') : [],
  };
}

/**
 * Extract authors from JSON Feed author/authors fields.
 *
 * Handles both JSON Feed 1.0 (`author` string/object) and 1.1
 * (`authors` array of {name, url, avatar}).
 *
 * @param {string|object|Array<object>} value
 * @returns {Array<object>}
 */
function extractJSONAuthors(value) {
  if (!value) return [];

  if (typeof value === 'string') {
    return [{ name: decodeHTMLEntities(value) }];
  }

  if (Array.isArray(value)) {
    return value
      .filter((author) => author && typeof author.name === 'string')
      .map((author) => ({ name: decodeHTMLEntities(author.name) }));
  }

  if (value && typeof value.name === 'string') {
    return [{ name: decodeHTMLEntities(value.name) }];
  }

  return [];
}

/**
 * Detect the syndication format from raw content.
 *
 * @param {string} content
 * @returns {string}
 */
function detectFeedType(content) {
  const trimmed = content.trim().toLowerCase();

  if (trimmed.includes('<rss')) return FEED_TYPES.RSS;
  if (trimmed.includes('<feed') && trimmed.includes('xmlns="http://www.w3.org/2005/atom"')) {
    return FEED_TYPES.ATOM;
  }
  if (trimmed.startsWith('{') && trimmed.includes('"version"')) return FEED_TYPES.JSON;

  return FEED_TYPES.UNKNOWN;
}

/**
 * Convert a rss-parser item into the app's ParsedItem shape.
 *
 * @param {object} item
 * @returns {object}
 */
function convertToParsedItem(item) {
  const contentText = stripHTML(item.content || item['content:encoded'] || item.description || '');
  let title = item.title;

  if (title) {
    title = decodeHTMLEntities(title).trim();
  }

  if (!title || title.toLowerCase() === 'untitled') {
    title = truncateText(contentText, 300);
  }

  const itemURL = extractItemURL(item);

  return {
    uniqueID: generateUniqueID(item),
    title,
    contentHTML: item.content || item['content:encoded'] || item.description,
    contentText,
    url: itemURL,
    externalURL: itemURL,
    summary: item.summary
      ? stripHTML(item.summary)
      : truncateText(stripHTML(item.content || item.description || ''), 200),
    imageURL: extractImageURL(item),
    datePublished: item.pubDate ? new Date(item.pubDate) : undefined,
    dateModified: item.pubDate ? new Date(item.pubDate) : undefined,
    authors: extractItemAuthors(item),
    tags: extractTags(item),
  };
}

/**
 * Extract the canonical URL for an item, falling back to id/guid when
 * rss-parser does not surface a dedicated link (common in Atom feeds).
 *
 * @param {object} item
 * @returns {string|undefined}
 */
function extractItemURL(item) {
  if (item.link && isURL(item.link)) {
    return item.link;
  }

  const fallback = item.guid || item.id;
  if (fallback && isURL(fallback)) {
    return fallback;
  }

  return undefined;
}

/**
 * Check whether a value looks like an absolute HTTP(S) URL.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isURL(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/**
 * Generate a stable ID for an item.
 *
 * @param {object} item
 * @returns {string}
 */
function generateUniqueID(item) {
  const url = extractItemURL(item);
  if (url) return url;

  const content = (item.title || '') + (item.pubDate || '') + (item.description || '');
  return simpleHash(content);
}

/**
 * Simple 32-bit hash.
 *
 * @param {string} str
 * @returns {string}
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extract feed-level authors.
 *
 * @param {object} feed
 * @returns {Array<object>}
 */
function extractAuthors(feed) {
  const authors = [];
  if (feed.managingEditor) {
    authors.push({ name: decodeHTMLEntities(feed.managingEditor) });
  }
  return authors;
}

/**
 * Extract item-level authors.
 *
 * @param {object} item
 * @returns {Array<object>}
 */
function extractItemAuthors(item) {
  const names = new Set();
  const authors = [];

  if (item.author) {
    const name = decodeHTMLEntities(item.author);
    if (!names.has(name)) {
      names.add(name);
      authors.push({ name });
    }
  }

  if (item.creator) {
    const name = decodeHTMLEntities(item.creator);
    if (!names.has(name)) {
      names.add(name);
      authors.push({ name });
    }
  }

  return authors;
}

/**
 * Extract item tags/categories.
 *
 * @param {object} item
 * @returns {Array<string>}
 */
function extractTags(item) {
  const tags = [];
  const categories = item.categories || item.category;

  if (Array.isArray(categories)) {
    tags.push(...categories.map(normalizeTag));
  } else if (typeof categories === 'string') {
    tags.push(normalizeTag(categories));
  } else if (categories && typeof categories === 'object' && categories.$ && categories.$.term) {
    tags.push(normalizeTag(categories.$.term));
  }

  return tags.filter(Boolean);
}

/**
 * Normalize a tag value by decoding any HTML entities.
 *
 * @param {string|object} tag
 * @returns {string}
 */
function normalizeTag(tag) {
  if (typeof tag === 'string') {
    return decodeHTMLEntities(tag);
  }
  if (tag && typeof tag === 'object' && tag.$ && tag.$.term) {
    return decodeHTMLEntities(tag.$.term);
  }
  return String(tag);
}

/**
 * Extract an image URL from an item.
 *
 * @param {object} item
 * @returns {string|undefined}
 */
function extractImageURL(item) {
  if (item.enclosure?.type?.startsWith('image/')) {
    return item.enclosure.url;
  }
  if (item.image?.url) {
    return item.image.url;
  }

  const content = item.content || item['content:encoded'] || item.description || '';
  const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imgMatch ? imgMatch[1] : undefined;
}

/**
 * Guess the site's favicon URL.
 *
 * @param {string} feedURL
 * @returns {string}
 */
function extractFaviconURL(feedURL) {
  try {
    const url = new URL(feedURL);
    return `${url.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

/**
 * Truncate text to a maximum length.
 *
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}
