/**
 * URL utilities.
 *
 * Small, framework-free helpers for deciding how a link should be handled.
 */

/**
 * Decide whether an href points outside the current application origin.
 *
 * Relative URLs, non-http(s) schemes (e.g. mailto:, tel:), and URLs that
 * share the base origin are considered internal. Only absolute http(s)
 * URLs with a different origin are external.
 *
 * @param {string} href
 * @param {string} base
 * @returns {boolean}
 */
export function isExternalURL(href, base) {
  if (!href) {
    return false;
  }
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    const baseUrl = new URL(base);
    return url.origin !== baseUrl.origin;
  } catch {
    return false;
  }
}
