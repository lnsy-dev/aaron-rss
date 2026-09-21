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
 * Repair broken (empty) HTML entities left behind by upstream CMSes.
 *
 * Some publishers' pipelines strip the innards of a character reference
 * (e.g. &#8217; or &rsquo;) and leave a bare "&;" behind — "they&;re"
 * for "they're". Between two word characters that is unambiguously a
 * lost right single quote, so repair it. Everywhere else the original
 * character is unknowable and the text is left untouched.
 *
 * @param {string} text
 * @returns {string}
 */
export function repairBrokenEntities(text) {
  if (!text) return '';
  return text.replace(/([A-Za-z])&;([A-Za-z])/g, '$1\u2019$2');
}

/**
 * Repair broken (empty) entities in markup that is still entity-encoded.
 *
 * HTML and Markdown sources carry the mangled reference in its encoded
 * form ("they&amp;;re" — the & was escaped when the entity's innards were
 * stripped). Both the bare "&;" and the escaped "&amp;;" forms are
 * repaired; the replacement is itself written as a character reference
 * (&#8217;) so it is safe to feed back into any HTML/markdown parser.
 *
 * @param {string} html
 * @returns {string}
 */
export function repairBrokenEntitiesInHTML(html) {
  if (!html) return '';
  return html
    .replace(/([A-Za-z])&amp;;([A-Za-z])/g, '$1&#8217;$2')
    .replace(/([A-Za-z])&;([A-Za-z])/g, '$1&#8217;$2');
}

/**
 * Decode HTML entities in a string.
 *
 * Uses the DOM in browser environments for full entity support and falls
 * back to a regex-based decoder in Node. Decodes iteratively to handle
 * feeds that double-encode entities (e.g. &amp;raquo;). Broken empty
 * entities between word characters are repaired afterwards (see
 * repairBrokenEntities).
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeHTMLEntities(text) {
  if (!text) return '';

  let decoded;
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    decoded = text;
    for (let i = 0; i < 3; i++) {
      textarea.innerHTML = decoded;
      const next = textarea.value;
      if (next === decoded) break;
      decoded = next;
    }
  } else {
    decoded = text;
    for (let i = 0; i < 3; i++) {
      const next = decodeEntitiesOnce(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  }
  return repairBrokenEntities(decoded);
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
