/**
 * Social Feed Migration
 *
 * One-time helper to convert synthetic Bluesky/Mastodon profile feeds
 * into real RSS/Atom feeds. Synthetic feeds generated from these profile
 * pages contain no actual posts and break Open Original, so this helper
 * discovers the canonical feed URL, adds it, and removes the synthetic one.
 */

import { loadAllFeeds, deleteFeed, addFeed } from './feed-manager.js';
import { updateFeedOpenOriginalByDefault } from './database.js';
import { findFeeds } from './feed-finder.js';

/**
 * Compute the canonical feed URL and platform for a social media profile URL.
 *
 * @param {string} url
 * @returns {{url: string, platform: string}|null}
 */
function resolveSocialFeed(url) {
  try {
    const urlObj = new URL(url);

    if (urlObj.hostname === 'bsky.app') {
      const match = urlObj.pathname.match(/^\/profile\/([^/]+)/);
      if (match) {
        return {
          url: `https://bsky.app/profile/${match[1]}/rss`,
          platform: 'Bluesky',
        };
      }
      return null;
    }

    const atMatch = urlObj.pathname.match(/^\/@([^/]+)/);
    const usersMatch = urlObj.pathname.match(/^\/users\/([^/]+)/);
    const handle = atMatch?.[1] || usersMatch?.[1];
    if (handle) {
      return {
        url: `${urlObj.origin}/@${handle}.atom`,
        platform: 'Mastodon',
      };
    }
  } catch {
    // invalid URL
  }

  return null;
}

/**
 * Convert synthetic Bluesky/Mastodon feeds to real RSS/Atom feeds.
 *
 * Adds the real feed first, then deletes the synthetic one so no data is
 * lost if the real feed cannot be fetched. Preserves the per-feed
 * "open original by default" setting.
 *
 * @returns {Promise<Array<object>>} Report of converted feeds
 */
export async function convertSyntheticSocialFeeds() {
  const feeds = await loadAllFeeds();
  const converted = [];

  for (const feed of feeds) {
    if (!feed.synthetic) {
      continue;
    }

    const target = resolveSocialFeed(feed.url);
    if (!target) {
      continue;
    }

    // Make sure the real feed exists before touching the old one.
    const discovered = await findFeeds(target.url);
    const validated = discovered.find((candidate) => candidate.url === target.url);
    if (!validated) {
      console.warn(`Could not validate ${target.platform} feed for ${feed.url}, skipping`);
      continue;
    }

    const newFeed = await addFeed(target.url);
    if (!newFeed) {
      console.warn(`Failed to add ${target.url}, leaving synthetic feed in place`);
      continue;
    }

    // Preserve the user's "open original by default" preference.
    if (feed.openOriginalByDefault) {
      try {
        await updateFeedOpenOriginalByDefault(newFeed.feedID, true);
      } catch (error) {
        console.warn(`Could not preserve open-original setting for ${newFeed.url}:`, error.message);
      }
    }

    await deleteFeed(feed.feedID);

    converted.push({
      oldUrl: feed.url,
      newUrl: target.url,
      platform: target.platform,
      name: newFeed.name,
    });
  }

  return converted;
}
