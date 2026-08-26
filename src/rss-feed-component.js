/**
 * RSS Feed Component
 *
 * Main application UI for the Aaron RSS Electron app. Provides a
 * hamburger menu (Manage Feeds, Mark All Read, Settings, Export/Import
 * OPML), primary action buttons in a fixed footer (Add Feed, Refresh All),
 * and a collapsible feed/article list.
 *
 * Persistence goes through src/lib/database.js and src/lib/feed-manager.js.
 */

import DataroomElement from 'dataroom-js';
import {
  getStatus,
  initRSSSchema,
  loadSettings,
  saveSettings,
  updateFeedOpenOriginalByDefault,
} from './lib/database.js';
import {
  discoverAndAddFeed,
  addFeed,
  addSnapshotFeed,
  refreshAllFeeds,
  refreshFeed,
  deleteFeed,
  loadAllFeeds,
  loadFeedsForDisplay,
  markArticleAsRead,
  markArticleAsUnread,
  toggleArticleStarred,
  markAllArticlesAsRead,
  downloadArticleYouTubeVideo,
} from './lib/feed-manager.js';
import {
  isFileSystemAccessSupported,
  isUserCancellation,
  saveBytesToDisk,
  saveTextToDisk,
  saveCSSToDisk,
  saveOPMLToDisk,
  pickCSSTextFileFromDisk,
  pickOPMLFileFromDisk,
} from './lib/file-storage.js';
import { exportOPML, parseOPML } from './lib/opml.js';
import { stripHTML } from './lib/html-utils.js';
import { extractArticle } from './lib/article-extractor.js';
import { renderMarkdown } from './lib/markdown-renderer.js';
import { generateFrontMatter } from './lib/yaml-front-matter.js';
import { sortFeedsByUnreadCount, buildTimelineItems } from './lib/feed-sorting.js';
import {
  identifySocialURL,
  fetchSocialPost,
  renderBlueskyText,
} from './lib/social-post.js';
import { highlightMatches, clearHighlights } from './lib/find-highlights.js';
import { isYouTubeURL, extractYouTubeVideoID, getYouTubeEmbedURL } from './lib/youtube.js';
import { deleteDownloadedVideo } from './lib/youtube-bridge.js';
import {
  getUsableImageURL,
  deriveImageFilename,
  buildImageAcceptTypes,
} from './lib/image-utils.js';
import { fetchBytes } from './lib/rss-network.js';
import DOMPurify from 'dompurify';

const DEFAULT_SETTINGS = {
  sourcesFolder: 'sources',
  refreshInterval: 5,
  maxArticlesPerFeed: 50,
  showUnreadOnly: false,
  viewMode: 'timeline',
  theme: '',
};

/** Minimum/maximum refresh interval allowed in the settings UI (minutes). */
const REFRESH_INTERVAL_BOUNDS = { min: 0, max: 1440 };

/** Per-refresh timeout so a hung feed/network call cannot lock the UI forever. */
const REFRESH_TIMEOUT_MS = 120000;

/** @type {string} */
const THEME_STYLE_ID = 'user-theme-style';

class RSSFeedComponent extends DataroomElement {
  /**
   * Initialize the component, schema, settings, and feeds.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    // If the element is reconnected to the DOM after a successful setup,
    // do not rebuild the chrome; just refresh the view and restart the
    // background timer. This also protects against any scenario that would
    // create duplicate content areas, which can leave stale rendered content
    // visible.
    if (this._rssSetupStarted) {
      if (this.initialized) {
        this.refreshFeeds();
        this._startAutoRefresh();
      }
      return;
    }
    this._rssSetupStarted = true;

    this.settings = { ...DEFAULT_SETTINGS };
    // Timeline is the default view; a saved setting can switch to feeds.
    this.viewMode = this.settings.viewMode === 'feeds' ? 'feeds' : 'timeline';
    this.viewToggleInput = null;
    this.viewToggleText = null;
    this.feeds = [];
    this.isRefreshing = false;
    this.activeModal = null;
    this._scrollLockCount = 0;
    this._previousBodyOverflow = '';
    this._previousHtmlOverflow = '';
    this._refreshTimer = null;
    this._lastRefreshAt = 0;
    this._visibilityHandler = null;
    this._renderFrame = null;
    this._keyboardHandler = null;
    this._selectedArticle = null;
    this._lastViewedArticle = null;
    this._nextArticleAfterViewed = null;

    this.classList.add('rss-feed-component');

    this.renderHeader();
    this.renderFooter();
    this.initializeCommandPanel();
    this.statusLine = this.create('p', { class: 'rss-status' });
    this.statusFadeTimeout = null;
    this.contentArea = this.create('div', { class: 'rss-content-area' });
    this.toastContainer = this.create('div', { class: 'rss-toast-container' });

    try {
      const status = await getStatus();
      await initRSSSchema();
      this.settings = { ...DEFAULT_SETTINGS, ...(await loadSettings()) };
      this.viewMode = this.settings.viewMode === 'feeds' ? 'feeds' : 'timeline';
      this._syncViewToggle();

      this.setStatus(
        status.persistent
          ? 'Persistent storage (OPFS) active'
          : 'Transient in-memory database — export subscriptions as OPML to keep your list'
      );

      this.applyTheme();
      await this.refreshFeeds();
      this._lastRefreshAt = Date.now();
      this._startAutoRefresh();
      this.initialized = true;
    } catch (error) {
      console.error('RSS initialization failed:', error);
      this.setStatus(`Database error: ${error.message}`);
      this.initialized = true;
    }

    this._setupKeyboardNavigation();
    this._setupFind();

    // Close menus/modals when clicking outside.
    this._documentClickHandler = (e) => this.handleDocumentClick(e);
    document.addEventListener('click', this._documentClickHandler);

    // Single delegated handler for the whole article list avoids creating
    // hundreds of per-article listeners that leak data across refreshes.
    this._contentClickHandler = (e) => this._handleContentClick(e);
    this.contentArea.addEventListener('click', this._contentClickHandler);

    this._setupImageContextMenu();
  }

  /**
   * Render the app header with the hamburger menu.
   *
   * @returns {void}
   */
  renderHeader() {
    const header = this.create('header', { class: 'rss-header' });

    const logo = document.createElement('img');
    logo.className = 'rss-logo';
    logo.src = './logo.png';
    logo.alt = 'Aaron RSS';
    header.appendChild(logo);

    const menuButton = document.createElement('button');
    menuButton.className = 'rss-hamburger';
    menuButton.setAttribute('aria-label', 'Commands');
    menuButton.textContent = '☰';
    menuButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.commandPanel) {
        this.commandPanel.openPanel();
      }
    });
    header.appendChild(menuButton);
  }

  /**
   * Render a fixed footer with the view toggle and primary action buttons.
   *
   * @returns {void}
   */
  renderFooter() {
    const footer = this.create('footer', { class: 'rss-footer' });

    const viewToggleLabel = document.createElement('label');
    viewToggleLabel.className = 'rss-view-toggle';
    viewToggleLabel.title = 'Switch between the Timeline view and the grouped Feeds view';

    const viewToggle = document.createElement('input');
    viewToggle.type = 'checkbox';
    viewToggle.className = 'rss-view-toggle-input';
    viewToggle.setAttribute('aria-label', 'Timeline view');
    viewToggle.checked = this.viewMode !== 'feeds';
    viewToggle.addEventListener('change', () => this._handleViewToggle(viewToggle));
    viewToggleLabel.appendChild(viewToggle);

    const track = document.createElement('span');
    track.className = 'rss-view-toggle-track';
    const thumb = document.createElement('span');
    thumb.className = 'rss-view-toggle-thumb';
    track.appendChild(thumb);
    viewToggleLabel.appendChild(track);

    const viewToggleText = document.createElement('span');
    viewToggleText.className = 'rss-view-toggle-text';
    viewToggleLabel.appendChild(viewToggleText);

    this.viewToggleInput = viewToggle;
    this.viewToggleText = viewToggleText;
    this._updateViewToggleText();

    footer.appendChild(viewToggleLabel);

    const refreshButton = document.createElement('button');
    refreshButton.className = 'rss-refresh-all-button';
    refreshButton.textContent = 'Refresh All Feeds';
    refreshButton.addEventListener('click', () => this.handleRefreshAll());
    footer.appendChild(refreshButton);

    const addFeedButton = document.createElement('button');
    addFeedButton.className = 'rss-add-feed-button';
    addFeedButton.textContent = 'Add RSS Feed';
    addFeedButton.addEventListener('click', () => this.openAddFeedModal());
    footer.appendChild(addFeedButton);
  }

  /**
   * Handle the footer view-mode switch being flipped.
   *
   * Persists the new mode to the settings table and re-renders.
   *
   * @param {HTMLInputElement} input - The checkbox backing the switch
   * @returns {Promise<void>}
   */
  async _handleViewToggle(input) {
    const mode = input.checked ? 'timeline' : 'feeds';
    if (mode === this.viewMode) {
      return;
    }

    this.viewMode = mode;
    this.settings.viewMode = mode;
    this._updateViewToggleText();

    try {
      await saveSettings({ viewMode: mode });
    } catch (error) {
      console.error('Failed to save view mode:', error);
      this.showToast(`Could not save view preference: ${error.message}`, 'error');
    }

    this.renderFeeds();
  }

  /**
   * Re-apply the saved view mode to the footer switch after startup.
   *
   * The switch is rendered before settings load, so it may need a sync.
   *
   * @returns {void}
   */
  _syncViewToggle() {
    if (!this.viewToggleInput) {
      return;
    }
    this.viewToggleInput.checked = this.viewMode !== 'feeds';
    this._updateViewToggleText();
  }

  /**
   * Update the label text next to the view switch.
   *
   * @returns {void}
   */
  _updateViewToggleText() {
    if (this.viewToggleText) {
      this.viewToggleText.textContent = this.viewMode === 'feeds' ? 'Feeds' : 'Timeline';
    }
  }

  /**
   * Create the command panel and register the available app commands.
   *
   * @returns {void}
   */
  initializeCommandPanel() {
    this.commandPanel = document.createElement('command-panel');
    this.commandPanel.setAttribute('open-keys', 'ctrl+shift+p');

    const commands = [
      { name: 'Add RSS Feed', icon: '➕', action: () => this.openAddFeedModal() },
      { name: 'Manage Feeds', icon: '📂', action: () => this.openManageFeedsModal() },
      { name: 'Refresh All Feeds', icon: '🔄', action: () => this.handleRefreshAll() },
      { name: 'Mark All Read', icon: '✓', action: () => this.handleMarkAllRead() },
      { name: 'Settings', icon: '⚙️', action: () => this.openSettingsModal() },
      { name: 'Export OPML', icon: '📤', action: () => this.handleExportOPML() },
      { name: 'Import OPML', icon: '📥', action: () => this.handleImportOPML() },
      { name: 'Help', icon: '❓', action: () => window.open('/help.html', '_blank') },
    ];

    for (const command of commands) {
      this.commandPanel.addCommand(command.name, command.icon, command.action);
    }

    this.appendChild(this.commandPanel);
  }

  /**
   * Handle clicks outside the menu and modals.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  handleDocumentClick(event) {
    const existingKebabMenu = this.querySelector('.rss-kebab-menu');
    if (existingKebabMenu && !existingKebabMenu.contains(event.target)) {
      existingKebabMenu.remove();
    }

    if (this.activeModal && !this.activeModal.contains(event.target)) {
      // Only close if clicking the overlay background
      if (event.target.classList.contains('rss-modal-overlay')) {
        this.closeModal();
      }
    }
  }

  /**
   * Handle clicks inside the article list via event delegation.
   *
   * This replaces the per-article addEventListener calls in renderArticle()
   * so refreshing the list does not leave behind detached DOM trees that
   * retain article/feed objects through closures.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  _handleContentClick(event) {
    // Links inside rendered social post content (link facets and external
    // link cards in the feed list) open in the user's default browser.
    // DOMPurify strips target="_blank", so without this the anchor would
    // navigate the app window itself.
    const contentLink = event.target.closest('.rss-article-content a[href]');
    if (contentLink) {
      const href = contentLink.getAttribute('href');
      if (href && !href.startsWith('#')) {
        event.preventDefault();
        event.stopPropagation();
        // Resolve relative links against the containing article's own URL,
        // since the app origin is meaningless for feed content. Bluesky
        // facet/card URIs are always absolute, so this is just a safety net.
        const articleEl = event.target.closest('[data-article-id]');
        const feedID = event.target.closest('[data-feed-id]')?.getAttribute('data-feed-id');
        const article = articleEl && feedID
          ? this.findArticle(feedID, articleEl.getAttribute('data-article-id'))
          : null;
        let resolved;
        try {
          resolved = new URL(href, article?.url || window.location.href);
        } catch {
          resolved = null;
        }
        if (resolved && (resolved.protocol === 'http:' || resolved.protocol === 'https:')) {
          this.openExternalURL(resolved.href);
        }
      }
      return;
    }

    // Matches both the grouped view's .rss-feed blocks and the timeline
    // view's .rss-timeline-item wrappers; both carry data-feed-id.
    const feedEl = event.target.closest('[data-feed-id]');
    if (!feedEl) {
      return;
    }

    // Keep feed action buttons from toggling the surrounding <details>.
    if (event.target.closest('.rss-feed-actions')) {
      event.stopPropagation();
    }

    const feedID = feedEl.getAttribute('data-feed-id');
    const feed = this.feeds.find((f) => f.feedID === feedID);
    if (!feed) {
      return;
    }

    const actionEl = event.target.closest('[data-action]');
    const action = actionEl?.getAttribute('data-action');

    if (action === 'feed-menu') {
      this.showFeedMenu(feedID, actionEl);
      return;
    }

    const articleEl = event.target.closest('.rss-article');
    if (!articleEl) {
      return;
    }

    const articleID = articleEl.getAttribute('data-article-id');
    const article = this.findArticle(feedID, articleID);
    if (!article) {
      return;
    }

    switch (action) {
      case 'open-article':
        this.openArticleViewer(article, feed);
        break;
      case 'mark-read':
        if (article.read) {
          this.markAsUnread(feedID, articleID);
        } else {
          this._selectSurvivingArticle(feedID, articleID);
          this.markAsRead(feedID, articleID);
        }
        break;
      case 'toggle-star':
        this.toggleStar(feedID, articleID);
        break;
      case 'export-markdown':
        this.exportArticleMarkdown(article, feed);
        break;
      case 'save-file':
        this.saveArticleToFile(article);
        break;
      case 'download-youtube':
        this._downloadYouTubeVideo(article, feed, actionEl);
        break;
      default:
        // Clicks on non-action parts of the article do nothing.
        break;
    }
  }

  /**
   * Register delegated listeners for the image context menu.
   *
   * Right-clicking (or ctrl-clicking, for trackpad users) any image inside
   * feed content — article bodies, markdown exports, social posts — opens
   * a small menu offering "Copy Image" and "Save Image…". Electron does
   * not ship a default context menu, so this fills that gap.
   *
   * @returns {void}
   */
  _setupImageContextMenu() {
    this._imageContextMenuHandler = (e) => {
      const image = e.target.closest('img');
      if (!image) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this._showImageMenu(image, e.clientX, e.clientY);
    };
    this.addEventListener('contextmenu', this._imageContextMenuHandler);

    // Ctrl+click fires a native contextmenu on macOS but not everywhere;
    // handle it explicitly so ctrl-click works as promised.
    this._imageCtrlClickHandler = (e) => {
      if (!e.ctrlKey || e.button !== 0) {
        return;
      }
      const image = e.target.closest('img');
      if (!image) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this._showImageMenu(image, e.clientX, e.clientY);
    };
    this.addEventListener('click', this._imageCtrlClickHandler);
  }

  /**
   * Show the image action menu anchored at the pointer position.
   *
   * Replaces any previously open menu. The menu reuses .rss-kebab-menu
   * styling and is closed by the existing document click handler.
   *
   * @param {HTMLImageElement} image - The clicked image element
   * @param {number} clientX - Pointer X position in viewport coordinates
   * @param {number} clientY - Pointer Y position in viewport coordinates
   * @returns {void}
   */
  _showImageMenu(image, clientX, clientY) {
    const existingMenu = this.querySelector('.rss-image-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'rss-kebab-menu rss-image-context-menu';

    const componentRect = this.getBoundingClientRect();
    menu.style.left = `${clientX - componentRect.left}px`;
    menu.style.top = `${clientY - componentRect.top}px`;

    const items = [
      {
        label: 'Copy Image',
        disabled: typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write,
        action: () => this.copyImageToClipboard(image),
      },
      {
        label: 'Save Image…',
        disabled: !isFileSystemAccessSupported(),
        action: () => this.saveImageToFile(image),
      },
    ];

    for (const item of items) {
      const menuItem = document.createElement('div');
      menuItem.className = 'rss-menu-item';
      menuItem.textContent = item.label;
      if (item.disabled) {
        menuItem.classList.add('rss-menu-item-disabled');
        menuItem.setAttribute('aria-disabled', 'true');
      } else {
        menuItem.addEventListener('click', () => {
          menu.remove();
          item.action();
        });
      }
      menu.appendChild(menuItem);
    }

    this.appendChild(menu);
  }

  /**
   * Fetch an image's bytes through the network helper.
   *
   * In Electron the main-process bridge avoids CORS problems with remote
   * feed images; elsewhere it falls back to renderer fetch().
   *
   * @param {HTMLImageElement} image - The image element to fetch
   * @returns {Promise<{buffer: Uint8Array, mimeType: string}>}
   * @throws {Error} When the fetch fails or the response is not OK
   */
  async _fetchImageBytes(image) {
    const url = getUsableImageURL(image);
    if (!url) {
      throw new Error('Image has no URL.');
    }

    const response = await fetchBytes(url);
    if (!response.ok || !response.buffer) {
      throw new Error(`Failed to download image (HTTP ${response.status}).`);
    }

    return {
      buffer: response.buffer,
      mimeType: response.contentType || '',
    };
  }

  /**
   * Copy an image to the system clipboard.
   *
   * @param {HTMLImageElement} image - The image element to copy
   * @returns {Promise<void>}
   */
  async copyImageToClipboard(image) {
    try {
      const { buffer, mimeType } = await this._fetchImageBytes(image);
      const type = mimeType.startsWith('image/') ? mimeType : 'image/png';
      const blob = new Blob([buffer], { type });
      await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
      this.showToast('Image copied to clipboard');
    } catch (error) {
      console.error('Failed to copy image:', error);
      this.showToast(`Could not copy image: ${error.message}`, 'error');
    }
  }

  /**
   * Save an image to disk via the native save dialog.
   *
   * @param {HTMLImageElement} image - The image element to save
   * @returns {Promise<void>}
   */
  async saveImageToFile(image) {
    try {
      const { buffer, mimeType } = await this._fetchImageBytes(image);
      const filename = deriveImageFilename(getUsableImageURL(image), mimeType);
      const name = await saveBytesToDisk(filename, buffer, buildImageAcceptTypes(mimeType));
      this.showToast(`Saved ${name}`);
    } catch (error) {
      if (isUserCancellation(error)) return;
      console.error('Failed to save image:', error);
      this.showToast(`Could not save image: ${error.message}`, 'error');
    }
  }

  /**
   * Handle clicks on links inside an article viewer body.
   *
   * Every http(s) link is opened in the user's default browser so the
   * application window is never navigated away from the feed. Relative
   * links are resolved against the article's own URL, since the app origin
   * is meaningless for feed content.
   *
   * @param {MouseEvent} event
   * @param {string} [baseUrl] - Article URL used to resolve relative links
   * @returns {void}
   */
  _handleArticleBodyClick(event, baseUrl) {
    const link = event.target.closest('a[href]');
    if (!link) {
      return;
    }

    const href = link.getAttribute('href');
    // Pure fragment links keep their in-page jump; empty hrefs do nothing.
    if (!href || href.startsWith('#')) {
      return;
    }

    // Resolve every link against the article's own URL. The app origin is
    // meaningless for feed content, so relative links would otherwise try
    // to navigate the whole app window to app://<site-path>.
    let resolved;
    try {
      resolved = new URL(href, baseUrl || window.location.href);
    } catch {
      return;
    }

    // Non-http(s) schemes (mailto:, tel:) fall through to default handling,
    // which Electron routes to the OS handler via will-navigate.
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.openExternalURL(resolved.href);
  }

  /**
   * Load feeds from the database and re-render.
   *
   * @async
   * @returns {Promise<void>}
   */
  async refreshFeeds() {
    try {
      // Only unread articles are needed for the main list, so avoid loading
      // potentially large read-article bodies into the renderer.
      this.feeds = sortFeedsByUnreadCount(await loadFeedsForDisplay());
      this.renderFeeds();
    } catch (error) {
      console.error('Failed to load feeds:', error);
      this.showToast(`Failed to load feeds: ${error.message}`, 'error');
    }
  }

  /**
   * Render the feed list into the content area.
   *
   * `this.feeds` is expected to already be in the desired order.
   *
   * @returns {void}
   */
  renderFeeds() {
    // Cancel any pending animation-frame render so direct renders always
    // win and never get overwritten by a stale scheduled render.
    this._cancelScheduledRender();

    // The timeline view flattens all articles into one chronological list.
    if (this.viewMode === 'timeline') {
      this.renderTimeline();
      return;
    }

    // Remember which feeds the user has collapsed so incremental refreshes
    // do not force every feed back open.
    const openState = new Map();
    for (const details of this.contentArea.querySelectorAll('.rss-feed-details')) {
      const feedDiv = details.closest('.rss-feed');
      if (feedDiv) {
        openState.set(feedDiv.getAttribute('data-feed-id'), details.open);
      }
    }

    this.contentArea.innerHTML = '';

    if (this.feeds.length === 0) {
      this.contentArea.appendChild(this._createEmptyStateElement());
      return;
    }

    for (const feed of this.feeds) {
      this.renderFeed(this.contentArea, feed, openState);
    }

    this._restoreSelection();
    this._ensureFirstArticleSelected();

    if (this._findBar?.classList.contains('rss-find-bar--visible')) {
      this._runFind({ selectFirst: true });
    }
  }

  /**
   * Build the shared "no feeds yet" placeholder.
   *
   * @returns {HTMLElement}
   */
  _createEmptyStateElement() {
    const empty = document.createElement('div');
    empty.className = 'rss-empty-state';

    const message = document.createElement('p');
    message.textContent = 'No RSS feeds added yet.';
    empty.appendChild(message);

    const hint = document.createElement('p');
    hint.textContent = 'Open the menu and select "Add RSS Feed" to get started.';
    empty.appendChild(hint);

    return empty;
  }

  /**
   * Render the Timeline view: every feed's unread articles in one flat,
   * chronologically ordered list regardless of which feed they came from.
   *
   * @returns {void}
   */
  renderTimeline() {
    this.contentArea.innerHTML = '';

    if (this.feeds.length === 0) {
      this.contentArea.appendChild(this._createEmptyStateElement());
      return;
    }

    const container = document.createElement('div');
    container.className = 'rss-timeline';

    const items = buildTimelineItems(this.feeds, this.settings.maxArticlesPerFeed);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rss-no-articles';
      empty.textContent = 'No unread articles';
      container.appendChild(empty);
    } else {
      for (const { feed, article } of items) {
        // The wrapper carries data-feed-id so selection, click delegation,
        // and article actions keep working exactly as in the feeds view.
        const entry = document.createElement('div');
        entry.className = 'rss-timeline-item';
        entry.setAttribute('data-feed-id', feed.feedID);

        this.renderArticle(entry, article, feed, { showFeedName: true });
        container.appendChild(entry);
      }
    }

    this.contentArea.appendChild(container);

    this._restoreSelection();
    this._ensureFirstArticleSelected();

    if (this._findBar?.classList.contains('rss-find-bar--visible')) {
      this._runFind({ selectFirst: true });
    }
  }

  /**
   * Cancel a pending scheduled render, if any.
   *
   * @returns {void}
   */
  _cancelScheduledRender() {
    if (this._renderFrame) {
      cancelAnimationFrame(this._renderFrame);
      this._renderFrame = null;
    }
  }

  /**
   * Schedule a render of the feed list on the next animation frame.
   *
   * Multiple calls in the same frame are coalesced into a single render,
   * which prevents incremental refresh updates from thrashing the DOM and
   * blocking user interactions such as marking articles as read.
   *
   * @returns {void}
   */
  scheduleRenderFeeds() {
    if (this._renderFrame) {
      return;
    }
    this._renderFrame = requestAnimationFrame(() => {
      this._renderFrame = null;
      this.renderFeeds();
    });
  }

  /**
   * Render a single feed block.
   *
   * @param {HTMLElement} container
   * @param {object} feed
   * @param {Map<string, boolean>} [openState] - Existing open/closed state for feeds.
   * @returns {void}
   */
  renderFeed(container, feed, openState = new Map()) {
    const feedDiv = document.createElement('div');
    feedDiv.className = 'rss-feed';
    feedDiv.setAttribute('data-feed-id', feed.feedID);

    const details = document.createElement('details');
    details.className = 'rss-feed-details';
    details.open = openState.has(feed.feedID) ? openState.get(feed.feedID) : true;

    const summary = document.createElement('summary');
    summary.className = 'rss-feed-summary';

    const titleEl = document.createElement('span');
    titleEl.className = 'rss-feed-title';
    titleEl.textContent = feed.name || 'Untitled Feed';
    summary.appendChild(titleEl);

    if (feed.synthetic) {
      const syntheticIndicator = document.createElement('span');
      syntheticIndicator.className = 'rss-synthetic-indicator';
      syntheticIndicator.textContent = '🔄';
      syntheticIndicator.title = 'Generated RSS feed from HTML';
      summary.appendChild(syntheticIndicator);
    }

    const unreadCount = feed.articles.filter((article) => !article.read).length;
    if (unreadCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'rss-unread-badge';
      badge.textContent = String(unreadCount);
      summary.appendChild(badge);
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'rss-feed-actions';

    const kebabButton = document.createElement('button');
    kebabButton.className = 'rss-kebab-button';
    kebabButton.textContent = '⋯';
    kebabButton.setAttribute('data-action', 'feed-menu');
    actionsDiv.appendChild(kebabButton);
    summary.appendChild(actionsDiv);

    details.appendChild(summary);

    const articlesContainer = document.createElement('div');
    articlesContainer.className = 'rss-articles-container';

    const articles = feed.articles
      .filter((article) => !article.read)
      .slice(0, this.settings.maxArticlesPerFeed);

    if (articles.length === 0) {
      const emptyArticles = document.createElement('div');
      emptyArticles.className = 'rss-no-articles';
      emptyArticles.textContent = 'No unread articles';
      articlesContainer.appendChild(emptyArticles);
    } else {
      for (const article of articles) {
        this.renderArticle(articlesContainer, article, feed);
      }
    }

    details.appendChild(articlesContainer);
    feedDiv.appendChild(details);
    container.appendChild(feedDiv);
  }

  /**
   * Render a single article.
   *
   * @param {HTMLElement} container
   * @param {object} article
   * @param {object} feed
   * @param {object} [options]
   * @param {boolean} [options.showFeedName=false] - Prefix the meta line with the feed name (used by the timeline view).
   * @returns {void}
   */
  renderArticle(container, article, feed, options = {}) {
    const articleDiv = document.createElement('div');
    articleDiv.className = 'rss-article';
    articleDiv.setAttribute('data-article-id', article.articleID);
    articleDiv.tabIndex = -1;

    if (!article.read) {
      articleDiv.classList.add('rss-article-unread');
    }

    const titleDiv = document.createElement('div');
    titleDiv.className = 'rss-article-title';

    const titleEl = document.createElement(article.read ? 'span' : 'strong');
    titleEl.textContent = article.title || 'Untitled';

    if (article.url) {
      titleEl.classList.add('rss-article-link');
      titleEl.setAttribute('data-action', 'open-article');
    }
    titleDiv.appendChild(titleEl);

    if (isYouTubeURL(article.url)) {
      const youtubeBadge = document.createElement('span');
      youtubeBadge.className = 'rss-youtube-badge';
      youtubeBadge.textContent = '▶ YouTube';
      youtubeBadge.title = 'YouTube video';
      titleDiv.appendChild(youtubeBadge);
    }

    articleDiv.appendChild(titleDiv);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'rss-article-meta';

    if (options.showFeedName && feed?.name) {
      const feedSpan = document.createElement('span');
      feedSpan.className = 'rss-article-feed-name';
      feedSpan.textContent = feed.name;
      metaDiv.appendChild(feedSpan);
    }

    if (article.datePublished) {
      const dateSpan = document.createElement('span');
      dateSpan.className = 'rss-article-date';
      dateSpan.textContent =
        (metaDiv.children.length > 0 ? ' • ' : '') + this.formatDate(article.datePublished);
      metaDiv.appendChild(dateSpan);
    }

    if (article.authors && article.authors.length > 0) {
      const authorSpan = document.createElement('span');
      authorSpan.className = 'rss-article-author';
      authorSpan.textContent = ` • ${article.authors[0].name}`;
      metaDiv.appendChild(authorSpan);
    }

    if (metaDiv.children.length > 0) {
      articleDiv.appendChild(metaDiv);
    }

    if (this.isSocialArticle(article) && (article.contentHTML || article.contentText)) {
      const contentDiv = document.createElement('div');
      contentDiv.className = 'rss-article-content';
      const rawHtml = article.contentHTML || this.escapeHTML(article.contentText).replace(/\n/g, '<br>');
      contentDiv.innerHTML = this.sanitizeHTML(rawHtml);
      articleDiv.appendChild(contentDiv);
    } else if (article.summary) {
      const summaryDiv = document.createElement('div');
      summaryDiv.className = 'rss-article-summary';
      summaryDiv.textContent = article.summary;
      articleDiv.appendChild(summaryDiv);
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'rss-article-actions';

    const readButton = document.createElement('button');
    readButton.className = 'rss-action-button';
    readButton.textContent = article.read ? 'Mark Unread' : 'Mark Read';
    readButton.setAttribute('data-action', 'mark-read');
    actionsDiv.appendChild(readButton);

    const starButton = document.createElement('button');
    starButton.className = 'rss-action-button';
    starButton.textContent = article.starred ? 'Unstar' : 'Star';
    starButton.setAttribute('data-action', 'toggle-star');
    actionsDiv.appendChild(starButton);

    if (article.url) {
      const openButton = document.createElement('button');
      openButton.className = 'rss-action-button';
      openButton.textContent = 'Read';
      openButton.setAttribute('data-action', 'open-article');
      actionsDiv.appendChild(openButton);
    }

    if (article.url && isYouTubeURL(article.url)) {
      const downloadButton = document.createElement('button');
      downloadButton.className = 'rss-action-button rss-youtube-download-button';
      downloadButton.textContent = article.downloadPath ? 'Downloaded ✓' : 'Download Video';
      downloadButton.setAttribute('data-action', 'download-youtube');
      actionsDiv.appendChild(downloadButton);
    }

    const exportButton = document.createElement('button');
    exportButton.className = 'rss-action-button';
    exportButton.textContent = 'Export Markdown';
    exportButton.setAttribute('data-action', 'export-markdown');
    actionsDiv.appendChild(exportButton);

    const saveButton = document.createElement('button');
    saveButton.className = 'rss-action-button';
    saveButton.textContent = 'Save to File';
    saveButton.setAttribute('data-action', 'save-file');
    actionsDiv.appendChild(saveButton);

    articleDiv.appendChild(actionsDiv);
    container.appendChild(articleDiv);
  }

  /**
   * Show the kebab menu for a feed.
   *
   * @param {string} feedID
   * @param {HTMLElement} buttonElement
   * @returns {void}
   */
  showFeedMenu(feedID, buttonElement) {
    const existingMenu = this.querySelector('.rss-kebab-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'rss-kebab-menu';

    const rect = buttonElement.getBoundingClientRect();
    const componentRect = this.getBoundingClientRect();
    menu.style.top = `${rect.bottom - componentRect.top + 5}px`;
    menu.style.right = `${componentRect.right - rect.right}px`;

    const feed = this.feeds.find((f) => f.feedID === feedID);

    const items = [
      {
        label: 'Mark All Read',
        action: () => this.markAllFeedAsRead(feedID),
      },
      {
        label: 'Refresh',
        action: () => this.refreshSingleFeed(feedID),
      },
      {
        label: 'Mark All Unread',
        action: () => this.markAllFeedAsUnread(feedID),
      },
    ];

    for (const item of items) {
      const menuItem = document.createElement('div');
      menuItem.className = 'rss-menu-item';
      if (item.className) menuItem.classList.add(item.className);
      menuItem.textContent = item.label;
      menuItem.addEventListener('click', () => {
        menu.remove();
        item.action();
      });
      menu.appendChild(menuItem);
    }

    if (feed) {
      const openOriginalItem = document.createElement('div');
      openOriginalItem.className = 'rss-menu-item rss-menu-item-checkbox';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(feed.openOriginalByDefault);
      checkbox.tabIndex = -1;

      const label = document.createElement('span');
      label.textContent = 'Open Original by Default';

      openOriginalItem.appendChild(checkbox);
      openOriginalItem.appendChild(label);
      openOriginalItem.addEventListener('click', async () => {
        const newValue = !checkbox.checked;
        try {
          await this.setFeedOpenOriginalByDefault(feedID, newValue);
          checkbox.checked = newValue;
        } catch (error) {
          console.error('Failed to update feed setting:', error);
          this.showToast('Failed to update feed setting', 'error');
        }
      });
      menu.appendChild(openOriginalItem);
    }

    if (feed && feed.homePageURL) {
      const menuItem = document.createElement('div');
      menuItem.className = 'rss-menu-item';
      menuItem.textContent = 'Visit Website';
      menuItem.addEventListener('click', () => {
        menu.remove();
        this.openExternalURL(feed.homePageURL);
      });
      menu.appendChild(menuItem);
    }

    const deleteItem = document.createElement('div');
    deleteItem.className = 'rss-menu-item rss-menu-item-danger';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', () => {
      menu.remove();
      this.confirmDeleteFeed(feedID);
    });
    menu.appendChild(deleteItem);

    this.appendChild(menu);
  }

  /**
   * Open the Add Feed modal.
   *
   * @returns {void}
   */
  openAddFeedModal() {
    const modal = this.createModal('Add RSS Feed');

    const label = document.createElement('label');
    label.textContent = 'URL';
    modal.body.appendChild(label);

    const input = document.createElement('input');
    input.type = 'url';
    input.placeholder = 'https://example.com or feed URL';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitButton.click();
    });
    modal.body.appendChild(input);

    const help = document.createElement('p');
    help.className = 'rss-modal-help';
    help.textContent = 'Enter a website URL or direct RSS feed URL.';
    modal.body.appendChild(help);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'rss-modal-buttons';

    const submitButton = document.createElement('button');
    submitButton.className = 'rss-button-primary';
    submitButton.textContent = 'Discover & Add Feed';
    submitButton.addEventListener('click', () => {
      const url = input.value.trim();
      if (!url) return;

      // Close right away; discovery continues out of view and the user
      // is only notified if it fails.
      this.closeModal();
      this.addFeedInBackground(url);
    });
    buttonContainer.appendChild(submitButton);

    const watchButton = document.createElement('button');
    watchButton.className = 'rss-button-secondary';
    watchButton.textContent = 'Watch Page (no RSS)';
    watchButton.title = 'Snapshot every link on the page; new links appear as items when the page changes.';
    watchButton.addEventListener('click', async () => {
      const url = input.value.trim();
      if (!url) return;

      watchButton.disabled = true;
      watchButton.textContent = 'Snapshotting…';

      try {
        this.showToast('Taking a snapshot of the page…');
        const feed = await addSnapshotFeed(url);

        if (feed) {
          // Important expectation-setting: a watched page starts empty.
          // Items only appear after the page changes and a refresh runs.
          this.showToast(
            `Watching ${feed.name}. The feed starts empty — you will not see any content until the page updates and you refresh.`,
            'info',
            8000,
          );
          this.closeModal();
          await this.refreshFeeds();
        } else {
          this.showToast('Failed to snapshot page. Check the URL and try again.', 'error');
        }
      } catch (error) {
        this.showToast(`Failed to watch page: ${error.message}`, 'error');
      } finally {
        watchButton.disabled = false;
        watchButton.textContent = 'Watch Page (no RSS)';
      }
    });
    buttonContainer.appendChild(watchButton);

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => this.closeModal());
    buttonContainer.appendChild(cancelButton);

    modal.body.appendChild(buttonContainer);
    input.focus();
  }

  /**
   * Discover and add a feed in the background, after the Add Feed modal
   * has already closed.
   *
   * A successful discovery silently refreshes the feed list — the user is
   * only notified when discovery was unsuccessful (no feeds found or a
   * hard error).
   *
   * Note: network fetching stays on the main thread because the Electron
   * preload fetch bridge is only available there. Discovery is dominated
   * by awaited network I/O, so it proceeds without freezing the UI even
   * though it is not inside a Worker.
   *
   * @param {string} url - Website URL or direct feed URL
   * @returns {Promise<void>}
   */
  async addFeedInBackground(url) {
    try {
      const feed = await discoverAndAddFeed(url);

      if (!feed) {
        this.showToast('No RSS feeds found. Try a direct feed URL, or use Watch Page.', 'error');
        return;
      }

      // Silent success: just fold the new feed into the visible list.
      await this.refreshFeeds();
    } catch (error) {
      this.showToast(`Failed to add feed: ${error.message}`, 'error');
    }
  }

  /**
   * Open the Manage Feeds modal.
   *
   * @returns {Promise<void>}
   */
  async openManageFeedsModal() {
    const modal = this.createModal('Manage RSS Feeds');
    try {
      const allFeeds = await loadAllFeeds();
      this.renderManageFeedsBody(modal.body, allFeeds);
    } catch (error) {
      console.error('Failed to load feeds for management:', error);
      modal.body.innerHTML = '';
      const message = document.createElement('p');
      message.className = 'rss-empty-state';
      message.textContent = `Failed to load feeds: ${error.message}`;
      modal.body.appendChild(message);
    }
  }

  /**
   * Render the body of the Manage Feeds modal.
   *
   * @param {HTMLElement} body
   * @param {Array<object>} feeds - Full feed data (including read articles).
   * @returns {void}
   */
  renderManageFeedsBody(body, feeds) {
    body.innerHTML = '';

    if (feeds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'rss-empty-state';
      empty.textContent = 'No feeds to manage.';
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'rss-manage-feed-list';

    const sortedFeeds = [...feeds].sort((a, b) => {
      return (a.name || 'Untitled Feed').localeCompare(b.name || 'Untitled Feed');
    });

    for (const feed of sortedFeeds) {
      const item = document.createElement('div');
      item.className = 'rss-manage-feed-item';

      const info = document.createElement('div');
      info.className = 'rss-manage-feed-info';

      const title = document.createElement('h3');
      title.textContent = feed.name || 'Untitled Feed';
      info.appendChild(title);

      const url = document.createElement('p');
      url.className = 'rss-manage-feed-url';
      url.textContent = feed.url;
      info.appendChild(url);

      const stats = document.createElement('p');
      stats.className = 'rss-manage-feed-stats';
      const unreadCount = feed.articles.filter((a) => !a.read).length;
      stats.textContent = `${feed.articles.length} articles (${unreadCount} unread)`;
      info.appendChild(stats);

      if (feed.lastFetchEndTime) {
        const lastUpdate = document.createElement('p');
        lastUpdate.className = 'rss-manage-feed-last-update';
        lastUpdate.textContent = `Last updated: ${feed.lastFetchEndTime.toLocaleString()}`;
        info.appendChild(lastUpdate);
      }

      item.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'rss-manage-feed-actions';

      const refreshButton = document.createElement('button');
      refreshButton.textContent = 'Refresh';
      refreshButton.addEventListener('click', async () => {
        await this.refreshSingleFeed(feed.feedID);
        const refreshedFeeds = await loadAllFeeds();
        this.renderManageFeedsBody(body, refreshedFeeds);
      });
      actions.appendChild(refreshButton);

      const deleteButton = document.createElement('button');
      deleteButton.className = 'rss-button-danger';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => {
        this.confirmDeleteFeed(feed.feedID, async () => {
          const remainingFeeds = await loadAllFeeds();
          this.renderManageFeedsBody(body, remainingFeeds);
        });
      });
      actions.appendChild(deleteButton);

      item.appendChild(actions);
      list.appendChild(item);
    }

    body.appendChild(list);
  }

  /**
   * Open the Settings modal.
   *
   * @returns {void}
   */
  openSettingsModal() {
    const modal = this.createModal('Settings', { fullPage: true });

    const form = document.createElement('div');
    form.className = 'rss-settings-form';

    const maxLabel = document.createElement('label');
    maxLabel.textContent = 'Max articles per feed';
    form.appendChild(maxLabel);

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.min = '10';
    maxInput.max = '200';
    maxInput.step = '10';
    maxInput.value = String(this.settings.maxArticlesPerFeed);
    form.appendChild(maxInput);

    const refreshLabel = document.createElement('label');
    refreshLabel.textContent = 'Auto-refresh interval (minutes)';
    form.appendChild(refreshLabel);

    const refreshInput = document.createElement('input');
    refreshInput.type = 'number';
    refreshInput.className = 'rss-refresh-interval-input';
    refreshInput.min = String(REFRESH_INTERVAL_BOUNDS.min);
    refreshInput.max = String(REFRESH_INTERVAL_BOUNDS.max);
    refreshInput.step = '1';
    refreshInput.value = String(this.settings.refreshInterval ?? DEFAULT_SETTINGS.refreshInterval);
    form.appendChild(refreshInput);

    const refreshHelp = document.createElement('p');
    refreshHelp.className = 'rss-modal-help';
    refreshHelp.textContent = 'Set to 0 to disable automatic refresh. Maximum is 1440 minutes (1 day).';
    form.appendChild(refreshHelp);

    const folderLabel = document.createElement('label');
    folderLabel.textContent = 'Sources folder name';
    form.appendChild(folderLabel);

    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.value = this.settings.sourcesFolder;
    form.appendChild(folderInput);

    const unreadLabel = document.createElement('label');
    unreadLabel.className = 'rss-checkbox-label';

    const unreadCheckbox = document.createElement('input');
    unreadCheckbox.type = 'checkbox';
    unreadCheckbox.checked = this.settings.showUnreadOnly;
    unreadLabel.appendChild(unreadCheckbox);

    const unreadText = document.createElement('span');
    unreadText.textContent = 'Show unread articles only';
    unreadLabel.appendChild(unreadText);
    form.appendChild(unreadLabel);

    const themeLabel = document.createElement('label');
    themeLabel.textContent = 'Custom theme CSS';
    form.appendChild(themeLabel);

    const themeStatus = document.createElement('p');
    themeStatus.className = 'rss-modal-help';
    themeStatus.textContent = isFileSystemAccessSupported()
      ? 'Edit CSS below, or use Download / Upload to save and load theme.css files.'
      : 'Edit CSS below to customize the theme. File pickers are unavailable in this browser.';
    form.appendChild(themeStatus);

    const themeTextarea = document.createElement('textarea');
    themeTextarea.className = 'rss-theme-textarea';
    themeTextarea.rows = 12;
    themeTextarea.placeholder = '/* Paste or type theme CSS here */';
    themeTextarea.value = this.settings.theme || '';
    form.appendChild(themeTextarea);

    const themeButtons = document.createElement('div');
    themeButtons.className = 'rss-modal-buttons rss-theme-buttons';

    const downloadThemeButton = document.createElement('button');
    downloadThemeButton.textContent = 'Download theme.css';
    downloadThemeButton.addEventListener('click', async () => {
      try {
        const css = themeTextarea.value;
        const name = await saveCSSToDisk('theme.css', css);
        this.showToast(`Saved ${name}`);
      } catch (error) {
        if (isUserCancellation(error)) return;
        this.showToast(`Download failed: ${error.message}`, 'error');
      }
    });
    themeButtons.appendChild(downloadThemeButton);

    const uploadThemeButton = document.createElement('button');
    uploadThemeButton.textContent = 'Upload theme.css';
    uploadThemeButton.addEventListener('click', async () => {
      try {
        const { name, text } = await pickCSSTextFileFromDisk();
        themeTextarea.value = text;
        this.showToast(`Loaded ${name}`);
      } catch (error) {
        if (isUserCancellation(error)) return;
        this.showToast(`Upload failed: ${error.message}`, 'error');
      }
    });
    themeButtons.appendChild(uploadThemeButton);

    const resetThemeButton = document.createElement('button');
    resetThemeButton.className = 'rss-button-danger';
    resetThemeButton.textContent = 'Reset Theme';
    resetThemeButton.addEventListener('click', () => {
      themeTextarea.value = '';
      this.showToast('Theme reset to default — save to apply');
    });
    themeButtons.appendChild(resetThemeButton);

    form.appendChild(themeButtons);

    modal.body.appendChild(form);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'rss-modal-buttons';

    const saveButton = document.createElement('button');
    saveButton.className = 'rss-button-primary';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', async () => {
      this.settings.maxArticlesPerFeed = parseInt(maxInput.value, 10) || DEFAULT_SETTINGS.maxArticlesPerFeed;
      this.settings.sourcesFolder = folderInput.value.trim() || DEFAULT_SETTINGS.sourcesFolder;
      this.settings.showUnreadOnly = unreadCheckbox.checked;
      this.settings.theme = themeTextarea.value;

      const rawRefreshInterval = parseInt(refreshInput.value, 10);
      this.settings.refreshInterval = Number.isFinite(rawRefreshInterval)
        ? Math.max(REFRESH_INTERVAL_BOUNDS.min, Math.min(REFRESH_INTERVAL_BOUNDS.max, rawRefreshInterval))
        : DEFAULT_SETTINGS.refreshInterval;

      try {
        await saveSettings(this.settings);
        this.applyTheme();
        this._startAutoRefresh();
        this.showToast('Settings saved');
        this.closeModal();
        this.renderFeeds();
      } catch (error) {
        this.showToast(`Failed to save settings: ${error.message}`, 'error');
      }
    });
    buttonContainer.appendChild(saveButton);

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => this.closeModal());
    buttonContainer.appendChild(cancelButton);

    modal.body.appendChild(buttonContainer);
  }

  /**
   * Apply the user's custom theme CSS to the document.
   *
   * Inserts or updates a <style> element in the document head. An empty
   * theme removes the element and restores the default look.
   *
   * @returns {void}
   */
  applyTheme() {
    const css = this.settings.theme || '';
    let styleElement = document.getElementById(THEME_STYLE_ID);

    if (!css.trim()) {
      if (styleElement) {
        styleElement.remove();
      }
      return;
    }

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = THEME_STYLE_ID;
      document.head.appendChild(styleElement);
    }

    styleElement.textContent = css;
  }

  /**
   * Create a modal overlay and return the body element.
   *
   * @param {string} title
   * @param {object} [options]
   * @param {boolean} [options.fullPage=false]
   * @returns {{overlay: HTMLElement, body: HTMLElement}}
   */
  createModal(title, options = {}) {
    this.closeModal();
    this._closeFind();

    const overlay = document.createElement('div');
    overlay.className = options.fullPage
      ? 'rss-modal-overlay rss-modal-overlay--full'
      : 'rss-modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = options.fullPage
      ? 'rss-modal-dialog rss-modal-dialog--full'
      : 'rss-modal-dialog';

    const header = document.createElement('div');
    header.className = 'rss-modal-header';

    const heading = document.createElement('h2');
    heading.textContent = title;
    header.appendChild(heading);

    const closeButton = document.createElement('button');
    closeButton.className = 'rss-modal-close';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.closeModal());
    header.appendChild(closeButton);

    dialog.appendChild(header);

    const body = document.createElement('div');
    body.className = 'rss-modal-body';
    dialog.appendChild(body);

    overlay.appendChild(dialog);
    this.appendChild(overlay);

    this.activeModal = overlay;
    this.lockBackgroundScroll();
    return { overlay, body };
  }

  /**
   * Close the active modal.
   *
   * @returns {void}
   */
  closeModal() {
    if (!this.activeModal) {
      return;
    }

    const overlay = this.activeModal;
    const wasArticleViewer = this._isArticleViewerModal(overlay);

    // Release any embedded YouTube player before removing the overlay.
    if (overlay._youtubePlayer && typeof overlay._youtubePlayer.destroy === 'function') {
      try {
        overlay._youtubePlayer.destroy();
      } catch (error) {
        console.error('Failed to destroy YouTube player:', error);
      }
      overlay._youtubePlayer = null;
    }

    // Release the original-page iframe and extracted body so the renderer
    // can reclaim the browsing context and large article objects.
    if (overlay._originalFrame) {
      overlay._originalFrame.removeAttribute('src');
      overlay._originalFrame.src = 'about:blank';
      overlay._originalFrame = null;
    }

    if (overlay._articleBody) {
      overlay._articleBody.innerHTML = '';
      overlay._articleBody = null;
    }

    overlay.remove();
    this.activeModal = null;
    this.unlockBackgroundScroll();

    if (wasArticleViewer && this._findBar?.classList.contains('rss-find-bar--visible')) {
      this._runFind({ selectFirst: true });
    }
  }

  /**
   * Lock the page body so only the active modal/article viewer scrolls.
   *
   * @returns {void}
   */
  lockBackgroundScroll() {
    if (this._scrollLockCount === 0) {
      this._previousBodyOverflow = document.body.style.overflow;
      this._previousHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }
    this._scrollLockCount += 1;
  }

  /**
   * Restore page body scrolling once the last lock is released.
   *
   * @returns {void}
   */
  unlockBackgroundScroll() {
    if (this._scrollLockCount <= 0) {
      return;
    }
    this._scrollLockCount -= 1;
    if (this._scrollLockCount === 0) {
      document.body.style.overflow = this._previousBodyOverflow;
      document.documentElement.style.overflow = this._previousHtmlOverflow;
    }
  }

  /**
   * Start the automatic refresh loop and listen for visibility changes.
   *
   * Safe to call repeatedly: it resets any pending timer first.
   *
   * @returns {void}
   */
  _startAutoRefresh() {
    this._stopAutoRefresh();

    if (!this._visibilityHandler) {
      this._visibilityHandler = () => this._handleVisibilityChange();
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    this._scheduleAutoRefresh();
  }

  /**
   * Clear the pending auto-refresh timer.
   *
   * @returns {void}
   */
  _stopAutoRefresh() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  /**
   * Schedule the next automatic refresh based on the configured interval.
   *
   * If the interval is set to 0, auto-refresh is disabled. The delay is
   * computed from the last refresh time so a refresh that happens early
   * (manual or on visibility change) does not cause a burst of updates.
   *
   * @returns {void}
   */
  _scheduleAutoRefresh() {
    const intervalMinutes = Number(this.settings?.refreshInterval ?? DEFAULT_SETTINGS.refreshInterval);
    if (intervalMinutes <= 0 || !Number.isFinite(intervalMinutes)) {
      return;
    }

    // Do not schedule refresh work while the app is hidden/minimized.
    // A visibilitychange handler will catch up when the user returns.
    if (document.visibilityState === 'hidden') {
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    const elapsed = Date.now() - this._lastRefreshAt;
    const delay = Math.max(0, intervalMs - elapsed);

    this._refreshTimer = setTimeout(() => this._runAutoRefresh(), delay);
  }

  /**
   * Perform an automatic refresh.
   *
   * Runs even when the page is hidden so feeds stay current in the
   * background (Electron disables renderer throttling for this window).
   *
   * @async
   * @returns {Promise<void>}
   */
  async _runAutoRefresh() {
    this._refreshTimer = null;

    try {
      await this.handleRefreshAll();
    } catch (error) {
      console.error('Auto-refresh failed:', error);
    } finally {
      this._lastRefreshAt = Date.now();
      this._scheduleAutoRefresh();
    }
  }

  /**
   * React to the page becoming visible again.
   *
   * Auto-refresh keeps running while the page is hidden, but if a refresh
   * fell overdue anyway, catch up immediately so the user sees current
   * data. Otherwise, just reload the view from the database in case a
   * previous refresh completed while the DOM was stale.
   *
   * @returns {void}
   */
  _handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      // Stop any pending refresh so the app does not churn while idle.
      this._stopAutoRefresh();
      return;
    }

    const intervalMinutes = Number(this.settings?.refreshInterval ?? DEFAULT_SETTINGS.refreshInterval);
    const intervalMs = intervalMinutes * 60 * 1000;
    const isDue = intervalMinutes > 0 && Date.now() - this._lastRefreshAt >= intervalMs;

    if (isDue) {
      this.handleRefreshAll();
    } else {
      this.refreshFeeds();
    }

    this._scheduleAutoRefresh();
  }

  /**
   * Wrap a promise in a timeout so a stalled network/database call cannot
   * leave the refresh button disabled forever.
   *
   * @param {Promise<T>} promise
   * @param {number} ms
   * @returns {Promise<T>}
   * @template T
   */
  _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Refresh timed out')), ms);
      }),
    ]);
  }

  /**
   * Create and show the lower-right refresh progress panel.
   *
   * @param {number} total - Total number of feeds that will be fetched.
   * @returns {void}
   */
  _showRefreshProgress(total) {
    this._hideRefreshProgress();

    const container = document.createElement('div');
    container.className = 'rss-refresh-progress';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');

    const title = document.createElement('div');
    title.className = 'rss-refresh-progress-title';
    title.textContent = total === 1 ? 'Refreshing feed…' : 'Refreshing feeds…';
    container.appendChild(title);

    const track = document.createElement('div');
    track.className = 'rss-refresh-progress-track';

    const fill = document.createElement('div');
    fill.className = 'rss-refresh-progress-fill';
    track.appendChild(fill);
    container.appendChild(track);

    const feedName = document.createElement('div');
    feedName.className = 'rss-refresh-progress-feed';
    feedName.textContent = 'Starting…';
    container.appendChild(feedName);

    this.appendChild(container);

    this._refreshProgress = {
      container,
      fill,
      feedName,
      total: Math.max(1, total),
      current: 0,
    };
  }

  /**
   * Update the progress panel with the current feed and fill percentage.
   *
   * @param {number} current - Number of feeds completed so far.
   * @param {string} feedName - Name (or URL) of the feed now being fetched.
   * @returns {void}
   */
  _updateRefreshProgress(current, feedName) {
    if (!this._refreshProgress) {
      return;
    }

    this._refreshProgress.current = current;
    const pct = Math.round((current / this._refreshProgress.total) * 100);
    this._refreshProgress.fill.style.width = `${pct}%`;
    this._refreshProgress.feedName.textContent = feedName
      ? `Fetching ${feedName}…`
      : 'Starting…';
  }

  /**
   * Remove the refresh progress panel from the DOM.
   *
   * @returns {void}
   */
  _hideRefreshProgress() {
    if (this._refreshProgress) {
      this._refreshProgress.container.remove();
      this._refreshProgress = null;
    }
  }

  /**
   * Replace a feed in the current list with its freshly fetched version and
   * re-render so the user sees updates as they arrive instead of all at once.
   *
   * @param {object} updatedFeed
   * @returns {void}
   */
  _mergeUpdatedFeed(updatedFeed) {
    const index = this.feeds.findIndex((f) => f.feedID === updatedFeed.feedID);
    if (index >= 0) {
      this.feeds[index] = updatedFeed;
    } else {
      this.feeds.push(updatedFeed);
    }
    // Defer the render so a burst of incremental updates does not block
    // the main thread while the user is interacting with articles.
    this.scheduleRenderFeeds();
  }

  /**
   * Advance the progress bar after a feed has been fetched.
   *
   * @param {string} feedName
   * @returns {void}
   */
  _advanceRefreshProgress(feedName) {
    if (!this._refreshProgress) {
      return;
    }

    this._refreshProgress.current += 1;
    const pct = Math.round((this._refreshProgress.current / this._refreshProgress.total) * 100);
    this._refreshProgress.fill.style.width = `${pct}%`;
    this._refreshProgress.feedName.textContent = feedName
      ? `Fetched ${feedName}`
      : 'Working…';
  }

  /**
   * Refresh all feeds.
   *
   * @async
   * @returns {Promise<void>}
   */
  async handleRefreshAll() {
    if (this.isRefreshing) {
      this.showToast('Refresh already in progress');
      return;
    }

    if (this.feeds.length === 0) {
      this.showToast('No feeds to refresh');
      return;
    }

    this.isRefreshing = true;
    this._showRefreshProgress(this.feeds.length);

    try {
      const results = await this._withTimeout(
        refreshAllFeeds(
          this.settings.maxArticlesPerFeed,
          (progress) => {
            this._updateRefreshProgress(
              progress.index,
              progress.feed.name || progress.feed.url
            );
          },
          (updatedFeed) => {
            this._mergeUpdatedFeed(updatedFeed);
            this._advanceRefreshProgress(updatedFeed.name || updatedFeed.url);
          }
        ),
        REFRESH_TIMEOUT_MS
      );
      const successCount = results.filter((r) => r.success).length;
      this.showToast(`Refreshed ${successCount}/${results.length} feeds`);
      this._cancelScheduledRender();
      await this.refreshFeeds();
      this._lastRefreshAt = Date.now();
      this._scheduleAutoRefresh();
    } catch (error) {
      this.showToast(`Refresh failed: ${error.message}`, 'error');
    } finally {
      this._hideRefreshProgress();
      this.isRefreshing = false;
    }
  }

  /**
   * Mark every unread article across all feeds as read.
   *
   * @returns {Promise<void>}
   */
  async handleMarkAllRead() {
    try {
      const count = await markAllArticlesAsRead();
      for (const feed of this.feeds) {
        for (const article of feed.articles) {
          article.read = true;
        }
      }
      this.showToast(`Marked ${count} article${count === 1 ? '' : 's'} as read`);
      this.renderFeeds();
    } catch (error) {
      this.showToast(`Failed to mark all read: ${error.message}`, 'error');
    }
  }

  /**
   * Refresh a single feed.
   *
   * @param {string} feedID
   * @returns {Promise<void>}
   */
  async refreshSingleFeed(feedID) {
    const feed = this.feeds.find((f) => f.feedID === feedID);
    const feedName = feed?.name || feed?.url || 'feed';

    this._showRefreshProgress(1);
    this._updateRefreshProgress(0, feedName);

    try {
      await this._withTimeout(
        refreshFeed(feedID, this.settings.maxArticlesPerFeed),
        REFRESH_TIMEOUT_MS
      );
      this.showToast('Feed refreshed');
      await this.refreshFeeds();
    } catch (error) {
      this.showToast(`Failed to refresh feed: ${error.message}`, 'error');
    } finally {
      this._hideRefreshProgress();
    }
  }

  /**
   * Confirm and delete a feed.
   *
   * @param {string} feedID
   * @param {Function} [onDeleted]
   * @returns {void}
   */
  confirmDeleteFeed(feedID, onDeleted) {
    const feed = this.feeds.find((f) => f.feedID === feedID);
    if (!feed) return;

    const modal = this.createModal('Delete Feed');

    const message = document.createElement('p');
    message.textContent = `Are you sure you want to delete "${feed.name || 'Untitled Feed'}"? This will remove the feed and all its articles.`;
    modal.body.appendChild(message);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'rss-modal-buttons';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => this.closeModal());
    buttonContainer.appendChild(cancelButton);

    const deleteButton = document.createElement('button');
    deleteButton.className = 'rss-button-danger';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', async () => {
      try {
        await deleteFeed(feedID);
        this.showToast('Feed deleted');
        this.closeModal();
        await this.refreshFeeds();
        if (onDeleted) onDeleted();
      } catch (error) {
        this.showToast(`Failed to delete feed: ${error.message}`, 'error');
      }
    });
    buttonContainer.appendChild(deleteButton);

    modal.body.appendChild(buttonContainer);
  }

  /**
   * Mark an article as read.
   *
   * @param {string} feedID
   * @param {string} articleID
   * @returns {Promise<void>}
   */
  async markAsRead(feedID, articleID) {
    try {
      await markArticleAsRead(feedID, articleID);
      const article = this.findArticle(feedID, articleID);
      if (article) {
        article.read = true;
      }
      this.renderFeeds();
    } catch (error) {
      console.error('Failed to mark article as read:', error);
    }
  }

  /**
   * Toggle whether a feed opens the original website by default.
   *
   * @param {string} feedID
   * @param {boolean} value
   * @returns {Promise<void>}
   */
  async setFeedOpenOriginalByDefault(feedID, value) {
    await updateFeedOpenOriginalByDefault(feedID, value);
    const feed = this.feeds.find((f) => f.feedID === feedID);
    if (feed) {
      feed.openOriginalByDefault = value;
    }
  }

  /**
   * Mark an article as unread.
   *
   * @param {string} feedID
   * @param {string} articleID
   * @returns {Promise<void>}
   */
  async markAsUnread(feedID, articleID) {
    try {
      await markArticleAsUnread(feedID, articleID);
      const article = this.findArticle(feedID, articleID);
      if (article) {
        article.read = false;
      }
      this.renderFeeds();
    } catch (error) {
      console.error('Failed to mark article as unread:', error);
    }
  }

  /**
   * Toggle an article's starred status.
   *
   * @param {string} feedID
   * @param {string} articleID
   * @returns {Promise<void>}
   */
  async toggleStar(feedID, articleID) {
    try {
      await toggleArticleStarred(feedID, articleID);
      const article = this.findArticle(feedID, articleID);
      if (article) {
        article.starred = !article.starred;
      }
      this.renderFeeds();
    } catch (error) {
      console.error('Failed to toggle star:', error);
    }
  }

  /**
   * Locate an article in the current feed list.
   *
   * @param {string} feedID
   * @param {string} articleID
   * @returns {object|undefined}
   */
  findArticle(feedID, articleID) {
    const feed = this.feeds.find((f) => f.feedID === feedID);
    return feed?.articles.find((a) => a.articleID === articleID);
  }

  /**
   * Determine whether an article URL belongs to a supported social platform.
   *
   * @param {object} article
   * @returns {boolean}
   */
  isSocialArticle(article) {
    return Boolean(article.url && identifySocialURL(article.url));
  }

  /**
   * Escape a plain-text string for safe insertion into HTML.
   *
   * @param {string} text
   * @returns {string}
   */
  escapeHTML(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Sanitize arbitrary HTML for in-app display.
   *
   * @param {string} html
   * @returns {string}
   */
  sanitizeHTML(html) {
    if (!html) return '';
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  /**
   * Open an external URL in the user's default browser.
   *
   * In Electron the main process handles the actual hand-off via the
   * preload bridge. In a plain browser (including Playwright tests) the
   * fallback opens a new tab so the app window is never navigated away.
   *
   * @param {string} url
   * @returns {void}
   */
  openExternalURL(url) {
    if (window.electron?.openExternal) {
      window.electron.openExternal(url);
      return;
    }
    window.open(url, '_blank');
  }

  /**
   * Open an article in an in-app Markdown viewer.
   *
   * Fetches the original page, extracts clean Markdown with Defuddle,
   * renders it to sanitized HTML, and presents it in a reading modal.
   *
   * @param {object} article
   * @param {object} feed
   * @returns {Promise<void>}
   */
  async openArticleViewer(article, feed) {
    if (!article.url) {
      this.showToast('Article has no URL to open', 'error');
      return;
    }

    if (isYouTubeURL(article.url)) {
      await this.openYouTubeViewer(article, feed);
      return;
    }

    if (this.isSocialArticle(article)) {
      await this.openSocialViewer(article, feed);
      return;
    }

    if (feed && feed.openOriginalByDefault) {
      await this.openOriginalViewer(article, feed);
      return;
    }

    const { overlay, body } = this.createArticleViewer(article, feed);

    try {
      this.showToast('Extracting article…');
      const extracted = await extractArticle(article.url);

      this.renderArticleViewerContent(body, article, feed, extracted);
      await this.markAsRead(feed.feedID, article.articleID);
    } catch (error) {
      console.error('Failed to open article viewer:', error);
      body.innerHTML = '';

      const errorMessage = document.createElement('p');
      errorMessage.className = 'rss-article-viewer-error';
      errorMessage.textContent = `Could not extract article: ${error.message}`;
      body.appendChild(errorMessage);

      const originalLink = document.createElement('button');
      originalLink.className = 'rss-action-button';
      originalLink.textContent = 'Open original page';
      originalLink.addEventListener('click', () => {
        this._showOriginalView(overlay, article.url);
      });
      body.appendChild(originalLink);
    }
  }

  /**
   * Open an article's original website directly in a minimal in-app viewer.
   *
   * Shows the URL in a sandboxed iframe with a small header containing a back
   * button that closes the viewer and returns to the feed list.
   *
   * @param {object} article
   * @param {object} feed
   * @returns {Promise<void>}
   */
  async openOriginalViewer(article, feed) {
    if (this.isSocialArticle(article)) {
      await this.openSocialViewer(article, feed);
      return;
    }

    this.closeModal();

    const overlay = document.createElement('div');
    overlay.className = 'rss-article-viewer-overlay rss-original-viewer-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'rss-article-viewer-dialog rss-original-viewer-dialog';

    const header = document.createElement('div');
    header.className = 'rss-article-viewer-header rss-original-viewer-header';

    const backButton = document.createElement('button');
    backButton.className = 'rss-article-viewer-back';
    backButton.textContent = '←';
    backButton.setAttribute('aria-label', 'Back to feed');
    backButton.addEventListener('click', () => this.closeModal());
    header.appendChild(backButton);

    const title = document.createElement('h2');
    title.textContent = article.title || 'Untitled Article';
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.className = 'rss-article-viewer-close';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close article viewer');
    closeButton.addEventListener('click', () => this.closeModal());
    header.appendChild(closeButton);

    dialog.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'rss-article-viewer-actions';

    const shareButton = document.createElement('button');
    shareButton.className = 'rss-action-button';
    shareButton.setAttribute('data-action', 'share-article');
    shareButton.textContent = 'Share';
    shareButton.addEventListener('click', () => this.shareArticle(article));
    actions.appendChild(shareButton);

    dialog.appendChild(actions);

    const frame = document.createElement('iframe');
    frame.className = 'rss-article-viewer-frame';
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups'
    );
    frame.title = 'Original article';
    frame.src = article.url;
    frame.style.display = 'block';

    dialog.appendChild(frame);
    overlay.appendChild(dialog);
    this.appendChild(overlay);

    overlay._originalFrame = frame;
    overlay._viewerMode = 'original';

    this.activeModal = overlay;
    this.lockBackgroundScroll();

    await this.markAsRead(feed.feedID, article.articleID);
  }

  /**
   * Open a Bluesky or Mastodon post in a native in-app view.
   *
   * Fetches the post and its replies through the platform's public API,
   * then renders them locally so the user sees the original post and
   * comments without an iframe.
   *
   * @param {object} article
   * @param {object} feed
   * @returns {Promise<void>}
   */
  async openSocialViewer(article, feed) {
    const platform = identifySocialURL(article.url);
    const platformName = platform === 'mastodon' ? 'Mastodon' : 'Bluesky';

    const { overlay, body } = this.createArticleViewer(article, feed);

    // Replace the generic "Open Original" button with one that opens the
    // post in the user's default browser, because the iframe is blocked.
    // Markdown export does not make sense for a social post, so remove it.
    const exportButton = overlay.querySelector('[data-action="export-markdown"]');
    if (exportButton) {
      exportButton.remove();
    }

    const originalButton = overlay.querySelector('[data-action="open-original"]');
    if (originalButton) {
      const externalButton = document.createElement('button');
      externalButton.className = 'rss-action-button';
      externalButton.textContent = `Open on ${platformName}`;
      externalButton.addEventListener('click', () => {
        this.openExternalURL(article.url);
      });
      originalButton.replaceWith(externalButton);
    }

    body.innerHTML = '';

    const spinner = document.createElement('div');
    spinner.className = 'rss-article-viewer-loading';
    spinner.textContent = `Loading ${platformName} post…`;
    body.appendChild(spinner);

    try {
      this.showToast(`Loading ${platformName} post…`);
      const post = await fetchSocialPost(article.url);

      body.innerHTML = '';
      this.renderSocialViewerContent(body, post);
      await this.markAsRead(feed.feedID, article.articleID);
    } catch (error) {
      console.error(`Failed to load ${platformName} post:`, error);
      body.innerHTML = '';

      const errorMessage = document.createElement('p');
      errorMessage.className = 'rss-article-viewer-error';
      errorMessage.textContent = `Could not load ${platformName} post: ${error.message}`;
      body.appendChild(errorMessage);

      const externalButton = document.createElement('button');
      externalButton.className = 'rss-action-button';
      externalButton.textContent = `Open on ${platformName}`;
      externalButton.addEventListener('click', () => {
        this.openExternalURL(article.url);
      });
      body.appendChild(externalButton);
    }
  }

  /**
   * Open a YouTube video in an embedded player with save/delete lifecycle.
   *
   * Uses the YouTube IFrame Player API so the app can detect when the
   * video ends and prompt the user to keep or delete the downloaded file.
   *
   * @param {object} article
   * @param {object} feed
   * @returns {Promise<void>}
   */
  async openYouTubeViewer(article, feed) {
    const videoID = extractYouTubeVideoID(article.url);
    if (!videoID) {
      this.showToast('Could not parse YouTube video URL', 'error');
      return;
    }

    const { overlay, body } = this.createArticleViewer(article, feed);

    // Remove actions that do not make sense for a YouTube video.
    const exportButton = overlay.querySelector('[data-action="export-markdown"]');
    if (exportButton) {
      exportButton.remove();
    }

    const originalButton = overlay.querySelector('[data-action="open-original"]');
    if (originalButton) {
      const openButton = document.createElement('button');
      openButton.className = 'rss-action-button';
      openButton.textContent = 'Open on YouTube';
      openButton.addEventListener('click', () => {
        this.openExternalURL(article.url);
      });
      originalButton.replaceWith(openButton);
    }

    // Add a Download Video action so the file is only saved when asked
    // for, plus a Delete Video action that stays visible during playback.
    const actions = overlay.querySelector('.rss-article-viewer-actions');
    const deleteButton = document.createElement('button');
    deleteButton.className = 'rss-action-button rss-button-danger';
    deleteButton.textContent = 'Delete Video';
    deleteButton.addEventListener('click', () => this._deleteYouTubeVideo(article, feed, overlay));

    const viewerDownloadButton = document.createElement('button');
    viewerDownloadButton.className = 'rss-action-button rss-youtube-download-button';
    viewerDownloadButton.textContent = article.downloadPath ? 'Downloaded ✓' : 'Download Video';
    viewerDownloadButton.addEventListener('click', () => this._downloadYouTubeVideo(article, feed, viewerDownloadButton));

    actions.insertBefore(deleteButton, actions.firstChild);
    actions.insertBefore(viewerDownloadButton, deleteButton);

    body.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'rss-youtube-viewer';

    const playerContainer = document.createElement('div');
    playerContainer.className = 'rss-youtube-player';
    playerContainer.id = `rss-youtube-player-${videoID}-${Date.now()}`;
    wrapper.appendChild(playerContainer);

    const prompt = document.createElement('div');
    prompt.className = 'rss-youtube-prompt';
    prompt.style.display = 'none';

    const promptText = document.createElement('p');
    promptText.textContent = 'Video finished. Keep or delete this video?';
    prompt.appendChild(promptText);

    const promptButtons = document.createElement('div');
    promptButtons.className = 'rss-youtube-prompt-buttons';

    const saveButton = document.createElement('button');
    saveButton.className = 'rss-button-primary';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () => {
      prompt.style.display = 'none';
    });
    promptButtons.appendChild(saveButton);

    const deletePromptButton = document.createElement('button');
    deletePromptButton.className = 'rss-button-danger';
    deletePromptButton.textContent = 'Delete';
    deletePromptButton.addEventListener('click', () => this._deleteYouTubeVideo(article, feed, overlay));
    promptButtons.appendChild(deletePromptButton);

    prompt.appendChild(promptButtons);
    wrapper.appendChild(prompt);

    body.appendChild(wrapper);

    // YouTube videos are not marked read on open; the end-of-video
    // Save/Delete prompt decides whether they stay in the feed.
    this._loadYouTubePlayer(overlay, playerContainer.id, videoID, prompt);
  }

  /**
   * Download a YouTube video for an article on explicit user request.
   *
   * Runs through feed-manager so the saved path is persisted; updates the
   * triggering button to reflect in-progress/completed state.
   *
   * @param {object} article
   * @param {object} feed
   * @param {HTMLElement} [buttonElement] - The clicked button, if any
   * @returns {Promise<void>}
   */
  async _downloadYouTubeVideo(article, feed, buttonElement) {
    const button = buttonElement || null;
    if (button) {
      button.disabled = true;
      button.textContent = 'Downloading…';
    }

    try {
      const result = await downloadArticleYouTubeVideo(feed, article);
      if (result.error) {
        this.showToast(`Download failed: ${result.error}`, 'error');
        if (button) {
          button.disabled = false;
          button.textContent = 'Download Video';
        }
        return;
      }

      this.showToast(`Video saved to ${result.filePath}`);
      if (button) {
        button.disabled = false;
        button.textContent = 'Downloaded ✓';
      }
    } catch (error) {
      console.error('Failed to download YouTube video:', error);
      this.showToast(`Download failed: ${error.message}`, 'error');
      if (button) {
        button.disabled = false;
        button.textContent = 'Download Video';
      }
    }
  }

  /**
   * Delete a downloaded YouTube video, mark the article read, and close the viewer.
   *
   * @param {object} article
   * @param {object} feed
   * @param {HTMLElement} overlay
   * @returns {Promise<void>}
   */
  async _deleteYouTubeVideo(article, feed, overlay) {
    if (article.downloadPath) {
      try {
        await deleteDownloadedVideo(article.downloadPath);
      } catch (error) {
        console.error('Failed to delete downloaded video:', error);
      }
    }

    this.closeModal();
    await this.markAsRead(feed.feedID, article.articleID);
  }

  /**
   * Load the YouTube IFrame Player API and create a player for a video.
   *
   * @param {string} containerID
   * @param {string} videoID
   * @param {HTMLElement} endPrompt
   * @returns {void}
   */
  _loadYouTubePlayer(overlay, containerID, videoID, endPrompt) {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;

      const firstScript = document.getElementsByTagName('script')[0];
      firstScript.parentNode.insertBefore(tag, firstScript);
    }

    const createPlayer = () => {
      const player = new window.YT.Player(containerID, {
        videoId: videoID,
        playerVars: {
          enablejsapi: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.ENDED) {
              endPrompt.style.display = '';
            }
          },
        },
      });

      // Keep a reference so closeModal() can explicitly destroy the player.
      overlay._youtubePlayer = player;
    };

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousReady === 'function') {
          previousReady();
        }
        createPlayer();
      };
    }
  }

  /**
   * Render image/media attachments for a social post.
   *
   * @param {HTMLElement} container
   * @param {Array<object>} media
   * @returns {void}
   */
  renderSocialMedia(container, media) {
    if (!media || media.length === 0) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'rss-social-media';

    for (const item of media) {
      if (item.type === 'image' && (item.fullsize || item.thumb)) {
        const link = document.createElement('a');
        link.href = item.fullsize || item.thumb;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        const image = document.createElement('img');
        image.src = item.fullsize || item.thumb;
        image.alt = item.alt || '';
        image.loading = 'lazy';

        link.appendChild(image);
        wrapper.appendChild(link);
      } else if (item.type === 'external' && item.uri) {
        // External website preview card. Clicks open the site in the
        // user's default browser instead of navigating the app window.
        const card = document.createElement('a');
        card.className = 'rss-social-link-card';
        card.href = item.uri;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openExternalURL(item.uri);
        });

        if (item.thumb) {
          const thumb = document.createElement('img');
          thumb.src = item.thumb;
          thumb.alt = '';
          thumb.loading = 'lazy';
          card.appendChild(thumb);
        }

        const body = document.createElement('span');
        body.className = 'rss-social-link-card-body';

        const title = document.createElement('span');
        title.className = 'rss-social-link-card-title';
        title.textContent = item.title || item.uri;
        body.appendChild(title);

        if (item.description) {
          const description = document.createElement('span');
          description.className = 'rss-social-link-card-description';
          description.textContent = item.description;
          body.appendChild(description);
        }

        card.appendChild(body);
        wrapper.appendChild(card);
      }
    }

    if (wrapper.children.length > 0) {
      container.appendChild(wrapper);
    }
  }

  /**
   * Render Bluesky/Mastodon post content and replies into the viewer body.
   *
   * @param {HTMLElement} body
   * @param {object} post
   * @returns {void}
   */
  renderSocialViewerContent(body, post) {
    const article = document.createElement('article');
    article.className = 'rss-social-post';

    const header = document.createElement('div');
    header.className = 'rss-social-header';

    const author = document.createElement('span');
    author.className = 'rss-social-author';
    author.textContent = post.author || 'Unknown';
    header.appendChild(author);

    if (post.handle) {
      const handle = document.createElement('span');
      handle.className = 'rss-social-handle';
      handle.textContent = `@${post.handle}`;
      header.appendChild(handle);
    }

    if (post.date) {
      const date = document.createElement('span');
      date.className = 'rss-social-date';
      date.textContent = this.formatDate(new Date(post.date));
      header.appendChild(date);
    }

    article.appendChild(header);

    const text = document.createElement('div');
    text.className = 'rss-social-text';
    if (post.platform === 'bluesky') {
      text.innerHTML = this.sanitizeHTML(renderBlueskyText(post.text, post.facets));
    } else {
      text.innerHTML = this.sanitizeHTML(post.text);
    }
    article.appendChild(text);

    if (post.media && post.media.length > 0) {
      this.renderSocialMedia(article, post.media);
    }

    if (post.embeds && post.embeds.length > 0) {
      const embedsSection = document.createElement('div');
      embedsSection.className = 'rss-social-embeds';

      const embedsTitle = document.createElement('h3');
      embedsTitle.textContent = 'Embedded post';
      embedsSection.appendChild(embedsTitle);

      for (const embed of post.embeds) {
        const embedBlock = document.createElement('blockquote');
        embedBlock.className = 'rss-social-embed';

        if (embed.author) {
          const embedAuthor = document.createElement('div');
          embedAuthor.className = 'rss-social-embed-author';
          embedAuthor.textContent = embed.author;
          embedBlock.appendChild(embedAuthor);
        }

        const embedText = document.createElement('p');
        embedText.textContent = embed.text || '';
        embedBlock.appendChild(embedText);

        if (embed.media && embed.media.length > 0) {
          this.renderSocialMedia(embedBlock, embed.media);
        }

        embedsSection.appendChild(embedBlock);
      }

      article.appendChild(embedsSection);
    }

    if (post.comments && post.comments.length > 0) {
      const commentsSection = document.createElement('div');
      commentsSection.className = 'rss-social-comments';

      const commentsTitle = document.createElement('h3');
      commentsTitle.textContent = `Comments (${post.comments.length})`;
      commentsSection.appendChild(commentsTitle);

      for (const comment of post.comments) {
        const commentBlock = document.createElement('div');
        commentBlock.className = 'rss-social-comment';
        if (comment.depth > 0) {
          commentBlock.style.marginLeft = `${comment.depth * 1.5}rem`;
        }

        const commentHeader = document.createElement('div');
        commentHeader.className = 'rss-social-comment-header';

        const commentAuthor = document.createElement('span');
        commentAuthor.className = 'rss-social-comment-author';
        commentAuthor.textContent = comment.author || 'Unknown';
        commentHeader.appendChild(commentAuthor);

        if (comment.handle) {
          const commentHandle = document.createElement('span');
          commentHandle.className = 'rss-social-comment-handle';
          commentHandle.textContent = `@${comment.handle}`;
          commentHeader.appendChild(commentHandle);
        }

        if (comment.date) {
          const commentDate = document.createElement('span');
          commentDate.className = 'rss-social-comment-date';
          commentDate.textContent = this.formatDate(new Date(comment.date));
          commentHeader.appendChild(commentDate);
        }

        commentBlock.appendChild(commentHeader);

        const commentText = document.createElement('div');
        commentText.className = 'rss-social-comment-text';
        if (post.platform === 'bluesky') {
          commentText.innerHTML = this.sanitizeHTML(this.escapeHTML(comment.text).replace(/\n/g, '<br>'));
        } else {
          commentText.innerHTML = this.sanitizeHTML(comment.text);
        }
        commentBlock.appendChild(commentText);

        commentsSection.appendChild(commentBlock);
      }

      article.appendChild(commentsSection);
    }

    body.appendChild(article);

    if (this._findBar?.classList.contains('rss-find-bar--visible')) {
      this._runFind({ selectFirst: true });
    }
  }

  /**
   * Create the article viewer modal shell.
   *
   * @param {object} article
   * @param {object} feed
   * @returns {{overlay: HTMLElement, body: HTMLElement}}
   */
  createArticleViewer(article, feed) {
    this.closeModal();

    const overlay = document.createElement('div');
    overlay.className = 'rss-article-viewer-overlay';
    overlay._viewerMode = 'article';

    const dialog = document.createElement('div');
    dialog.className = 'rss-article-viewer-dialog';

    const header = document.createElement('div');
    header.className = 'rss-article-viewer-header';

    const backButton = document.createElement('button');
    backButton.className = 'rss-article-viewer-back';
    backButton.textContent = '←';
    backButton.setAttribute('aria-label', 'Back to feed');
    // The back button always closes the viewer, matching Escape. Switching
    // between extracted and original views is handled by the action toggle
    // ("Open Original" ↔ "Show Article") so there is always a way back.
    backButton.addEventListener('click', () => this.closeModal());
    header.appendChild(backButton);

    const title = document.createElement('h2');
    title.textContent = article.title || 'Untitled Article';
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.className = 'rss-article-viewer-close';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close article viewer');
    closeButton.addEventListener('click', () => this.closeModal());
    header.appendChild(closeButton);

    dialog.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'rss-article-viewer-meta';

    if (feed.name) {
      const source = document.createElement('span');
      source.textContent = feed.name;
      meta.appendChild(source);
    }

    if (article.datePublished) {
      const date = document.createElement('span');
      date.textContent = ` • ${this.formatDate(article.datePublished)}`;
      meta.appendChild(date);
    }

    if (article.authors && article.authors.length > 0) {
      const author = document.createElement('span');
      author.textContent = ` • ${article.authors.map((a) => a.name).join(', ')}`;
      meta.appendChild(author);
    }

    dialog.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'rss-article-viewer-actions';

    const exportButton = document.createElement('button');
    exportButton.className = 'rss-action-button';
    exportButton.setAttribute('data-action', 'export-markdown');
    exportButton.textContent = 'Export Markdown';
    exportButton.addEventListener('click', () => this.exportArticleMarkdown(article, feed));
    actions.appendChild(exportButton);

    const originalButton = document.createElement('button');
    originalButton.className = 'rss-action-button';
    originalButton.setAttribute('data-action', 'open-original');
    originalButton.textContent = 'Open Original';
    originalButton.addEventListener('click', () => {
      this._showOriginalView(overlay, article.url);
    });
    actions.appendChild(originalButton);

    const shareButton = document.createElement('button');
    shareButton.className = 'rss-action-button';
    shareButton.setAttribute('data-action', 'share-article');
    shareButton.textContent = 'Share';
    shareButton.addEventListener('click', () => this.shareArticle(article));
    actions.appendChild(shareButton);

    dialog.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'rss-article-viewer-body';
    body.tabIndex = -1;
    body.addEventListener('click', (event) => this._handleArticleBodyClick(event, article.url));

    const spinner = document.createElement('div');
    spinner.className = 'rss-article-viewer-loading';
    spinner.textContent = 'Extracting article content…';
    body.appendChild(spinner);

    const originalFrame = document.createElement('iframe');
    originalFrame.className = 'rss-article-viewer-frame';
    originalFrame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups'
    );
    originalFrame.title = 'Original article';

    dialog.appendChild(body);
    dialog.appendChild(originalFrame);
    overlay.appendChild(dialog);
    this.appendChild(overlay);

    overlay._articleBody = body;
    overlay._originalFrame = originalFrame;

    this.activeModal = overlay;
    this.lockBackgroundScroll();
    body.focus();

    if (this._findBar?.classList.contains('rss-find-bar--visible')) {
      this._runFind({ selectFirst: true });
    }

    return { overlay, body };
  }

  /**
   * Switch the article viewer to the original website view.
   *
   * Hides the extracted Markdown body and shows an iframe loaded with the
   * article's original URL, keeping navigation inside the same window.
   *
   * @param {HTMLElement} overlay - The article viewer overlay
   * @param {string} url - The original article URL
   * @returns {void}
   */
  _showOriginalView(overlay, url) {
    overlay._viewerMode = 'original';
    overlay._articleBody.style.display = 'none';
    overlay._originalFrame.src = url;
    overlay._originalFrame.style.display = 'block';

    // The back button now always closes the viewer, so expose a way back
    // to the extracted article through the "Open Original" action instead.
    const toggleButton = overlay.querySelector('[data-action="open-original"]');
    if (toggleButton) {
      toggleButton.textContent = 'Show Article';
    }
  }

  /**
   * Switch the article viewer back to the extracted Markdown view.
   *
   * Hides the original-website iframe and restores the Markdown body.
   *
   * @param {HTMLElement} overlay - The article viewer overlay
   * @returns {void}
   */
  _showArticleView(overlay) {
    overlay._viewerMode = 'article';
    overlay._originalFrame.style.display = 'none';
    overlay._articleBody.style.display = '';
    overlay._articleBody.focus();

    const toggleButton = overlay.querySelector('[data-action="open-original"]');
    if (toggleButton) {
      toggleButton.textContent = 'Open Original';
    }
  }

  /**
   * Render extracted Markdown content into the article viewer body.
   *
   * @param {HTMLElement} body
   * @param {object} article
   * @param {object} feed
   * @param {object} extracted
   * @returns {void}
   */
  renderArticleViewerContent(body, article, feed, extracted) {
    body.innerHTML = '';

    const content = document.createElement('article');
    content.className = 'rss-markdown-content';
    content.innerHTML = renderMarkdown(extracted.markdown);
    body.appendChild(content);

    if (this._findBar?.classList.contains('rss-find-bar--visible')) {
      this._runFind({ selectFirst: true });
    }
  }

  /**
   * Export an article as a Markdown file with extensive YAML front matter.
   *
   * @param {object} article
   * @param {object} feed
   * @returns {Promise<void>}
   */
  async exportArticleMarkdown(article, feed) {
    if (!isFileSystemAccessSupported()) {
      this.showToast('File System Access API not available', 'error');
      return;
    }

    try {
      this.showToast('Extracting article for export…');
      const extracted = await extractArticle(article.url);
      const frontMatter = generateFrontMatter(article, feed, extracted);
      const content = `${frontMatter}\n\n${extracted.markdown}`;
      const filename = this.generateArticleFilename(article, '.md');
      const name = await saveTextToDisk(filename, content, undefined, {
        rememberKey: 'markdown-export',
      });
      this.showToast(`Exported Markdown to ${name}`);
    } catch (error) {
      if (isUserCancellation(error)) return;
      console.error('Failed to export Markdown:', error);
      this.showToast(`Export failed: ${error.message}`, 'error');
    }
  }

  /**
   * Mark all articles in a feed as read.
   *
   * @param {string} feedID
   * @returns {Promise<void>}
   */
  async markAllFeedAsRead(feedID) {
    const feed = this.feeds.find((f) => f.feedID === feedID);
    if (!feed) return;

    try {
      for (const article of feed.articles) {
        if (!article.read) {
          await markArticleAsRead(feedID, article.articleID);
        }
      }
      for (const article of feed.articles) {
        article.read = true;
      }
      this.showToast(`Marked all ${feed.name || 'feed'} articles as read`);
      this.renderFeeds();
    } catch (error) {
      console.error('Failed to mark all feed read:', error);
    }
  }

  /**
   * Mark all articles in a feed as unread.
   *
   * @param {string} feedID
   * @returns {Promise<void>}
   */
  async markAllFeedAsUnread(feedID) {
    const feed = this.feeds.find((f) => f.feedID === feedID);
    if (!feed) return;

    try {
      for (const article of feed.articles) {
        if (article.read) {
          await markArticleAsUnread(feedID, article.articleID);
        }
      }
      for (const article of feed.articles) {
        article.read = false;
      }
      this.showToast(`Marked all ${feed.name || 'feed'} articles as unread`);
      this.renderFeeds();
    } catch (error) {
      console.error('Failed to mark all feed unread:', error);
    }
  }

  /**
   * Export the current subscription list as OPML to a file on disk.
   *
   * @async
   * @returns {Promise<void>}
   */
  async handleExportOPML() {
    if (!isFileSystemAccessSupported()) {
      this.showToast('File System Access API not available', 'error');
      return;
    }

    try {
      const opml = exportOPML(this.feeds, 'Aaron RSS subscriptions');
      const name = await saveOPMLToDisk('Aaron-RSS-subscriptions.opml', opml);
      this.showToast(`Exported ${name}`);
    } catch (error) {
      if (isUserCancellation(error)) return;
      this.showToast(`Export failed: ${error.message}`, 'error');
    }
  }

  /**
   * Import a subscription list from an OPML file on disk.
   *
   * Each discovered subscription is added as a feed and the feed list
   * is refreshed when finished.
   *
   * @async
   * @returns {Promise<void>}
   */
  async handleImportOPML() {
    if (!isFileSystemAccessSupported()) {
      this.showToast('File System Access API not available', 'error');
      return;
    }

    try {
      const { name, text } = await pickOPMLFileFromDisk();
      const subscriptions = parseOPML(text);

      if (subscriptions.length === 0) {
        this.showToast('No subscriptions found in OPML file', 'error');
        return;
      }

      this.showToast(`Importing ${subscriptions.length} subscriptions…`);
      let added = 0;

      for (const subscription of subscriptions) {
        const feed = await addFeed(subscription.url, subscription.name);
        if (feed) {
          added++;
        }
      }

      this.showToast(`Imported ${added}/${subscriptions.length} subscriptions from ${name}`);
      await this.refreshFeeds();
    } catch (error) {
      if (isUserCancellation(error)) return;
      this.showToast(`Import failed: ${error.message}`, 'error');
    }
  }

  /**
   * Save an article as a Markdown file via the File System Access API.
   *
   * @param {object} article
   * @returns {Promise<void>}
   */
  async saveArticleToFile(article) {
    if (!isFileSystemAccessSupported()) {
      this.showToast('File System Access API not available', 'error');
      return;
    }

    const filename = this.generateArticleFilename(article);
    const content = this.generateArticleMarkdown(article);
    const bytes = new TextEncoder().encode(content);

    try {
      const name = await saveBytesToDisk(filename, bytes);
      this.showToast(`Saved ${name}`);
    } catch (error) {
      if (isUserCancellation(error)) return;
      this.showToast(`Save failed: ${error.message}`, 'error');
    }
  }

  /**
   * Generate a safe filename for an article.
   *
   * @param {object} article
   * @param {string} [extension='.md'] - File extension including the dot
   * @returns {string}
   */
  generateArticleFilename(article, extension = '.md') {
    const base = (article.title || 'untitled-article')
      .toString()
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
      .replace(/-[^-]*$/, '');

    const date = new Date().toISOString().slice(0, 10);
    return `${base || 'untitled'}-${date}${extension}`;
  }

  /**
   * Generate Markdown content for an article.
   *
   * @param {object} article
   * @returns {string}
   */
  generateArticleMarkdown(article) {
    const lines = [];
    lines.push('---');
    lines.push(`title: ${JSON.stringify(article.title || 'Untitled')}`);
    lines.push(`source: RSS Feed`);
    lines.push(`url: ${JSON.stringify(article.url || article.externalURL || '')}`);
    if (article.authors?.length) {
      lines.push(`author: ${JSON.stringify(article.authors.map((a) => a.name).join(', '))}`);
    }
    if (article.datePublished) {
      lines.push(`published: ${article.datePublished.toISOString()}`);
    }
    lines.push(`imported: ${new Date().toISOString()}`);
    lines.push('---');
    lines.push('');

    if (article.title) {
      lines.push(`# ${article.title}`);
      lines.push('');
    }

    if (article.url) {
      lines.push(`**Original URL:** [${article.url}](${article.url})`);
      lines.push('');
    }

    if (article.summary && article.summary !== article.title) {
      lines.push('## Summary');
      lines.push('');
      lines.push(article.summary);
      lines.push('');
    }

    if (article.contentText || article.contentHTML) {
      lines.push('## Content');
      lines.push('');
      lines.push(article.contentText || stripHTML(article.contentHTML));
      lines.push('');
    }

    lines.push(`*Imported from ${article.feedURL || 'RSS feed'} on ${new Date().toLocaleDateString()}*`);
    return lines.join('\n');
  }

  /**
   * Copy the article's original URL to the clipboard.
   *
   * @param {object} article
   * @returns {Promise<void>}
   */
  async shareArticle(article) {
    if (!article?.url) {
      this.showToast('Article has no URL to share', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(article.url);
      this.showToast('Copied URL to clipboard');
    } catch (error) {
      console.error('Failed to copy URL:', error);
      this.showToast('Failed to copy URL', 'error');
    }
  }

  /**
   * Update the status tag and reset its fade-out timer.
   *
   * The status tag sits in the lower-right corner and disappears after
   * 10 seconds of inactivity. Calling this method with new text makes
   * the tag visible again and restarts the timer.
   *
   * @param {string} text
   * @returns {void}
   */
  setStatus(text) {
    if (this.statusFadeTimeout) {
      clearTimeout(this.statusFadeTimeout);
    }

    this.statusLine.textContent = text;
    this.statusLine.classList.remove('rss-status-fade');

    this.statusFadeTimeout = setTimeout(() => {
      this.statusLine.classList.add('rss-status-fade');
    }, 10000);
  }

  /**
   * Display a toast message.
   *
   * @param {string} message
   * @param {'info'|'error'} [type='info']
   * @returns {void}
   */
  /**
   * Show a transient toast message.
   *
   * @param {string} message - The message to display
   * @param {string} [type] - Toast style ('info' or 'error')
   * @param {number} [duration=3000] - Milliseconds before the toast fades
   * @returns {void}
   */
  showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `rss-toast rss-toast-${type}`;
    toast.textContent = message;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('rss-toast-fade');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Format a date as a human-readable relative string.
   *
   * @param {Date} date
   * @returns {string}
   */
  formatDate(date) {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return new Date(date).toLocaleDateString();
  }

  /**
   * Install the global keyboard navigation listener.
   *
   * Uses the capture phase so it can inspect the command panel state
   * before the panel's own Escape handler runs.
   *
   * @returns {void}
   */
  _setupKeyboardNavigation() {
    if (this._keyboardHandler) {
      return;
    }
    this._keyboardHandler = (event) => this._handleKeyDown(event);
    document.addEventListener('keydown', this._keyboardHandler, true);

    // In Electron, key events targeting a cross-origin iframe never reach
    // this document, so Escape would stop working while focus sits inside
    // the "Open Original" website viewer. The main process forwards those
    // presses over IPC instead (see electron/main.js); a timestamp guard
    // in _runEscapeAction() keeps the two delivery paths from double-firing.
    if (window.electron?.onEscapePressed) {
      window.electron.onEscapePressed(() => this._runEscapeAction());
    }
  }

  /**
   * Run the shared Escape-key behavior exactly once per physical press.
   *
   * Closes the find bar, closes the active modal, or jumps back to the top
   * of the feed list depending on current state. Electron delivers Escape
   * both as a normal DOM keydown (when the main document has focus) and as
   * an IPC message (needed when an iframe has focus), so presses that land
   * within 250ms of each other are treated as one physical key press.
   *
   * @returns {void}
   */
  _runEscapeAction() {
    const now = Date.now();
    if (now - (this._lastEscapeHandledAt || 0) < 250) {
      return;
    }
    this._lastEscapeHandledAt = now;

    if (this._findBar?.classList.contains('rss-find-bar--visible') && !this.activeModal) {
      this._closeFind();
      return;
    }
    if (this.activeModal) {
      if (this._isArticleViewerModal(this.activeModal)) {
        this._closeArticleViewerAndSelectNext();
      } else {
        this.closeModal();
      }
      return;
    }
    // On the main feed page, jump to the top and select the first article.
    this._goToTopOfFeed();
  }

  /**
   * Handle global keydown events for keyboard navigation.
   *
   * Arrow keys move the selection through posts; Shift+Arrow jumps
   * between feeds. Enter opens the selected post. Escape closes the
   * article viewer and returns to the feed with the next post selected,
   * or, on the main feed page, re-sorts the feeds by unread count,
   * jumps to the top of the list, and selects the first article.
   *
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  _handleKeyDown(event) {
    if (this._isCommandPanelOpen()) {
      return;
    }

    const isFindShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f';

    if (event.key === 'Escape') {
      event.preventDefault();
      this._runEscapeAction();
      return;
    }

    if (isFindShortcut) {
      event.preventDefault();
      this._toggleFind();
      return;
    }

    if (this._isTypingInInput() || this.activeModal) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (event.shiftKey) {
        this._selectNextFeed();
      } else {
        this._selectNextArticle();
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (event.shiftKey) {
        this._selectPreviousFeed();
      } else {
        this._selectPreviousArticle();
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this._openSelectedArticle();
      return;
    }

    if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      this._markSelectedArticleAsRead();
      return;
    }
  }

  // ============================================================================
  // Find functionality
  // ============================================================================

  /**
   * Initialize the find feature state and UI.
   *
   * @returns {void}
   */
  _setupFind() {
    this._findState = {
      query: '',
      highlights: [],
      currentIndex: -1,
    };
    this._createFindBar();
  }

  /**
   * Build the find bar DOM and append it to the component.
   *
   * @returns {void}
   */
  _createFindBar() {
    const bar = document.createElement('div');
    bar.className = 'rss-find-bar';
    bar.setAttribute('role', 'search');
    bar.setAttribute('aria-label', 'Find in articles');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rss-find-input';
    input.placeholder = 'Find in articles…';
    input.setAttribute('aria-label', 'Find query');
    input.addEventListener('input', () => {
      this._runFind({ selectFirst: true });
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this._closeFind();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) {
          this._findPrevious();
        } else {
          this._findNext();
        }
      }
    });
    bar.appendChild(input);
    this._findInput = input;

    const caseLabel = document.createElement('label');
    caseLabel.className = 'rss-find-case-label';
    caseLabel.title = 'Match case';
    const caseCheckbox = document.createElement('input');
    caseCheckbox.type = 'checkbox';
    caseLabel.appendChild(caseCheckbox);
    const caseText = document.createElement('span');
    caseText.textContent = 'Aa';
    caseLabel.appendChild(caseText);
    caseCheckbox.addEventListener('change', () => {
      this._runFind({ selectFirst: true });
    });
    bar.appendChild(caseLabel);
    this._findCaseCheckbox = caseCheckbox;

    const findNextButton = document.createElement('button');
    findNextButton.className = 'rss-find-button';
    findNextButton.textContent = 'Find Next';
    findNextButton.addEventListener('click', () => this._findNext());
    bar.appendChild(findNextButton);

    const findAllButton = document.createElement('button');
    findAllButton.className = 'rss-find-button rss-find-button-primary';
    findAllButton.textContent = 'Find All';
    findAllButton.addEventListener('click', () => this._findAll());
    bar.appendChild(findAllButton);

    const counter = document.createElement('span');
    counter.className = 'rss-find-counter';
    counter.textContent = '0/0';
    counter.setAttribute('aria-live', 'polite');
    bar.appendChild(counter);
    this._findCounter = counter;

    const closeButton = document.createElement('button');
    closeButton.className = 'rss-find-button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close find');
    closeButton.addEventListener('click', () => this._closeFind());
    bar.appendChild(closeButton);

    this.appendChild(bar);
    this._findBar = bar;
  }

  /**
   * Show the find bar and focus the input.
   *
   * @returns {void}
   */
  _openFind() {
    if (this.activeModal && !this._isArticleViewerModal(this.activeModal)) {
      return;
    }
    this._findBar.classList.add('rss-find-bar--visible');
    this._findInput.focus();
    this._findInput.select();
    if (this._findInput.value) {
      this._runFind({ selectFirst: true });
    }
  }

  /**
   * Hide the find bar and clear highlights.
   *
   * @returns {void}
   */
  _closeFind() {
    if (!this._findBar) {
      return;
    }
    this._findBar.classList.remove('rss-find-bar--visible');
    this._clearFindHighlights();
    this._removeFindRail();
    if (this._findInput === document.activeElement) {
      this._findInput.blur();
    }
  }

  /**
   * Toggle the find bar open or closed.
   *
   * @returns {void}
   */
  _toggleFind() {
    if (this._findBar.classList.contains('rss-find-bar--visible')) {
      this._closeFind();
    } else {
      this._openFind();
    }
  }

  /**
   * Return the DOM element that should be searched.
   *
   * Returns the article viewer body when the viewer is open, the main
   * content area otherwise, and null when a blocking modal is open.
   *
   * @returns {HTMLElement|null}
   */
  _getFindContainer() {
    if (this.activeModal && this._isArticleViewerModal(this.activeModal)) {
      return this.activeModal.querySelector('.rss-article-viewer-body') || null;
    }
    if (this.activeModal) {
      return null;
    }
    return this.contentArea || null;
  }

  /**
   * Run a find pass against the current container.
   *
   * @param {object} [options]
   * @param {boolean} [options.selectFirst=false] - Jump to the first match.
   * @returns {void}
   */
  _runFind(options = {}) {
    const query = this._findInput.value;
    const container = this._getFindContainer();

    this._clearFindHighlights();
    this._removeFindRail();

    if (!query || !container) {
      this._findState.query = '';
      this._findState.highlights = [];
      this._findState.currentIndex = -1;
      this._updateFindCounter();
      return;
    }

    this._findState.query = query;
    this._findState.highlights = highlightMatches(container, query, {
      caseSensitive: this._findCaseCheckbox.checked,
    });

    if (this._findState.highlights.length > 0) {
      this._findState.currentIndex = options.selectFirst ? 0 : -1;
      if (options.selectFirst) {
        this._activateHighlight(0);
      }
    } else {
      this._findState.currentIndex = -1;
    }

    this._updateFindMarkers(container);
    this._updateFindCounter();
  }

  /**
   * Highlight all matches and jump to the first one.
   *
   * @returns {void}
   */
  _findAll() {
    this._runFind({ selectFirst: true });
  }

  /**
   * Jump to the next match, wrapping around to the first after the last.
   *
   * @returns {void}
   */
  _findNext() {
    if (
      this._findState.highlights.length === 0 ||
      this._findState.query !== this._findInput.value
    ) {
      this._runFind({ selectFirst: true });
      return;
    }
    const nextIndex =
      (this._findState.currentIndex + 1) % this._findState.highlights.length;
    this._activateHighlight(nextIndex);
  }

  /**
   * Jump to the previous match, wrapping around to the last before the first.
   *
   * @returns {void}
   */
  _findPrevious() {
    if (
      this._findState.highlights.length === 0 ||
      this._findState.query !== this._findInput.value
    ) {
      this._runFind({ selectFirst: true });
      return;
    }
    const prevIndex =
      (this._findState.currentIndex - 1 + this._findState.highlights.length) %
      this._findState.highlights.length;
    this._activateHighlight(prevIndex);
  }

  /**
   * Activate a specific match by index, scrolling it into view.
   *
   * @param {number} index
   * @returns {void}
   */
  _activateHighlight(index) {
    const highlights = this._findState.highlights;
    if (index < 0 || index >= highlights.length) {
      return;
    }

    const previous = highlights[this._findState.currentIndex];
    if (previous) {
      previous.classList.remove('rss-find-highlight-active');
    }

    this._findState.currentIndex = index;
    const current = highlights[index];
    current.classList.add('rss-find-highlight-active');
    current.scrollIntoView({ block: 'center', behavior: 'smooth' });

    this._updateFindCounter();
    this._updateActiveMarker();
  }

  /**
   * Update the match counter text.
   *
   * @returns {void}
   */
  _updateFindCounter() {
    const count = this._findState.highlights.length;
    const current = count > 0 ? this._findState.currentIndex + 1 : 0;
    this._findCounter.textContent = count > 0 ? `${current}/${count}` : '0/0';
  }

  /**
   * Render scrollbar markers for every match.
   *
   * @param {HTMLElement} container
   * @returns {void}
   */
  _updateFindMarkers(container) {
    this._removeFindRail();
    if (this._findState.highlights.length === 0) {
      return;
    }

    const isViewerBody = container.classList.contains('rss-article-viewer-body');
    const rail = document.createElement('div');
    rail.className = isViewerBody
      ? 'rss-find-rail rss-find-rail--viewer'
      : 'rss-find-rail';

    const scrollHeight = isViewerBody
      ? container.scrollHeight
      : document.documentElement.scrollHeight;

    for (let i = 0; i < this._findState.highlights.length; i++) {
      const highlight = this._findState.highlights[i];
      const marker = document.createElement('div');
      marker.className = 'rss-find-marker';
      marker.dataset.index = String(i);

      const offsetTop = isViewerBody
        ? highlight.offsetTop
        : highlight.getBoundingClientRect().top + window.scrollY;

      const pct = scrollHeight > 0 ? (offsetTop / scrollHeight) * 100 : 0;
      marker.style.top = `${Math.min(100, Math.max(0, pct))}%`;
      rail.appendChild(marker);
    }

    if (isViewerBody) {
      container.appendChild(rail);
    } else {
      document.body.appendChild(rail);
    }

    this._findRail = rail;
    this._updateActiveMarker();
  }

  /**
   * Remove the marker rail from the DOM.
   *
   * @returns {void}
   */
  _removeFindRail() {
    if (this._findRail) {
      this._findRail.remove();
      this._findRail = null;
    }
  }

  /**
   * Update marker colors to reflect the active match.
   *
   * @returns {void}
   */
  _updateActiveMarker() {
    if (!this._findRail) {
      return;
    }
    const markers = this._findRail.querySelectorAll('.rss-find-marker');
    markers.forEach((marker, index) => {
      marker.classList.toggle(
        'rss-find-marker-active',
        index === this._findState.currentIndex
      );
    });
  }

  /**
   * Remove all highlight marks from the document.
   *
   * @returns {void}
   */
  _clearFindHighlights() {
    clearHighlights();
    this._findState.highlights = [];
    this._findState.currentIndex = -1;
  }

  /**
   * Determine whether the command panel dialog is currently open.
   *
   * @returns {boolean}
   */
  _isCommandPanelOpen() {
    return Boolean(this.commandPanel?.dialog?.open);
  }

  /**
   * Determine whether the active element is a text input or similar
   * where arrow keys should have their normal editing meaning.
   *
   * @returns {boolean}
   */
  _isTypingInInput() {
    const active = document.activeElement;
    if (!active) {
      return false;
    }
    const tag = active.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      active.isContentEditable
    );
  }

  /**
   * Determine whether a modal element is an article viewer.
   *
   * @param {HTMLElement} modal
   * @returns {boolean}
   */
  _isArticleViewerModal(modal) {
    return (
      modal.classList.contains('rss-article-viewer-overlay') ||
      modal.classList.contains('rss-original-viewer-overlay')
    );
  }

  /**
   * Return all visible article elements along with their feed/article ids.
   *
   * @returns {Array<{feedID: string, articleID: string, element: HTMLElement}>}
   */
  _getVisibleArticles() {
    return Array.from(this.querySelectorAll('.rss-article'))
      .map((element) => {
        // In the grouped view this is the .rss-feed block; in the timeline
        // it is the .rss-timeline-item wrapper. Both carry data-feed-id.
        const host = element.closest('[data-feed-id]');
        return {
          feedID: host?.getAttribute('data-feed-id') || '',
          articleID: element.getAttribute('data-article-id') || '',
          element,
        };
      })
      .filter((item) => item.feedID && item.articleID);
  }

  /**
   * Select an article by id, scrolling it into view.
   *
   * @param {string} feedID
   * @param {string} articleID
   * @returns {void}
   */
  _selectArticle(feedID, articleID) {
    this._clearSelection();

    // Works in both views: the grouped view nests .rss-article inside the
    // .rss-feed block, and the timeline nests it inside a .rss-timeline-item.
    const article = this.querySelector(
      `[data-feed-id="${CSS.escape(feedID)}"] .rss-article[data-article-id="${CSS.escape(articleID)}"]`
    );
    if (!article) {
      this._selectedArticle = null;
      return;
    }

    this._selectedArticle = { feedID, articleID };
    article.classList.add('rss-article-selected');
    article.focus();
    article.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Re-apply the selected class after a fresh render.
   *
   * @returns {void}
   */
  _restoreSelection() {
    if (!this._selectedArticle) {
      return;
    }
    const { feedID, articleID } = this._selectedArticle;
    const article = this.querySelector(
      `[data-feed-id="${CSS.escape(feedID)}"] .rss-article[data-article-id="${CSS.escape(articleID)}"]`
    );
    if (article) {
      article.classList.add('rss-article-selected');
    } else {
      this._selectedArticle = null;
    }
  }

  /**
   * Remove the selected class from the currently selected article.
   *
   * @returns {void}
   */
  _clearSelection() {
    const selected = this.querySelector('.rss-article-selected');
    if (selected) {
      selected.classList.remove('rss-article-selected');
    }
  }

  /**
   * Select the first visible unread article.
   *
   * @returns {void}
   */
  _selectFirstArticle() {
    const articles = this._getVisibleArticles();
    if (articles.length === 0) {
      this._selectedArticle = null;
      return;
    }
    const { feedID, articleID } = articles[0];
    this._selectArticle(feedID, articleID);
  }

  /**
   * Re-sort the feed list, scroll to the top, and select the first article.
   *
   * @returns {void}
   */
  _goToTopOfFeed() {
    this.feeds = sortFeedsByUnreadCount(this.feeds);
    this.renderFeeds();
    this._selectFirstArticle();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Select the first visible article only when nothing is currently selected.
   *
   * Skips selection while a modal is open so the feed list does not steal
   * focus from an active viewer or dialog.
   *
   * @returns {void}
   */
  _ensureFirstArticleSelected() {
    if (this._selectedArticle || this.activeModal) {
      return;
    }
    this._selectFirstArticle();
  }

  /**
   * Select the next visible article.
   *
   * @returns {void}
   */
  _selectNextArticle() {
    const articles = this._getVisibleArticles();
    if (articles.length === 0) {
      this._selectedArticle = null;
      return;
    }

    let index = 0;
    if (this._selectedArticle) {
      const found = articles.findIndex(
        (a) =>
          a.feedID === this._selectedArticle.feedID &&
          a.articleID === this._selectedArticle.articleID
      );
      if (found >= 0) {
        index = found;
      }
    }

    const nextIndex = Math.min(index + 1, articles.length - 1);
    const { feedID, articleID } = articles[nextIndex];
    this._selectArticle(feedID, articleID);
  }

  /**
   * Select the previous visible article.
   *
   * @returns {void}
   */
  _selectPreviousArticle() {
    const articles = this._getVisibleArticles();
    if (articles.length === 0) {
      this._selectedArticle = null;
      return;
    }

    let index = articles.length - 1;
    if (this._selectedArticle) {
      const found = articles.findIndex(
        (a) =>
          a.feedID === this._selectedArticle.feedID &&
          a.articleID === this._selectedArticle.articleID
      );
      if (found >= 0) {
        index = found;
      }
    }

    const prevIndex = Math.max(index - 1, 0);
    const { feedID, articleID } = articles[prevIndex];
    this._selectArticle(feedID, articleID);
  }

  /**
   * Select the first visible article of the next feed.
   *
   * @returns {void}
   */
  _selectNextFeed() {
    const feeds = Array.from(this.querySelectorAll('.rss-feed'));
    if (feeds.length === 0) {
      return;
    }

    let startIndex = -1;
    if (this._selectedArticle) {
      startIndex = feeds.findIndex(
        (f) => f.getAttribute('data-feed-id') === this._selectedArticle.feedID
      );
    }

    for (let i = startIndex + 1; i < feeds.length; i++) {
      const feed = feeds[i];
      const details = feed.querySelector('.rss-feed-details');
      const firstArticle = feed.querySelector('.rss-article');
      if (firstArticle) {
        if (details) {
          details.open = true;
        }
        const feedID = feed.getAttribute('data-feed-id');
        const articleID = firstArticle.getAttribute('data-article-id');
        this._selectArticle(feedID, articleID);
        return;
      }
    }
  }

  /**
   * Select the first visible article of the previous feed.
   *
   * @returns {void}
   */
  _selectPreviousFeed() {
    const feeds = Array.from(this.querySelectorAll('.rss-feed'));
    if (feeds.length === 0) {
      return;
    }

    let startIndex = feeds.length;
    if (this._selectedArticle) {
      startIndex = feeds.findIndex(
        (f) => f.getAttribute('data-feed-id') === this._selectedArticle.feedID
      );
    }

    for (let i = startIndex - 1; i >= 0; i--) {
      const feed = feeds[i];
      const details = feed.querySelector('.rss-feed-details');
      const firstArticle = feed.querySelector('.rss-article');
      if (firstArticle) {
        if (details) {
          details.open = true;
        }
        const feedID = feed.getAttribute('data-feed-id');
        const articleID = firstArticle.getAttribute('data-article-id');
        this._selectArticle(feedID, articleID);
        return;
      }
    }
  }

  /**
   * Open the currently selected article in the viewer.
   *
   * @returns {Promise<void>}
   */
  async _openSelectedArticle() {
    if (!this._selectedArticle) {
      return;
    }
    const { feedID, articleID } = this._selectedArticle;
    const feed = this.feeds.find((f) => f.feedID === feedID);
    const article = this.findArticle(feedID, articleID);
    if (!feed || !article) {
      return;
    }

    this._lastViewedArticle = { feedID, articleID };
    this._nextArticleAfterViewed = this._findNextVisibleArticle(feedID, articleID);

    await this.openArticleViewer(article, feed);
  }

  /**
   * Return the article that follows the given article in the visible list.
   *
   * @param {string} feedID
   * @param {string} articleID
   * @returns {{feedID: string, articleID: string}|null}
   */
  _findNextVisibleArticle(feedID, articleID) {
    const articles = this._getVisibleArticles();
    const index = articles.findIndex(
      (a) => a.feedID === feedID && a.articleID === articleID
    );
    if (index >= 0 && index < articles.length - 1) {
      const next = articles[index + 1];
      return { feedID: next.feedID, articleID: next.articleID };
    }
    return null;
  }

  /**
   * Move the selection to the article that follows the given article,
   * falling back to the previous article when the given article is the
   * last visible one. This keeps a selection alive after the given
   * article is removed from the unread list.
   *
   * @param {string} feedID
   * @param {string} articleID
   * @returns {void}
   */
  _selectSurvivingArticle(feedID, articleID) {
    const nextArticle = this._findNextVisibleArticle(feedID, articleID);
    if (nextArticle) {
      this._selectedArticle = nextArticle;
    } else {
      const prevArticle = this._findPreviousVisibleArticle(feedID, articleID);
      this._selectedArticle = prevArticle;
    }
  }

  /**
   * Mark the currently selected article as read and move the selection
   * to the next unread article (or the previous one if it was the last).
   *
   * @returns {Promise<void>}
   */
  async _markSelectedArticleAsRead() {
    if (!this._selectedArticle) {
      return;
    }
    const { feedID, articleID } = this._selectedArticle;
    this._selectSurvivingArticle(feedID, articleID);
    await this.markAsRead(feedID, articleID);
  }

  /**
   * Return the article that precedes the given article in the visible list.
   *
   * @param {string} feedID
   * @param {string} articleID
   * @returns {{feedID: string, articleID: string}|null}
   */
  _findPreviousVisibleArticle(feedID, articleID) {
    const articles = this._getVisibleArticles();
    const index = articles.findIndex(
      (a) => a.feedID === feedID && a.articleID === articleID
    );
    if (index > 0) {
      const prev = articles[index - 1];
      return { feedID: prev.feedID, articleID: prev.articleID };
    }
    return null;
  }

  /**
   * Close the article viewer and select the next unread article.
   *
   * @returns {void}
   */
  _closeArticleViewerAndSelectNext() {
    this.closeModal();
    if (this._nextArticleAfterViewed) {
      const { feedID, articleID } = this._nextArticleAfterViewed;
      const details = this.querySelector(
        `.rss-feed[data-feed-id="${CSS.escape(feedID)}"] .rss-feed-details`
      );
      if (details) {
        details.open = true;
      }
      this._selectArticle(feedID, articleID);
    } else {
      this._selectFirstArticle();
    }
    this._nextArticleAfterViewed = null;
  }

  /**
   * Clean up timers and event listeners when the element is removed.
   *
   * @async
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._stopAutoRefresh();

    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }

    if (this._keyboardHandler) {
      document.removeEventListener('keydown', this._keyboardHandler, true);
      this._keyboardHandler = null;
    }

    if (this._documentClickHandler) {
      document.removeEventListener('click', this._documentClickHandler);
      this._documentClickHandler = null;
    }

    if (this.contentArea && this._contentClickHandler) {
      this.contentArea.removeEventListener('click', this._contentClickHandler);
      this._contentClickHandler = null;
      this.contentArea.innerHTML = '';
    }

    if (this._imageContextMenuHandler) {
      this.removeEventListener('contextmenu', this._imageContextMenuHandler);
      this._imageContextMenuHandler = null;
    }
    if (this._imageCtrlClickHandler) {
      this.removeEventListener('click', this._imageCtrlClickHandler);
      this._imageCtrlClickHandler = null;
    }

    this.closeModal();
    this.feeds = [];

    this._removeFindRail();
    if (this._findBar) {
      this._findBar.remove();
      this._findBar = null;
    }
  }
}

if (!customElements.get('rss-feed-component')) {
  customElements.define('rss-feed-component', RSSFeedComponent);
}
