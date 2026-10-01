/**
 * Article Extractor
 *
 * Fetches a web article and extracts clean Markdown using Defuddle,
 * the same content-extraction engine used by Obsidian Web Clipper.
 * URLs pointing at PDF documents are routed to the PDF text extractor
 * (unpdf) so their text opens as a readable article.
 *
 * @see https://github.com/kepano/defuddle
 */

import Defuddle from 'defuddle';
import { fetchText } from './rss-network.js';
import { isCloudflareChallenge } from '../../electron/challenge-detect.js';
import { repairBrokenEntitiesInHTML } from './html-utils.js';
import {
  extractPDFArticle,
  isPDFContentType,
  isPDFURL,
  looksLikePDFText,
} from './pdf-extractor.js';

/**
 * Error `code` set when a fetch is answered by a Cloudflare bot
 * challenge rather than the article. Callers (the article viewer)
 * react by showing the website in the article view instead of an
 * extraction error.
 */
export const CLOUDFLARE_CHALLENGE_CODE = 'cloudflare-challenge';

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
 * URLs that point at PDF documents (by .pdf extension, PDF content-type,
 * or a `%PDF-` magic-byte sniff) are routed to the PDF text extractor
 * instead of the HTML parser, so feed items linking report PDFs — like
 * the USDA NASS publications — open as readable articles.
 *
 * @param {string} url - The article URL
 * @returns {Promise<object>} Extracted article with markdown and metadata
 */
export async function extractArticle(url) {
  if (!url) {
    throw new Error('No URL provided for article extraction');
  }

  // Unambiguous PDF link: skip the HTML path (and its text fetch) and
  // go straight to the byte-oriented PDF extractor.
  if (isPDFURL(url)) {
    return extractPDFArticle(url);
  }

  // Article extraction never runs the challenge solver: a hidden solve
  // stalls the open for up to a minute and an interactive one pops a
  // browser window at the user (the reported "very delayed, then a new
  // window" bug). Fetch as-is, detect the challenge up front, and let
  // the viewer show the website in the article view instead — a
  // top-level embed clears the check like any normal browser tab.
  const response = await fetchText(url, { clearChallenges: false });
  if (isCloudflareChallenge(response)) {
    const error = new Error('This site is protected by a Cloudflare bot check');
    error.code = CLOUDFLARE_CHALLENGE_CODE;
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch article: ${response.status}`);
  }

  // A PDF served at a URL without the .pdf extension is caught by its
  // content-type or by the `%PDF-` header that survives the text decode.
  if (isPDFContentType(response.contentType) || looksLikePDFText(response.text)) {
    return extractPDFArticle(url);
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

  // Publishers occasionally serve content with broken (empty) entities —
  // e.g. "they&;re" where an apostrophe entity was mangled upstream.
  // Defuddle's markdown output re-escapes them faithfully, so repair the
  // encoded forms here to keep exports and scraped markdown readable.
  return {
    url,
    markdown: repairBrokenEntitiesInHTML(result.content || ''),
    title: repairBrokenEntitiesInHTML(result.title || ''),
    author: repairBrokenEntitiesInHTML(result.author || ''),
    description: repairBrokenEntitiesInHTML(result.description || ''),
    domain: result.domain || '',
    site: result.site || '',
    published: result.published || '',
    image: result.image || '',
    favicon: result.favicon || '',
    language: result.language || '',
    wordCount: typeof result.wordCount === 'number' ? result.wordCount : 0,
  };
}
