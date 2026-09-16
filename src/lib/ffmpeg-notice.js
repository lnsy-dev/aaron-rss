/**
 * FFmpeg availability notice helpers.
 *
 * Shared between the Electron main process — which knows when a video
 * download ran without FFmpeg because the automatic static-build setup
 * failed — and the renderer, which shows the install dialog pointing at
 * the official download instructions.
 */

/** Official FFmpeg install instructions the dialog links to. */
export const FFMPEG_INSTALL_URL = 'https://ffmpeg.org/download.html';

/** Prefix used on download errors caused by a missing FFmpeg. */
export const FFMPEG_MISSING_HINT =
  'FFmpeg is not installed and could not be set up automatically';

/**
 * Annotate a video download result that ran without FFmpeg.
 *
 * The download itself may still have succeeded (yt-dlp falls back to
 * combined formats), but every such attempt means the machine has no
 * FFmpeg and the automatic provisioning failed — the renderer uses the
 * flag to show its install dialog, and failures additionally carry the
 * hint so the toast explains the real cause instead of a raw yt-dlp
 * format error.
 *
 * @param {{error?: string, [key: string]: unknown}} result - The download result.
 * @param {boolean} ffmpegUnavailable - True when the download ran without FFmpeg.
 * @returns {{error?: string, ffmpegMissing?: boolean, [key: string]: unknown}} The annotated result.
 */
export function annotateFFmpegMissing(result, ffmpegUnavailable) {
  if (!ffmpegUnavailable) {
    return result;
  }
  if (result.error) {
    return {
      ...result,
      error: `${FFMPEG_MISSING_HINT} — ${result.error}`,
      ffmpegMissing: true,
    };
  }
  return { ...result, ffmpegMissing: true };
}
