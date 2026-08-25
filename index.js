/**
 * Main Entry Point
 *
 * This is the primary JavaScript entry point for the webpack build.
 * It imports the global CSS and all custom element modules.
 *
 * Webpack follows this dependency graph to bundle everything into
 * a single output file (plus worker/wasm chunks).
 *
 * For LLMs: When adding a new component:
 *   1. Create the component file in src/
 *   2. Add an import statement below
 *   3. If the component needs styles, create a CSS file in styles/
 *   4. Import the CSS in index.css (not here — keep JS and CSS separate)
 */

// Global styles: imported first so they are available before components render
import './index.css';

// ============================================================================
// Command palette
// ============================================================================

// Import the source module so webpack processes its CSS import and extracts
// it in production (the prebuilt dist uses style-loader which violates CSP).
import './src/lib/command-panel-patch.js';
import '@lnsy/command-panel/src/command-panel.js';

// ============================================================================
// RSS Reader Application
// ============================================================================

import './src/rss-feed-component.js';
import { convertSyntheticSocialFeeds } from './src/lib/migrate-social-feeds.js';

/**
 * Expose a one-time migration helper for converting synthetic Bluesky/Mastodon
 * feeds into real RSS/Atom feeds. This is used by scripts/convert-synthetic-social-feeds.js
 * and can also be run manually from the DevTools console:
 *
 *   await window.convertSyntheticSocialFeeds()
 */
window.convertSyntheticSocialFeeds = convertSyntheticSocialFeeds;

console.log('Aaron RSS application initialized');
