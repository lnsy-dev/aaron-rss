/**
 * Article Extractor Unit Tests
 *
 * Tests for src/lib/article-extractor.js. Because the library depends on
 * browser APIs (DOMParser) and the Defuddle browser bundle, the test mocks
 * both the network layer and the Defuddle module. The PDF extractor is
 * mocked too: these tests cover routing (which URLs go to the PDF path),
 * while the PDF extraction itself is covered in pdf-extractor.test.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractArticle, sanitizeSchemaOrgScripts } from '../../src/lib/article-extractor.js';

vi.mock('../../src/lib/rss-network.js', () => ({
  fetchText: vi.fn(),
}));

const mockParse = vi.fn();

vi.mock('defuddle', () => ({
  default: vi.fn(() => ({ parse: mockParse })),
}));

vi.mock('../../src/lib/pdf-extractor.js', () => ({
  extractPDFArticle: vi.fn(),
  isPDFContentType: vi.fn(() => false),
  isPDFURL: vi.fn(() => false),
  looksLikePDFText: vi.fn(() => false),
}));

import { fetchText } from '../../src/lib/rss-network.js';
import {
  extractPDFArticle,
  isPDFContentType,
  isPDFURL,
  looksLikePDFText,
} from '../../src/lib/pdf-extractor.js';

describe('article-extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default routing signals: no PDF detected anywhere.
    isPDFURL.mockReturnValue(false);
    isPDFContentType.mockReturnValue(false);
    looksLikePDFText.mockReturnValue(false);
  });

  it('throws when no URL is provided', async () => {
    await expect(extractArticle('')).rejects.toThrow('No URL provided');
  });

  it('throws when the fetch fails', async () => {
    fetchText.mockResolvedValue({ ok: false, status: 404, text: '' });

    await expect(extractArticle('https://example.com/post')).rejects.toThrow('Failed to fetch article: 404');
  });

  it('extracts metadata and markdown from a fetched page', async () => {
    fetchText.mockResolvedValue({
      ok: true,
      status: 200,
      text: '<html><body><article>Hello</article></body></html>',
    });

    mockParse.mockReturnValue({
      content: '# Hello\n\nWorld',
      title: 'Hello World',
      author: 'Jane Doe',
      description: 'A greeting',
      domain: 'example.com',
      site: 'Example',
      published: '2024-01-01',
      image: 'https://example.com/image.png',
      favicon: 'https://example.com/favicon.ico',
      language: 'en',
      wordCount: 42,
    });

    vi.stubGlobal('DOMParser', class {
      parseFromString(html) {
        return { documentElement: {}, body: {}, querySelector: () => null };
      }
    });

    const result = await extractArticle('https://example.com/post');

    expect(fetchText).toHaveBeenCalledWith('https://example.com/post');
    expect(result.markdown).toBe('# Hello\n\nWorld');
    expect(result.title).toBe('Hello World');
    expect(result.author).toBe('Jane Doe');
    expect(result.domain).toBe('example.com');
    expect(result.wordCount).toBe(42);

    vi.unstubAllGlobals();
  });

  it('repairs broken empty entities from mangled publisher content', async () => {
    fetchText.mockResolvedValue({
      ok: true,
      status: 200,
      text: '<html><body><article>Hello</article></body></html>',
    });

    // Defuddle faithfully re-escapes what the publisher served; a CMS
    // stripped the apostrophe entity leaving "&;" (escaped "&amp;;").
    mockParse.mockReturnValue({
      content: 'Unlike Chromebooks, they&amp;;re not cheap.',
      title: 'Googlebooks are (almost) here',
      author: '',
      description: 'A roundup where they&;re discussed',
      domain: 'liliputing.com',
      site: 'Liliputing',
      published: '',
      image: '',
      favicon: '',
      language: 'en',
      wordCount: 6,
    });

    vi.stubGlobal('DOMParser', class {
      parseFromString() {
        return { documentElement: {}, body: {}, querySelector: () => null };
      }
    });

    const result = await extractArticle('https://example.com/post');

    expect(result.markdown).toBe('Unlike Chromebooks, they&#8217;re not cheap.');
    expect(result.description).toBe('A roundup where they&#8217;re discussed');

    vi.unstubAllGlobals();
  });

  it('throws when Defuddle returns no content', async () => {
    fetchText.mockResolvedValue({
      ok: true,
      status: 200,
      text: '<html></html>',
    });
    mockParse.mockReturnValue(null);

    vi.stubGlobal('DOMParser', class {
      parseFromString() {
        return { documentElement: {}, body: {} };
      }
    });

    await expect(extractArticle('https://example.com/post')).rejects.toThrow('Defuddle returned no content');

    vi.unstubAllGlobals();
  });

  it('sanitizes unescaped control characters in JSON-LD schema.org scripts', () => {
    const script = {
      textContent: '{"description":"Hello\nWorld"}',
    };
    const doc = {
      querySelectorAll: (selector) =>
        selector === 'script[type="application/ld+json"]' ? [script] : [],
    };

    sanitizeSchemaOrgScripts(doc);

    expect(script.textContent).toBe('{"description":"Hello World"}');
  });

  it('leaves non-JSON-LD scripts untouched during sanitization', () => {
    const script = {
      textContent: 'var x = "\n";',
    };
    const doc = {
      querySelectorAll: (selector) =>
        selector === 'script[type="application/ld+json"]' ? [] : [script],
    };

    sanitizeSchemaOrgScripts(doc);

    expect(script.textContent).toBe('var x = "\n";');
  });

  it('does not fail when the document has no querySelectorAll', () => {
    expect(() => sanitizeSchemaOrgScripts(null)).not.toThrow();
    expect(() => sanitizeSchemaOrgScripts({})).not.toThrow();
  });

  it('routes .pdf URLs straight to the PDF extractor without fetching text', async () => {
    isPDFURL.mockReturnValue(true);
    extractPDFArticle.mockResolvedValue({ url: 'x', markdown: '# PDF' });

    const result = await extractArticle('https://www.nass.usda.gov/report.pdf');

    expect(isPDFURL).toHaveBeenCalledWith('https://www.nass.usda.gov/report.pdf');
    expect(extractPDFArticle).toHaveBeenCalledWith('https://www.nass.usda.gov/report.pdf');
    expect(result.markdown).toBe('# PDF');
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('routes text-fetched responses with a PDF content-type to the PDF extractor', async () => {
    fetchText.mockResolvedValue({
      ok: true,
      status: 200,
      text: '%PDF-1.6 binary-ish',
      contentType: 'application/pdf',
    });
    isPDFContentType.mockReturnValue(true);
    extractPDFArticle.mockResolvedValue({ markdown: 'extracted' });

    await extractArticle('https://example.com/document');

    expect(extractPDFArticle).toHaveBeenCalledWith('https://example.com/document');
  });

  it('routes responses whose text sniffs as %PDF- to the PDF extractor', async () => {
    fetchText.mockResolvedValue({
      ok: true,
      status: 200,
      text: '%PDF-1.4 …',
      contentType: 'application/octet-stream',
    });
    looksLikePDFText.mockReturnValue(true);
    extractPDFArticle.mockResolvedValue({ markdown: 'extracted' });

    await extractArticle('https://example.com/no-extension');

    expect(extractPDFArticle).toHaveBeenCalledWith('https://example.com/no-extension');
  });

  it('still extracts HTML pages when no PDF signal is present', async () => {
    fetchText.mockResolvedValue({
      ok: true,
      status: 200,
      text: '<html><body><article>Hello</article></body></html>',
      contentType: 'text/html',
    });
    mockParse.mockReturnValue({ content: '# Hello', title: '', wordCount: 1 });

    vi.stubGlobal('DOMParser', class {
      parseFromString() {
        return { documentElement: {}, body: {}, querySelector: () => null };
      }
    });

    const result = await extractArticle('https://example.com/post');

    expect(extractPDFArticle).not.toHaveBeenCalled();
    expect(result.markdown).toBe('# Hello');

    vi.unstubAllGlobals();
  });
});
