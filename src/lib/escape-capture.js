/**
 * Escape-capture helpers for Distraction Free Mode.
 *
 * When an element is shown through the document Fullscreen API, the
 * browser reserves Escape for leaving full screen: the keydown never
 * reaches the page, so Escape cannot close the article viewer. The
 * Keyboard Lock API (navigator.keyboard.lock) hands Escape back to the
 * page while full screen is active. Electron windows do not reserve
 * Escape for window full screen (and its keyboard lock is unavailable),
 * so capture only matters on the web path — see
 * rss-feed-component._updateEscapeCapture().
 */

/**
 * Decide whether the page should capture Escape from the browser chrome.
 *
 * Capture is a Distraction Free Mode affordance: while reading without
 * app chrome, Escape must keep navigating backwards inside the app
 * (closing the article) instead of leaving full screen. Outside
 * Distraction Free Mode the browser default is left alone.
 *
 * @param {{distractionFree: boolean, fullScreen: boolean}} state
 * @returns {boolean} True when the page should capture Escape
 */
export function shouldCaptureEscape({ distractionFree, fullScreen }) {
  return Boolean(distractionFree && fullScreen);
}

/**
 * Bring the Keyboard Lock API in line with the desired capture state.
 *
 * Locks Escape when capture is wanted (only possible while full screen
 * is active), unlocks it otherwise. Environments without the API
 * (Electron, Firefox, Safari) degrade to "not capturing". Redundant
 * calls with an unchanged state are ignored so the method can run on
 * every toggle without churning locks.
 *
 * @param {Keyboard|undefined} keyboard - navigator.keyboard, when present
 * @param {boolean} capture - Whether Escape should be captured
 * @param {boolean} currentlyCaptured - Result of the previous sync
 * @returns {Promise<boolean>} True when Escape is captured afterwards
 */
export async function syncEscapeCapture(keyboard, capture, currentlyCaptured) {
  if (!keyboard || typeof keyboard.lock !== 'function') {
    return false;
  }
  if (capture === currentlyCaptured) {
    return currentlyCaptured;
  }
  if (!capture) {
    try {
      keyboard.unlock();
    } catch {
      // Unlocking can only fail on already-released state; either way
      // the page is not capturing Escape now.
    }
    return false;
  }
  try {
    await keyboard.lock(['Escape']);
    return true;
  } catch {
    // E.g. the document is not full screen (yet). Leave capture off;
    // the fullscreenchange listener re-syncs once it is.
    return false;
  }
}
