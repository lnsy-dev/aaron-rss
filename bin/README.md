# Bundled binaries

Binaries in this directory are copied into the packaged app's resources
by electron-builder (`build.extraResources` in `package.json`) and are
probed by `electron/youtube-download.js` at runtime.

## qjs (QuickJS)

yt-dlp needs a JavaScript runtime to extract YouTube videos. The app
bundles a `qjs` binary so downloads work out of the box on machines
without deno/node installed.

Place a **statically linked, current-architecture** `qjs` binary here,
named exactly:

- macOS / Linux: `qjs`
- Windows: `qjs.exe`

Sources:

- QuickJS-NG: https://github.com/quickjs-ng/quickjs/releases
  (official prebuilt binaries are Windows-only; on macOS/Linux build
  from source: `cmake -B build && cmake --build build` — the binary is
  `build/qjs`)
- Bellard QuickJS: https://bellard.org/quickjs/ (build with `make`)

Notes for packagers:

- Use a release of quickjs-ng >= 0.12.0 (or Bellard >= 2025-04-26);
  older versions lack optimizations and can take minutes per challenge.
- Build a universal macOS binary or ship per-arch builds.
- If this file is absent the packaged app first tries deno/node/qjs
  already installed on the user's machine, then auto-downloads a static
  build once into userData (quickjs on Windows, deno elsewhere).

## ffmpeg

Merging YouTube's separate video+audio streams requires ffmpeg. The app
probes PATH and common prefixes at download time and otherwise
auto-downloads a static build from the ffmpeg-static releases into
userData — no manual step is needed for this one.
