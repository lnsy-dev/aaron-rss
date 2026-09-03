/**
 * Research API Bridge (renderer side)
 *
 * The external watch API's HTTP server runs in the Electron main
 * process, but the SQLite database lives in the renderer (sqlite-wasm +
 * OPFS). When main receives an API request it forwards the query here
 * over IPC ('research-api-query'), this module maps it onto the
 * database helpers, and the result is sent back to main
 * ('research-api-response', handled inside the preload bridge).
 *
 * Browser runs (no Electron preload) simply never register the bridge,
 * and the API server is an Electron-only feature.
 */

import {
  listResearchTopics,
  listFeedArticles,
  listResearchTopicArticles,
  getArticleMarkdown,
  getFeedName,
} from './database.js';

/**
 * Whether the Electron research API bridge is available.
 *
 * @returns {boolean}
 */
export function isResearchApiBridgeAvailable() {
  return typeof window !== 'undefined' && typeof window.electron?.onResearchApiQuery === 'function';
}

/**
 * Register the query handler that answers main-process API requests.
 *
 * @returns {boolean} Whether the bridge was registered (Electron only)
 */
export function registerResearchApiBridge() {
  if (!isResearchApiBridgeAvailable()) {
    return false;
  }

  window.electron.onResearchApiQuery(async ({ type, params = {} }) => {
    switch (type) {
      case 'listResearchTopics':
        return listResearchTopics();

      case 'getResearchTopic': {
        const topics = await listResearchTopics();
        return topics.find((topic) => topic.topicID === params.topicID) || null;
      }

      case 'getResearchTopicArticles': {
        const topics = await listResearchTopics();
        const topic = topics.find((entry) => entry.topicID === params.topicID);
        if (!topic) {
          return null;
        }
        const articles = await listResearchTopicArticles(params.topicID);
        return { topicID: topic.topicID, name: topic.name, articles };
      }

      case 'getFeedArticles': {
        // getFeedName doubles as the existence check: an unknown feed is
        // null, a known feed with no articles yields an empty list.
        const name = await getFeedName(params.feedID);
        if (name === null) {
          return null;
        }
        const articles = await listFeedArticles(params.feedID);
        return { feedID: params.feedID, name, articles };
      }

      case 'getArticleMarkdown': {
        const row = await getArticleMarkdown(params.feedID, params.articleID);
        return row ? row.markdown : null;
      }

      default:
        throw new Error(`Unknown research API query type: ${type}`);
    }
  });

  return true;
}
