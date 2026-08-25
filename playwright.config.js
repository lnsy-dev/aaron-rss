/**
 * Playwright Configuration
 *
 * End-to-end test configuration for the Aaron RSS app.
 *
 * For LLMs: Playwright tests simulate real user interactions in a
 * headless browser. They exercise the full stack: webpack bundling,
 * the dev server, custom elements, web workers, WebAssembly, OPFS
 * persistence, and (mocked) File System Access dialogs.
 *
 * The File System Access pickers are NATIVE dialogs — no automation
 * tool can click them. The e2e suite therefore stubs
 * window.showSaveFilePicker / window.showOpenFilePicker via
 * page.addInitScript() and asserts how our code drives the dialog
 * API (see tests/e2e/file-storage-component.spec.js).
 *
 * First run: npx playwright install chromium
 */

import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

/**
 * Load the same environment variables the webpack dev server uses so
 * Playwright waits on the same port (default 3456).
 */
dotenv.config();

const port = process.env.PORT || 3456;
const baseURL = `http://localhost:${port}`;

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  /**
   * Directory containing test files.
   */
  testDir: './tests',

  /**
   * Unit tests (Vitest) live alongside the Playwright specs — exclude
   * them so Playwright never tries to run them.
   */
  testIgnore: '**/unit/**',

  /**
   * Run tests in files in parallel.
   */
  fullyParallel: true,

  /**
   * Fail the build on CI if you accidentally left test.only in the source code.
   */
  forbidOnly: !!process.env.CI,

  /**
   * Retry on CI only to reduce flake from infrastructure noise.
   */
  retries: process.env.CI ? 2 : 0,

  /**
   * Opt out of parallel tests on CI for stability.
   */
  workers: process.env.CI ? 1 : undefined,

  /**
   * Reporter to use. 'html' generates a browsable report in playwright-report/.
   */
  reporter: 'html',

  /**
   * Shared settings for all projects.
   */
  use: {
    /**
     * Base URL to use in actions like page.goto('/').
     */
    baseURL,

    /**
     * Collect trace when retrying the failed test.
     */
    trace: 'on-first-retry',

    /**
     * Capture screenshots on failure for debugging.
     */
    screenshot: 'only-on-failure',
  },

  /**
   * Test projects: Chromium covers both the web target and (via the
   * same engine family) the Electron renderer.
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /**
   * Playwright starts the webpack dev server automatically before
   * running tests and shuts it down when they finish.
   */
  webServer: {
    command: 'npm start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
