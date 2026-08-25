/**
 * Article Extractor Unit Tests
 *
 * Tests for src/lib/article-extractor.js. Because the library depends on
 * browser APIs (DOMParser) and the Defuddle browser bundle, the test mocks
 * both the network layer and the Defuddle module.
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

import { fetchText } from '../../src/lib/rss-network.js';

describe('article-extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
