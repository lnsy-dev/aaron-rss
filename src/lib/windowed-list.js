/**
 * Windowed feed rendering.
 *
 * The feed views only render a bounded number of article rows at a time
 * and grow or shrink that window as the user scrolls, so a feed with a
 * very large number of items stays responsive. This module holds the
 * pure decision logic (window sizes, extension/trim counts, and the
 * grouped-view budget plan); the DOM manipulation lives in
 * src/rss-feed-component.js.
 */

/** Tuning knobs for the windowed renderers. */
export const WINDOWED_RENDER_DEFAULTS = Object.freeze({
  /** Flat views (timeline, topic): items rendered when the view first paints. */
  flatInitialCount: 120,
  /** Flat views: items added to (or dropped from) the window per step. */
  flatChunkCount: 60,
  /** Flat views: never trim the window below this many rendered items. */
  flatKeepRendered: 240,
  /** Start extending when the end of the rendered content is this close to the viewport (px). */
  edgeDistancePx: 1600,
  /** Trim a run of rows only once it sits this many viewports past a screen edge. */
  trimViewportFactor: 2,
  /** Grouped feeds view: total articles rendered across feeds up front. */
  groupedArticleBudget: 300,
  /** Grouped feeds view: articles rendered per feed per step. */
  groupedPerFeedChunk: 25,
});

/**
 * At most this many chunks are appended per scroll tick so a burst of
 * scroll events can never wedge the main thread in render work.
 */
export const MAX_CHUNKS_PER_TICK = 4;

/**
 * Estimated height (px) of a rendered article row. Used to size the
 * placeholder spacers for items that are not in the DOM yet; the real
 * measurements replace the estimate as rows are rendered.
 */
export const ESTIMATED_ITEM_HEIGHT_PX = 96;

/**
 * Blend a fresh height measurement into the running average.
 *
 * @param {number} previous - Current average height in px.
 * @param {number} sample - Newly measured height in px.
 * @param {number} [alpha] - Weight of the new sample (0..1).
 * @returns {number} Updated average height in px.
 */
export function rollingAverage(previous, sample, alpha = 0.25) {
  if (!Number.isFinite(previous) || previous <= 0) {
    return sample;
  }
  if (!Number.isFinite(sample) || sample <= 0) {
    return previous;
  }
  return previous * (1 - alpha) + sample * alpha;
}

/**
 * How many items may be appended at the end of the window this step.
 *
 * @param {object} state
 * @param {number} state.end - One past the last rendered index.
 * @param {number} state.total - Total item count.
 * @param {number} chunkCount - Items per chunk.
 * @returns {number} Items to append (0 when the window already covers everything).
 */
export function appendCount({ end, total }, chunkCount) {
  if (end >= total) {
    return 0;
  }
  return Math.min(chunkCount, total - end);
}

/**
 * How many items may be prepended before the start of the window.
 *
 * @param {object} state
 * @param {number} state.start - First rendered index.
 * @param {number} chunkCount - Items per chunk.
 * @returns {number} Items to prepend (0 when the window starts at 0).
 */
export function prependCount({ start }, chunkCount) {
  if (start <= 0) {
    return 0;
  }
  return Math.min(chunkCount, start);
}

/**
 * How many leading rendered items may be removed.
 *
 * A run of rows is only trimmed once its last row sits a full
 * `trimDistancePx` above the viewport top, and the window is never
 * trimmed below `keepRendered` items.
 *
 * @param {Array<{top: number, bottom: number}>} rects - Viewport-relative rects of rendered wrappers, in order.
 * @param {number} keepRendered - Minimum window size.
 * @param {number} trimDistancePx - Rows must end this far above the viewport to be trimmed.
 * @returns {number} Number of leading items to remove (0 = none).
 */
export function trimStartCount(rects, keepRendered, trimDistancePx) {
  let count = 0;
  while (
    rects.length - count > keepRendered &&
    rects[count].bottom < -trimDistancePx
  ) {
    count += 1;
  }
  return count;
}

/**
 * How many trailing rendered items may be removed.
 *
 * Mirrors trimStartCount for the bottom edge: rows are trimmed once they
 * sit `trimDistancePx` below the viewport bottom.
 *
 * @param {Array<{top: number, bottom: number}>} rects - Viewport-relative rects of rendered wrappers, in order.
 * @param {number} keepRendered - Minimum window size.
 * @param {number} trimDistancePx - Rows must start this far below the viewport to be trimmed.
 * @returns {number} Number of trailing items to remove (0 = none).
 */
export function trimEndCount(rects, keepRendered, trimDistancePx) {
  let count = 0;
  while (
    rects.length - count > keepRendered &&
    rects[rects.length - 1 - count].top > trimDistancePx
  ) {
    count += 1;
  }
  return count;
}

/**
 * Index of an item in the flat item list, matched by feed and article id.
 *
 * @param {Array<{feed: object, article: object}>} items - Flat item list.
 * @param {string} feedID
 * @param {string} articleID
 * @returns {number} Item index, or -1 when absent.
 */
export function findItemIndex(items, feedID, articleID) {
  return items.findIndex(
    (item) =>
      item.feed?.feedID === feedID && item.article?.articleID === articleID
  );
}

/**
 * Plan which grouped feeds view articles render up front.
 *
 * Feeds are processed in display order and each consumes the shared
 * article budget until it runs out; later feeds with unread articles
 * stay deferred (their rows render on demand when the user opens them
 * or scrolls them into range). Feeds that were already rendered and are
 * still open get first claim on the budget so a re-render (for example
 * after marking an article read) never collapses a feed the user is
 * reading.
 *
 * @param {object} plan
 * @param {Array<{feedID: string, articleCount: number}>} plan.feeds - Feeds in display order with their (capped) unread counts.
 * @param {number} plan.budget - Total articles to render up front.
 * @param {number} plan.perFeedChunk - Articles rendered per feed per step.
 * @param {Map<string, boolean>} [plan.openState] - Details open/closed state carried over from the previous render.
 * @param {Set<string>} [plan.previouslyRendered] - Feeds that had rendered rows in the previous render.
 * @returns {{renderCounts: Map<string, number>, renderedFeedIDs: Set<string>, deferredFeedIDs: Set<string>}}
 */
export function buildGroupedRenderPlan({
  feeds,
  budget,
  perFeedChunk,
  openState = new Map(),
  previouslyRendered = new Set(),
}) {
  const renderCounts = new Map();
  let remaining = Math.max(0, budget);

  const allocate = (feed) => {
    if (remaining <= 0 || feed.articleCount <= 0) {
      return;
    }
    const count = Math.min(perFeedChunk, feed.articleCount, remaining);
    if (count > 0) {
      renderCounts.set(feed.feedID, count);
      remaining -= count;
    }
  };

  // Pass 1: feeds the user is already reading keep their rows.
  for (const feed of feeds) {
    if (
      previouslyRendered.has(feed.feedID) &&
      openState.get(feed.feedID) !== false
    ) {
      allocate(feed);
    }
  }

  // Pass 2: everyone else in display order.
  for (const feed of feeds) {
    if (!renderCounts.has(feed.feedID)) {
      allocate(feed);
    }
  }

  const renderedFeedIDs = new Set(renderCounts.keys());
  const deferredFeedIDs = new Set(
    feeds
      .filter((feed) => feed.articleCount > 0 && !renderedFeedIDs.has(feed.feedID))
      .map((feed) => feed.feedID)
  );

  return { renderCounts, renderedFeedIDs, deferredFeedIDs };
}

/**
 * How many more rows a feed in the grouped view should render.
 *
 * @param {object} state
 * @param {number} state.renderedCount - Rows the feed already shows.
 * @param {number} state.availableCount - Rows the feed may show in total (unread, capped).
 * @param {number} chunkCount - Rows per step.
 * @returns {number} Rows to add (0 when the feed is fully rendered).
 */
export function groupedFeedExtensionCount(
  { renderedCount, availableCount },
  chunkCount
) {
  if (renderedCount >= availableCount) {
    return 0;
  }
  return Math.min(chunkCount, availableCount - renderedCount);
}
