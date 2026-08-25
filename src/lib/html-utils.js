/**
 * HTML utilities.
 *
 * Shared helpers for stripping HTML tags and decoding HTML entities.
 */

/**
 * Map of common named HTML entities for environments without a DOM.
 *
 * @type {Record<string, string>}
 */
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  raquo: '»',
  laquo: '«',
  mdash: '—',
  ndash: '–',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  hellip: '…',
  trade: '™',
  copy: '©',
  reg: '®',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  agrave: 'à',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  ouml: 'ö',
  uuml: 'ü',
  auml: 'ä',
  oslash: 'ø',
  aring: 'å',
  ccedil: 'ç',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
};

/**
 * Decode HTML entities in a string.
 *
 * Uses the DOM in browser environments for full entity support and falls
 * back to a regex-based decoder in Node. Decodes iteratively to handle
 * feeds that double-encode entities (e.g. &amp;raquo;).
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeHTMLEntities(text) {
  if (!text) return '';

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    let decoded = text;
    for (let i = 0; i < 3; i++) {
      textarea.innerHTML = decoded;
      const next = textarea.value;
      if (next === decoded) break;
      decoded = next;
    }
    return decoded;
  }

  let decoded = text;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntitiesOnce(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

/**
 * Single-pass regex-based entity decoder for Node environments.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeEntitiesOnce(text) {
  return text
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (_, name) => NAMED_ENTITIES[name] || `&${name};`)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Strip HTML tags and decode entities.
 *
 * @param {string} html
 * @returns {string}
 */
export function stripHTML(html) {
  if (!html) return '';
  const text = html.replace(/<[^>]*>/g, '');
  return decodeHTMLEntities(text).trim();
}
