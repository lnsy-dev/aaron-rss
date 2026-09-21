/**
 * PDF Extractor Unit Tests
 *
 * Tests for src/lib/pdf-extractor.js: URL/content-type/byte-sniffing
 * detection, text-to-Markdown cleanup, and end-to-end extraction of a
 * structurally valid minimal PDF through the real unpdf/pdf.js engine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  derivePDFTitle,
  extractPDFArticle,
  extractPDFTextFromBytes,
  isPDFContentType,
  isPDFURL,
  looksLikePDFBytes,
  looksLikePDFText,
  pdfTextToMarkdown,
} from '../../src/lib/pdf-extractor.js';
import { buildMinimalPDF } from '../helpers/minimal-pdf.js';

vi.mock('../../src/lib/rss-network.js', () => ({
  fetchBytes: vi.fn(),
}));

import { fetchBytes } from '../../src/lib/rss-network.js';

describe('isPDFURL', () => {
  it('matches .pdf path extensions case-insensitively', () => {
    expect(isPDFURL('https://www.nass.usda.gov/report.pdf')).toBe(true);
    expect(isPDFURL('https://www.nass.usda.gov/REPORT.PDF')).toBe(true);
  });

  it('ignores query strings and fragments after the extension', () => {
    expect(isPDFURL('https://www.nass.usda.gov/report.pdf?mode=wave')).toBe(true);
    expect(isPDFURL('https://www.nass.usda.gov/report.pdf#page=2')).toBe(true);
  });

  it('rejects non-PDF and scheme-less garbage URLs', () => {
    expect(isPDFURL('https://example.com/article.html')).toBe(false);
    expect(isPDFURL('https://example.com/pdf-in-the-middle.pdf/article')).toBe(false);
    expect(isPDFURL('not a url at all')).toBe(false);
    expect(isPDFURL('')).toBe(false);
  });
});

describe('isPDFContentType', () => {
  it('accepts the standard and vendor-variant PDF media types', () => {
    expect(isPDFContentType('application/pdf')).toBe(true);
    expect(isPDFContentType('application/x-pdf')).toBe(true);
    expect(isPDFContentType('application/pdf; charset=binary')).toBe(true);
  });

  it('rejects other content types and missing values', () => {
    expect(isPDFContentType('text/html; charset=utf-8')).toBe(false);
    expect(isPDFContentType('')).toBe(false);
    expect(isPDFContentType(undefined)).toBe(false);
  });
});

describe('looksLikePDFBytes', () => {
  it('accepts bytes starting with the %PDF- header', () => {
    const bytes = new TextEncoder().encode('%PDF-1.6\n…');
    expect(looksLikePDFBytes(bytes)).toBe(true);
  });

  it('accepts the header within the sniff window after leading junk', () => {
    const junk = 'x'.repeat(500);
    const bytes = new TextEncoder().encode(`${junk}%PDF-1.4\nrest`);
    expect(looksLikePDFBytes(bytes)).toBe(true);
  });

  it('rejects non-PDF bytes and empty input', () => {
    expect(looksLikePDFBytes(new TextEncoder().encode('<html></html>'))).toBe(false);
    expect(looksLikePDFBytes(new Uint8Array(0))).toBe(false);
    expect(looksLikePDFBytes(null)).toBe(false);
    expect(looksLikePDFBytes(undefined)).toBe(false);
  });
});

describe('looksLikePDFText', () => {
  it('detects the %PDF- header that survives a UTF-8 text decode', () => {
    expect(looksLikePDFText('%PDF-1.4\nbinary-ish decoded text')).toBe(true);
  });

  it('rejects HTML and non-string input', () => {
    expect(looksLikePDFText('<!DOCTYPE html>')).toBe(false);
    expect(looksLikePDFText(undefined)).toBe(false);
    expect(looksLikePDFText(12345)).toBe(false);
  });
});

describe('pdfTextToMarkdown', () => {
  it('produces clean paragraphs from wrapped PDF lines', () => {
    const markdown = pdfTextToMarkdown(
      'The board prepares and\ndisseminates hundreds of reports\n' +
        'every year.\n\nOfficial USDA estimates on crops,\nlivestock, and economic\nindicators.'
    );
    expect(markdown).toBe(
      'The board prepares and disseminates hundreds of reports every year.\n\n' +
        'Official USDA estimates on crops, livestock, and economic indicators.'
    );
  });

  it('rejoins words hyphen-split across a line break', () => {
    expect(pdfTextToMarkdown('second line wraps-\nacross a hyphen')).toBe(
      'second line wraps-across a hyphen'
    );
  });

  it('starts a new paragraph when a line ends a sentence', () => {
    expect(pdfTextToMarkdown('First sentence ends.\nNext one starts here')).toBe(
      'First sentence ends.\n\nNext one starts here'
    );
  });

  it('normalizes CRLF and form feeds, and trims the output', () => {
    expect(pdfTextToMarkdown('Line one\r\nLine two\f\nLine three\n')).toBe(
      'Line one\n\nLine two\n\nLine three'
    );
  });

  it('keeps list-like lines as separate paragraphs', () => {
    // A capitalized line after a non-sentence-ending line begins a new
    // block rather than being glued onto it.
    expect(pdfTextToMarkdown('Heading Without Punctuation\nSubheading')).toBe(
      'Heading Without Punctuation\n\nSubheading'
    );
  });

  it('returns an empty string for empty input', () => {
    expect(pdfTextToMarkdown('')).toBe('');
    expect(pdfTextToMarkdown('   \n  \n')).toBe('');
  });
});

describe('derivePDFTitle', () => {
  it('prefers the document Info title', () => {
    expect(derivePDFTitle({ Title: 'Fact Finders for Agriculture' }, 'https://x/y.pdf')).toBe(
      'Fact Finders for Agriculture'
    );
  });

  it('falls back to the URL filename with separators as spaces', () => {
    expect(derivePDFTitle({}, 'https://www.nass.usda.gov/Crop_Production-2026.pdf')).toBe(
      'Crop Production 2026'
    );
    expect(derivePDFTitle(null, 'https://example.com/reports/guide.pdf?a=1')).toBe('guide');
  });

  it('falls back to the hostname when the path has no filename', () => {
    expect(derivePDFTitle({}, 'https://www.nass.usda.gov/')).toBe('www.nass.usda.gov');
  });
});

describe('extractPDFTextFromBytes', () => {
  it('extracts text, page count, and Info metadata from a real PDF', async () => {
    const bytes = buildMinimalPDF({
      lines: ['Hello PDF World.', 'Second line wraps-across a hyphen.'],
      title: 'Test Report',
      author: 'USDA NASS',
    });

    const { text, totalPages, info } = await extractPDFTextFromBytes(bytes);

    expect(totalPages).toBe(1);
    expect(text).toContain('Hello PDF World.');
    expect(text).toContain('Second line wraps-across a hyphen.');
    expect(info.Title).toBe('Test Report');
    expect(info.Author).toBe('USDA NASS');
  });
});

describe('extractPDFArticle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the document and returns an article-shaped result', async () => {
    const bytes = buildMinimalPDF({
      lines: ['Corn production is up 5 percent from 2025.'],
      title: 'Crop Production',
      author: 'USDA NASS',
    });
    fetchBytes.mockResolvedValue({ ok: true, status: 200, buffer: bytes });

    const article = await extractPDFArticle('https://www.nass.usda.gov/croppro.pdf');

    expect(fetchBytes).toHaveBeenCalledWith('https://www.nass.usda.gov/croppro.pdf');
    expect(article.title).toBe('Crop Production');
    expect(article.author).toBe('USDA NASS');
    expect(article.markdown).toContain('Corn production is up 5 percent from 2025.');
    expect(article.domain).toBe('www.nass.usda.gov');
    expect(article.wordCount).toBeGreaterThan(0);
    // Same shape as the HTML extractor so callers can treat both alike.
    for (const key of [
      'url', 'markdown', 'title', 'author', 'description', 'domain',
      'site', 'published', 'image', 'favicon', 'language', 'wordCount',
    ]) {
      expect(article).toHaveProperty(key);
    }
  });

  it('throws when the fetch fails', async () => {
    fetchBytes.mockResolvedValue({ ok: false, status: 404 });
    await expect(extractPDFArticle('https://example.com/missing.pdf')).rejects.toThrow(
      'Failed to fetch PDF: 404'
    );
  });

  it('throws when the payload is not a PDF despite the extension', async () => {
    fetchBytes.mockResolvedValue({
      ok: true,
      status: 200,
      buffer: new TextEncoder().encode('<html>login page</html>'),
    });
    await expect(extractPDFArticle('https://example.com/misleading.pdf')).rejects.toThrow(
      'did not return a PDF document'
    );
  });

  it('throws a readable error when the document cannot be parsed', async () => {
    fetchBytes.mockResolvedValue({
      ok: true,
      status: 200,
      // Truncated document: valid header, unusable body.
      buffer: new TextEncoder().encode('%PDF-1.4\nbroken'),
    });
    await expect(extractPDFArticle('https://example.com/broken.pdf')).rejects.toThrow();
  });

  it('throws when the PDF has no extractable text (scanned image)', async () => {
    const bytes = buildMinimalPDF({ contentStream: 'BT ET' });
    fetchBytes.mockResolvedValue({ ok: true, status: 200, buffer: bytes });
    await expect(extractPDFArticle('https://example.com/scanned.pdf')).rejects.toThrow(
      'no extractable text'
    );
  });
});
