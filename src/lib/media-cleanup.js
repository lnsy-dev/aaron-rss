/**
 * Media playback teardown helpers.
 *
 * Closing a viewer must stop its media deterministically: simply
 * removing the overlay from the DOM is not reliable on every platform,
 * because detached <video>/<audio> elements can keep playing (and hold
 * their decoder and buffers) until they are garbage collected — which
 * produced "the video keeps playing after I exit the view" and, on the
 * next open, two overlapping playbacks. Stopping the elements
 * explicitly makes the close behavior identical everywhere.
 */

/**
 * Stop one media element for good: pause it, drop its source and reset
 * the element so any decoder, buffer and network fetch it holds is
 * released.
 *
 * @param {HTMLMediaElement|null} media - The media element to stop
 * @returns {boolean} Whether the element was stopped
 */
export function stopMediaElement(media) {
  if (!media || typeof media.pause !== 'function') {
    return false;
  }

  try {
    media.pause();
  } catch (error) {
    console.error('Failed to pause media element:', error);
  }

  if (typeof media.removeAttribute === 'function') {
    media.removeAttribute('src');
  }
  try {
    media.load();
  } catch (error) {
    console.error('Failed to reset media element:', error);
  }
  return true;
}

/**
 * Stop every video and audio element under a root element.
 *
 * @param {Element|null} root - Element (typically a closing overlay)
 *   whose media descendants are stopped
 * @returns {number} How many media elements were stopped
 */
export function stopMediaPlayback(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return 0;
  }

  const media = root.querySelectorAll('video, audio');
  for (const element of media) {
    stopMediaElement(element);
  }
  return media.length;
}
