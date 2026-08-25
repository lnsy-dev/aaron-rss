#!/usr/bin/env node
/**
 * Convert Synthetic Social Feeds
 *
 * Command-line helper that launches the Aaron RSS Electron app, runs the
 * in-app migration to convert synthetic Bluesky/Mastodon profile feeds into
 * real RSS/Atom feeds, and then closes the app.
 *
 * Usage:
 *   node scripts/convert-synthetic-social-feeds.js
 *
 * Requires:
 *   - npm run build   (production bundle in dist/)
 *   - Playwright's Electron launcher (already a dev dependency)
 */

import { _electron as electron } from 'playwright-core';

(async () => {
  let app = null;

  try {
    app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'production' },
    });

    const window = await app.firstWindow();

    // Wait for the RSS component to appear and initialize.
    await window.waitForSelector('.rss-feed-component', { timeout: 30000 });
    // Give the database and initial feed load a moment to settle.
    await window.waitForTimeout(2000);

    const result = await window.evaluate(async () => {
      if (typeof window.convertSyntheticSocialFeeds !== 'function') {
        throw new Error(
          'window.convertSyntheticSocialFeeds is not available. ' +
            'Make sure the app build includes the migration helper.'
        );
      }
      return await window.convertSyntheticSocialFeeds();
    });

    if (result.length === 0) {
      console.log('No synthetic Bluesky/Mastodon feeds found.');
    } else {
      console.log(`Converted ${result.length} feed(s):`);
      for (const item of result) {
        console.log(`  [${item.platform}] ${item.name}`);
        console.log(`    ${item.oldUrl}`);
        console.log(`    -> ${item.newUrl}`);
      }
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (app) {
      await app.close();
    }
  }
})();
