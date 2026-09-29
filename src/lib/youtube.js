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
 * Shape of a YouTube channel ID (internal handle): starts with UC
 * followed by at least 10 URL-safe characters. yt-dlp reports it as
 * channel_id; a channel's RSS feed is keyed by it.
 *
 * @type {RegExp}
 */
const CHANNEL_ID_REGEX = /^UC[A-Za-z0-9_-]{10,}$/;

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
 * Build the RSS feed URL for a YouTube channel.
 *
 * Every YouTube channel exposes a machine-readable RSS feed of its
 * latest 15 uploads keyed by its channel ID; this is the feed
 * subscribing to a channel means.
 *
 * @param {string} channelID - Channel ID as reported by yt-dlp (UC...)
 * @returns {string} https://www.youtube.com/feeds/videos.xml?channel_id=...
 */
export function buildYouTubeChannelFeedURL(channelID) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelID)}`;
}

/**
 * Classify the channel reference carried by a YouTube channel-page URL.
 *
 * Recognizes the four path shapes YouTube uses for channels: the modern
 * @handle form, the canonical /channel/UC... form, and the legacy
 * /c/vanity and /user/username forms. The value is the last path
 * segment, percent-decoded; validation of handle/ID shapes is left to
 * the resolvers that consume it.
 *
 * @param {string} url - Any www.youtube.com URL
 * @returns {{kind: 'channelID'|'handle'|'legacy', value: string}|null}
 *   The reference, or null when the URL is not a YouTube channel page
 */
export function extractYouTubeChannelReference(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return null;
  }

  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    return null;
  }

  const hostname = urlObj.hostname.toLowerCase();
  if (hostname !== 'www.youtube.com' && hostname !== 'youtube.com' && hostname !== 'm.youtube.com') {
    return null;
  }

  const segments = urlObj.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const first = segments[0];
  let value;
  try {
    value = decodeURIComponent(first);
  } catch {
    value = first;
  }

  if (value.startsWith('@')) {
    return { kind: 'handle', value: value.slice(1) };
  }
  if ((first === 'channel' || first === 'c' || first === 'user') && segments.length > 1) {
    let reference;
    try {
      reference = decodeURIComponent(segments[1]);
    } catch {
      reference = segments[1];
    }
    if (first === 'channel') {
      return CHANNEL_ID_REGEX.test(reference) ? { kind: 'channelID', value: reference } : null;
    }
    return { kind: 'legacy', value: reference };
  }

  return null;
}

/**
 * Extract the canonical channel RSS feed URL from a YouTube channel page.
 *
 * YouTube embeds the feed URL of the page's channel in its HTML in
 * several places: an <link rel="alternate" type="application/rss+xml">
 * tag and a "rssUrl" field in the page JSON. Resolving feeds from this
 * tag (instead of guessing IDs from path segments) is authoritative —
 * notably /@handle pages can also mention other channel IDs (e.g. a
 * featured video's channel), which must not be mistaken for the page's
 * channel. /channel/UC... pages carry no such ambiguity.
 *
 * @param {string} html - Raw HTML of a YouTube channel page
 * @returns {string|null} The advertised feeds/videos.xml URL, or null
 */
export function extractYouTubeRSSLink(html) {
  if (!html || typeof html !== 'string') {
    return null;
  }

  // Preferred: the <link rel="alternate" type="application/rss+xml">
  // tag. Attributes may appear in any order, so match the tag first and
  // pull the href out of the tag snippet.
  const linkTag = html.match(/<link\b[^>]*type=["']application\/rss\+xml["'][^>]*>/i);
  if (linkTag) {
    const href = linkTag[0].match(/href=["']([^"']+)["']/i);
    if (href) {
      return href[1];
    }
  }

  // Fallback: the "rssUrl" field in the page's embedded JSON.
  const rssURL = html.match(/["']rssUrl["']\s*:\s*["']([^"']+)["']/);
  if (rssURL) {
    return rssURL[1];
  }

  return null;
}

/**
 * Extract the page's own channel ID from a YouTube channel page.
 *
 * Last-resort resolution for channel pages that advertise no RSS link:
 * prefers the "externalId" field (the page channel's ID) over a bare
 * "channelId", which on @handle pages can belong to an unrelated
 * embedded entity (e.g. the featured video's channel).
 *
 * @param {string} html - Raw HTML of a YouTube channel page
 * @returns {string|null} The UC... channel ID, or null
 */
export function extractYouTubeChannelIDFromHTML(html) {
  if (!html || typeof html !== 'string') {
    return null;
  }

  const external = html.match(/["']externalId["']\s*:\s*["'](UC[A-Za-z0-9_-]+)["']/);
  if (external) {
    return external[1];
  }

  const canonical = html.match(/["']channelId["']\s*:\s*["'](UC[A-Za-z0-9_-]+)["']/);
  if (canonical) {
    return canonical[1];
  }

  return null;
}

/**
 * Extract the human-readable channel title from a YouTube channel page.
 *
 * Reads the og:title meta tag (either attribute order), falling back to
 * the <title> element. HTML entities are decoded; the result labels the
 * discovered feed.
 *
 * @param {string} html - Raw HTML of a YouTube channel page
 * @returns {string|null} The channel title, or null when absent
 */
export function extractYouTubeChannelTitle(html) {
  if (!html || typeof html !== 'string') {
    return null;
  }

  const patterns = [
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i,
    /<title[^>]*>([^<]*)<\/title>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Build the candidate feed URLs for a YouTube channel, best first.
 *
 * YouTube's feed server has been intermittently answering 404 for the
 * classic channel_id feeds (the "RSS feeds are down" outages of 2024
 * and 2026), sometimes shape-specifically. The same server keeps
 * serving the channel's uploads feed keyed by uploads playlist IDs,
 * which are the channel ID with the UC prefix replaced: UU (all
 * uploads, the same items as the channel_id feed) and UULF (long-form
 * uploads only, shorts filtered). Callers use these as fallbacks when
 * the canonical URL fails, so subscriptions and refreshes survive the
 * outage without changing what "subscribing to a channel" means.
 *
 * @param {string} channelID - Channel ID (UC...)
 * @returns {Array<string>} Feed URLs, canonical first
 */
export function buildYouTubeChannelFeedURLCandidates(channelID) {
  if (!channelID || !CHANNEL_ID_REGEX.test(channelID)) {
    return [];
  }
  const uploads = channelID.slice(2);
  return [
    buildYouTubeChannelFeedURL(channelID),
    `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${uploads}`,
    `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${uploads}`,
  ];
}

/**
 * Extract a channel ID from a YouTube channel RSS feed URL.
 *
 * Inverse of buildYouTubeChannelFeedURL: lets the subscription check
 * compare a stored feed URL against a video's channel without guessing
 * about other URL shapes. Legacy user IDs and vanity handles have no
 * stable feeds/videos.xml mapping here and yield null.
 *
 * @param {string} url - Candidate feed URL
 * @returns {string|null} The channel ID, or null when the URL is not a
 *   channel_id-keyed YouTube feeds/videos.xml URL
 */
export function extractYouTubeChannelFeedID(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return null;
  }

  const hostname = urlObj.hostname.toLowerCase();
  if (hostname !== 'www.youtube.com' && hostname !== 'youtube.com' && hostname !== 'm.youtube.com') {
    return null;
  }
  if (urlObj.pathname !== '/feeds/videos.xml') {
    return null;
  }

  const channelID = urlObj.searchParams.get('channel_id') || '';
  return CHANNEL_ID_REGEX.test(channelID) ? channelID : null;
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
