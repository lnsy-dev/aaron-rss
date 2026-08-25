/**
 * URL utilities unit tests.
 */

import { describe, it, expect } from 'vitest';
import { isExternalURL } from '../../src/lib/url-utils.js';

describe('isExternalURL', () => {
  const base = 'http://localhost:3456/';

  it('returns false for relative URLs', () => {
    expect(isExternalURL('/help.html', base)).toBe(false);
    expect(isExternalURL('help.html', base)).toBe(false);
    expect(isExternalURL('#section', base)).toBe(false);
  });

  it('returns false for URLs sharing the base origin', () => {
    expect(isExternalURL('http://localhost:3456/article', base)).toBe(false);
  });

  it('returns false for non-http(s) schemes', () => {
    expect(isExternalURL('mailto:test@example.com', base)).toBe(false);
    expect(isExternalURL('tel:+1234567890', base)).toBe(false);
  });

  it('returns true for absolute http(s) URLs on a different origin', () => {
    expect(isExternalURL('https://example.com/', base)).toBe(true);
    expect(isExternalURL('http://other.local:3456/', base)).toBe(true);
  });

  it('returns false for empty or invalid hrefs', () => {
    expect(isExternalURL('', base)).toBe(false);
    expect(isExternalURL(null, base)).toBe(false);
  });
});
