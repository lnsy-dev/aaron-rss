/**
 * YouTube Download Backend
 *
 * Runs in the Electron main process. Uses yt-dlp-wrap-plus to download
 * YouTube videos to the user's Downloads/Aaron-RSS-YouTube folder and to
 * delete downloaded files on request.
 *
 * Live streams and gaming.youtube.com URLs are always skipped.
 */

import { app } from 'electron';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import fsConstants from 'node:fs';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { isYouTubeStream } from '../src/lib/youtube.js';
import YTDlpWrapImport from 'yt-dlp-wrap-plus';

/**
 * yt-dlp-wrap-plus is a CommonJS module whose default export is wrapped
 * one level deep ({ default: YTDlpWrap }) in Node ESM imports. Unwrap it
 * so both static helpers (downloadFromGithub, getGithubReleases) and the
 * constructor are available regardless of how the loader presents the
 * module.
 */
const YTDlpWrap = YTDlpWrapImport?.default ?? YTDlpWrapImport;

/** Callback-style execFile wrapped for async/await use. */
const execFile = promisify(execFileCallback);

/** Subdirectory inside the user's Downloads folder where videos are saved. */
const DOWNLOAD_DIR_NAME = 'Aaron-RSS-YouTube';

/** Name of the yt-dlp binary inside the app's user data directory. */
const YTDLP_BINARY_NAME = 'yt-dlp';

/** Name of the JSON file that tracks the last update check. */
const UPDATE_STATE_FILE_NAME = 'yt-dlp-update-state.json';

/** How often to check for yt-dlp updates (24 hours). */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Fallback install locations for JavaScript runtimes yt-dlp can use.
 *
 * Packaged Electron apps do not inherit the user's shell PATH, so
 * common Homebrew/system prefixes are probed explicitly in addition to
 * whatever PATH the process received.
 */
const JS_RUNTIME_FALLBACK_PATHS = {
  quickjs: ['/opt/homebrew/bin/qjs', '/usr/local/bin/qjs', '/usr/bin/qjs'],
  deno: ['/opt/homebrew/bin/deno', '/usr/local/bin/deno'],
  node: ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'],
};

/** Name of a qjs binary bundled via electron-builder extraResources. */
const BUNDLED_QJS_NAME = `qjs${process.platform === 'win32' ? '.exe' : ''}`;

/** Common install locations for ffmpeg outside PATH (GUI apps get a minimal PATH). */
const FFMPEG_FALLBACK_PATHS = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
];

/**
 * Format selector used when ffmpeg is available.
 *
 * Modern YouTube videos rarely offer a combined video+audio stream, so
 * merging is normally required. Prefers H.264 (avc1) video with AAC
 * audio in mp4 containers because those are the codecs QuickTime,
 * Finder preview, and most macOS apps can actually decode; YouTube's
 * default "best" streams are often AV1 or VP9, which produce files
 * that download fine but will not play on a Mac. Falls back to any
 * mergeable pair and finally to whatever single combined format exists.
 */
const MERGE_FORMAT_SELECTOR = 'bv*[vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a][ext=m4a]/b[ext=mp4]/bv*+ba/b';

/** Legacy selector for environments without ffmpeg (combined formats only). */
const SINGLE_FILE_FORMAT_SELECTOR = 'best[ext=mp4]/best';

/** GitHub repos that publish static builds we can fall back to. */
const DENO_REPO = 'denoland/deno';
const QUICKJS_NG_REPO = 'quickjs-ng/quickjs';
const FFMPEG_STATIC_REPO = 'eugeneware/ffmpeg-static';

/** Directory inside userData where auto-downloaded binaries are kept. */
const PROVISION_DIR_NAME = 'provisioned-binaries';

/** Hard limit for binary/archive downloads and GitHub API calls. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** Cached result of the JS runtime probe (null until first lookup). */
let jsRuntimeArgsCache = null;

/** Set after a runtime download attempt fails, to avoid retrying every call. */
let runtimeProvisionFailed = false;

/** @type {YTDlpWrap|null} */
let ytDlpInstance = null;

/** @type {Promise<YTDlpWrap>|null} */
let binaryReadyPromise = null;

/**
 * Return the directory where downloaded videos are stored.
 *
 * @returns {string}
 */
export function getDownloadDirectory() {
  return path.join(app.getPath('downloads'), DOWNLOAD_DIR_NAME);
}

/**
 * Ensure the download directory exists, creating it if necessary.
 *
 * @returns {Promise<void>}
 */
async function ensureDownloadDirectory() {
  await fs.mkdir(getDownloadDirectory(), { recursive: true });
}

/**
 * Return the full path to the yt-dlp binary.
 *
 * @returns {string}
 */
function getBinaryPath() {
  return path.join(app.getPath('userData'), YTDLP_BINARY_NAME);
}

/**
 * Return the full path to the update-state JSON file.
 *
 * @returns {string}
 */
function getUpdateStatePath() {
  return path.join(app.getPath('userData'), UPDATE_STATE_FILE_NAME);
}

/**
 * Return the directory where auto-downloaded static binaries are kept.
 *
 * @returns {string}
 */
function getProvisionDirectory() {
  return path.join(app.getPath('userData'), PROVISION_DIR_NAME);
}

/**
 * Parse a yt-dlp version string into a comparable array of numbers.
 *
 * yt-dlp versions are release dates such as "2023.07.06". The function
 * strips any non-numeric prefix and splits on dots.
 *
 * @param {string} version
 * @returns {Array<number>}
 */
function parseVersion(version) {
  const cleaned = String(version).replace(/^[^0-9]*/, '');
  return cleaned.split('.').map((part) => parseInt(part, 10) || 0);
}

/**
 * Compare two yt-dlp version strings.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} Negative if a < b, zero if equal, positive if a > b
 */
function compareVersions(a, b) {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

/**
 * Read the persisted update-check state.
 *
 * @returns {Promise<{lastCheck?: string, lastKnownVersion?: string}>}
 */
async function readUpdateState() {
  try {
    const text = await fs.readFile(getUpdateStatePath(), 'utf-8');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Persist the update-check state.
 *
 * @param {object} state
 * @returns {Promise<void>}
 */
async function writeUpdateState(state) {
  await fs.writeFile(getUpdateStatePath(), JSON.stringify(state), 'utf-8');
}

/**
 * Determine whether an update check is due based on the persisted state.
 *
 * @param {object} state
 * @returns {boolean}
 */
function isUpdateCheckDue(state) {
  if (!state?.lastCheck) {
    return true;
  }
  const lastCheck = new Date(state.lastCheck).getTime();
  return Number.isNaN(lastCheck) || Date.now() - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
}

/**
 * Return the latest yt-dlp release version from GitHub.
 *
 * @returns {Promise<string|null>}
 */
async function fetchLatestVersion() {
  try {
    const releases = await YTDlpWrap.getGithubReleases(1, 1);
    const latest = releases?.[0]?.tag_name;
    return latest || null;
  } catch (error) {
    console.error('[youtube-download] Failed to fetch latest yt-dlp version:', error);
    return null;
  }
}

/**
 * Download the latest yt-dlp binary, replacing the current one.
 *
 * @param {string} binaryPath
 * @param {string} [targetVersion]
 * @returns {Promise<void>}
 */
async function downloadLatestBinary(binaryPath, targetVersion) {
  await YTDlpWrap.downloadFromGithub(binaryPath, targetVersion);
  try {
    await fs.chmod(binaryPath, 0o755);
  } catch {
    // chmod may fail on Windows; the binary can still be executable.
  }
}

/**
 * Ensure the yt-dlp binary is present and up to date, then return a
 * configured wrapper.
 *
 * On first run the latest binary is downloaded from GitHub. On subsequent
 * runs an update check is performed at most once every 24 hours.
 *
 * @returns {Promise<YTDlpWrap>}
 */
async function ensureBinary() {
  if (ytDlpInstance) {
    return ytDlpInstance;
  }

  if (binaryReadyPromise) {
    return binaryReadyPromise;
  }

  binaryReadyPromise = (async () => {
    const binaryPath = getBinaryPath();
    let binaryExists = false;

    try {
      await fs.access(binaryPath);
      binaryExists = true;
    } catch {
      binaryExists = false;
    }

    if (!binaryExists) {
      await downloadLatestBinary(binaryPath);
      const ytDlpWrap = new YTDlpWrap(binaryPath);
      const version = await ytDlpWrap.getVersion().catch(() => 'unknown');
      await writeUpdateState({ lastCheck: new Date().toISOString(), lastKnownVersion: version });
      ytDlpInstance = ytDlpWrap;
      return ytDlpInstance;
    }

    const ytDlpWrap = new YTDlpWrap(binaryPath);

    const state = await readUpdateState();
    if (isUpdateCheckDue(state)) {
      const [installedVersion, latestVersion] = await Promise.all([
        ytDlpWrap.getVersion().catch(() => null),
        fetchLatestVersion(),
      ]);

      if (installedVersion && latestVersion && compareVersions(latestVersion, installedVersion) > 0) {
        console.log(
          `[youtube-download] Updating yt-dlp from ${installedVersion} to ${latestVersion}`
        );
        await downloadLatestBinary(binaryPath, latestVersion);
        await writeUpdateState({ lastCheck: new Date().toISOString(), lastKnownVersion: latestVersion });
      } else {
        await writeUpdateState({
          lastCheck: new Date().toISOString(),
          lastKnownVersion: installedVersion || state.lastKnownVersion,
        });
      }
    }

    ytDlpInstance = new YTDlpWrap(binaryPath);
    return ytDlpInstance;
  })();

  return binaryReadyPromise;
}

/**
 * Force an immediate yt-dlp update check.
 *
 * Can be called on app startup or from a manual update action. If an
 * update is available the binary is replaced; if the check fails the
 * existing binary is left untouched.
 *
 * @returns {Promise<{updated: boolean, version?: string, error?: string}>}
 */
export async function checkForYTDlpUpdate() {
  try {
    const binaryPath = getBinaryPath();
    let binaryExists = false;
    try {
      await fs.access(binaryPath);
      binaryExists = true;
    } catch {
      binaryExists = false;
    }

    if (!binaryExists) {
      await downloadLatestBinary(binaryPath);
      const ytDlpWrap = new YTDlpWrap(binaryPath);
      const version = await ytDlpWrap.getVersion().catch(() => 'unknown');
      await writeUpdateState({ lastCheck: new Date().toISOString(), lastKnownVersion: version });
      return { updated: true, version };
    }

    const ytDlpWrap = new YTDlpWrap(binaryPath);
    const [installedVersion, latestVersion] = await Promise.all([
      ytDlpWrap.getVersion().catch(() => null),
      fetchLatestVersion(),
    ]);

    if (!installedVersion) {
      return { updated: false, error: 'Could not determine installed yt-dlp version' };
    }
    if (!latestVersion) {
      return { updated: false, error: 'Could not fetch latest yt-dlp version' };
    }

    if (compareVersions(latestVersion, installedVersion) > 0) {
      await downloadLatestBinary(binaryPath, latestVersion);
      await writeUpdateState({ lastCheck: new Date().toISOString(), lastKnownVersion: latestVersion });
      return { updated: true, version: latestVersion };
    }

    await writeUpdateState({ lastCheck: new Date().toISOString(), lastKnownVersion: installedVersion });
    return { updated: false, version: installedVersion };
  } catch (error) {
    const message = error.message || String(error);
    console.error('[youtube-download] Update check failed:', error);
    return { updated: false, error: message };
  }
}

/**
 * Return the path where a bundled qjs binary is expected.
 *
 * When packaged with electron-builder, extraResources entries land in
 * process.resourcesPath. During development we also look in <app>/bin
 * so a locally built binary can be dropped there.
 *
 * @returns {Array<string>} Candidate paths to probe
 */
function getBundledQjsCandidates() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, BUNDLED_QJS_NAME));
  }
  try {
    candidates.push(path.join(app.getAppPath(), 'bin', BUNDLED_QJS_NAME));
  } catch {
    // app may be unavailable very early; ignore.
  }
  return candidates;
}

/**
 * Map Node platform/arch to the triple used in static build asset names.
 *
 * @param {string} [platform] Defaults to process.platform
 * @param {string} [arch] Defaults to process.arch
 * @returns {string|null} Triple such as "aarch64-apple-darwin", or null
 *   when the platform has no static builds we know of.
 */
export function platformTriple(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  }
  return null;
}

/**
 * Select a release asset whose name contains every given substring.
 *
 * @param {Array<{name: string}>|null} assets GitHub release assets
 * @param {Array<string>} patterns Substrings that must all match
 * @returns {object|null} The matching asset or null
 */
export function pickAsset(assets, patterns) {
  if (!Array.isArray(assets)) {
    return null;
  }
  return assets.find((asset) => patterns.every((pattern) => asset.name.includes(pattern))) || null;
}

/**
 * Fetch the release assets of the latest GitHub release for a repo.
 *
 * @param {string} repo "owner/name"
 * @returns {Promise<Array<{name: string, browser_download_url: string}>>}
 */
async function fetchLatestReleaseAssets(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub API request for ${repo} failed with status ${response.status}`);
  }
  const release = await response.json();
  return Array.isArray(release?.assets) ? release.assets : [];
}

/**
 * Download a URL to a file (buffered; archives are tens of MB).
 *
 * @param {string} url
 * @param {string} destPath
 * @returns {Promise<void>}
 */
async function downloadToFile(url, destPath) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}: ${url}`);
  }
  await fs.writeFile(destPath, Buffer.from(await response.arrayBuffer()));
}

/**
 * Build the extraction command for an archive.
 *
 * @param {string} archivePath
 * @param {string} destDir
 * @returns {{command: string, args: Array<string>}}
 */
function getExtractCommand(archivePath, destDir) {
  if (archivePath.endsWith('.tar.xz')) {
    return { command: 'tar', args: ['-xJf', archivePath, '-C', destDir] };
  }
  if (process.platform === 'win32') {
    // PowerShell's Expand-Archive needs no extra dependencies; tar.exe
    // (bsdtar, Win10 1803+) would also handle zip files.
    return {
      command: 'powershell',
      args: [
        '-NoProfile', '-NonInteractive', '-Command',
        'Expand-Archive', '-LiteralPath', archivePath,
        '-DestinationPath', destDir, '-Force',
      ],
    };
  }
  return { command: 'unzip', args: ['-o', archivePath, '-d', destDir] };
}

/**
 * Extract an archive into a directory using system tools.
 *
 * @param {string} archivePath
 * @param {string} destDir
 * @returns {Promise<void>}
 */
async function extractArchive(archivePath, destDir) {
  const { command, args } = getExtractCommand(archivePath, destDir);
  await execFile(command, args);
}

/**
 * Mark a downloaded binary executable (no-op on Windows).
 *
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function makeExecutable(filePath) {
  if (process.platform === 'win32') {
    return;
  }
  try {
    await fs.chmod(filePath, 0o755);
  } catch {
    // Non-fatal; yt-dlp will surface a clearer error if it cannot run.
  }
}

/**
 * Find a named file anywhere inside a directory tree.
 *
 * @param {string} dir Directory to search
 * @param {string} fileName Exact file name to look for
 * @returns {Promise<string|null>} Path to the file or null
 */
async function findBinaryInDir(dir, fileName) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findBinaryInDir(fullPath, fileName);
      if (found) {
        return found;
      }
    } else if (entry.name === fileName) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Download and extract a binary from a release archive.
 *
 * The extracted binary is copied to a stable path so subsequent sessions
 * can find it without re-extracting stale archives.
 *
 * @param {object} options
 * @param {string} options.repo "owner/name" of the GitHub repo
 * @param {Array<string>} options.assetPatterns Substrings selecting the asset
 * @param {string} options.archiveName Local name for the downloaded archive
 * @param {string} options.binaryName File name to locate inside the archive
 * @param {string} options.destPath Where the final binary should live
 * @returns {Promise<string>} Path to the provisioned binary
 */
async function provisionArchivedBinary({ repo, assetPatterns, archiveName, binaryName, destPath }) {
  const workDir = path.join(getProvisionDirectory(), path.parse(archiveName).name);
  const assets = await fetchLatestReleaseAssets(repo);
  const asset = pickAsset(assets, assetPatterns);
  if (!asset) {
    throw new Error(`No matching release asset in ${repo} for ${assetPatterns.join(', ')}`);
  }

  const archivePath = path.join(workDir, archiveName);
  try {
    await fs.mkdir(workDir, { recursive: true });
    await downloadToFile(asset.browser_download_url, archivePath);
    await extractArchive(archivePath, workDir);
    const extracted = await findBinaryInDir(workDir, binaryName);
    if (!extracted) {
      throw new Error(`${binaryName} not found inside ${archiveName} after extraction`);
    }
    if (extracted !== destPath) {
      await fs.copyFile(extracted, destPath);
    }
    await makeExecutable(destPath);
    return destPath;
  } finally {
    await fs.rm(archivePath, { force: true }).catch(() => {});
  }
}

/**
 * Download a single-file (non-archive) release asset.
 *
 * @param {object} options
 * @param {string} options.repo "owner/name" of the GitHub repo
 * @param {Array<string>} options.assetPatterns Substrings selecting the asset
 * @param {string} options.destPath Where the final binary should live
 * @returns {Promise<string>} Path to the provisioned binary
 */
async function provisionSingleBinary({ repo, assetPatterns, destPath }) {
  const assets = await fetchLatestReleaseAssets(repo);
  const asset = pickAsset(assets, assetPatterns);
  if (!asset) {
    throw new Error(`No matching release asset in ${repo} for ${assetPatterns.join(', ')}`);
  }
  await downloadToFile(asset.browser_download_url, destPath);
  await makeExecutable(destPath);
  return destPath;
}

/**
 * Download a static deno build for the current platform.
 *
 * Deno publishes official prebuilt binaries for every supported desktop
 * platform, which makes it the universal out-of-the-box JS runtime.
 *
 * @returns {Promise<string|null>} Path to the deno binary, or null when
 *   the platform is unsupported.
 */
async function provisionDeno() {
  const triple = platformTriple();
  if (!triple) {
    return null;
  }
  const exeSuffix = process.platform === 'win32' ? '.exe' : '';
  return provisionArchivedBinary({
    repo: DENO_REPO,
    assetPatterns: [`deno-${triple}`, '.zip'],
    archiveName: `deno-${triple}.zip`,
    binaryName: `deno${exeSuffix}`,
    destPath: path.join(getProvisionDirectory(), `deno${exeSuffix}`),
  });
}

/**
 * Download a prebuilt quickjs qjs binary for the current platform.
 *
 * quickjs-ng only publishes prebuilt binaries for Windows, so this
 * returns null everywhere else and callers fall back to deno.
 *
 * @returns {Promise<string|null>} Path to the qjs binary, or null when
 *   no prebuilt binary exists for this platform/arch.
 */
async function provisionQuickjs() {
  if (process.platform !== 'win32') {
    return null;
  }
  const suffix = process.arch === 'x64' ? 'x86_64' : process.arch === 'ia32' ? 'x86' : null;
  if (!suffix) {
    return null;
  }
  return provisionSingleBinary({
    repo: QUICKJS_NG_REPO,
    assetPatterns: [`qjs-windows-${suffix}.exe`],
    destPath: path.join(getProvisionDirectory(), 'qjs.exe'),
  });
}

/**
 * Map the current platform/arch to an ffmpeg-static asset suffix.
 *
 * @returns {string|null} Suffix such as "darwin-arm64", or null when the
 *   platform has no prebuilt ffmpeg-static binary.
 */
function getFFmpegStaticPlatformKey(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (platform === 'linux') {
    return `linux-${arch}`;
  }
  if (platform === 'win32') {
    return arch === 'x64' ? 'win32-x64' : null;
  }
  return null;
}

/**
 * Download a gzip-compressed single-binary asset and unpack it.
 *
 * Uses Node's zlib so no system tools are required (important on Windows,
 * which ships no command-line gunzip).
 *
 * @param {string} url
 * @param {string} destPath
 * @returns {Promise<void>}
 */
async function downloadAndGunzip(url, destPath) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}: ${url}`);
  }
  const compressed = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, zlib.gunzipSync(compressed));
  await makeExecutable(destPath);
}

/**
 * Download a static ffmpeg build from the ffmpeg-static releases.
 *
 * ffmpeg-static publishes prebuilt binaries for every supported desktop
 * platform (including native Apple Silicon), which yt-dlp's own
 * FFmpeg-Builds no longer does for macOS. ffprobe is fetched too when
 * available, but is optional.
 *
 * @returns {Promise<string|null>} Path to the ffmpeg binary, or null when
 *   the platform is unsupported.
 */
async function provisionFFmpeg() {
  const platformKey = getFFmpegStaticPlatformKey();
  if (!platformKey) {
    return null;
  }
  const exeSuffix = process.platform === 'win32' ? '.exe' : '';
  const assets = await fetchLatestReleaseAssets(FFMPEG_STATIC_REPO);

  const ffmpegAsset = pickAsset(assets, [`ffmpeg-${platformKey}.gz`]);
  if (!ffmpegAsset) {
    throw new Error(`No ffmpeg-${platformKey}.gz asset in ${FFMPEG_STATIC_REPO} release`);
  }
  const ffmpegPath = path.join(getProvisionDirectory(), `ffmpeg${exeSuffix}`);
  await downloadAndGunzip(ffmpegAsset.browser_download_url, ffmpegPath);

  // ffprobe is optional for merging but improves format handling.
  try {
    const probeAsset = pickAsset(assets, [`ffprobe-${platformKey}.gz`]);
    if (probeAsset) {
      await downloadAndGunzip(probeAsset.browser_download_url, path.join(getProvisionDirectory(), `ffprobe${exeSuffix}`));
    }
  } catch (error) {
    console.error('[youtube-download] ffprobe provisioning failed (non-fatal):', error);
  }

  return ffmpegPath;
}

/**
 * Return paths of previously provisioned binaries to re-find quickly.
 *
 * @param {string} name "quickjs", "deno" or "ffmpeg"
 * @returns {Array<string>} Candidate paths inside the provision directory
 */
function getProvisionedCandidates(name) {
  const exeSuffix = process.platform === 'win32' ? '.exe' : '';
  const names = {
    quickjs: `qjs${exeSuffix}`,
    deno: `deno${exeSuffix}`,
    ffmpeg: `ffmpeg${exeSuffix}`,
  };
  return [path.join(getProvisionDirectory(), names[name] || name)];
}

/**
 * Find an executable path for a JavaScript runtime binary.
 *
 * Searches the process PATH first, then well-known install prefixes,
 * because GUI-launched Electron apps usually get a minimal PATH.
 *
 * @param {string} name Binary name to look for ("qjs", "deno" or "node")
 * @returns {Promise<string|null>} Absolute path or null when not found
 */
async function findRuntimeBinary(name) {
  const candidates = [
    ...(name === 'quickjs'
      ? getBundledQjsCandidates()
      : []),
    ...(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, name)),
    ...(JS_RUNTIME_FALLBACK_PATHS[name] || []),
    ...getProvisionedCandidates(name),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.constants.X_OK);
      return candidate;
    } catch {
      // Keep probing remaining candidates.
    }
  }
  return null;
}

/**
 * Build yt-dlp arguments that point it at a usable JS runtime.
 *
 * Recent yt-dlp releases require a JavaScript runtime for YouTube
 * extraction. Preference order:
 *
 *   1. quickjs — small, sandbox-free; bundled via extraResources or
 *      installed on the system;
 *   2. deno — officially recommended by yt-dlp when installed;
 *   3. node — common on developer machines;
 *   4. auto-provisioned — download a static quickjs build (Windows)
 *      or deno build (macOS/Linux) once into userData.
 *
 * The chosen runtime is passed explicitly via --js-runtimes. Probing
 * happens once per session and the result is cached.
 *
 * @returns {Promise<Array<string>>} Arguments to prepend to invocations
 */
async function getJsRuntimeArgs() {
  if (jsRuntimeArgsCache) {
    return jsRuntimeArgsCache;
  }

  const quickjs = await findRuntimeBinary('quickjs');
  if (quickjs) {
    jsRuntimeArgsCache = ['--js-runtimes', `quickjs:${quickjs}`];
    return jsRuntimeArgsCache;
  }

  const deno = await findRuntimeBinary('deno');
  if (deno) {
    jsRuntimeArgsCache = ['--js-runtimes', `deno:${deno}`];
    return jsRuntimeArgsCache;
  }

  const node = await findRuntimeBinary('node');
  if (node) {
    jsRuntimeArgsCache = ['--js-runtimes', `node:${node}`];
    return jsRuntimeArgsCache;
  }

  // Nothing usable on the machine: download a static build once.
  if (!runtimeProvisionFailed) {
    console.log('[youtube-download] No JS runtime found; downloading a static build...');
    try {
      const downloadedQuickjs = await provisionQuickjs();
      if (downloadedQuickjs) {
        jsRuntimeArgsCache = ['--js-runtimes', `quickjs:${downloadedQuickjs}`];
      } else {
        const downloadedDeno = await provisionDeno();
        if (downloadedDeno) {
          jsRuntimeArgsCache = ['--js-runtimes', `deno:${downloadedDeno}`];
        }
      }
    } catch (error) {
      console.error('[youtube-download] JS runtime provisioning failed:', error);
    }
    if (!jsRuntimeArgsCache) {
      runtimeProvisionFailed = true;
    }
  }

  jsRuntimeArgsCache = jsRuntimeArgsCache || [];
  return jsRuntimeArgsCache;
}

/** Cached result of the ffmpeg probe (null until first lookup). */
let ffmpegPathCache = null;

/** Set after an ffmpeg download attempt fails, to avoid retrying every call. */
let ffmpegProvisionFailed = false;

/**
 * Locate an ffmpeg binary.
 *
 * Merging separate video+audio streams requires ffmpeg, which is not
 * guaranteed on user machines. Probes PATH and well-known prefixes,
 * then falls back to downloading a static build from yt-dlp's own
 * FFmpeg-Builds releases once into userData.
 *
 * @returns {Promise<string|null>} Absolute path or null when unavailable
 */
async function findFFmpeg() {
  if (ffmpegPathCache !== null) {
    return ffmpegPathCache || null;
  }

  const candidates = [
    ...(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, 'ffmpeg')),
    ...FFMPEG_FALLBACK_PATHS,
    ...getProvisionedCandidates('ffmpeg'),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.constants.X_OK);
      ffmpegPathCache = candidate;
      return ffmpegPathCache;
    } catch {
      // Keep probing remaining candidates.
    }
  }

  if (!ffmpegProvisionFailed) {
    console.log('[youtube-download] No ffmpeg found; downloading a static build...');
    try {
      const downloaded = await provisionFFmpeg();
      if (downloaded) {
        ffmpegPathCache = downloaded;
        return ffmpegPathCache;
      }
    } catch (error) {
      console.error('[youtube-download] ffmpeg provisioning failed:', error);
    }
    ffmpegProvisionFailed = true;
  }

  ffmpegPathCache = '';
  return null;
}

/**
 * Fetch video metadata for a URL via --dump-json.
 *
 * Replaces YTDlpWrap.getVideoInfo so our --js-runtimes arguments are
 * always included; without them metadata extraction fails on YouTube.
 *
 * @param {YTDlpWrap} ytDlpWrap
 * @param {string} url
 * @returns {Promise<object|null>} Parsed metadata or null on failure
 */
async function fetchVideoInfo(ytDlpWrap, url) {
  try {
    const runtimeArgs = await getJsRuntimeArgs();
    const stdout = await ytDlpWrap.execPromise([
      ...runtimeArgs,
      '--no-playlist',
      '--dump-json',
      url,
    ]);
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Determine whether yt-dlp reports that a URL is a live stream.
 *
 * @param {YTDlpWrap} ytDlpWrap
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function isLiveVideo(ytDlpWrap, url) {
  try {
    const info = await fetchVideoInfo(ytDlpWrap, url);
    return Boolean(info?.is_live || info?.live_status === 'is_live');
  } catch {
    // If we cannot determine the status, treat it as non-live and let
    // the download step fail if it really is unsupported.
    return false;
  }
}

/**
 * Find the downloaded file matching a video ID.
 *
 * yt-dlp writes %(id)s.%(ext)s, so we look for any file whose basename
 * is the video ID.
 *
 * @param {string} videoID
 * @returns {Promise<string|null>}
 */
async function findDownloadedFile(videoID) {
  const dir = getDownloadDirectory();
  const files = await fs.readdir(dir).catch(() => []);
  for (const file of files) {
    const base = path.parse(file).name;
    if (base === videoID) {
      return path.join(dir, file);
    }
  }
  return null;
}

/**
 * Report a download progress update to an optional listener.
 *
 * Listener failures are swallowed so a broken UI channel can never
 * abort an in-flight download.
 *
 * @param {Function|null} onProgress - Progress callback, if any
 * @param {{stage: string, percent?: number|null, totalSize?: string, currentSpeed?: string, eta?: string}} payload
 * @returns {void}
 */
function reportDownloadProgress(onProgress, payload) {
  if (typeof onProgress !== 'function') {
    return;
  }
  try {
    onProgress(payload);
  } catch {
    // Never let a listener error kill the download.
  }
}

/**
 * Run yt-dlp and stream its progress to an optional listener.
 *
 * Uses the event-emitter form of yt-dlp-wrap-plus (exec) instead of
 * execPromise so the [download] percent lines parsed from yt-dlp's
 * --newline output surface as live progress updates.
 *
 * @param {YTDlpWrap} ytDlpWrap
 * @param {string[]} args
 * @param {Function|null} onProgress - Progress callback, if any
 * @returns {Promise<void>} Resolves on clean exit, rejects otherwise
 */
function runYtDlpWithProgress(ytDlpWrap, args, onProgress) {
  return new Promise((resolve, reject) => {
    const emitter = ytDlpWrap.exec(args);

    emitter.on('progress', (progress) => {
      const percent = Number(progress?.percent);
      reportDownloadProgress(onProgress, {
        stage: 'downloading',
        percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null,
        totalSize: progress?.totalSize,
        currentSpeed: progress?.currentSpeed,
        eta: progress?.eta,
      });
    });
    emitter.on('error', reject);
    emitter.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

/**
 * Download a YouTube video to disk.
 *
 * Skips live streams and URLs that are not YouTube watch/short/embed
 * links. Returns the path to the saved file on success or an error
 * object on failure.
 *
 * @param {string} url
 * @param {Function|null} [onProgress] - Optional progress callback; receives
 *   { stage, percent?, totalSize?, currentSpeed?, eta? } updates where
 *   stage is 'starting' | 'downloading' | 'processing'
 * @returns {Promise<{filePath?: string, error?: string}>}
 */
export async function downloadYouTubeVideo(url, onProgress = null) {
  if (isYouTubeStream(url)) {
    return { error: 'Live streams are not downloaded' };
  }

  try {
    reportDownloadProgress(onProgress, { stage: 'starting', percent: null });

    await ensureDownloadDirectory();
    const ytDlpWrap = await ensureBinary();

    if (await isLiveVideo(ytDlpWrap, url)) {
      return { error: 'Live streams are not downloaded' };
    }

    const outputTemplate = path.join(getDownloadDirectory(), '%(id)s.%(ext)s');
    const [runtimeArgs, ffmpegPath] = await Promise.all([getJsRuntimeArgs(), findFFmpeg()]);
    const args = [...runtimeArgs];
    if (ffmpegPath) {
      // GUI apps have a minimal PATH, so hand yt-dlp ffmpeg explicitly.
      args.push('--ffmpeg-location', ffmpegPath);
    }
    args.push(
      url,
      '-f',
      ffmpegPath ? MERGE_FORMAT_SELECTOR : SINGLE_FILE_FORMAT_SELECTOR,
      '-o',
      outputTemplate,
      '--no-playlist',
      // Keep the merged container mp4 even when the fallback selectors
      // pick non-mp4 inputs, so macOS always recognizes the result.
      ...(ffmpegPath ? ['--merge-output-format', 'mp4'] : []),
      '--newline',
    );
    await runYtDlpWithProgress(ytDlpWrap, args, onProgress);

    reportDownloadProgress(onProgress, { stage: 'processing', percent: 100 });

    const info = await fetchVideoInfo(ytDlpWrap, url);
    const videoID = info?.id;
    if (!videoID) {
      return { error: 'Could not determine downloaded video ID' };
    }

    const filePath = await findDownloadedFile(videoID);
    if (!filePath) {
      return { error: 'Download completed but file was not found' };
    }

    return { filePath };
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

/**
 * Delete a downloaded video file from disk.
 *
 * Tolerates missing files so callers can safely delete stale paths.
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function deleteDownloadedVideo(filePath) {
  if (!filePath) {
    return true;
  }

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }
    return false;
  }
}
