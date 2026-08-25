/**
 * Feed sorting utilities.
 *
 * Pure helpers for ordering feeds in the RSS feed component.
 */

/**
 * Sort feeds by unread article count (descending), then alphabetically by name.
 *
 * @param {Array<object>} feeds
 * @returns {Array<object>} New sorted array; original is not mutated.
 */
export function sortFeedsByUnreadCount(feeds) {
  return [...feeds].sort((a, b) => {
    const unreadA = a.articles.filter((article) => !article.read).length;
    const unreadB = b.articles.filter((article) => !article.read).length;
    if (unreadA !== unreadB) return unreadB - unreadA;
    return (a.name || 'Untitled Feed').localeCompare(b.name || 'Untitled Feed');
  });
}

/**
 * Return the timestamp a timeline item is sorted by.
 *
 * Publication date wins; arrival date is the fallback so feeds without
 * timestamps still interleave sensibly. Items with neither sort last.
 *
 * @param {object} article
 * @returns {number} Milliseconds since the Unix epoch
 */
function getTimelineSortTime(article) {
  const date = article.datePublished || article.dateArrived;
  const time = date ? new Date(date).getTime() : NaN;
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Flatten every feed's unread articles into one list ordered by
 * publication date, newest first.
 *
 * This powers the Timeline view, where items are mixed across feeds and
 * ordered purely by when they were posted rather than grouped by feed.
 * Each feed still contributes at most `maxPerFeed` articles, mirroring
 * the per-feed cap applied by the grouped feeds view.
 *
 * @param {Array<object>} feeds
 * @param {number} [maxPerFeed=Infinity] - Per-feed cap on contributions
 * @returns {Array<{feed: object, article: object}>} New sorted array of pairs; inputs are not mutated.
 */
export function buildTimelineItems(feeds, maxPerFeed = Infinity) {
  const items = [];

  for (const feed of feeds) {
    const articles = feed.articles.filter((article) => !article.read).slice(0, maxPerFeed);
    for (const article of articles) {
      items.push({ feed, article });
    }
  }

  return items.sort(
    (a, b) => getTimelineSortTime(b.article) - getTimelineSortTime(a.article)
  );
}
