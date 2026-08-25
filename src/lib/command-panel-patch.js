/**
 * Lifecycle patch for @lnsy/command-panel.
 *
 * The published component calls this.initialize() inside its constructor and
 * appends children to itself. Chromium (and the custom elements spec) throw
 * when document.createElement returns an element that already has children.
 *
 * This module intercepts registration of the <command-panel> element and
 * wraps the class so initialization runs from connectedCallback instead.
 * The original methods (addCommand, openPanel, etc.) are inherited unchanged.
 */

const originalDefine = customElements.define;

customElements.define = function (name, constructor, options) {
  if (name !== 'command-panel') {
    return originalDefine.call(this, name, constructor, options);
  }

  class FixedCommandPanel extends constructor {
    constructor() {
      super();
    }

    /**
     * The base constructor invokes initialize(). We must not create children
     * here, but we do need a commands array so addCommand() can be called
     * before the element is connected.
     */
    initialize() {
      if (!this.commands) {
        this.commands = [];
      }
    }

    connectedCallback() {
      // Let the base class run its own connectedCallback (preInit), which is
      // now safe because our initialize() only touches the commands array.
      if (super.connectedCallback) {
        super.connectedCallback();
      }

      if (this._commandPanelInitialized) {
        return;
      }
      this._commandPanelInitialized = true;

      // Capture any commands registered before the element was connected.
      const queuedCommands = this.commands || [];

      // Run the real component initialization now that DOM access is allowed.
      constructor.prototype.initialize.call(this);

      // Restore pre-registered commands and refresh the list.
      for (const command of queuedCommands) {
        this.commands.push(command);
      }
      this.filteredCommands = [...this.commands];
      this.selectedIndex = 0;
      constructor.prototype.renderCommands.call(this);

      // Prevent Escape from bubbling out of the command panel. The panel is
      // rendered on top of modals such as the article viewer; without this,
      // pressing Escape would close both the panel and the viewer behind it.
      this.dialog.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
          }
        },
        true
      );
    }
  }

  return originalDefine.call(this, name, FixedCommandPanel, options);
};
