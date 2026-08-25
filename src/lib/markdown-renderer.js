/**
 * Markdown Renderer
 *
 * Renders Markdown to sanitized HTML for in-app article reading.
 * Uses `marked` for parsing and `dompurify` for HTML sanitization,
 * matching the safe-by-default approach used by Obsidian Web Clipper.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Configure marked for safe, readable article output.
 *
 * Disabled features that are unnecessary inside an RSS reader and
 * could produce unsafe or noisy HTML.
 */
marked.setOptions({
  headerIds: false,
  mangle: false,
  breaks: false,
  gfm: true,
});

/**
 * Render Markdown to sanitized HTML.
 *
 * @param {string} markdown - Raw Markdown content
 * @returns {string} Sanitized HTML ready for DOM insertion
 */
export function renderMarkdown(markdown) {
  if (!markdown) return '';

  const rawHtml = marked.parse(markdown);
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|xxx):|[^a-z\u0000-\u001F\u007F]*^[^a-z\u0000-\u001F\u007F]*)/i,
  });
}
