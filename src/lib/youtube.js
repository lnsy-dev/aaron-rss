/**
 * YouTube URL Helpers
 *
 * Framework-free utilities for recognizing YouTube links, extracting
 * video IDs, and generating embed URLs. These helpers run in any
 * JavaScript environment (renderer, worker, tests) and do not depend
 * on DOM or Node APIs.
 */

/**
 * YouTube hostnames that should be treated as video links.
 *
 * @type {Array<string>}
 */
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];

/**
 * Hostnames that are explicitly excluded from YouTube handling.
 *
 * @type {Array<string>}
 */
const EXCLUDED_HOSTS = ['gaming.youtube.com'];

/**
 * Regular expression matching a valid 11-character YouTube video ID.
 *
 * @type {RegExp}
 */
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Determine whether a URL points to a YouTube video page.
 *
 * Returns false for gaming.youtube.com, malformed URLs, and non-HTTP
 * schemes.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isYouTubeURL(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return false;
  }

  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    return false;
  }

  const hostname = urlObj.hostname.toLowerCase();
  if (EXCLUDED_HOSTS.includes(hostname)) {
    return false;
  }

  if (!YOUTUBE_HOSTS.includes(hostname)) {
    return false;
  }

  // youtu.be/{id}
  if (hostname === 'youtu.be') {
    return VIDEO_ID_REGEX.test(urlObj.pathname.slice(1));
  }

  // youtube.com/watch?v={id}
  if (urlObj.pathname === '/watch') {
    return VIDEO_ID_REGEX.test(urlObj.searchParams.get('v') || '');
  }

  // youtube.com/shorts/{id}
  if (urlObj.pathname.startsWith('/shorts/')) {
    return VIDEO_ID_REGEX.test(urlObj.pathname.split('/')[2] || '');
  }

  // youtube.com/embed/{id}
  if (urlObj.pathname.startsWith('/embed/')) {
    return VIDEO_ID_REGEX.test(urlObj.pathname.split('/')[2] || '');
  }

  // youtube.com/live/{id} is a stream; treated as YouTube URL but
  // filtered separately by isYouTubeStream(). Still return true here
  // so callers can decide what to do.
  if (urlObj.pathname.startsWith('/live/')) {
    return VIDEO_ID_REGEX.test(urlObj.pathname.split('/')[2] || '');
  }

  // youtube.com/v/{id} is an old-style player URL.
  if (urlObj.pathname.startsWith('/v/')) {
    return VIDEO_ID_REGEX.test(urlObj.pathname.split('/')[2] || '');
  }

  return false;
}

/**
 * Determine whether a URL points at YouTube at all (host-level check).
 *
 * Unlike isYouTubeURL(), this does not require a recognizable video path
 * or a valid 11-character ID. It returns true for every http(s) URL on a
 * YouTube host (youtube.com, m.youtube.com, music.youtube.com, youtu.be),
 * including odd shapes like attribution_link or deleted-video redirects
 * that a feed may still carry. Callers use it to route the user to the
 * YouTube viewer instead of attempting a generic article extraction,
 * which fails with 403 against youtube.com.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isYouTubeHostURL(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return false;
  }

  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    return false;
  }

  const hostname = urlObj.hostname.toLowerCase();
  if (EXCLUDED_HOSTS.includes(hostname)) {
    return false;
  }

  return YOUTUBE_HOSTS.includes(hostname);
}

/**
 * Determine whether a YouTube URL is a live stream.
 *
 * Live streams and premieres are excluded from auto-download and from
 * the end-of-video lifecycle because they do not have a clean "ended"
 * state in the same way as uploaded videos.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isYouTubeStream(url) {
  if (!isYouTubeURL(url)) {
    return false;
  }

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return false;
  }

  const pathname = urlObj.pathname.toLowerCase();
  return pathname.startsWith('/live/');
}

/**
 * Extract the 11-character video ID from a YouTube URL.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function extractYouTubeVideoID(url) {
  if (!isYouTubeURL(url)) {
    return null;
  }

  const urlObj = new URL(url);
  const hostname = urlObj.hostname.toLowerCase();

  if (hostname === 'youtu.be') {
    const id = urlObj.pathname.slice(1);
    return VIDEO_ID_REGEX.test(id) ? id : null;
  }

  if (urlObj.pathname.startsWith('/shorts/') || urlObj.pathname.startsWith('/embed/') || urlObj.pathname.startsWith('/live/') || urlObj.pathname.startsWith('/v/')) {
    const id = urlObj.pathname.split('/')[2] || '';
    return VIDEO_ID_REGEX.test(id) ? id : null;
  }

  const id = urlObj.searchParams.get('v');
  if (id && VIDEO_ID_REGEX.test(id)) {
    return id;
  }

  return null;
}

/**
 * Build the YouTube embed URL for a video ID.
 *
 * Includes enablejsapi=1 so the IFrame Player API can control the
 * player and report state changes (e.g. video ended).
 *
 * @param {string} videoID
 * @returns {string}
 */
export function getYouTubeEmbedURL(videoID) {
  if (!videoID || !VIDEO_ID_REGEX.test(videoID)) {
    throw new Error('Invalid YouTube video ID');
  }
  return `https://www.youtube.com/embed/${videoID}?enablejsapi=1&rel=0&modestbranding=1`;
}
