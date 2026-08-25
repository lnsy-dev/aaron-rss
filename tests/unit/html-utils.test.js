/**
 * HTML Utilities Unit Tests
 *
 * Tests tag stripping and HTML entity decoding for both Node (fallback)
 * and browser (DOM) environments.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodeHTMLEntities, stripHTML } from '../../src/lib/html-utils.js';

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
