/**
 * Cloudflare Challenge Bypass
 *
 * Sites behind Cloudflare's managed challenge answer plain HTTP clients
 * (undici via Node fetch, curl) with a "Just a moment..." interstitial
 * even when the URL is a perfectly valid feed. A real Chromium window
 * clears the challenge — often automatically in the background — and the
 * resulting `cf_clearance` cookie (persisted in the session) lets
 * subsequent `net.fetch` calls with `useSessionCookies` and
 * `credentials: 'include'` succeed (verified against counterpunch.org,
 * which 403-challenges both Node fetch and Playwright's request API).
 *
 * Flow implemented here:
 *   1. Probe the URL with a session-cookie fetch; if it is not
 *      challenged, there is nothing to do.
 *   2. Load the URL in a small hidden window on the same session so the
 *      challenge can auto-solve; poll until the interstitial is gone.
 *      Because the post-solve reload takes a moment to land the
 *      clearance cookie, the result is verified with real fetches before
 *      declaring success.
 *   3. When the site demands an interactive solve, show the window so
 *      the user can click through once — but only when the caller asked
 *      for an interactive solve (the user-facing "Try Again" path).
 *      Automatic callers (feed refreshes) never pop a window to the
 *      front: all their attempts stay hidden, and a stubborn challenge
 *      simply fails quietly. Clearance cookies persist in the session,
 *      so every later request to the site benefits.
 */

import { BrowserWindow, net } from 'electron';
import { isCloudflareChallenge } from './challenge-detect.js';

// The interstitial's document title on challenge pages.
const CHALLENGE_TITLE = 'just a moment';

// Solve budgets and poll cadence. Overridable in tests via
// configureChallengeSolveTimeouts(); the defaults cover real sites,
// where hidden auto-solves typically finish within a few seconds.
const solveTiming = {
  hiddenMs: 20000,
  visibleMs: 120000,
  pollMs: 1500,
  // Post-solve settle budget: how long to keep re-probing with real
  // fetches after the interstitial disappears, waiting for the
  // clearance cookie to become effective.
  settleMs: 15000,
  settlePollMs: 2000,
  // How many window attempts to make (1 hidden + retries).
  attempts: 3,
};

/**
 * Override the challenge-solving budgets (used by unit tests).
 *
 * @param {{hiddenMs?: number, visibleMs?: number, pollMs?: number, settleMs?: number, settlePollMs?: number, attempts?: number}} timing
 *   Replacement durations in milliseconds; omitted fields keep values.
 * @returns {void}
 */
export function configureChallengeSolveTimeouts(timing = {}) {
  if (typeof timing.hiddenMs === 'number') solveTiming.hiddenMs = timing.hiddenMs;
  if (typeof timing.visibleMs === 'number') solveTiming.visibleMs = timing.visibleMs;
  if (typeof timing.pollMs === 'number') solveTiming.pollMs = timing.pollMs;
  if (typeof timing.settleMs === 'number') solveTiming.settleMs = timing.settleMs;
  if (typeof timing.settlePollMs === 'number') solveTiming.settlePollMs = timing.settlePollMs;
  if (typeof timing.attempts === 'number') solveTiming.attempts = timing.attempts;
}

/**
 * Probe a URL through the Chromium stack with session cookies and
 * report whether the response is a Cloudflare challenge.
 *
 * Transport errors count as "challenged" so callers keep retrying;
 * they will surface the real error on their own next request.
 *
 * @param {string} url - The URL to probe.
 * @returns {Promise<boolean>} True when the response is a challenge.
 */
async function probeIsChallenged(url) {
  try {
    const response = await net.fetch(url, {
      useSessionCookies: true,
      credentials: 'include',
    });
    const text = await response.text();
    return isCloudflareChallenge({
      status: response.status,
      text,
      contentType: response.headers.get('content-type'),
    });
  } catch {
    return true;
  }
}

/**
 * Poll a window until the Cloudflare challenge page is gone.
 *
 * The interstitial's title is "Just a moment..."; it disappears both
 * when the protected document loads and while the post-solve reload is
 * in flight (blank title), so the caller must verify with real fetches
 * afterwards (see settleUntilClear).
 *
 * @param {BrowserWindow} win - The window navigating the challenge.
 * @param {number} timeoutMs - Give up (resolve null) after this long.
 * @returns {Promise<string|null>} Cleared page title, or null on timeout.
 */
async function waitForChallengeTitleClear(win, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (win.isDestroyed()) {
      return null;
    }
    const title = await win.webContents
      .executeJavaScript('document.title')
      .catch(() => 'Just a moment...');
    if (!title.toLowerCase().includes(CHALLENGE_TITLE)) {
      return title;
    }
    await new Promise((resolve) => setTimeout(resolve, solveTiming.pollMs));
  }
  return null;
}

/**
 * Wait until a session-cookie fetch to the URL stops being challenged.
 *
 * The clearance cookie set by a solved challenge becomes effective once
 * the post-solve navigation lands, which can trail the visible page
 * change by a few seconds; this keeps probing until then.
 *
 * @param {string} url - The URL to probe.
 * @returns {Promise<boolean>} True when the probe is no longer challenged.
 */
async function settleUntilClear(url) {
  const start = Date.now();
  while (Date.now() - start < solveTiming.settleMs) {
    if (!(await probeIsChallenged(url))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, solveTiming.settlePollMs));
  }
  return !(await probeIsChallenged(url));
}

/**
 * Clear a Cloudflare challenge for a URL by visiting it in a window.
 *
 * Tries a hidden window first; if the challenge does not auto-solve and
 * `interactive` is set, shows the window and waits for the user to
 * complete it. Automatic callers (feed refreshes) keep every attempt
 * hidden — an unsolved challenge just returns false, instead of
 * popping a website window to the front mid-refresh. Every success is
 * verified with a real session-cookie fetch before returning, so a
 * `true` result guarantees the caller's next request gets the content.
 *
 * Concurrent solves for the same origin share one job, so refreshing
 * many Cloudflare-protected feeds never opens a storm of windows; the
 * first caller's `interactive` choice wins for the shared job.
 *
 * @param {string} url - The URL whose origin is challenged.
 * @param {{interactive?: boolean}} [options]
 *   `interactive: true` allows visible windows on retry attempts (for
 *   user-initiated solves); the default keeps every window hidden.
 * @returns {Promise<boolean>} True when clearance was verified.
 */
const inFlightSolves = new Map();

export function resolveCloudflareChallenge(url, { interactive = false } = {}) {
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    // Keep the raw URL as the dedupe key for unparsable input.
  }

  if (inFlightSolves.has(origin)) {
    return inFlightSolves.get(origin);
  }

  const job = resolveCloudflareChallengeUncached(url, interactive).finally(() => {
    inFlightSolves.delete(origin);
  });
  inFlightSolves.set(origin, job);
  return job;
}

/**
 * Clear the in-flight solve table (test isolation helper).
 *
 * @returns {void}
 */
export function __resetInFlightSolvesForTests() {
  inFlightSolves.clear();
}

/**
 * Uncached single-flight body of resolveCloudflareChallenge.
 *
 * @param {string} url - The URL whose origin is challenged.
 * @param {boolean} interactive - Whether retry attempts may show the
 *   window for a manual solve (user-initiated calls only).
 * @returns {Promise<boolean>} True when clearance was verified.
 */
async function resolveCloudflareChallengeUncached(url, interactive) {
  if (!(await probeIsChallenged(url))) {
    return true;
  }

  for (let attempt = 0; attempt < Math.max(1, solveTiming.attempts); attempt++) {
    let win = null;
    try {
      // Hidden first, so a window that auto-solves (the common case)
      // never flickers. Retries surface the window only for interactive
      // solves; automatic callers (feed refreshes) stay invisible —
      // their failures must not throw a website window at the user.
      win = new BrowserWindow({
        width: 520,
        height: 640,
        show: interactive && attempt > 0,
        // The default (main) session holds the cookies the fetch bridge
        // uses, so the clearance must land there.
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      await win.loadURL(url).catch(() => {});

      const titleCleared = await waitForChallengeTitleClear(
        win,
        interactive && attempt > 0 ? solveTiming.visibleMs : solveTiming.hiddenMs
      );
      if (titleCleared === null) {
        // Budget exhausted for this attempt; destroy and retry (visible
        // only when the caller asked for an interactive solve).
        continue;
      }

      if (await settleUntilClear(url)) {
        return true;
      }
      // The interstitial disappeared but the probe is still challenged
      // (e.g. the blank mid-reload moment) — loop and try again.
    } catch {
      // Window creation or navigation failed; retry on the next attempt.
    } finally {
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
    }
  }

  return false;
}
