import { describe, it, expect } from 'vitest';
import {
  WINDOWED_RENDER_DEFAULTS,
  MAX_CHUNKS_PER_TICK,
  ESTIMATED_ITEM_HEIGHT_PX,
  rollingAverage,
  appendCount,
  prependCount,
  trimStartCount,
  trimEndCount,
  findItemIndex,
  buildGroupedRenderPlan,
  groupedFeedExtensionCount,
} from '../../src/lib/windowed-list.js';

describe('rollingAverage', () => {
  it('adopts the sample when there is no previous average', () => {
    expect(rollingAverage(0, 120)).toBe(120);
    expect(rollingAverage(-5, 120)).toBe(120);
    expect(rollingAverage(Number.NaN, 120)).toBe(120);
  });

  it('ignores non-positive samples', () => {
    expect(rollingAverage(100, 0)).toBe(100);
    expect(rollingAverage(100, Number.NaN)).toBe(100);
  });

  it('blends the sample at the given weight', () => {
    expect(rollingAverage(100, 200, 0.25)).toBeCloseTo(125);
    expect(rollingAverage(100, 200, 1)).toBe(200);
  });
});

describe('appendCount', () => {
  it('returns 0 once the window covers every item', () => {
    expect(appendCount({ end: 10, total: 10 }, 5)).toBe(0);
    expect(appendCount({ end: 12, total: 10 }, 5)).toBe(0);
  });

  it('returns a full chunk while items remain', () => {
    expect(appendCount({ end: 0, total: 100 }, 60)).toBe(60);
  });

  it('clamps the final chunk to the remaining items', () => {
    expect(appendCount({ end: 90, total: 100 }, 60)).toBe(10);
  });
});

describe('prependCount', () => {
  it('returns 0 when the window already starts at 0', () => {
    expect(prependCount({ start: 0 }, 60)).toBe(0);
  });

  it('returns a full chunk when room remains above', () => {
    expect(prependCount({ start: 120 }, 60)).toBe(60);
  });

  it('clamps to the items available above the window', () => {
    expect(prependCount({ start: 10 }, 60)).toBe(10);
  });
});

describe('trimStartCount', () => {
  const rects = (offset, heights) =>
    heights.reduce((acc, h) => {
      const top = acc.length === 0 ? offset : acc[acc.length - 1].bottom;
      acc.push({ top, bottom: top + h });
      return acc;
    }, []);

  it('never trims below the keep-rendered floor', () => {
    // Ten rows of 50px far above the viewport; keep 8.
    expect(
      trimStartCount(rects(-1000, Array(10).fill(50)), 8, 500)
    ).toBe(2);
  });

  it('only trims rows that end well above the viewport', () => {
    // 60 rows of 10px starting at -600: rows end above -500 one by one,
    // stopping at the row whose bottom is exactly at the trim line.
    expect(
      trimStartCount(rects(-600, Array(60).fill(10)), 40, 500)
    ).toBe(9);
  });

  it('returns 0 when everything is near or inside the viewport', () => {
    expect(trimStartCount(rects(0, [100, 100, 100]), 0, 500)).toBe(0);
  });
});

describe('trimEndCount', () => {
  const rects = (offset, heights) =>
    heights.reduce((acc, h) => {
      const top = acc.length === 0 ? offset : acc[acc.length - 1].bottom;
      acc.push({ top, bottom: top + h });
      return acc;
    }, []);

  it('never trims below the keep-rendered floor', () => {
    // Ten rows of 50px well below the viewport; keep 8.
    expect(trimEndCount(rects(200, Array(10).fill(50)), 8, 500)).toBe(2);
  });

  it('only trims rows that start well below the viewport', () => {
    // 60 rows of 10px: trailing rows start above +500 until the row
    // whose top is exactly at the trim line.
    expect(trimEndCount(rects(0, Array(60).fill(10)), 40, 500)).toBe(9);
  });

  it('returns 0 when nothing sits below the viewport', () => {
    expect(trimEndCount(rects(0, [100, 100]), 0, 500)).toBe(0);
  });
});

describe('findItemIndex', () => {
  it('locates an item by feed and article id', () => {
    const items = [
      { feed: { feedID: 'f1' }, article: { articleID: 'a1' } },
      { feed: { feedID: 'f2' }, article: { articleID: 'a2' } },
    ];
    expect(findItemIndex(items, 'f2', 'a2')).toBe(1);
    expect(findItemIndex(items, 'f2', 'a1')).toBe(-1);
    expect(findItemIndex(items, 'missing', 'a1')).toBe(-1);
  });
});

describe('buildGroupedRenderPlan', () => {
  const feeds = (counts) =>
    counts.map((articleCount, i) => ({ feedID: `f${i + 1}`, articleCount }));

  it('distributes the budget in display order and defers the rest', () => {
    const plan = buildGroupedRenderPlan({
      feeds: feeds([25, 25, 25, 25]),
      budget: 60,
      perFeedChunk: 25,
    });
    expect(plan.renderCounts.get('f1')).toBe(25);
    expect(plan.renderCounts.get('f2')).toBe(25);
    // The budget ran out mid-feed: f3 gets the remainder.
    expect(plan.renderCounts.get('f3')).toBe(10);
    expect(plan.renderCounts.has('f4')).toBe(false);
    expect(plan.deferredFeedIDs.has('f4')).toBe(true);
    expect(plan.deferredFeedIDs.has('f3')).toBe(false);
  });

  it('gives previously rendered, still-open feeds first claim on the budget', () => {
    const plan = buildGroupedRenderPlan({
      feeds: feeds([25, 25, 25]),
      budget: 30,
      perFeedChunk: 25,
      openState: new Map([['f3', true]]),
      previouslyRendered: new Set(['f3']),
    });
    expect(plan.renderCounts.get('f3')).toBe(25);
    expect(plan.renderCounts.get('f1')).toBe(5);
    expect(plan.renderCounts.has('f2')).toBe(false);
  });

  it('does not prioritize previously rendered feeds the user closed', () => {
    const plan = buildGroupedRenderPlan({
      feeds: feeds([25, 25, 25]),
      budget: 30,
      perFeedChunk: 25,
      openState: new Map([['f3', false]]),
      previouslyRendered: new Set(['f3']),
    });
    expect(plan.renderCounts.has('f3')).toBe(false);
    expect(plan.deferredFeedIDs.has('f3')).toBe(true);
    expect(plan.renderCounts.get('f1')).toBe(25);
    expect(plan.renderCounts.get('f2')).toBe(5);
  });

  it('ignores feeds without unread articles entirely', () => {
    const plan = buildGroupedRenderPlan({
      feeds: feeds([0, 25, 0, 25]),
      budget: 30,
      perFeedChunk: 25,
    });
    expect(plan.renderCounts.get('f2')).toBe(25);
    expect(plan.renderCounts.get('f4')).toBe(5);
    expect(plan.deferredFeedIDs.size).toBe(0);
  });

  it('renders everything when the budget covers all feeds', () => {
    const plan = buildGroupedRenderPlan({
      feeds: feeds([10, 20]),
      budget: 300,
      perFeedChunk: 25,
    });
    expect(plan.renderCounts.get('f1')).toBe(10);
    expect(plan.renderCounts.get('f2')).toBe(20);
    expect(plan.deferredFeedIDs.size).toBe(0);
  });
});

describe('groupedFeedExtensionCount', () => {
  it('returns 0 for fully rendered feeds', () => {
    expect(groupedFeedExtensionCount({ renderedCount: 50, availableCount: 50 }, 25)).toBe(0);
  });

  it('returns a chunk while rows remain', () => {
    expect(groupedFeedExtensionCount({ renderedCount: 25, availableCount: 50 }, 25)).toBe(25);
  });

  it('clamps the final chunk', () => {
    expect(groupedFeedExtensionCount({ renderedCount: 40, availableCount: 50 }, 25)).toBe(10);
  });
});

describe('module constants', () => {
  it('exposes the tuning defaults used by the component', () => {
    expect(WINDOWED_RENDER_DEFAULTS.flatInitialCount).toBeGreaterThan(0);
    expect(WINDOWED_RENDER_DEFAULTS.flatChunkCount).toBeGreaterThan(0);
    expect(WINDOWED_RENDER_DEFAULTS.flatKeepRendered).toBeGreaterThanOrEqual(
      WINDOWED_RENDER_DEFAULTS.flatInitialCount
    );
    expect(WINDOWED_RENDER_DEFAULTS.groupedArticleBudget).toBeGreaterThan(0);
    expect(WINDOWED_RENDER_DEFAULTS.groupedPerFeedChunk).toBeGreaterThan(0);
    expect(MAX_CHUNKS_PER_TICK).toBeGreaterThan(0);
    expect(ESTIMATED_ITEM_HEIGHT_PX).toBeGreaterThan(0);
  });
});
