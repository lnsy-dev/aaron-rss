/**
 * File Storage Component
 *
 * Demonstrates Google Chrome's File System Access API working together
 * with the RSS feed list:
 *   - Export: serialize the current subscriptions to an OPML file on disk
 *     via showSaveFilePicker()
 *   - Import: pick an .opml file via showOpenFilePicker() and add the
 *     subscriptions as feeds
 *
 * The API is available in Chrome, Edge and the Electron renderer.
 * Elsewhere the component explains that the feature is unsupported.
 *
 * Events emitted (dataroom-js this.event):
 *   OPML-EXPORTED  { name }
 *   OPML-IMPORTED  { name, added, total }
 *   OPML-ERROR     { error }
 */

import DataroomElement from 'dataroom-js';
import { loadAllFeeds, addFeed } from './lib/feed-manager.js';
import { exportOPML, parseOPML } from './lib/opml.js';
import {
  isFileSystemAccessSupported,
  isUserCancellation,
  saveOPMLToDisk,
  pickOPMLFileFromDisk,
} from './lib/file-storage.js';

/**
 * FileStorageComponent
 *
 * A custom HTML element with export/import buttons for OPML subscription
 * lists.
 *
 * @extends DataroomElement
 */
class FileStorageComponent extends DataroomElement {
  /**
   * Initialize the component.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    this.create('h2', { content: 'OPML Subscriptions' });

    this.create('p', {
      content: 'Export your subscription list to an OPML file on disk, or import one back, using the File System Access API.',
    });

    if (!isFileSystemAccessSupported()) {
      this.create('p', {
        class: 'file-storage-unsupported',
        content: 'The File System Access API is not available in this browser. Use Chrome, Edge, or the Electron app.',
      });
      return;
    }

    const controls = this.create('div', { class: 'file-storage-controls' });

    const exportButton = this.create('button', { content: 'Export subscriptions to OPML' }, controls);
    exportButton.addEventListener('click', () => this.exportToFile());

    const importButton = this.create('button', { content: 'Import subscriptions from OPML' }, controls);
    importButton.addEventListener('click', () => this.importFromFile());

    this.resultLine = this.create('p', { class: 'file-storage-result' });
  }

  /**
   * Serialize the current subscriptions to OPML and save it to disk with a
   * save dialog.
   *
   * @async
   * @returns {Promise<void>}
   */
  async exportToFile() {
    try {
      const feeds = await loadAllFeeds();
      const opml = exportOPML(feeds, 'Aaron RSS subscriptions');
      const name = await saveOPMLToDisk('Aaron-RSS-subscriptions.opml', opml);
      this.resultLine.textContent = `Exported ${feeds.length} subscriptions to ${name}.`;
      this.event('OPML-EXPORTED', { name, count: feeds.length });
    } catch (error) {
      if (isUserCancellation(error)) {
        return; // User closed the save dialog — nothing to do
      }
      console.error('OPML export failed:', error);
      this.resultLine.textContent = `Export failed: ${error.message}`;
      this.event('OPML-ERROR', { error: error.message });
    }
  }

  /**
   * Pick an OPML file from disk and add each subscription as a feed.
   * Afterwards, refreshes <rss-feed-component> and triggers a full feed
   * refresh from the network if one is on the page.
   *
   * @async
   * @returns {Promise<void>}
   */
  async importFromFile() {
    try {
      const { name, text } = await pickOPMLFileFromDisk();
      const subscriptions = parseOPML(text);

      if (subscriptions.length === 0) {
        this.resultLine.textContent = 'No subscriptions found in the selected file.';
        this.event('OPML-ERROR', { error: 'No subscriptions found' });
        return;
      }

      let added = 0;
      for (const subscription of subscriptions) {
        const feed = await addFeed(subscription.url, subscription.name);
        if (feed) {
          added++;
        }
      }

      this.resultLine.textContent = `Imported ${added}/${subscriptions.length} subscriptions from ${name}.`;
      this.event('OPML-IMPORTED', { name, added, total: subscriptions.length });

      // dataroom-js events do not bubble, so refresh the RSS component directly
      const rssComponent = document.querySelector('rss-feed-component');
      if (rssComponent && typeof rssComponent.refreshFeeds === 'function') {
        await rssComponent.refreshFeeds();
        if (typeof rssComponent.handleRefreshAll === 'function') {
          await rssComponent.handleRefreshAll();
        }
      }
    } catch (error) {
      if (isUserCancellation(error)) {
        return; // User closed the open dialog — nothing to do
      }
      console.error('OPML import failed:', error);
      this.resultLine.textContent = `Import failed: ${error.message}`;
      this.event('OPML-ERROR', { error: error.message });
    }
  }

  /**
   * Clear stored references when the component is removed.
   *
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.resultLine = null;
  }
}

// Register the custom element
if (!customElements.get('file-storage-component')) {
  customElements.define('file-storage-component', FileStorageComponent);
}
