/**
 * Feed Finder
 *
 * Discovers RSS/Atom/JSON Feed URLs from a website. Tries the URL as-is,
 * parses `<link>` tags in the HTML, probes common feed paths, and handles
 * a few well-known site special cases.
 */

import { fetchText } from './rss-network.js';
import { parseFeedText } from './rss-parser.js';
import { decodeHTMLEntities } from './html-utils.js';

const COMMON_FEED_PATHS = [
  '/rss',
  '/rss.xml',
  '/feed',
  '/feed.xml',
  '/feeds',
  '/feeds.xml',
  '/atom.xml',
  '/index.xml',
];

const EXTENDED_FEED_PATHS = [
  '/feed',
  '/feeds',
  '/rss',
  '/rss.xml',
  '/rss/updates.xml',
  '/atom.xml',
  '/feed.xml',
  '/index.xml',
  '/.rss',
  '/feeds/all.atom.xml',
  '/feeds/posts/default',
  '/feeds/posts/default?alt=rss',
  '/rss/index.xml',
  '/feed/index.xml',
  '/news/rss.xml',
  '/blog/feed',
  '/blog/rss',
  '/blog/atom.xml',
];

/**
 * Discover feed URLs for a given site or feed URL.
 *
 * @param {string} url
 * @returns {Promise<Array<object>>} Array of { url, title?, score, synthetic? }
 */
export async function findFeeds(url) {
  const feeds = [];

  try {
    if (await isFeedURL(url)) {
      feeds.push({ url, score: 100 });
      return feeds;
    }

    const socialFeeds = await trySocialMediaFeeds(url);
    if (socialFeeds.length > 0) {
      return socialFeeds.sort((a, b) => b.score - a.score);
    }

    const htmlFeeds = await findFeedsInHTML(url);
    feeds.push(...htmlFeeds);

    const pathFeeds = await tryCommonPaths(url);
    feeds.push(...pathFeeds);

    const subdomainFeeds = await trySubdomainVariations(url);
    feeds.push(...subdomainFeeds);

    const uniqueFeeds = removeDuplicates(feeds);
    return uniqueFeeds.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error('Feed discovery failed:', error);
    return [];
  }
}

/**
 * Check whether a URL returns a valid feed.
 *
 * Accepts a response when the content type identifies a feed, the body
 * sniffs as RSS/Atom XML, or the body parses as a JSON Feed document.
 * JSON is validated strictly (must start with `{`, declare a feed
 * version, and carry an items array) so arbitrary JSON responses — e.g.
 * JSON error pages that mention "version" — are not misidentified as
 * feeds and later crash the XML parser.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function isFeedURL(url) {
  try {
    const response = await fetchText(url);
    if (!response.ok) {
      return false;
    }

    const contentType = (response.contentType || '').toLowerCase();
    const content = response.text || '';

    const isFeedContentType =
      contentType.includes('application/rss+xml') ||
      contentType.includes('application/atom+xml') ||
      contentType.includes('application/feed+json');

    if (isFeedContentType) {
      return true;
    }

    const trimmed = content.trim();
    if (trimmed.startsWith('<')) {
      // XML-ish: only accept documents that sniff as a feed.
      const lowerContent = trimmed.toLowerCase();
      return (
        lowerContent.includes('<rss') ||
        lowerContent.includes('<feed') ||
        lowerContent.includes('<atom') ||
        lowerContent.includes('<rdf')
      );
    }

    if (trimmed.startsWith('{')) {
      // JSON: only accept actual JSON Feed documents.
      return isJSONFeedDocument(trimmed);
    }

    return false;
  } catch (error) {
    console.error('Error checking feed URL', url, error);
    return false;
  }
}

/**
 * Check whether text is a valid JSON Feed document.
 *
 * @param {string} text - JSON text starting with '{'
 * @returns {boolean}
 */
function isJSONFeedDocument(text) {
  try {
    const json = JSON.parse(text);
    return Boolean(
      json &&
      typeof json === 'object' &&
      typeof json.version === 'string' &&
      Array.isArray(json.items)
    );
  } catch {
    return false;
  }
}

/**
 * Discover feeds for well-known social media profile URLs.
 *
 * Bluesky and Mastodon expose standard RSS/Atom feeds for profiles, but
 * those feeds are not always discoverable via generic `<link>` tags or
 * common feed paths. This helper maps profile URLs directly to their
 * canonical feed URLs and validates them before returning.
 *
 * @param {string} url
 * @returns {Promise<Array<object>>}
 */
async function trySocialMediaFeeds(url) {
  const blueskyFeeds = await tryBlueskyFeed(url);
  if (blueskyFeeds.length > 0) {
    return blueskyFeeds;
  }

  return tryMastodonFeed(url);
}

/**
 * Map a Bluesky profile URL to its RSS feed.
 *
 * @param {string} url
 * @returns {Promise<Array<object>>}
 */
async function tryBlueskyFeed(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname !== 'bsky.app') {
      return [];
    }

    const match = urlObj.pathname.match(/^\/profile\/([^/]+)/);
    if (!match) {
      return [];
    }

    const handle = match[1];
    const feedUrl = `https://bsky.app/profile/${handle}/rss`;
    if (await isFeedURL(feedUrl)) {
      return [{
        url: feedUrl,
        title: `@${handle} on Bluesky`,
        score: 95,
      }];
    }
  } catch {
    // invalid URL
  }

  return [];
}

/**
 * Map a Mastodon profile URL to its Atom feed.
 *
 * @param {string} url
 * @returns {Promise<Array<object>>}
 */
async function tryMastodonFeed(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    let handle = null;
    const atMatch = pathname.match(/^\/@([^/]+)/);
    if (atMatch) {
      handle = atMatch[1];
    } else {
      const usersMatch = pathname.match(/^\/users\/([^/]+)/);
      if (usersMatch) {
        handle = usersMatch[1];
      }
    }

    if (!handle) {
      return [];
    }

    const feedUrl = `${urlObj.origin}/@${handle}.atom`;
    if (await isFeedURL(feedUrl)) {
      return [{
        url: feedUrl,
        title: `@${handle} on ${urlObj.hostname}`,
        score: 95,
      }];
    }

    const usersFeedUrl = `${urlObj.origin}/users/${handle}.atom`;
    if (await isFeedURL(usersFeedUrl)) {
      return [{
        url: usersFeedUrl,
        title: `@${handle} on ${urlObj.hostname}`,
        score: 95,
      }];
    }
  } catch {
    // invalid URL
  }

  return [];
}

/**
 * Look for feed links inside an HTML page.
 *
 * @param {string} url
 * @returns {Promise<Array<object>>}
 */
async function findFeedsInHTML(url) {
  try {
    const response = await fetchText(url);
    if (!response.ok) return [];

    const html = response.text;
    const candidateMap = new Map();

    const patterns = [
      /<link[^>]*(?:type=["']application\/(?:rss\+xml|atom\+xml|json)["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*type=["']application\/(?:rss\+xml|atom\+xml|json)["'])[^>]*>/gi,
      /<link[^>]*(?:type=["']application\/xml["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*type=["']application\/xml["'])[^>]*>/gi,
      /<link[^>]*href=["']([^"']*(?:rss|feed|atom)[^"]*)["'][^>]*>/gi,
      /<a[^>]*href=["']([^"']*(?:rss|feed|atom|\.xml)[^"]*)["'][^>]*>/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const feedUrl = match[1] || match[2];
        if (feedUrl && isValidFeedUrl(feedUrl)) {
          const absoluteUrl = resolveURL(feedUrl, url);
          const title = extractTitle(match[0]);
          const score = scoreFeed(feedUrl, title);
          const existing = candidateMap.get(absoluteUrl);
          if (!existing || score > existing.score) {
            candidateMap.set(absoluteUrl, { title, score });
          }
        }
      }
    }

    const feeds = [];
    const validationPromises = Array.from(candidateMap.entries()).map(async ([feedUrl, meta]) => {
      if (await isFeedURL(feedUrl)) {
        feeds.push({
          url: feedUrl,
          title: meta.title,
          score: meta.score,
        });
      }
    });
    await Promise.all(validationPromises);

    return feeds;
  } catch (error) {
    console.error('HTML parsing failed:', error);
    return [];
  }
}

/**
 * Probe common feed paths under a base URL.
 *
 * @param {string} baseUrl
 * @returns {Promise<Array<object>>}
 */
async function tryCommonPaths(baseUrl) {
  const feeds = [];
  let base;

  try {
    base = new URL(baseUrl);
  } catch {
    return feeds;
  }

  const paths = [...COMMON_FEED_PATHS, ...EXTENDED_FEED_PATHS];
  const pathPromises = paths.map(async (path) => {
    try {
      const feedUrl = `${base.origin}${path}`;
      if (await isFeedURL(feedUrl)) {
        return { url: feedUrl, score: scoreCommonPath(path) };
      }
    } catch {
      // ignore
    }
    return null;
  });

  const results = await Promise.allSettled(pathPromises);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      feeds.push(result.value);
    }
  }

  return feeds;
}

/**
 * Try known subdomain/feed patterns for major sites.
 *
 * @param {string} baseUrl
 * @returns {Promise<Array<object>>}
 */
async function trySubdomainVariations(baseUrl) {
  const feeds = [];

  try {
    const url = new URL(baseUrl);
    const domain = url.hostname;

    if (domain.includes('bbc.co') || domain.includes('bbc.com')) {
      const bbcFeeds = [
        'http://feeds.bbci.co.uk/news/rss.xml',
        'http://feeds.bbci.co.uk/news/world/rss.xml',
        'http://feeds.bbci.co.uk/news/uk/rss.xml',
        'http://feeds.bbci.co.uk/news/business/rss.xml',
        'http://feeds.bbci.co.uk/news/politics/rss.xml',
        'http://feeds.bbci.co.uk/news/health/rss.xml',
        'http://feeds.bbci.co.uk/news/education/rss.xml',
        'http://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
        'http://feeds.bbci.co.uk/news/technology/rss.xml',
      ];

      for (const feedUrl of bbcFeeds) {
        try {
          if (await isFeedURL(feedUrl)) {
            feeds.push({
              url: feedUrl,
              title: getBBCFeedTitle(feedUrl),
              score: 80,
            });
          }
        } catch {
          // continue
        }
      }

      return feeds;
    }

    const subdomains = ['rss', 'feeds', 'news', 'blog'];
    for (const subdomain of subdomains) {
      const subdomainUrl = `${url.protocol}//${subdomain}.${domain}`;
      const pathsToTry = ['/feed', '/rss', '/atom.xml', '/'];

      for (const path of pathsToTry) {
        try {
          const testUrl = `${subdomainUrl}${path}`;
          if (await isFeedURL(testUrl)) {
            feeds.push({ url: testUrl, score: 30 });
            break;
          }
        } catch {
          // continue
        }
      }
    }
  } catch {
    // invalid URL
  }

  return feeds;
}

/**
 * Get a human-readable title for known BBC feeds.
 *
 * @param {string} feedUrl
 * @returns {string}
 */
function getBBCFeedTitle(feedUrl) {
  const titleMap = {
    'http://feeds.bbci.co.uk/news/rss.xml': 'BBC News - Home',
    'http://feeds.bbci.co.uk/news/world/rss.xml': 'BBC News - World',
    'http://feeds.bbci.co.uk/news/uk/rss.xml': 'BBC News - UK',
    'http://feeds.bbci.co.uk/news/business/rss.xml': 'BBC News - Business',
    'http://feeds.bbci.co.uk/news/politics/rss.xml': 'BBC News - Politics',
    'http://feeds.bbci.co.uk/news/health/rss.xml': 'BBC News - Health',
    'http://feeds.bbci.co.uk/news/education/rss.xml': 'BBC News - Education',
    'http://feeds.bbci.co.uk/news/science_and_environment/rss.xml': 'BBC News - Science & Environment',
    'http://feeds.bbci.co.uk/news/technology/rss.xml': 'BBC News - Technology',
  };
  return titleMap[feedUrl] || 'BBC News Feed';
}

/**
 * Filter out obviously non-feed URLs.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isValidFeedUrl(url) {
  const invalidPatterns = [
    /\.(css|js|png|jpg|jpeg|gif|ico|svg)$/i,
    /^mailto:/,
    /^tel:/,
    /^javascript:/,
    /#/,
  ];
  return !invalidPatterns.some((pattern) => pattern.test(url));
}

/**
 * Extract the title attribute from a link tag snippet.
 *
 * @param {string} linkTag
 * @returns {string|undefined}
 */
function extractTitle(linkTag) {
  const titleMatch = linkTag.match(/title=["']([^"']+)["']/i);
  return titleMatch ? decodeHTMLEntities(titleMatch[1]) : undefined;
}

/**
 * Score a feed candidate by URL and title hints.
 *
 * @param {string} url
 * @param {string|undefined} title
 * @returns {number}
 */
function scoreFeed(url, title) {
  let score = 50;
  if (url.includes('feed')) score += 20;
  if (url.includes('rss')) score += 15;
  if (url.includes('atom')) score += 15;
  if (url.includes('xml')) score += 10;

  if (title) {
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('rss')) score += 10;
    if (lowerTitle.includes('feed')) score += 10;
    if (lowerTitle.includes('atom')) score += 10;
  }

  return Math.min(score, 100);
}

/**
 * Score a feed discovered via a common path.
 *
 * @param {string} path
 * @returns {number}
 */
function scoreCommonPath(path) {
  const scores = {
    '/feed': 40,
    '/rss': 35,
    '/atom.xml': 35,
    '/feed.xml': 30,
    '/feeds': 25,
    '/index.xml': 20,
    '/feeds/all.atom.xml': 35,
    '/feeds/posts/default': 30,
    '/.rss': 15,
  };
  return scores[path] || 10;
}

/**
 * Resolve a possibly-relative URL.
 *
 * @param {string} url
 * @param {string} base
 * @returns {string}
 */
function resolveURL(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/**
 * Remove duplicate feed URLs, keeping the highest score.
 *
 * @param {Array<object>} feeds
 * @returns {Array<object>}
 */
function removeDuplicates(feeds) {
  const best = new Map();
  for (const feed of feeds) {
    const existing = best.get(feed.url);
    if (!existing || feed.score > existing.score) {
      best.set(feed.url, feed);
    }
  }
  return Array.from(best.values());
}
