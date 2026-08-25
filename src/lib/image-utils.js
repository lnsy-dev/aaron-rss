/**
 * Image Utilities
 *
 * Helpers shared by the image context menu (right-click / ctrl-click on
 * images inside feed content): picking the URL that actually loaded and
 * deriving a sensible file name from the image URL and MIME type.
 */

/** Map of common image MIME types to canonical file extensions. */
const EXTENSION_BY_MIME_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/apng': 'apng',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
};

/**
 * Return the URL an image element actually resolved to.
 *
 * Prefers `currentSrc` because `<picture>`/`srcset` may resolve to a
 * different resource than the raw `src` attribute.
 *
 * @param {HTMLImageElement} image - The image element
 * @returns {string} The resolved URL, or '' when unavailable
 */
export function getUsableImageURL(image) {
  if (!image) {
    return '';
  }
  return image.currentSrc || image.src || '';
}

/**
 * Derive a file name for an image from its URL and MIME type.
 *
 * Uses the URL's last path segment when it has a plausible name,
 * otherwise falls back to "image". Appends a canonical extension based
 * on the MIME type when the name does not already have one.
 *
 * @param {string} url - The image URL (absolute or relative)
 * @param {string} [mimeType] - Content type of the fetched bytes, if known
 * @param {string} [fallbackName='image'] - Base name when the URL has none
 * @returns {string} A file name like "photo.jpg"
 */
export function deriveImageFilename(url, mimeType = '', fallbackName = 'image') {
  let baseName = fallbackName;

  // Resolve against the app origin when running in a browser; absolute
  // URLs ignore the base, and non-browser environments skip straight
  // to parsing the URL on its own.
  const base = typeof window !== 'undefined' && window.location
    ? window.location.href
    : undefined;

  try {
    const parsed = new URL(url, base);
    const segment = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    // Use any non-empty final path segment; the MIME-based extension pass
    // below fixes names that lack one.
    if (segment) {
      baseName = segment;
    }
  } catch {
    // Unparseable URLs keep the fallback name.
  }

  const extension = EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()];
  if (extension && !/\.[a-z0-9]{1,5}$/i.test(baseName)) {
    baseName = `${baseName}.${extension}`;
  }

  return baseName;
}

/**
 * Build File System Access accept descriptors for a MIME type.
 *
 * @param {string} [mimeType] - Content type of the image, if known
 * @returns {Array<object>} Descriptors usable by showSaveFilePicker
 */
export function buildImageAcceptTypes(mimeType = '') {
  const known = EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()];
  const resolvedType = known ? mimeType.toLowerCase() : 'image/png';
  const extension = known || 'png';
  return [
    {
      description: 'Image',
      accept: { [resolvedType]: [`.${extension}`] },
    },
  ];
}
