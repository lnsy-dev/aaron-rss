/**
 * Cloudflare Challenge Detection Unit Tests
 *
 * Covers the pure sniffing helpers the main process uses to recognize
 * Cloudflare challenge interstitials and describe failures to users.
 */

import { describe, it, expect } from 'vitest';

import { isCloudflareChallenge, describeFailureReason } from '../../electron/challenge-detect.js';

describe('isCloudflareChallenge', () => {
  it('recognizes a 403 challenge interstitial', () => {
    expect(
      isCloudflareChallenge({
        status: 403,
        contentType: 'text/html; charset=UTF-8',
        text: '<html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></head></html>',
      })
    ).toBe(true);
  });

  it('recognizes a 503 challenge interstitial', () => {
    expect(
      isCloudflareChallenge({
        status: 503,
        contentType: 'text/html',
        text: '<html><body><script>cf-challenge</script></body></html>',
      })
    ).toBe(true);
  });

  it('recognizes a 200 "challenge solved" relay page', () => {
    expect(
      isCloudflareChallenge({
        status: 200,
        contentType: 'text/html',
        text: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>',
      })
    ).toBe(true);
  });

  it('does not flag a bare 403 with no challenge markers (parked domain)', () => {
    // A parked-domain 403 like wpx.net's must not trigger the challenge
    // solver — otherwise every refresh opens a window on the site.
    expect(
      isCloudflareChallenge({
        status: 403,
        contentType: 'text/html',
        text: '<html><head><title>Domain Auction</title></head><body>buy this domain</body></html>',
      })
    ).toBe(false);
  });

  it('does not flag a bare 503 (failed origin server)', () => {
    expect(
      isCloudflareChallenge({ status: 503, contentType: 'text/html', text: '<html><body>Service Unavailable</body></html>' })
    ).toBe(false);
  });

  it('does not flag a 403 with no body', () => {
    expect(isCloudflareChallenge({ status: 403, contentType: 'text/html', text: '' })).toBe(false);
  });

  it('does not flag marker-like strings in non-HTML payloads', () => {
    expect(
      isCloudflareChallenge({
        status: 200,
        contentType: 'application/rss+xml',
        text: '<?xml version="1.0"?><rss>cf-challenge</rss>',
      })
    ).toBe(false);
  });

  it('does not flag a 200 HTML page', () => {
    expect(isCloudflareChallenge({ status: 200, contentType: 'text/html', text: '<html><body>hello</body></html>' })).toBe(false);
  });

  it('does not flag a 200 RSS document', () => {
    expect(
      isCloudflareChallenge({
        status: 200,
        contentType: 'application/rss+xml',
        text: '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>',
      })
    ).toBe(false);
  });

  it('does not flag a normal 404', () => {
    expect(isCloudflareChallenge({ status: 404, contentType: 'text/html', text: '<html>gone</html>' })).toBe(false);
  });

  it('does not flag empty or malformed responses', () => {
    expect(isCloudflareChallenge(null)).toBe(false);
    expect(isCloudflareChallenge({})).toBe(false);
    expect(isCloudflareChallenge({ status: 0, text: '', contentType: '' })).toBe(false);
  });
});

describe('describeFailureReason', () => {
  it('explains bot-protection blocks', () => {
    expect(describeFailureReason({ status: 403, contentType: 'text/html' })).toMatch(/bot protection/i);
    expect(describeFailureReason({ status: 503, contentType: 'text/html' })).toMatch(/bot protection/i);
  });

  it('explains missing feeds', () => {
    expect(describeFailureReason({ status: 404, contentType: 'text/html' })).toMatch(/404/);
  });

  it('explains HTML pages that are not feeds', () => {
    expect(describeFailureReason({ status: 200, contentType: 'text/html' })).toMatch(/HTML, not RSS/i);
  });

  it('reports other HTTP status codes', () => {
    expect(describeFailureReason({ status: 500, contentType: 'text/plain' })).toMatch(/HTTP 500/);
  });

  it('has a generic fallback', () => {
    expect(describeFailureReason({ status: 0, contentType: '' })).toMatch(/No feed found/i);
  });
});
