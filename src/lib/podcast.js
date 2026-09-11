/**
 * Podcast Detection Helpers
 *
 * Framework-free utilities for recognizing podcast episodes in parsed
 * feed items. A podcast episode is an item carrying an audio enclosure
 * (RSS `<enclosure>` / Atom `<link rel="enclosure">` / JSON Feed
 * `attachments`), which is how podcast clients have always discovered
 * downloadable audio. These helpers run in any JavaScript environment
 * (renderer, worker, tests) and do not depend on DOM or Node APIs.
 */

/**
 * File extensions that identify an audio file when an enclosure's MIME
 * type is missing (some feeds only provide a URL).
 *
 * @type {RegExp}
 */
const AUDIO_EXTENSION_REGEX = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i;

/**
 * Determine whether a MIME type string identifies audio.
 *
 * Empty/missing types are handled by the caller via URL inspection.
 *
 * @param {string|undefined} type - Enclosure MIME type
 * @returns {boolean} True when the type is an audio type
 */
export function isAudioMIMEType(type) {
  return typeof type === 'string' && type.toLowerCase().startsWith('audio/');
}

/**
 * Determine whether a URL looks like an audio file by extension.
 *
 * @param {string} url - Enclosure URL
 * @returns {boolean} True when the path ends in a known audio extension
 */
export function isAudioURLExtension(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return AUDIO_EXTENSION_REGEX.test(url);
}

/**
 * Extract the audio enclosure from a parsed feed item.
 *
 * Accepts raw rss-parser items (`enclosure: {url, type, length}`), JSON
 * Feed items (`attachments: [{url, mime_type, size_in_bytes}]`), and
 * already-normalized articles (`enclosureURL`). Returns null for items
 * without an audio enclosure — including image/video enclosures, so
 * ordinary blogs with image enclosures are not mistaken for podcasts.
 *
 * @param {object} item - Parsed feed item or article-like object
 * @returns {{url: string, type: string|null, length: number|null}|null}
 *   The audio enclosure, or null when the item has none
 */
export function extractAudioEnclosure(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  // Already-normalized article records from the database.
  if (item.enclosureURL) {
    return {
      url: item.enclosureURL,
      type: item.enclosureType || null,
      length: Number.isFinite(item.enclosureLength) ? item.enclosureLength : null,
    };
  }

  // JSON Feed 1.1 attachments (checked first: an item may carry both).
  if (Array.isArray(item.attachments)) {
    for (const attachment of item.attachments) {
      if (!attachment?.url || typeof attachment.url !== 'string') {
        continue;
      }
      const audio = audioEnclosureFromURLOptions(attachment.url, attachment.mime_type, attachment.size_in_bytes);
      if (audio) {
        return audio;
      }
    }
  }

  // RSS <enclosure> as surfaced by rss-parser.
  const enclosure = item.enclosure;
  if (enclosure && typeof enclosure.url === 'string' && enclosure.url) {
    const audio = audioEnclosureFromURLOptions(enclosure.url, enclosure.type, enclosure.length);
    if (audio) {
      return audio;
    }
  }

  // Atom <link rel="enclosure"> entries. Two shapes arrive here: raw
  // xml2js elements (rel/href inside `.$`, from rss-parser's atomLinks
  // custom field) and pre-flattened objects.
  if (Array.isArray(item.links) || Array.isArray(item.atomLinks)) {
    for (const link of [...(item.links || []), ...(item.atomLinks || [])]) {
      const attrs = link?.$ || link;
      if (attrs?.rel !== 'enclosure' || !attrs.href) {
        continue;
      }
      const audio = audioEnclosureFromURLOptions(attrs.href, attrs.type, attrs.length);
      if (audio) {
        return audio;
      }
    }
  }

  return null;
}

/**
 * Validate raw enclosure attributes as an audio enclosure.
 *
 * Audio is detected by MIME type first, then by URL extension when the
 * type is missing. Non-audio enclosures (images, video, HTML) yield
 * null so ordinary blogs are not mistaken for podcasts.
 *
 * @param {string} url - Enclosure URL
 * @param {string|undefined} type - Enclosure MIME type, when present
 * @param {string|number|undefined} length - Byte length, when present
 * @returns {{url: string, type: string|null, length: number|null}|null}
 */
function audioEnclosureFromURLOptions(url, type, length) {
  if (isAudioMIMEType(type) || (!type && isAudioURLExtension(url))) {
    return {
      url,
      type: type || null,
      length: Number(length) || null,
    };
  }
  return null;
}

/**
 * Determine whether an article is a podcast episode (has audio media).
 *
 * @param {object} article - Article record
 * @returns {boolean} True when the article carries an audio enclosure
 */
export function isPodcastEpisode(article) {
  return Boolean(article?.enclosureURL);
}

/**
 * Derive a download file name for a podcast episode.
 *
 * Uses the episode title sanitized for the filesystem, falling back to
 * the URL's basename when there is no title. The extension comes from
 * the enclosure URL; `.mp3` is the last-resort default.
 *
 * @param {object} article - Article with title and enclosureURL
 * @returns {string} A safe file name such as "Episode 42.mp3"
 */
export function suggestPodcastFileName(article) {
  const extension = extensionFromURL(article?.enclosureURL) || '.mp3';

  let base = typeof article?.title === 'string' ? article.title.trim() : '';
  if (!base) {
    // Fall back to the URL basename with its extension stripped (the
    // extension is appended again below).
    const urlBase = basenameFromURL(article?.enclosureURL);
    base = urlBase ? urlBase.replace(/\.[a-z0-9]{2,5}$/i, '') : '';
    if (!base) {
      base = 'podcast-episode';
    }
  }

  // Strip characters most filesystems reject, collapse whitespace, and
  // cap the length so the name stays readable on every platform.
  base = base
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
    .trim();

  if (!base) {
    base = 'podcast-episode';
  }

  return `${base}${extension}`;
}

/**
 * Extract the lowercase extension (including dot) from a URL path.
 *
 * @param {string} url
 * @returns {string|null} Extension such as ".mp3", or null
 */
function extensionFromURL(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  const match = /\.([a-z0-9]{2,5})$/i.exec(pathname);
  return match ? `.${match[1].toLowerCase()}` : null;
}

/**
 * Extract the last path segment of a URL, decoded.
 *
 * @param {string} url
 * @returns {string|null} Basename such as "episode-42.mp3", or null
 */
function basenameFromURL(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) {
      return null;
    }
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return null;
  }
}
