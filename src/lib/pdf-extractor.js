/**
 * PDF Extractor
 *
 * Downloads a PDF document and extracts its text as readable Markdown
 * with unpdf (a serverless build of pdf.js with zero native
 * dependencies). Used by the article extractor when a feed item points
 * at a PDF — e.g. the USDA NASS reports — so those articles open as
 * text instead of failing HTML parsing.
 *
 * unpdf is loaded through a dynamic import() so the ~1 MB pdf.js engine
 * stays out of the startup bundle and is only fetched when a PDF is
 * actually opened (the same lazy-chunk pattern the wasm glue uses).
 *
 * @see https://www.npmjs.com/package/unpdf
 */

import { fetchBytes } from './rss-network.js';

/**
 * How many leading bytes/chars are sniffed for the `%PDF-` header.
 *
 * The PDF spec expects the header at offset 0, but real-world files
 * sometimes carry junk before it; pdf.js itself searches the first 1024
 * bytes, so the sniffer uses the same window.
 */
const PDF_SNIFF_WINDOW = 1024;

/**
 * Check whether a URL points at a PDF by its path extension.
 *
 * Query strings and fragments are ignored, so report links shaped like
 * `…/report.pdf?mode=wave` still match. Case-insensitive.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isPDFURL(url) {
  try {
    const { pathname } = new URL(url);
    return /\.pdf$/i.test(pathname);
  } catch {
    return false;
  }
}

/**
 * Check whether a fetched content-type identifies a PDF document.
 *
 * Covers `application/pdf` and the looser variants some servers send
 * (`application/x-pdf`, `text/pdf`).
 *
 * @param {string} contentType - Raw Content-Type header value
 * @returns {boolean}
 */
export function isPDFContentType(contentType) {
  return typeof contentType === 'string' && /pdf/i.test(contentType);
}

/**
 * Sniff raw PDF bytes for the `%PDF-` header.
 *
 * @param {Uint8Array|ArrayBuffer|null|undefined} bytes - Raw document bytes
 * @returns {boolean}
 */
export function looksLikePDFBytes(bytes) {
  if (!bytes) {
    return false;
  }
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const window = view.subarray(0, Math.min(PDF_SNIFF_WINDOW, view.length));
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  for (let i = 0; i + marker.length <= window.length; i++) {
    let matched = true;
    for (let j = 0; j < marker.length; j++) {
      if (window[i + j] !== marker[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

/**
 * Sniff decoded text for the `%PDF-` header.
 *
 * Used on the text-fetch path: binary bytes run through a UTF-8 decode
 * still preserve the ASCII `%PDF-` marker, so a PDF served at a URL
 * without the .pdf extension (and with a wrong content-type) is caught
 * before the HTML parser mangles it.
 *
 * @param {string} text - Decoded response body
 * @returns {boolean}
 */
export function looksLikePDFText(text) {
  if (typeof text !== 'string') {
    return false;
  }
  return text.slice(0, PDF_SNIFF_WINDOW).includes('%PDF-');
}

/**
 * Extract raw text and metadata from PDF bytes with unpdf.
 *
 * @param {Uint8Array} bytes - Raw PDF document bytes
 * @returns {Promise<{text: string, totalPages: number, info: object}>}
 */
export async function extractPDFTextFromBytes(bytes) {
  const { getDocumentProxy, extractText, getMeta } = await import('unpdf');

  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });

  let info = {};
  try {
    const meta = await getMeta(pdf);
    info = meta?.info || {};
  } catch {
    // Metadata is a nice-to-have; a document without an Info dict is
    // still perfectly readable.
  }

  return { text: text || '', totalPages: totalPages || 0, info };
}

/**
 * Convert extracted PDF text into readable Markdown.
 *
 * pdf.js emits one line per positioned text run, so sentences are hard-
 * wrapped mid-flow and hyphenated words sit split across line breaks.
 * The cleanup de-hyphenates those splits, rejoins wrapped lines into
 * paragraphs (a line continues when it does not end a sentence and the
 * next starts mid-word/lowercase), and collapses the leftover blank
 * runs — good enough for report-style documents to read like articles.
 *
 * @param {string} rawText - Text as returned by pdf.js
 * @returns {string}
 */
export function pdfTextToMarkdown(rawText) {
  let text = (rawText || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    // De-hyphenate words split across a line break ("wrap-\nping").
    .replace(/([A-Za-z])-\n([a-z])/g, '$1-$2');

  const lines = text.split('\n').map((line) => line.trim());
  const paragraphs = [];
  let current = '';

  for (const line of lines) {
    if (!line) {
      if (current) {
        paragraphs.push(current);
        current = '';
      }
      continue;
    }
    if (
      current &&
      !/[.!?:;"'\u2019\u201d)\]}]$/.test(current) &&
      /^[a-z0-9(\u201c]/.test(line)
    ) {
      // The previous line does not end a sentence and this line starts
      // mid-flow: rejoin the hard-wrapped paragraph.
      current += ` ${line}`;
    } else {
      if (current) {
        paragraphs.push(current);
      }
      current = line;
    }
  }
  if (current) {
    paragraphs.push(current);
  }

  return paragraphs.join('\n\n').trim();
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
 * Derive an article title for a PDF from its metadata or URL.
 *
 * Prefers the document's Info Title; falls back to the URL filename
 * (underscores and dashes become spaces, e.g. NASS report links) and
 * finally the hostname.
 *
 * @param {object} info - PDF Info dictionary from unpdf's getMeta
 * @param {string} url
 * @returns {string}
 */
export function derivePDFTitle(info, url) {
  const metaTitle = typeof info?.Title === 'string' ? info.Title.trim() : '';
  if (metaTitle) {
    return metaTitle;
  }
  try {
    const { pathname, hostname } = new URL(url);
    const filename = decodeURIComponent(pathname.split('/').pop() || '');
    const base = filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    return base || hostname;
  } catch {
    return hostnameOf(url);
  }
}

/**
 * Count words in a block of text.
 *
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  return (text.split(/\s+/).filter(Boolean)).length;
}

/**
 * Fetch a PDF document and extract it as an article.
 *
 * Downloads the raw bytes through the same network layer the rest of
 * the app uses (main-process bridge in Electron, plain fetch elsewhere),
 * verifies the payload really is a PDF, then extracts its text with
 * unpdf. The result mirrors the shape of the HTML article extractor so
 * callers can treat both interchangeably.
 *
 * @param {string} url - The PDF document URL
 * @returns {Promise<object>} Extracted article with markdown and metadata
 * @throws {Error} On fetch failure, non-PDF payload, or extraction error
 */
export async function extractPDFArticle(url) {
  const response = await fetchBytes(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${response.status}`);
  }

  const bytes = response.buffer;
  if (!looksLikePDFBytes(bytes)) {
    throw new Error('The URL did not return a PDF document');
  }

  let extracted;
  try {
    extracted = await extractPDFTextFromBytes(bytes);
  } catch (error) {
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }

  const markdown = pdfTextToMarkdown(extracted.text);
  if (!markdown) {
    throw new Error(
      'This PDF contains no extractable text (it may be a scanned image)'
    );
  }

  return {
    url,
    markdown,
    title: derivePDFTitle(extracted.info, url),
    author:
      typeof extracted.info?.Author === 'string' ? extracted.info.Author : '',
    description: '',
    domain: hostnameOf(url),
    site: '',
    published: '',
    image: '',
    favicon: '',
    language:
      typeof extracted.info?.Language === 'string'
        ? extracted.info.Language
        : '',
    wordCount: countWords(markdown),
  };
}
