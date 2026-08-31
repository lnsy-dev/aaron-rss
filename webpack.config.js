import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load environment variables from .env file.
 * This allows users to customize build behavior without modifying
 * the webpack config directly.
 */
dotenv.config();

const outputFileName = process.env.OUTPUT_FILE_NAME || 'main.min.js';
/**
 * Base path for all emitted asset URLs. Root ('/') for the dev server
 * and Electron; override when hosting under a subpath, e.g.
 * PUBLIC_PATH=/aaron-rss/app/ for GitHub Pages deployments.
 */
const publicPath = process.env.PUBLIC_PATH || '/';
const port = process.env.PORT || 3456;

/**
 * Check if assets directory exists and has files.
 * We only add CopyWebpackPlugin if there are actual assets to copy,
 * avoiding unnecessary build overhead for projects without static files.
 */
const assetsPath = path.join(__dirname, 'assets');
const hasAssets = (() => {
  try {
    return fs.existsSync(assetsPath) && fs.readdirSync(assetsPath).length > 0;
  } catch {
    return false;
  }
})();

const isDev = process.env.NODE_ENV !== 'production';

/**
 * A note on persistence.
 *
 * The SQLite database (src/sqlite-worker.js) persists in OPFS via
 * sqlite-wasm's "opfs-sahpool" VFS, which only needs the OPFS
 * sync-access-handle APIs available in any modern browser worker.
 * It does NOT require cross-origin isolation (no COOP/COEP headers,
 * no SharedArrayBuffer), so this dev server needs no special headers
 * and the production build can be hosted on any static file host.
 *
 * Webpack Configuration
 *
 * This configuration is designed for vanilla JavaScript projects with:
 * - Modern CSS processing (PostCSS + cssnano)
 * - Fast JavaScript transpilation (SWC)
 * - Web Worker inlining for single-file deployment (classic workers)
 * - Native module workers (the sqlite-wasm worker imports npm modules,
 *   so it uses webpack 5's built-in `new Worker(new URL(...), { type: 'module' })`)
 * - WebAssembly support for sqlite-wasm, C++ (Emscripten) and Rust (wasm-pack)
 * - Static asset copying
 * - Environment-based customization
 */
export default {
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: isDev ? '[name].js' : outputFileName,
    /**
     * Additional chunks (module workers, dynamic import() of the
     * Emscripten/wasm-pack glue code) need their own filename pattern
     * so they do not collide with the fixed entry filename above.
     */
    chunkFilename: isDev ? '[name].js' : 'chunks/[name].min.js',
    clean: true,
    /**
     * WebAssembly files need a predictable public path so that
     * sqlite-wasm, Emscripten and wasm-pack generated modules can load
     * their companion .wasm binaries at runtime.
     */
    publicPath,
  },
  mode: isDev ? 'development' : 'production',
  /**
   * Override webpack's development default ('eval') so the bundle does not
   * rely on eval(). This keeps the Content-Security-Policy free of
   * 'unsafe-eval' while still providing source maps.
   */
  devtool: isDev ? 'cheap-module-source-map' : 'source-map',
  /**
   * Enable WebAssembly support.
   * asyncWebAssembly allows wasm modules to be loaded asynchronously,
   * which is required for both Emscripten MODULARIZE output and
   * wasm-pack generated ES modules.
   */
  experiments: {
    asyncWebAssembly: true,
  },
  devServer: {
    static: {
      directory: path.join(__dirname, 'assets'),
      publicPath: '/',
    },
    /**
     * Show the full-screen error overlay for compilation ERRORS only.
     * Our build always carries warnings we cannot fix (sqlite-wasm's
     * dynamic requires and the 844 KiB wasm binary size); if the
     * overlay reacted to those, it would cover the page and intercept
     * all clicks — which also breaks e2e test automation.
     */
    client: {
      overlay: {
        errors: true,
        warnings: false,
      },
    },
    port: port,
    hot: true,
    open: false,
    /**
     * Tag every dev-server response so Electron can tell this webpack
     * instance apart from any other HTTP server that might be listening
     * on the same port.
     */
    headers: {
      'X-Aaron-RSS': 'dev-server',
    },
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          // Production extracts CSS to files so the strict production CSP
          // (style-src 'self') is satisfied. Development keeps style-loader
          // for CSS hot module replacement.
          isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: isDev ? {} : {
              importLoaders: 1,
              modules: false,
            }
          },
          {
            loader: 'postcss-loader',
            options: isDev ? {} : {
              postcssOptions: {
                plugins: [
                  ['cssnano', {
                    preset: ['default', {
                      discardComments: {
                        removeAll: true,
                      },
                    }],
                  }],
                ],
              },
            }
          }
        ],
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: path.resolve(__dirname, 'scripts/transform-workers.js'),
          },
          {
            loader: 'swc-loader',
            options: {
              jsc: {
                parser: {
                  syntax: 'ecmascript',
                },
                target: 'es2015',
              },
            },
          },
        ],
      },
      /**
       * WebAssembly file handling.
       * Webpack 5's asset/resource type emits .wasm files to the output
       * directory and returns the public URL. This is necessary because
       * sqlite-wasm, Emscripten and wasm-pack runtime loaders fetch the
       * .wasm binary at runtime.
       *
       * The sqlite worker imports the binary with:
       *   import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm';
       */
      {
        test: /\.wasm$/,
        type: 'asset/resource',
        generator: {
          filename: 'wasm/[name][ext]',
        },
      },
    ],
  },
  optimization: {
    splitChunks: false,
    runtimeChunk: isDev ? 'single' : false,
  },
  resolve: {
    /**
     * Include .wasm in resolve.extensions so that imports like:
     *   import('./module.wasm')
     * are resolved without requiring the full extension.
     */
    extensions: ['.js', '.json', '.wasm'],
    /**
     * rss-parser (and its dependency xml2js) import Node core modules
     * for their default network path. The app fetches feed text itself
     * and only uses rss-parser's parseString(), so these can be stubbed
     * out safely in the browser bundle.
     */
    fallback: {
      http: false,
      https: false,
      url: false,
      stream: false,
      timers: path.resolve(__dirname, 'src/lib/timers-stub.js'),
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
      templateParameters: {
        CSP: [
          "default-src 'self'",
          "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "img-src 'self' https: http: data:",
          // Downloaded videos are served to <video> elements over the
          // app's media:// protocol (see electron/media-protocol.js).
          "media-src 'self' media:",
          "frame-src https: http:",
          "worker-src 'self' blob:",
          `connect-src 'self' ws://localhost:${port} http://localhost:${port}`,
          "font-src 'self' https://fonts.gstatic.com",
        ].join('; '),
      },
    }),
    // Always extract CSS in production so inline <style> tags are not
    // injected, which would violate the production Content-Security-Policy.
    ...(!isDev ? [new MiniCssExtractPlugin()] : []),
    ...(hasAssets
      ? [
          new CopyWebpackPlugin({
            patterns: [
              {
                from: 'assets',
                to: '.',
                /**
                 * Font files referenced via CSS url() are already copied and
                 * hashed by the css-loader/asset pipeline. Copying the raw
                 * font files again here would bloat the bundle with unused
                 * faces (the AtkinsonHyperlegibleMono folder alone is ~60 MB).
                 */
                globOptions: {
                  ignore: ['**/*.ttf', '**/*.otf', '**/*.woff', '**/*.woff2', '**/*.md', '**/*.txt'],
                },
              },
            ],
          }),
        ]
      : []),
  ],
};
