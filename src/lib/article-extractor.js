/**
 * Article Extractor
 *
 * Fetches a web article and extracts clean Markdown using Defuddle,
 * the same content-extraction engine used by Obsidian Web Clipper.
 *
 * @see https://github.com/kepano/defuddle
 */

import Defuddle from 'defuddle';
import { fetchText } from './rss-network.js';

/**
 * Remove unescaped control characters from JSON-LD schema.org script blocks.
 *
 * Defuddle parses the contents of `<script type="application/ld+json">`
 * elements with `JSON.parse`. Some publishers embed raw control characters
 * (literal newlines, tabs, etc.) inside JSON string values, which makes
 * `JSON.parse` throw. This sanitizes those blocks in-place before Defuddle
 * sees them so the metadata can still be extracted.
 *
 * @param {Document} doc - Parsed HTML document
 */
export function sanitizeSchemaOrgScripts(doc) {
  if (!doc || typeof doc.querySelectorAll !== 'function') {
    return;
  }

  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  scripts.forEach((script) => {
    const text = script.textContent || '';
    const sanitized = text.replace(/[\x00-\x1F]/g, ' ');
    if (sanitized !== text) {
      script.textContent = sanitized;
    }
  });
}

/**
 * Fetch a web page and extract its main content as Markdown.
 *
 * @param {string} url - The article URL
 * @returns {Promise<object>} Extracted article with markdown and metadata
 */
export async function extractArticle(url) {
  if (!url) {
    throw new Error('No URL provided for article extraction');
  }

  const response = await fetchText(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch article: ${response.status}`);
  }

  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is not available in this environment');
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(response.text, 'text/html');
  sanitizeSchemaOrgScripts(document);

  const defuddle = new Defuddle(document, { url, markdown: true });
  const result = defuddle.parse();

  if (!result) {
    throw new Error('Defuddle returned no content for this article');
  }

  return {
    url,
    markdown: result.content || '',
    title: result.title || '',
    author: result.author || '',
    description: result.description || '',
    domain: result.domain || '',
    site: result.site || '',
    published: result.published || '',
    image: result.image || '',
    favicon: result.favicon || '',
    language: result.language || '',
    wordCount: typeof result.wordCount === 'number' ? result.wordCount : 0,
  };
}
