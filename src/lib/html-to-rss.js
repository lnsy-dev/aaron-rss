/**
 * HTML-to-RSS Bridge
 *
 * Generates a synthetic ParsedFeed from an HTML page when no real RSS
 * feed is available. This is a direct port of the plugin's
 * HTMLToRSSBridge, adapted to use the app's network helpers.
 */

import { fetchText } from './rss-network.js';
import { decodeHTMLEntities, stripHTML } from './html-utils.js';

const BRIDGE_RULES = [
  {
    name: 'GitHub Releases',
    urlPattern: /github\.com\/[^/]+\/[^/]+\/?$/,
    articleSelector: '.Box-row',
    titleSelector: '.Link--primary',
    linkSelector: '.Link--primary',
    contentSelector: '.markdown-body',
    dateSelector: 'relative-time',
    linkAttribute: 'href',
  },
  {
    name: 'Hacker News',
    urlPattern: /news\.ycombinator\.com/,
    articleSelector: '.athing',
    titleSelector: '.titleline > a',
    linkSelector: '.titleline > a',
    linkAttribute: 'href',
  },
  {
    name: 'Reddit',
    urlPattern: /reddit\.com\/r\/[^/]+\/?$/,
    articleSelector: '[data-testid="post-container"]',
    titleSelector: 'h3',
    linkSelector: 'h3 a',
    linkAttribute: 'href',
  },
  {
    name: 'News Site',
    urlPattern: /\.(com|org|net|co\.uk|de|fr)$/,
    articleSelector: '.article, .story, .post-item, .news-item',
    titleSelector: '.headline, .title, h2, h3',
    linkSelector: 'a',
    contentSelector: '.excerpt, .summary, .description',
    dateSelector: '.date, .timestamp, time',
    linkAttribute: 'href',
  },
  {
    name: 'Blog',
    urlPattern: /blog|wordpress|medium/i,
    articleSelector: '.post, .entry, article',
    titleSelector: '.post-title, .entry-title, h1, h2',
    linkSelector: '.post-title a, .entry-title a, h1 a, h2 a',
    contentSelector: '.post-excerpt, .entry-summary, .excerpt',
    dateSelector: '.post-date, .entry-date, .published',
    linkAttribute: 'href',
  },
  {
    name: 'Generic Article',
    urlPattern: /.*/,
    articleSelector: 'article, .post, .entry, .news-item, .blog-post, .content-item',
    titleSelector: 'h1, h2, h3, .title, .headline',
    linkSelector: 'a[href]',
    contentSelector: '.content, .excerpt, .summary, p',
    dateSelector: 'time, .date, .published',
    linkAttribute: 'href',
  },
];

/**
 * Generate a synthetic feed from an already-fetched HTML page.
 *
 * This variant is used by the feed-refresh worker so the worker can
 * process synthetic feeds without doing network I/O itself.
 *
 * @param {string} url - The page URL
 * @param {string} html - The raw HTML body
 * @returns {object|null} ParsedFeed or null
 */
export function generateRSSFromHTMLText(url, html) {
  try {
    const rule = findMatchingRule(url);
    if (!rule) {
      return null;
    }

    const articles = extractArticles(html, rule, url);
    if (articles.length === 0) {
      return null;
    }

    const feedTitle = extractSiteTitle(html) || new URL(url).hostname;

    return {
      type: 'rss',
      title: `${feedTitle} (Generated Feed)`,
      homePageURL: url,
      feedURL: url,
      feedDescription: `Auto-generated RSS feed from ${feedTitle}`,
      iconURL: extractFaviconURL(url),
      faviconURL: extractFaviconURL(url),
      authors: [],
      items: articles,
    };
  } catch (error) {
    console.error('Failed to generate RSS from HTML:', error);
    return null;
  }
}

/**
 * Generate a synthetic feed from an HTML page.
 *
 * @param {string} url - The page URL
 * @returns {Promise<object|null>} ParsedFeed or null
 */
export async function generateRSSFromHTML(url) {
  try {
    const response = await fetchText(url);
    if (!response.ok) {
      return null;
    }

    return generateRSSFromHTMLText(url, response.text);
  } catch (error) {
    console.error('Failed to generate RSS from HTML:', error);
    return null;
  }
}

/**
 * Find the first bridge rule matching the URL.
 *
 * @param {string} url
 * @returns {object|null}
 */
function findMatchingRule(url) {
  for (const rule of BRIDGE_RULES) {
    if (rule.urlPattern.test(url)) {
      return rule;
    }
  }
  return null;
}

/**
 * Extract article items from HTML using a bridge rule.
 *
 * @param {string} html
 * @param {object} rule
 * @param {string} baseUrl
 * @returns {Array<object>}
 */
function extractArticles(html, rule, baseUrl) {
  const articles = [];
  const articleMatches = findElementsBySelector(html, rule.articleSelector);

  for (let i = 0; i < Math.min(articleMatches.length, 20); i++) {
    const articleHtml = articleMatches[i];
    const title = extractTextFromSelector(articleHtml, rule.titleSelector);
    if (!title) continue;

    const link = extractLinkFromSelector(articleHtml, rule.linkSelector, rule.linkAttribute);
    const absoluteLink = link ? resolveURL(link, baseUrl) : baseUrl;
    const content = rule.contentSelector ? extractTextFromSelector(articleHtml, rule.contentSelector) : '';
    const dateStr = rule.dateSelector ? extractTextFromSelector(articleHtml, rule.dateSelector) : '';
    const imageUrl = rule.imageSelector ? extractLinkFromSelector(articleHtml, rule.imageSelector, 'src') : undefined;

    const cleanTitle = cleanText(title);
    const cleanContent = cleanText(content || title);
    const finalTitle = (!cleanTitle || cleanTitle.toLowerCase() === 'untitled')
      ? truncateText(cleanContent, 100)
      : cleanTitle;

    articles.push({
      uniqueID: generateUniqueID(title, absoluteLink),
      title: finalTitle,
      contentHTML: content ? `<p>${cleanText(content)}</p>` : `<p>${cleanText(title)}</p>`,
      contentText: cleanContent,
      url: absoluteLink,
      externalURL: absoluteLink,
      summary: truncateText(cleanContent, 200),
      imageURL: imageUrl ? resolveURL(imageUrl, baseUrl) : undefined,
      datePublished: parseDate(dateStr),
      dateModified: parseDate(dateStr),
      authors: [],
      tags: [],
    });
  }

  return articles;
}

/**
 * Find HTML elements by a very simple selector.
 *
 * @param {string} html
 * @param {string} selector
 * @returns {Array<string>}
 */
function findElementsBySelector(html, selector) {
  const elements = [];

  if (selector.startsWith('.')) {
    const className = selector.substring(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<[^>]*class=[^>]*\\b${className}\\b[^>]*>.*?</[^>]+>`, 'gis');
    let match;
    while ((match = regex.exec(html)) !== null) {
      elements.push(match[0]);
    }
  } else if (selector.includes('[')) {
    const attrMatch = selector.match(/\[([^=]+)="([^"]+)"\]/);
    if (attrMatch) {
      const [, attr, value] = attrMatch;
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`<[^>]*${attr}=[^>]*\\b${escapedValue}\\b[^>]*>.*?</[^>]+>`, 'gis');
      let match;
      while ((match = regex.exec(html)) !== null) {
        elements.push(match[0]);
      }
    }
  } else if (selector.includes(',')) {
    const selectors = selector.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      elements.push(...findElementsBySelector(html, sel));
    }
  } else {
    const tag = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<${tag}[^>]*>.*?</${tag}>`, 'gis');
    let match;
    while ((match = regex.exec(html)) !== null) {
      elements.push(match[0]);
    }
  }

  return elements.slice(0, 20);
}

/**
 * Extract text content using a selector.
 *
 * @param {string} html
 * @param {string} selector
 * @returns {string}
 */
function extractTextFromSelector(html, selector) {
  const elements = findElementsBySelector(html, selector);
  if (elements.length === 0) return '';

  const element = elements[0];
  let text = stripHTML(element);

  if (!text.trim()) {
    const nestedTextMatch = element.match(/>([^<]+)</);
    if (nestedTextMatch) {
      text = nestedTextMatch[1].trim();
    }
  }

  return text;
}

/**
 * Extract an attribute value using a selector.
 *
 * @param {string} html
 * @param {string|undefined} selector
 * @param {string} attribute
 * @returns {string}
 */
function extractLinkFromSelector(html, selector, attribute = 'href') {
  if (!selector) return '';

  const elements = findElementsBySelector(html, selector);
  if (elements.length === 0) return '';

  const element = elements[0];
  const attrMatch = element.match(new RegExp(`${attribute}=['"']([^'"']+)['"]`, 'i'));
  return attrMatch ? attrMatch[1] : '';
}

/**
 * Extract the page title from HTML.
 *
 * @param {string} html
 * @returns {string}
 */
function extractSiteTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? cleanText(decodeHTMLEntities(titleMatch[1])) : '';
}

/**
 * Guess the site's favicon URL.
 *
 * @param {string} url
 * @returns {string}
 */
function extractFaviconURL(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

/**
 * Parse a date string, falling back to now.
 *
 * @param {string} dateStr
 * @returns {Date}
 */
function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Generate a stable ID from title and link.
 *
 * @param {string} title
 * @param {string} link
 * @returns {string}
 */
function generateUniqueID(title, link) {
  const content = title + link;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
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
 * Collapse whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Truncate text with ellipsis.
 *
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}
