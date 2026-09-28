/**
 * Cloudflare Challenge Detection
 *
 * Pure sniffing helpers that recognize Cloudflare's anti-bot
 * interstitials from an HTTP response. Sites protected by Cloudflare
 * answer plain HTTP clients (undici, curl) with a challenge page instead
 * of the real content; the app clears the challenge once in a real
 * browser window and then reuses the resulting clearance cookies for all
 * subsequent requests (see electron/challenge-bypass.js).
 *
 * Kept dependency-free and side-effect-free so unit tests can exercise
 * it against recorded response bodies directly.
 */

/**
 * Detect Cloudflare's managed challenge / "Just a moment..." page.
 *
 * Recognizes both a 403 status carrying a challenge body and a
 * Cloudflare "challenge solved, redirecting" page that can appear on
 * 200 responses after an auto-solve.
 *
 * @param {{status?: number, text?: string, contentType?: string}} response
 *   A fetch-like response summary.
 * @returns {boolean} True when the response is a Cloudflare challenge.
 */
export function isCloudflareChallenge(response) {
  if (!response || typeof response !== 'object') {
    return false;
  }

  const status = typeof response.status === 'number' ? response.status : 0;
  const text = typeof response.text === 'string' ? response.text : '';
  const contentType = (response.contentType || '').toLowerCase();

  if (text && contentType && !contentType.includes('html')) {
    return false;
  }

  if (status === 403 || status === 503) {
    return true;
  }

  if (status === 200 && text) {
    return text.includes('/cdn-cgi/challenge-platform/') || text.includes('cf-challenge');
  }

  return false;
}

/**
 * Build a short, user-facing description of why a feed could not load.
 *
 * @param {{status?: number, contentType?: string}} response
 *   The failed fetch response summary.
 * @returns {string} Message suitable toasts and feed errors.
 */
export function describeFailureReason(response) {
  const status = response && typeof response.status === 'number' ? response.status : 0;
  const contentType = ((response && response.contentType) || '').toLowerCase();

  if (status === 403 || status === 503) {
    return 'Blocked by Cloudflare bot protection. Use "Watch Page (no RSS)" or try again from the menu.';
  }
  if (status === 404) {
    return 'The server replied 404 Not Found — this address has no feed.';
  }
  if (contentType.includes('html')) {
    return 'No feed found at this address (the page is HTML, not RSS).';
  }
  if (status >= 400) {
    return `The server replied HTTP ${status}.`;
  }
  return 'No feed found at this address.';
}
