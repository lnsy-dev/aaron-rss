/**
 * Find Highlights Unit Tests
 *
 * Tests the text highlighting helpers in src/lib/find-highlights.js.
 * These run in Node with a minimal fake DOM because the helper only
 * needs a small subset of browser APIs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  escapeRegExp,
  highlightMatches,
  clearHighlights,
} from '../../src/lib/find-highlights.js';

/**
 * Create a minimal fake DOM sufficient for the find helpers.
 *
 * @returns {object} Fake DOM globals.
 */
function createFakeDOM() {
  const marks = [];

  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      attributes: {},
      children: [],
      parentNode: null,
      parentElement: null,
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      getAttribute(name) {
        return this.attributes[name] ?? null;
      },
      appendChild(child) {
        child.parentNode = this;
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChild(newChild, oldChild) {
        const index = this.children.indexOf(oldChild);
        if (index >= 0) {
          newChild.parentNode = this;
          newChild.parentElement = this;
          this.children[index] = newChild;
        }
        oldChild.parentNode = null;
        oldChild.parentElement = null;
        const markIndex = marks.indexOf(oldChild);
        if (markIndex >= 0) {
          marks.splice(markIndex, 1);
        }
      },
      closest(selector) {
        const selectors = selector.split(',').map((s) => s.trim());
        for (const sel of selectors) {
          if (sel === 'script' || sel === 'style' || sel === 'iframe') {
            if (this.tagName.toLowerCase() === sel) {
              return this;
            }
            continue;
          }
          if (sel === `.${this.className}`) {
            return this;
          }
        }
        return this.parentElement?.closest(selector) || null;
      },
      normalize() {
        // No-op for the mock; real browsers merge adjacent text nodes.
      },
    };
    if (tag.toLowerCase() === 'mark') {
      marks.push(el);
    }
    return el;
  }

  function createTextNode(text) {
    return {
      nodeType: 3,
      textContent: text,
      parentNode: null,
      parentElement: null,
    };
  }

  function createDocumentFragment() {
    return {
      nodeType: 11,
      children: [],
      appendChild(child) {
        child.parentNode = this;
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChild(newChild, oldChild) {
        const index = this.children.indexOf(oldChild);
        if (index >= 0) {
          newChild.parentNode = this;
          newChild.parentElement = this;
          this.children[index] = newChild;
        }
        oldChild.parentNode = null;
        oldChild.parentElement = null;
        const markIndex = marks.indexOf(oldChild);
        if (markIndex >= 0) {
          marks.splice(markIndex, 1);
        }
      },
      normalize() {
        // No-op for the mock.
      },
    };
  }

  const NodeFilter = {
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
  };

  function createTreeWalker(root, whatToShow, filter) {
    const queue = [...root.children];
    return {
      nextNode() {
        while (queue.length > 0) {
          const node = queue.shift();
          if (node.nodeType === 3) {
            const result = filter ? filter.acceptNode(node) : NodeFilter.FILTER_ACCEPT;
            if (result === NodeFilter.FILTER_ACCEPT) {
              return node;
            }
          }
          if (node.children) {
            queue.push(...node.children);
          }
        }
        return null;
      },
    };
  }

  return {
    document: {
      createElement,
      createTextNode,
      createDocumentFragment,
      createTreeWalker,
      querySelectorAll: (selector) => {
        if (selector.includes('rss-find-highlight')) {
          return marks.filter(
            (m) => m.className === 'rss-find-highlight' && m.parentNode !== null
          );
        }
        return [];
      },
    },
    NodeFilter,
  };
}

describe('find-highlights', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('escapeRegExp', () => {
    it('escapes special regular expression characters', () => {
      expect(escapeRegExp('a.b*c+d?e[f]g(h)i^j$k|l\\m')).toBe(
        'a\\.b\\*c\\+d\\?e\\[f\\]g\\(h\\)i\\^j\\$k\\|l\\\\m'
      );
    });

    it('leaves plain text unchanged', () => {
      expect(escapeRegExp('hello world')).toBe('hello world');
    });
  });

  describe('highlightMatches', () => {
    it('returns an empty array for an empty query', () => {
      const { document, NodeFilter } = createFakeDOM();
      vi.stubGlobal('document', document);
      vi.stubGlobal('NodeFilter', NodeFilter);

      const container = document.createElement('div');
      container.appendChild(document.createTextNode('hello world'));

      expect(highlightMatches(container, '')).toEqual([]);
    });

    it('wraps matching text in mark elements', () => {
      const { document, NodeFilter } = createFakeDOM();
      vi.stubGlobal('document', document);
      vi.stubGlobal('NodeFilter', NodeFilter);

      const container = document.createElement('div');
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createTextNode('hello world'));
      container.appendChild(paragraph);

      const highlights = highlightMatches(container, 'world');

      expect(highlights.length).toBe(1);
      expect(highlights[0].tagName).toBe('MARK');
      expect(highlights[0].textContent).toBe('world');
      expect(highlights[0].className).toBe('rss-find-highlight');
    });

    it('is case-insensitive by default', () => {
      const { document, NodeFilter } = createFakeDOM();
      vi.stubGlobal('document', document);
      vi.stubGlobal('NodeFilter', NodeFilter);

      const container = document.createElement('div');
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createTextNode('Hello World'));
      container.appendChild(paragraph);

      const highlights = highlightMatches(container, 'world');

      expect(highlights.length).toBe(1);
      expect(highlights[0].textContent).toBe('World');
    });

    it('respects case sensitivity when requested', () => {
      const { document, NodeFilter } = createFakeDOM();
      vi.stubGlobal('document', document);
      vi.stubGlobal('NodeFilter', NodeFilter);

      const container = document.createElement('div');
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createTextNode('Hello World'));
      container.appendChild(paragraph);

      const highlights = highlightMatches(container, 'world', {
        caseSensitive: true,
      });

      expect(highlights.length).toBe(0);
    });

    it('highlights multiple occurrences in the same node', () => {
      const { document, NodeFilter } = createFakeDOM();
      vi.stubGlobal('document', document);
      vi.stubGlobal('NodeFilter', NodeFilter);

      const container = document.createElement('div');
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createTextNode('foo foo foo'));
      container.appendChild(paragraph);

      const highlights = highlightMatches(container, 'foo');

      expect(highlights.length).toBe(3);
    });

    it('ignores text inside script and style tags', () => {
      const { document, NodeFilter } = createFakeDOM();
      vi.stubGlobal('document', document);
      vi.stubGlobal('NodeFilter', NodeFilter);

      const container = document.createElement('div');
      const script = document.createElement('script');
      script.appendChild(document.createTextNode('hello world'));
      container.appendChild(script);

      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createTextNode('hello world'));
      container.appendChild(paragraph);

      const highlights = highlightMatches(container, 'world');

      expect(highlights.length).toBe(1);
    });
  });

  describe('clearHighlights', () => {
    it('removes all highlight marks and normalizes parents', () => {
      const { document, NodeFilter } = createFakeDOM();
      vi.stubGlobal('document', document);
      vi.stubGlobal('NodeFilter', NodeFilter);

      const container = document.createElement('div');
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createTextNode('hello world'));
      container.appendChild(paragraph);

      highlightMatches(container, 'world');
      expect(document.querySelectorAll('.rss-find-highlight').length).toBe(1);

      clearHighlights();

      expect(document.querySelectorAll('.rss-find-highlight').length).toBe(0);
    });
  });
});
