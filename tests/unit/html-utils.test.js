/**
 * HTML Utilities Unit Tests
 *
 * Tests tag stripping and HTML entity decoding for both Node (fallback)
 * and browser (DOM) environments.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  decodeHTMLEntities,
  stripHTML,
  repairBrokenEntities,
  repairBrokenEntitiesInHTML,
} from '../../src/lib/html-utils.js';

describe('html-utils', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('decodeHTMLEntities', () => {
    it('decodes common named entities in Node fallback mode', () => {
      expect(decodeHTMLEntities('Hackaday &raquo; Feed')).toBe('Hackaday » Feed');
      expect(decodeHTMLEntities('Tom &amp; Jerry')).toBe('Tom & Jerry');
      expect(decodeHTMLEntities('5 &lt; 10 &gt; 2')).toBe('5 < 10 > 2');
      expect(decodeHTMLEntities('&ldquo;Hello&rdquo;')).toBe('"Hello"');
      expect(decodeHTMLEntities('It&rsquo;s fine')).toBe("It's fine");
    });

    it('decodes double-encoded entities in Node fallback mode', () => {
      expect(decodeHTMLEntities('Hackaday &amp;raquo; Feed')).toBe('Hackaday » Feed');
      expect(decodeHTMLEntities('Tom &amp;amp; Jerry')).toBe('Tom & Jerry');
      expect(decodeHTMLEntities('Price: &amp;#36;100')).toBe('Price: $100');
    });

    it('decodes decimal and hexadecimal numeric entities', () => {
      expect(decodeHTMLEntities('&#187;')).toBe('»');
      expect(decodeHTMLEntities('&#xBB;')).toBe('»');
      expect(decodeHTMLEntities('&#x27;')).toBe("'");
    });

    it('leaves unknown named entities untouched in Node fallback mode', () => {
      expect(decodeHTMLEntities('&unknownentity;')).toBe('&unknownentity;');
    });

    it('uses the DOM in browser environments', () => {
      const fakeTextarea = {
        innerHTML: '',
        get value() {
          return this.innerHTML
            .replace(/&amp;/g, '&')
            .replace(/&raquo;/g, '»');
        },
      };
      vi.stubGlobal('document', {
        createElement: vi.fn(() => fakeTextarea),
      });

      expect(decodeHTMLEntities('&raquo;')).toBe('»');
      expect(decodeHTMLEntities('&amp;raquo;')).toBe('»');
      expect(document.createElement).toHaveBeenCalledWith('textarea');
    });

    it('returns empty string for falsy input', () => {
      expect(decodeHTMLEntities('')).toBe('');
      expect(decodeHTMLEntities(null)).toBe('');
      expect(decodeHTMLEntities(undefined)).toBe('');
    });
  });

  describe('stripHTML', () => {
    it('removes HTML tags and decodes entities', () => {
      expect(stripHTML('<p>Hackaday &raquo; Feed</p>')).toBe('Hackaday » Feed');
      expect(stripHTML('<strong>Tom &amp; Jerry</strong>')).toBe('Tom & Jerry');
    });

    it('trims surrounding whitespace', () => {
      expect(stripHTML('  <p>hello</p>  ')).toBe('hello');
    });

    it('returns empty string for falsy input', () => {
      expect(stripHTML('')).toBe('');
      expect(stripHTML(null)).toBe('');
      expect(stripHTML(undefined)).toBe('');
    });
  });
});

describe('repairBrokenEntities', () => {
  it('repairs a broken empty entity between word characters as an apostrophe', () => {
    expect(repairBrokenEntities('they&;re not cheap')).toBe('they’re not cheap');
    expect(repairBrokenEntities('won&;t, can&;t')).toBe('won’t, can’t');
    expect(repairBrokenEntities("It&;s the publisher's bug")).toBe("It\u2019s the publisher's bug");
  });

  it('leaves broken entities outside word boundaries untouched', () => {
    expect(repairBrokenEntities('10 &; 20')).toBe('10 &; 20');
    expect(repairBrokenEntities('&; leading')).toBe('&; leading');
    expect(repairBrokenEntities('trailing &;')).toBe('trailing &;');
  });

  it('leaves normal text and legitimate entities alone', () => {
    expect(repairBrokenEntities("they're fine")).toBe("they're fine");
    expect(repairBrokenEntities('Tom & Jerry')).toBe('Tom & Jerry');
    expect(repairBrokenEntities('a&amp;b')).toBe('a&amp;b');
  });

  it('returns empty string for empty input', () => {
    expect(repairBrokenEntities('')).toBe('');
  });
});

describe('repairBrokenEntitiesInHTML', () => {
  it('repairs the escaped broken-entity form as a character reference', () => {
    expect(repairBrokenEntitiesInHTML('they&amp;;re not cheap')).toBe('they&#8217;re not cheap');
  });

  it('repairs the bare broken-entity form as a character reference', () => {
    expect(repairBrokenEntitiesInHTML('they&;re not cheap')).toBe('they&#8217;re not cheap');
  });

  it('repairs every occurrence in one pass', () => {
    expect(repairBrokenEntitiesInHTML('won&;t and they&amp;;re')).toBe('won&#8217;t and they&#8217;re');
  });

  it('leaves legitimate encoded entities alone', () => {
    expect(repairBrokenEntitiesInHTML('Tom &amp; Jerry')).toBe('Tom &amp; Jerry');
    expect(repairBrokenEntitiesInHTML('<p>It&#8217;s fine</p>')).toBe('<p>It&#8217;s fine</p>');
    expect(repairBrokenEntitiesInHTML('<a href="https://x/?a=1&amp;p=2">link</a>')).toBe(
      '<a href="https://x/?a=1&amp;p=2">link</a>'
    );
  });

  it('returns empty string for empty input', () => {
    expect(repairBrokenEntitiesInHTML('')).toBe('');
  });
});

describe('decodeHTMLEntities repairs broken empty entities', () => {
  it('repairs a mangled apostrophe after decoding in Node fallback mode', () => {
    // The publisher served "they&amp;;re"; the textarea/regex decode turns
    // it into the literal text "they&;re", which the repair step fixes.
    expect(decodeHTMLEntities('they&amp;;re not cheap')).toBe('they’re not cheap');
    expect(decodeHTMLEntities('they&;re not cheap')).toBe('they’re not cheap');
  });

  it('does not alter already-correct contractions', () => {
    expect(decodeHTMLEntities('they&#8217;re fine')).toBe('they’re fine');
    expect(decodeHTMLEntities('they&rsquo;re fine')).toBe("they're fine");
  });
});
