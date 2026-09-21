/**
 * Refresh Render Scheduler
 *
 * Coalesces bursts of incremental feed-refresh updates into at most one
 * deferred render per interval. While a refresh is fetching, every feed
 * completion wants to re-render the list; honoring each one at animation-
 * frame frequency rebuilds the whole content area dozens of times per
 * second, which saturates the main thread and drops the user's button
 * clicks mid-press. This scheduler bounds that render work: one render
 * per interval keeps the list visibly current while the main thread stays
 * free for real interaction.
 */

/**
 * Create a scheduler that runs `render` at most once per interval.
 *
 * @param {Function} render - Called (without arguments) when the interval
 *   elapses after at least one schedule() call
 * @param {number} intervalMs - Minimum delay between renders
 * @returns {{schedule: Function, cancel: Function, isPending: Function}}
 */
export function createRefreshRenderScheduler(render, intervalMs) {
  /** @type {number|null} Pending setTimeout handle */
  let timer = null;

  return {
    /**
     * Request a render. Back-to-back calls inside one interval collapse
     * into the single render already scheduled for that interval's end.
     *
     * @returns {void}
     */
    schedule() {
      if (timer !== null) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        render();
      }, intervalMs);
    },

    /**
     * Drop a pending render, if any. Used when a direct render supersedes
     * the scheduled one.
     *
     * @returns {void}
     */
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },

    /**
     * Whether a render is currently scheduled.
     *
     * @returns {boolean}
     */
    isPending() {
      return timer !== null;
    },
  };
}
