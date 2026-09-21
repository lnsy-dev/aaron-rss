/**
 * Refresh Render Scheduler Unit Tests
 *
 * Tests the coalescing behavior that bounds incremental re-renders while
 * a feed refresh is fetching: many schedule() calls inside one interval
 * must produce exactly one render, cancel() must drop a pending render,
 * and the render must not run before the interval elapses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRefreshRenderScheduler } from '../../src/lib/refresh-render-scheduler.js';

describe('refresh render scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render before the interval elapses', () => {
    const render = vi.fn();
    const scheduler = createRefreshRenderScheduler(render, 1000);

    scheduler.schedule();
    vi.advanceTimersByTime(999);

    expect(render).not.toHaveBeenCalled();
    expect(scheduler.isPending()).toBe(true);
  });

  it('renders once after the interval elapses', () => {
    const render = vi.fn();
    const scheduler = createRefreshRenderScheduler(render, 1000);

    scheduler.schedule();
    vi.advanceTimersByTime(1000);

    expect(render).toHaveBeenCalledTimes(1);
    expect(scheduler.isPending()).toBe(false);
  });

  it('coalesces a burst of schedules into a single render per interval', () => {
    const render = vi.fn();
    const scheduler = createRefreshRenderScheduler(render, 1000);

    // A burst of 8 feed completions inside the first interval…
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    vi.advanceTimersByTime(1000);

    // …must produce exactly one render.
    expect(render).toHaveBeenCalledTimes(1);

    // A second burst after the first render starts a new interval.
    scheduler.schedule();
    vi.advanceTimersByTime(1000);

    expect(render).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the pending render entirely', () => {
    const render = vi.fn();
    const scheduler = createRefreshRenderScheduler(render, 1000);

    scheduler.schedule();
    scheduler.cancel();
    vi.advanceTimersByTime(5000);

    expect(render).not.toHaveBeenCalled();
    expect(scheduler.isPending()).toBe(false);
  });

  it('a cancelled slot frees the scheduler to accept a new schedule', () => {
    const render = vi.fn();
    const scheduler = createRefreshRenderScheduler(render, 1000);

    scheduler.schedule();
    scheduler.cancel();
    scheduler.schedule();
    vi.advanceTimersByTime(1000);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('renders scheduled after a fired interval wait a full new interval', () => {
    const render = vi.fn();
    const scheduler = createRefreshRenderScheduler(render, 1000);

    scheduler.schedule();
    vi.advanceTimersByTime(1000);
    expect(render).toHaveBeenCalledTimes(1);

    // Half an interval after the render, a new schedule must not fire early.
    vi.advanceTimersByTime(500);
    scheduler.schedule();
    vi.advanceTimersByTime(999);
    expect(render).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
