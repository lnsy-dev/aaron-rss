/**
 * Text highlighting helpers for the find feature.
 *
 * These functions walk the visible text nodes of a container and wrap
 * matching substrings in <mark> elements. They intentionally avoid
 * script/style/iframe content and any nodes already inside a highlight.
 */

/** Default CSS class applied to highlighted matches. */
const DEFAULT_HIGHLIGHT_CLASS = 'rss-find-highlight';

/**
 * Escape a string for safe use inside a RegExp.
 *
 * @param {string} string
 * @returns {string}
 */
export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight all occurrences of a query string inside a container.
 *
 * @param {HTMLElement} container - Element to search within.
 * @param {string} query - Text to search for.
 * @param {object} [options]
 * @param {string} [options.className='rss-find-highlight'] - Class for each <mark>.
 * @param {boolean} [options.caseSensitive=false] - Whether matching is case-sensitive.
 * @returns {HTMLElement[]} - Array of created highlight <mark> elements in document order.
 */
export function highlightMatches(container, query, options = {}) {
  const highlights = [];
  const className = options.className || DEFAULT_HIGHLIGHT_CLASS;
  const caseSensitive = Boolean(options.caseSensitive);

  if (!container || !query) {
    return highlights;
  }

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip script/style, iframes, existing highlights, and the find UI.
        if (
          parent.closest(
            `.${className}, .rss-find-rail, script, style, iframe, [data-skip-find]`
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const textNodes = [];
  let node;
  while ((node = walker.nextNode()) !== null) {
    textNodes.push(node);
  }

  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegExp(query), flags);

  for (const textNode of textNodes) {
    const text = textNode.textContent || '';
    const matches = Array.from(text.matchAll(regex));
    if (matches.length === 0) {
      continue;
    }

    const parent = textNode.parentNode;
    if (!parent) {
      continue;
    }

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of matches) {
      const start = match.index ?? 0;
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      const mark = document.createElement('mark');
      mark.className = className;
      mark.textContent = match[0];
      fragment.appendChild(mark);
      highlights.push(mark);
      lastIndex = start + match[0].length;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    parent.replaceChild(fragment, textNode);
  }

  return highlights;
}

/**
 * Remove all highlight <mark> elements created by highlightMatches and
 * normalize their parent nodes so subsequent searches still work.
 *
 * @param {object} [options]
 * @param {string} [options.className='rss-find-highlight'] - Class used for highlights.
 * @returns {void}
 */
export function clearHighlights(options = {}) {
  const className = options.className || DEFAULT_HIGHLIGHT_CLASS;
  const parents = new Set();
  for (const mark of Array.from(document.querySelectorAll(`.${className}`))) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    parents.add(parent);
  }
  for (const parent of parents) {
    parent.normalize();
  }
}
