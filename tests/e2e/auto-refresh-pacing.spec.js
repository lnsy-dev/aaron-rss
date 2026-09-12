/**
 * Auto-Refresh Pacing E2E Tests
 *
 * The auto-refresh interval is a PAUSE between completed fetches, not a
 * fixed heartbeat: a refresh that runs longer than the interval (long
 * feeds easily do) must never get a second fetch started at its heels.
 *
 * Regression being covered: refresh completion and the auto-refresh
 * finally both called _scheduleAutoRefresh, which overwrote the pending
 * timer handle without clearing the timer. Duplicate ticks then fired
 * mid-refresh, each toasting "Refresh already in progress" and stacking
 * yet another timer — an avalanche of toasts on an idle, unfocused app,
 * with fetches repeating back to back instead of pausing.
 *
 * The scheduling tests use Playwright's fake clock (installed after the
 * app boots) to fast-forward 5-minute intervals instantly; the pacing
 * test uses real timers with a short configured pause and a slowed
 * network to observe actual fetch spacing.
 */

import { test, expect } from '@playwright/test';

test.describe('auto-refresh pacing', () => {
  test.use({ bypassCSP: true });

  test.beforeEach(async ({ page }) => {
    await page.route(/https:\/\/[a-z0-9]+\.pacing\.example\.com\//, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Pacing</title><link>https://pacing.example.com/</link><description>test</description></channel></rss>',
      });
    });
    await page.goto('/');
  });

  test('a tick landing mid-refresh skips silently and keeps the loop alive', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    // Fake clock installed after boot: timers created from here on are
    // under test control; the boot-time real timer is replaced below by
    // _startAutoRefresh.
    await page.clock.install();
    await component.evaluate((el) => {
      el.settings.refreshInterval = 5; // 5-minute pause
      el._lastRefreshAt = Date.now();
      el.isRefreshing = true; // simulate a refresh that is still running
      window.__refreshCalls = 0;
      const original = el.handleRefreshAll.bind(el);
      el.handleRefreshAll = async () => {
        window.__refreshCalls += 1;
        await original();
      };
      el._startAutoRefresh();
    });

    // Fast-forward one interval: the tick lands mid-refresh. It must not
    // call handleRefreshAll (no toast, no overlapping fetch)…
    await page.clock.runFor(5 * 60 * 1000);
    await page.waitForTimeout(50);

    const midState = await component.evaluate((el) => ({
      calls: window.__refreshCalls,
      toastTexts: Array.from(document.querySelectorAll('.app-toast')).map((t) => t.textContent),
      // The skip must have armed the next tick (loop stays alive).
      timerArmed: el._refreshTimer !== null,
    }));
    expect(midState.calls).toBe(0);
    expect(
      midState.toastTexts.filter((t) => t.includes('Refresh already in progress'))
    ).toEqual([]);
    expect(midState.timerArmed).toBe(true);

    // …and once the refresh finishes, the loop resumes on the pause
    // schedule without any extra ticks having piled up.
    await component.evaluate((el) => {
      el.isRefreshing = false;
    });
    await page.clock.runFor(5 * 60 * 1000);
    await page.waitForTimeout(50);
    const endState = await component.evaluate((el) => ({
      calls: window.__refreshCalls,
      toastTexts: Array.from(document.querySelectorAll('.app-toast')).map((t) => t.textContent),
    }));
    expect(endState.calls).toBe(1);
    expect(
      endState.toastTexts.filter((t) => t.includes('Refresh already in progress'))
    ).toEqual([]);
  });

  test('overlapping scheduling calls leave exactly one pending timer', async ({ page }) => {
    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    await page.clock.install();
    await component.evaluate((el) => {
      el.settings.refreshInterval = 5;
      el._lastRefreshAt = Date.now();
      window.__refreshCalls = 0;
      const original = el.handleRefreshAll.bind(el);
      el.handleRefreshAll = async () => {
        window.__refreshCalls += 1;
        await original();
      };
      el._startAutoRefresh();
    });

    // Simulate the historical double-schedule (completion + finally) plus
    // a visibility handler arming again: each call must clear the
    // previous timer, never stack a second one.
    await component.evaluate((el) => {
      el._scheduleAutoRefresh();
      el._scheduleAutoRefresh();
      el._scheduleAutoRefresh();
    });

    // One full interval: exactly one tick fires.
    await page.clock.runFor(5 * 60 * 1000);
    await page.waitForTimeout(50);
    // A little extra time proves no second (stacked) timer was pending.
    await page.clock.runFor(60 * 1000);
    await page.waitForTimeout(50);

    const state = await component.evaluate((el) => ({
      calls: window.__refreshCalls,
      timerArmed: el._refreshTimer !== null,
    }));
    expect(state.calls).toBe(1);
    expect(state.timerArmed).toBe(true);
  });

  test('fetch rounds pause for the interval after each completed refresh', async ({ page }) => {
    test.setTimeout(60000);

    // Two feeds whose fetch takes 2.5s: with a 3s pause, each round is
    // (fetch + pause) ≈ 5.5s apart, and no round may start while the
    // previous is still running.
    const serveSlowFeed = async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Slow</title><link>https://slow.example.com/</link><description>test</description></channel></rss>',
      });
    };
    await page.route(/https:\/\/slow[12]\.example\.com\//, serveSlowFeed);

    const component = page.locator('rss-feed-component');
    await expect(component).toHaveJSProperty('initialized', true);

    await component.evaluate((el) => {
      el.addFeedInBackground('https://slow1.example.com/feed.xml');
      el.addFeedInBackground('https://slow2.example.com/feed.xml');
    });
    await expect
      .poll(async () => component.evaluate((el) => el.feeds.length), { timeout: 20000 })
      .toBe(2);

    // From here on, record every fetch the auto loop makes. (Seeding the
    // feeds also fetched them; the recorder is attached only now so those
    // discovery fetches stay out of the pacing assertions.)
    const roundStarts = [];
    await page.unroute(/https:\/\/slow[12]\.example\.com\//);
    await page.route(/https:\/\/slow[12]\.example\.com\//, async (route) => {
      roundStarts.push(Date.now());
      await serveSlowFeed(route);
    });

    // Configure a 3-second pause, make the next tick due immediately,
    // and let the auto loop run against real timers.
    await component.evaluate((el) => {
      el.settings.refreshInterval = 0.05; // 0.05 min = 3s
      el._lastRefreshAt = 0;
      el._startAutoRefresh();
    });

    // Long enough for three rounds: each round fetches the two feeds
    // sequentially (~2.5s each, the refresh worker is single-threaded),
    // then pauses 3s: 0–5s, 8–13s, 16–21s.
    await page.waitForTimeout(18000);

    const state = await component.evaluate((el) => ({
      toastTexts: Array.from(document.querySelectorAll('.app-toast')).map((t) => t.textContent),
      isRefreshing: el.isRefreshing,
    }));

    // No "Refresh already in progress" toast may appear, even though
    // several ticks landed while rounds were in flight.
    expect(
      state.toastTexts.filter((t) => t.includes('Refresh already in progress'))
    ).toEqual([]);

    // Fetch rounds must be spaced by at least the configured pause —
    // no back-to-back or overlapping rounds. Feeds are fetched in
    // order, so each round is exactly feeds.length sequential fetches;
    // the pause shows up at every round boundary.
    const roundSize = 2;
    const expectedRounds = 3;
    expect(roundStarts.length).toBeGreaterThanOrEqual(expectedRounds * roundSize);

    for (let i = roundSize; i < roundStarts.length; i += roundSize) {
      const gap = roundStarts[i] - roundStarts[i - 1];
      // Round duration is ~5s; the 3s pause must show up as a gap
      // clearly larger than a single fetch (no back-to-back fetch).
      expect(gap).toBeGreaterThanOrEqual(3000);
    }
  });
});
