/**
 * Markdown Renderer Unit Tests
 *
 * Tests for src/lib/markdown-renderer.js. The dependencies `marked`
 * and `dompurify` are mocked so the tests run in Node without a DOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown-renderer.js';

const mockParse = vi.fn();
const mockSanitize = vi.fn();

vi.mock('marked', () => ({
  marked: {
    setOptions: vi.fn(),
    parse: (input) => mockParse(input),
  },
}));

vi.mock('dompurify', () => ({
  default: {
    sanitize: (input, config) => mockSanitize(input, config),
  },
}));

describe('markdown-renderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParse.mockImplementation((md) => `<p>${md}</p>`);
    mockSanitize.mockImplementation((html) => html);
  });

  it('returns empty string for empty markdown', () => {
    expect(renderMarkdown('')).toBe('');
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('parses markdown and sanitizes the result', () => {
    const md = '# Title';
    const html = '<h1>Title</h1>';
    mockParse.mockReturnValue(html);

    const result = renderMarkdown(md);

    expect(mockParse).toHaveBeenCalledWith(md);
    expect(mockSanitize).toHaveBeenCalledWith(html, expect.any(Object));
    expect(result).toBe(html);
  });
});
