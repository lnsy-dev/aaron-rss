/**
 * Page Snapshot Feed
 *
 * Turns a plain web page (no RSS feed available) into a "watched page"
 * feed by snapshotting every link on the page. On each refresh the link
 * list is re-extracted and diffed against the stored snapshot; any link
 * that was not present before becomes a new feed item.
 *
 * All functions here are pure and DOM-free so they can run inside the
 * feed-refresh worker and be unit-tested in Node.
 */

import { decodeHTMLEntities, stripHTML } from './html-utils.js';

/** Default maximum number of links kept in a snapshot. */
const MAX_SNAPSHOT_LINKS = 1000;

/**
 * Extract every meaningful link from an HTML document.
 *
 * Skips anchors, non-HTTP schemes (mailto:, javascript:, tel:, data:),
 * and the base URL itself. Relative URLs are resolved against the base,
 * fragments are stripped, and duplicates are removed (first occurrence
 * wins, keeping its anchor text).
 *
 * @param {string} html - The raw HTML body
 * @param {string} baseUrl - The page URL used to resolve relative links
 * @returns {Array<{url: string, text: string}>} Absolute links in document order
 */
export function extractPageLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const normalizedBase = normalizeURL(baseUrl);

  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const rawHref = match[1].trim();
    if (!rawHref || rawHref.startsWith('#')) continue;

    const schemeMatch = rawHref.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (schemeMatch && !/^https?$/i.test(schemeMatch[1])) continue;

    const absolute = resolveURL(rawHref, baseUrl);
    if (!absolute) continue;

    const normalized = normalizeURL(absolute);
    if (!normalized || normalized === normalizedBase || seen.has(normalized)) continue;
    seen.add(normalized);

    links.push({
      url: normalized,
      text: cleanText(stripHTML(match[2])),
    });
  }

  return links;
}

/**
 * Find links that were not part of a previous snapshot.
 *
 * @param {Array<string>} previousLinks - URLs captured in the last snapshot
 * @param {Array<{url: string, text: string}>} currentLinks - Links from the fresh page
 * @returns {Array<{url: string, text: string}>} Only the brand-new links
 */
export function diffPageLinks(previousLinks, currentLinks) {
  const known = new Set(previousLinks);
  return currentLinks.filter((link) => !known.has(link.url));
}

/**
 * Merge previously snapshotted URLs with freshly extracted links.
 *
 * Previously known links keep their position at the front of the list so
 * their identity is stable across refreshes; the result is capped to
 * avoid unbounded growth.
 *
 * @param {Array<string>} previousLinks - URLs captured in the last snapshot
 * @param {Array<{url: string, text: string}>} currentLinks - Links from the fresh page
 * @param {number} [maxLinks=1000] - Maximum number of URLs to keep
 * @returns {Array<string>} The merged snapshot URL list
 */
export function mergePageLinks(previousLinks, currentLinks, maxLinks = MAX_SNAPSHOT_LINKS) {
  const merged = [...previousLinks];
  const seen = new Set(previousLinks);

  for (const link of currentLinks) {
    if (!seen.has(link.url)) {
      seen.add(link.url);
      merged.push(link.url);
    }
  }

  return merged.slice(0, maxLinks);
}

/**
 * Convert a link into a parsed-feed item shape.
 *
 * The anchor text is preferred as the title, falling back to a prettified
 * URL slug and finally the hostname. Dates are left unset so article
 * merging falls back to the arrival time (when the link was first seen).
 *
 * @param {{url: string, text: string}} link - A link extracted from the page
 * @returns {object} A ParsedFeed item
 */
export function linkToFeedItem(link) {
  const title = link.text || titleFromURL(link.url);
  return {
    uniqueID: hashString(link.url),
    title,
    contentHTML: `<p><a href="${escapeHTML(link.url)}">${escapeHTML(title)}</a></p>`,
    contentText: `${title}\n${link.url}`,
    url: link.url,
    externalURL: link.url,
    summary: title,
    authors: [],
    tags: [],
  };
}

/**
 * Build a synthetic parsed feed from a watched page by diffing against
 * the stored snapshot.
 *
 * @param {string} html - The freshly fetched HTML body
 * @param {string} url - The watched page URL
 * @param {Array<string>} previousLinks - URLs captured in the last snapshot
 * @returns {{parsedFeed: object|null, snapshotLinks: Array<string>}} The
 *   feed containing only newly-seen links (null when nothing is new) plus
 *   the updated full link list to persist as the next snapshot.
 */
export function buildSnapshotParsedFeed(html, url, previousLinks) {
  const currentLinks = extractPageLinks(html, url);
  const newLinks = diffPageLinks(previousLinks, currentLinks);
  const snapshotLinks = mergePageLinks(previousLinks, currentLinks);

  if (newLinks.length === 0) {
    return { parsedFeed: null, snapshotLinks };
  }

  const pageTitle = extractPageTitle(html) || hostnameOf(url);

  return {
    parsedFeed: {
      type: 'rss',
      title: `${pageTitle} (Watched Page)`,
      homePageURL: url,
      feedURL: url,
      feedDescription: `New links detected on ${pageTitle}`,
      items: newLinks.map(linkToFeedItem),
    },
    snapshotLinks,
  };
}

/**
 * Extract a snapshot-worthy page title from HTML.
 *
 * @param {string} html
 * @returns {string} The decoded <title>, or '' when absent
 */
export function extractPageTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? cleanText(decodeHTMLEntities(match[1])) : '';
}

/**
 * Normalize a URL for comparison: strip the fragment and trailing slash
 * ambiguity while keeping query strings.
 *
 * @param {string} url
 * @returns {string} The normalized URL, or '' when unparsable
 */
function normalizeURL(url) {
  try {
    const urlObj = new URL(url);
    urlObj.hash = '';
    // Treat a trailing slash as insignificant (except on the root path)
    // so /journal and /journal/ deduplicate to one entry.
    if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    return urlObj.href.replace(/\?$/, '');
  } catch {
    return '';
  }
}

/**
 * Resolve a possibly-relative href against the page URL.
 *
 * @param {string} href
 * @param {string} base
 * @returns {string} The absolute URL, or '' when unparsable
 */
function resolveURL(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return '';
  }
}

/**
 * Derive a human-friendly title from a URL's last path segment.
 *
 * @param {string} url
 * @returns {string}
 */
function titleFromURL(url) {
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return urlObj.hostname;

    const decoded = decodeURIComponent(last)
      .replace(/\.(html?|php|aspx?)$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();

    if (!decoded) return urlObj.hostname;
    return decoded.charAt(0).toUpperCase() + decoded.slice(1);
  } catch {
    return url;
  }
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
 * Collapse whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Escape a string for safe interpolation into HTML.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeHTML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate a stable ID from a string (same scheme as html-to-rss).
 *
 * @param {string} content
 * @returns {string}
 */
function hashString(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
