/**
 * OPML Subscription List Library
 *
 * Helpers for importing and exporting RSS subscription lists in OPML
 * format. OPML is the de-facto standard for moving feed subscriptions
 * between readers.
 *
 * Exported helpers:
 *   - exportOPML(feeds, title) -> XML string
 *   - parseOPML(text)          -> Array<{name, url, homePageURL}>
 */

import { decodeHTMLEntities } from './html-utils.js';

/**
 * Escape text for use inside XML attribute values.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeXML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Parse attribute pairs from an XML tag's attribute string.
 *
 * Handles double- and single-quoted values and lower-cases names so
 * callers do not need to worry about xmlUrl vs xmlurl.
 *
 * @param {string} attributeText
 * @returns {Record<string, string>}
 */
function parseAttributes(attributeText) {
  const attributes = {};
  const regex = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;

  while ((match = regex.exec(attributeText)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] !== undefined ? match[2] : match[3];
    attributes[name] = value;
  }

  return attributes;
}

/**
 * Generate an OPML 2.0 document from a list of feeds.
 *
 * @param {Array<object>} feeds - Feed objects with name, url, and optional homePageURL
 * @param {string} [title='Subscriptions'] - Document title
 * @returns {string} OPML XML
 */
export function exportOPML(feeds, title = 'Subscriptions') {
  const dateCreated = new Date().toUTCString();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escapeXML(title)}</title>`,
    `    <dateCreated>${escapeXML(dateCreated)}</dateCreated>`,
    '  </head>',
    '  <body>',
  ];

  for (const feed of feeds) {
    if (!feed || !feed.url) {
      continue;
    }

    const name = feed.name || 'Untitled Feed';
    const attrs = [
      'type="rss"',
      `text="${escapeXML(name)}"`,
      `title="${escapeXML(name)}"`,
      `xmlUrl="${escapeXML(feed.url)}"`,
    ];

    if (feed.homePageURL) {
      attrs.push(`htmlUrl="${escapeXML(feed.homePageURL)}"`);
    }

    lines.push(`    <outline ${attrs.join(' ')}/>`);
  }

  lines.push('  </body>', '</opml>');
  return lines.join('\n');
}

/**
 * Parse an OPML document and return the RSS subscription outlines.
 *
 * Recognizes outline elements with an xmlUrl attribute (case-insensitive).
 * Prefers the text attribute for the subscription name, falling back to
 * title, name, or the feed URL itself.
 *
 * @param {string} text - OPML XML
 * @returns {Array<{name: string, url: string, homePageURL?: string}>}
 */
export function parseOPML(text) {
  if (!text) {
    return [];
  }

  const subscriptions = [];
  const outlineRegex = /<outline\s+([^>]*)\/?>/gi;
  let match;

  while ((match = outlineRegex.exec(text)) !== null) {
    const attrs = parseAttributes(match[1]);
    const url = attrs.xmlurl;

    if (!url) {
      continue;
    }

    const rawName = attrs.text || attrs.title || attrs.name || url;
    subscriptions.push({
      name: decodeHTMLEntities(rawName).trim() || url,
      url: decodeHTMLEntities(url).trim(),
      homePageURL: attrs.htmlurl ? decodeHTMLEntities(attrs.htmlurl).trim() : undefined,
    });
  }

  return subscriptions;
}
