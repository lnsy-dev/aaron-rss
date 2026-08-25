/**
 * Social Post Helpers
 *
 * Fetches Bluesky and Mastodon posts through their public APIs so the app
 * can render original posts, embedded quote posts, and replies without
 * relying on iframes (which are blocked by X-Frame-Options on bsky.app and
 * most Mastodon instances).
 *
 * All network traffic goes through the app's existing `fetchText` helper so
 * the Electron main-process bridge is used in production.
 */

import { fetchText } from './rss-network.js';
import { stripHTML } from './html-utils.js';

const BLUESKY_EMBED_PLACEHOLDER = '[contains quote post or other embedded content]';

/**
 * Recognize a Bluesky or Mastodon post URL.
 *
 * @param {string} url
 * @returns {'bluesky'|'mastodon'|null}
 */
export function identifySocialURL(url) {
  if (parseBlueskyURL(url)) return 'bluesky';
  if (parseMastodonURL(url)) return 'mastodon';
  return null;
}

/**
 * Parse a Bluesky post URL.
 *
 * @param {string} url
 * @returns {{handle: string, rkey: string}|null}
 */
function parseBlueskyURL(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname !== 'bsky.app') return null;

    const match = urlObj.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)\/?$/);
    if (!match) return null;

    return { handle: decodeURIComponent(match[1]), rkey: match[2] };
  } catch {
    return null;
  }
}

/**
 * Parse a Mastodon status URL.
 *
 * Accepts the common `/@handle/ID` path as well as the alternate
 * `/users/handle/statuses/ID` path.
 *
 * @param {string} url
 * @returns {{origin: string, statusId: string}|null}
 */
function parseMastodonURL(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    const atMatch = pathname.match(/^\/@([^/]+)\/([^/]+)\/?$/);
    if (atMatch) {
      return { origin: urlObj.origin, statusId: atMatch[2] };
    }

    const usersMatch = pathname.match(/^\/users\/([^/]+)\/statuses\/([^/]+)\/?$/);
    if (usersMatch) {
      return { origin: urlObj.origin, statusId: usersMatch[2] };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch a URL and parse the response as JSON.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
async function fetchJSON(url) {
  const response = await fetchText(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  try {
    return JSON.parse(response.text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${error.message}`);
  }
}

/**
 * Resolve a Bluesky handle to a DID.
 *
 * @param {string} handle
 * @returns {Promise<string>}
 */
async function resolveBlueskyHandle(handle) {
  const data = await fetchJSON(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  );
  if (!data.did) {
    throw new Error(`Could not resolve Bluesky handle: ${handle}`);
  }
  return data.did;
}

/**
 * Build an at:// URI for a Bluesky post.
 *
 * @param {string} did
 * @param {string} rkey
 * @returns {string}
 */
function buildBlueskyURI(did, rkey) {
  return `at://${did}/app.bsky.feed.post/${rkey}`;
}

/**
 * Extract the primary text from a Bluesky post view.
 *
 * @param {object} postView
 * @returns {string}
 */
function extractBlueskyPostText(postView) {
  return postView?.record?.text || '';
}

/**
 * Convert a UTF-8 byte offset into a JavaScript string character offset.
 *
 * @param {string} text
 * @param {number} byteOffset
 * @returns {number}
 */
function byteOffsetToCharOffset(text, byteOffset) {
  if (!text || byteOffset <= 0) return 0;

  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const slice = bytes.slice(0, byteOffset);
  const decoded = new TextDecoder('utf-8').decode(slice);
  return decoded.length;
}

/**
 * Render Bluesky text with link facets as HTML.
 *
 * Link facets are replaced by clickable anchors showing the full URL.
 *
 * @param {string} text
 * @param {Array<object>} [facets]
 * @returns {string}
 */
export function renderBlueskyText(text, facets) {
  if (!text) return '';

  const linkFacets = (facets || [])
    .filter((facet) =>
      facet.features?.some((feature) => feature.$type === 'app.bsky.richtext.facet#link' && feature.uri)
    )
    .sort((a, b) => a.index.byteStart - b.index.byteStart);

  if (linkFacets.length === 0) {
    return escapeHTML(text).replace(/\n/g, '<br>');
  }

  let html = '';
  let lastCharEnd = 0;

  for (const facet of linkFacets) {
    const start = byteOffsetToCharOffset(text, facet.index.byteStart);
    const end = byteOffsetToCharOffset(text, facet.index.byteEnd);
    const linkFeature = facet.features.find((feature) => feature.$type === 'app.bsky.richtext.facet#link');
    const uri = linkFeature?.uri || '';

    if (start > lastCharEnd) {
      html += escapeHTML(text.slice(lastCharEnd, start)).replace(/\n/g, '<br>');
    }

    html += `<a href="${escapeHTML(uri)}" target="_blank" rel="noopener noreferrer">${escapeHTML(uri)}</a>`;
    lastCharEnd = end;
  }

  if (lastCharEnd < text.length) {
    html += escapeHTML(text.slice(lastCharEnd)).replace(/\n/g, '<br>');
  }

  return html;
}

/**
 * Render Bluesky text with link facets as plain text.
 *
 * Link display text is replaced by the full URL so the URL is visible in
 * plain-text summaries.
 *
 * @param {string} text
 * @param {Array<object>} [facets]
 * @returns {string}
 */
export function renderBlueskyPlainText(text, facets) {
  if (!text) return '';

  const linkFacets = (facets || [])
    .filter((facet) =>
      facet.features?.some((feature) => feature.$type === 'app.bsky.richtext.facet#link' && feature.uri)
    )
    .sort((a, b) => a.index.byteStart - b.index.byteStart);

  if (linkFacets.length === 0) return text;

  let plain = '';
  let lastCharEnd = 0;

  for (const facet of linkFacets) {
    const start = byteOffsetToCharOffset(text, facet.index.byteStart);
    const end = byteOffsetToCharOffset(text, facet.index.byteEnd);
    const linkFeature = facet.features.find((feature) => feature.$type === 'app.bsky.richtext.facet#link');
    const uri = linkFeature?.uri || '';

    if (start > lastCharEnd) {
      plain += text.slice(lastCharEnd, start);
    }

    plain += uri;
    lastCharEnd = end;
  }

  if (lastCharEnd < text.length) {
    plain += text.slice(lastCharEnd);
  }

  return plain;
}

/**
 * Extract media (images, external link cards) from a Bluesky embed view.
 *
 * @param {object} embedView
 * @returns {Array<object>}
 */
function extractBlueskyMedia(embedView) {
  const media = [];
  if (!embedView) return media;

  // `embeds` arrays on a viewRecord contain nested embed views.
  if (Array.isArray(embedView)) {
    for (const child of embedView) {
      media.push(...extractBlueskyMedia(child));
    }
    return media;
  }

  if (Array.isArray(embedView.images)) {
    for (const image of embedView.images) {
      media.push({
        type: 'image',
        thumb: image.thumb,
        fullsize: image.fullsize,
        alt: image.alt || '',
        aspectRatio: image.aspectRatio,
      });
    }
  }

  if (embedView.external) {
    media.push({
      type: 'external',
      uri: embedView.external.uri,
      title: embedView.external.title,
      description: embedView.external.description,
      thumb: embedView.external.thumb,
    });
  }

  // recordWithMedia nests media under `embed.media`.
  if (embedView.media) {
    media.push(...extractBlueskyMedia(embedView.media));
  }

  // A quoted record may itself have embeds (e.g. images inside the quote).
  if (embedView.record && Array.isArray(embedView.record.embeds)) {
    media.push(...extractBlueskyMedia(embedView.record.embeds));
  }

  return media;
}

/**
 * Extract media attached directly to a Bluesky post (not inside a quote).
 *
 * @param {object} postView
 * @returns {Array<object>}
 */
function extractBlueskyMainMedia(postView) {
  const embed = postView?.embed;
  if (!embed) return [];

  const embedType = embed.$type || '';

  // A pure record embed is a quote post; the media belongs to the quote.
  if (embedType.includes('record') && embed.record && !embed.media) {
    return [];
  }

  // recordWithMedia attaches media separately from the quoted record.
  if (embedType.includes('recordWithMedia') && embed.media) {
    return extractBlueskyMedia(embed.media);
  }

  return extractBlueskyMedia(embed);
}

/**
 * Extract quote-post embeds from a Bluesky post view.
 *
 * @param {object} postView
 * @returns {Array<{author: string, text: string, media: Array<object>}>}
 */
function extractBlueskyEmbeds(postView) {
  const embeds = [];
  const recordEmbed = postView?.embed?.record;

  if (recordEmbed && recordEmbed.value) {
    const author = recordEmbed.author?.displayName || recordEmbed.author?.handle || '';
    const handle = recordEmbed.author?.handle || '';
    const text = recordEmbed.value.text || '';
    const media = extractBlueskyMedia(recordEmbed.embeds || []);
    embeds.push({ author, handle, text, media });
  }

  return embeds;
}

/**
 * Recursively flatten Bluesky thread replies into a simple comment list.
 *
 * @param {Array<object>} replies
 * @param {number} [depth]
 * @returns {Array<{author: string, handle: string, text: string, date: string}>}
 */
function flattenBlueskyReplies(replies, depth = 0) {
  const comments = [];
  if (!Array.isArray(replies)) return comments;

  for (const reply of replies) {
    const post = reply?.post;
    if (!post) continue;

    comments.push({
      author: post.author?.displayName || post.author?.handle || '',
      handle: post.author?.handle || '',
      text: extractBlueskyPostText(post),
      date: post.indexedAt || post.record?.createdAt || '',
      depth,
    });

    if (reply.replies?.length) {
      comments.push(...flattenBlueskyReplies(reply.replies, depth + 1));
    }
  }

  return comments;
}

/**
 * Fetch a Bluesky post and its replies.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
async function fetchBlueskyPost(url) {
  const { handle, rkey } = parseBlueskyURL(url);
  const did = await resolveBlueskyHandle(handle);
  const uri = buildBlueskyURI(did, rkey);

  const data = await fetchJSON(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=5`
  );
  const postView = data?.thread?.post;
  if (!postView) {
    throw new Error('Bluesky thread response missing post');
  }

  return {
    platform: 'bluesky',
    url,
    author: postView.author?.displayName || postView.author?.handle || '',
    handle: postView.author?.handle || '',
    date: postView.indexedAt || postView.record?.createdAt || '',
    text: extractBlueskyPostText(postView),
    facets: postView.record?.facets || [],
    media: extractBlueskyMainMedia(postView),
    embeds: extractBlueskyEmbeds(postView),
    comments: flattenBlueskyReplies(data.thread.replies),
  };
}

/**
 * Fetch a Mastodon status and its reply context.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
async function fetchMastodonPost(url) {
  const { origin, statusId } = parseMastodonURL(url);

  const [statusData, contextData] = await Promise.all([
    fetchJSON(`${origin}/api/v1/statuses/${encodeURIComponent(statusId)}`),
    fetchJSON(`${origin}/api/v1/statuses/${encodeURIComponent(statusId)}/context`),
  ]);

  if (!statusData?.content) {
    throw new Error('Mastodon status response missing content');
  }

  const account = statusData.account || {};
  const comments = (contextData?.descendants || []).map((reply) => ({
    author: reply.account?.display_name || reply.account?.username || '',
    handle: reply.account?.acct || '',
    text: reply.content || '',
    date: reply.created_at || '',
    depth: 0,
  }));

  const media = (statusData.media_attachments || []).map((attachment) => ({
    type: attachment.type === 'image' ? 'image' : 'external',
    thumb: attachment.preview_url,
    fullsize: attachment.url,
    alt: attachment.description || '',
  }));

  return {
    platform: 'mastodon',
    url,
    author: account.display_name || account.username || '',
    handle: account.acct || '',
    date: statusData.created_at || '',
    text: statusData.content || '',
    media,
    embeds: [],
    comments,
  };
}

/**
 * Fetch a social post and its replies.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function fetchSocialPost(url) {
  const platform = identifySocialURL(url);
  if (!platform) {
    throw new Error('Unsupported social post URL');
  }

  if (platform === 'bluesky') {
    return fetchBlueskyPost(url);
  }

  return fetchMastodonPost(url);
}

/**
 * Check whether a Bluesky feed item likely contains an embedded post.
 *
 * @param {object} item
 * @returns {boolean}
 */
function hasBlueskyEmbed(item) {
  const text = item.contentText || item.summary || '';
  return text.includes(BLUESKY_EMBED_PLACEHOLDER);
}

/**
 * Resolve a Bluesky profile feed's handle once and build AT URIs for its items.
 *
 * @param {string} feedURL
 * @param {Array<object>} items
 * @returns {Promise<Array<{item: object, uri: string}>>}
 */
async function buildBlueskyItemURIs(feedURL, items) {
  let handle;
  try {
    const urlObj = new URL(feedURL);
    const match = urlObj.pathname.match(/^\/profile\/([^/]+)\/rss\/?$/i);
    if (!match) return [];
    handle = decodeURIComponent(match[1]);
  } catch {
    return [];
  }

  let did;
  try {
    did = await resolveBlueskyHandle(handle);
  } catch {
    return [];
  }

  const result = [];
  for (const item of items) {
    const rkey = item.uniqueID?.split('/').pop() || item.url?.split('/').pop();
    if (!rkey) continue;
    result.push({ item, uri: buildBlueskyURI(did, rkey) });
  }
  return result;
}

/**
 * Build an HTML string for a list of Bluesky media items.
 *
 * Images become plain <img> elements; external link cards (website previews)
 * become clickable anchors so the linked site can be opened from the feed
 * list. Clicks on these anchors are routed to the system browser by the
 * component's delegated content-click handling (or will-navigate in Electron).
 *
 * @param {Array<object>} media
 * @returns {string}
 */
function buildBlueskyMediaHTML(media) {
  if (!media || media.length === 0) return '';

  const items = [];
  for (const item of media) {
    if (item.type === 'image' && item.thumb) {
      const alt = escapeHTML(item.alt || '');
      items.push(`<img src="${escapeHTML(item.thumb)}" alt="${alt}" loading="lazy">`);
    } else if (item.type === 'external' && item.uri) {
      const title = escapeHTML(item.title || item.uri);
      const thumb = item.thumb
        ? `<img src="${escapeHTML(item.thumb)}" alt="" loading="lazy">`
        : '';
      const description = item.description
        ? `<span class="rss-social-link-card-description">${escapeHTML(item.description)}</span>`
        : '';
      items.push(
        `<a class="rss-social-link-card" href="${escapeHTML(item.uri)}" target="_blank" rel="noopener noreferrer">` +
        thumb +
        `<span class="rss-social-link-card-body">` +
        `<span class="rss-social-link-card-title">${title}</span>` +
        description +
        `</span></a>`
      );
    }
  }

  if (items.length === 0) return '';
  return `<div class="rss-social-media">${items.join('')}</div>`;
}

/**
 * Build an HTML string for a Bluesky quote-post embed.
 *
 * @param {object} embed
 * @returns {string}
 */
function buildBlueskyEmbedHTML(embed) {
  const author = escapeHTML(embed.author || '');
  const text = escapeHTML(embed.text || '').replace(/\n/g, '<br>');
  const mediaHtml = buildBlueskyMediaHTML(embed.media);

  return (
    `<blockquote class="rss-social-embed">` +
    (author ? `<div class="rss-social-embed-author">${author}</div>` : '') +
    `<p>${text}</p>` +
    mediaHtml +
    `</blockquote>`
  );
}

/**
 * Build enriched HTML and text for a Bluesky RSS item from its API view.
 *
 * @param {object} item
 * @param {object} postView
 * @returns {{contentHTML: string, contentText: string, summary: string}}
 */
function buildBlueskyItemContent(item, postView) {
  const record = postView?.record || {};
  const mainText = record.text || item.contentText || '';
  const facets = record.facets;
  const mainMedia = extractBlueskyMainMedia(postView);
  const embeds = extractBlueskyEmbeds(postView);

  const mainTextHtml = renderBlueskyText(mainText, facets);
  const mainMediaHtml = buildBlueskyMediaHTML(mainMedia);
  const embedsHtml = embeds.map(buildBlueskyEmbedHTML).join('');

  const contentHTML = `<p>${mainTextHtml}</p>${mainMediaHtml}${embedsHtml}`;

  let contentText = renderBlueskyPlainText(mainText, facets).replace(BLUESKY_EMBED_PLACEHOLDER, '').trim();
  for (const embed of embeds) {
    contentText += `\n\n[quoted post] ${embed.author ? `${embed.author}: ` : ''}${embed.text}`;
  }
  for (const mediaItem of mainMedia) {
    if (mediaItem.alt) {
      contentText += `\n[image: ${mediaItem.alt}]`;
    }
  }

  return { contentHTML, contentText, summary: contentText };
}

/**
 * Enrich Bluesky RSS feed items with embedded posts and media.
 *
 * The public `app.bsky.feed.getPosts` endpoint is batched to avoid one
 * request per item.
 *
 * @param {string} feedURL
 * @param {Array<object>} items
 * @returns {Promise<Array<object>>}
 */
export async function enrichBlueskyFeedItems(feedURL, items) {
  if (items.length === 0) return items;

  const itemURIs = await buildBlueskyItemURIs(feedURL, items);
  if (itemURIs.length === 0) return items;

  const postMap = new Map();
  const chunks = [];
  for (let i = 0; i < itemURIs.length; i += 25) {
    chunks.push(itemURIs.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    const uris = chunk.map(({ uri }) => uri);
    const params = uris.map((uri) => `uris=${encodeURIComponent(uri)}`).join('&');
    try {
      const data = await fetchJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${params}`);
      for (const post of data?.posts || []) {
        postMap.set(post.uri, post);
      }
    } catch (error) {
      console.warn('Failed to enrich Bluesky embed chunk:', error.message);
    }
  }

  if (postMap.size === 0) return items;

  return items.map((item) => {
    const entry = itemURIs.find((entry) => entry.item === item);
    const postView = entry ? postMap.get(entry.uri) : null;
    if (!postView) return item;

    const { contentHTML, contentText, summary } = buildBlueskyItemContent(item, postView);
    return { ...item, contentHTML, contentText, summary };
  });
}

/**
 * Escape a string for safe insertion into HTML.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Public constant for consumers that need to detect the embed placeholder.
 *
 * @type {string}
 */
export { BLUESKY_EMBED_PLACEHOLDER, buildBlueskyMediaHTML };
