// icon-dropdown.js
class IconDropdown extends HTMLElement {
  constructor() {
    super();
    console.log('IconDropdown loaded with menu-option styles');
    // 1. Create a shadow root
    this.attachShadow({ mode: 'open' });

    // 2. Inject template + styles
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; position: relative; }
        .trigger {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 1.5rem;
          height: 1.5rem;
          background: transparent;
          border: 1px solid #ccc;
          border-radius: 50%;
          cursor: pointer;
          padding: 0;
          transition: background-color 0.1s ease;
        }
        .trigger:hover {
          background-color: var(--THEME-PURPLE, #8a2be2);
        }
        .menu {
          position: absolute;
          top: 100%;
          right: 0;
          background: white;
          border-radius: 0.5rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
          margin-top: 0.25rem;
          min-width: 8rem;
          display: none;
          padding: 0.5rem 0.5rem 0.5rem 0.75rem;
          z-index: 1000;
        }
        .menu.open {
          display: block;
        }
        ::slotted(.menu-option) {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.25rem 0.5rem;
          cursor: pointer;
          border: none;
          background: none;
          width: 100%;
          text-align: left;
          font-size: 10px !important;
          font-family: "Comfortaa", sans-serif;
          color: var(--GRAY-TEXT, #333);
          border-radius: 0.25rem;
          transition: background-color 0.2s ease;
        }
        ::slotted(.menu-option:hover:not(.active)) {
          background-color: var(--THEME-PURPLE, rgba(232, 237, 250, 0.75));
        }
        ::slotted(.menu-option.danger) {
          color: #dc2626;
        }
        ::slotted(.menu-option.danger:hover) {
          background-color: #fef2f2;
        }
      </style>
      <button class="trigger">
        <slot name="icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="9" y1="18" x2="21" y2="18"/>
          </svg>
        </slot>
      </button>
      <div class="menu icon-dropdown">
        <slot name="menu">
          <!-- default fallback -->
          <div style="padding:0.5rem">No items</div>
        </slot>
      </div>
    `;

    // 3. Bind methods
    this._toggle = this._toggle.bind(this);
    this._onClickOutside = this._onClickOutside.bind(this);
  }

  connectedCallback() {
    this.shadowRoot.querySelector('.trigger')
      .addEventListener('click', this._toggle);
    document.addEventListener('click', this._onClickOutside);
  }

  disconnectedCallback() {
    this.shadowRoot.querySelector('.trigger')
      .removeEventListener('click', this._toggle);
    document.removeEventListener('click', this._onClickOutside);
  }

  _toggle(e) {
    e.stopPropagation(); // don’t immediately close it
    const menu = this.shadowRoot.querySelector('.menu');
    menu.classList.toggle('open');
  }

  _onClickOutside(e) {
    const menu = this.shadowRoot.querySelector('.menu');
    if (!this.contains(e.target) && menu.classList.contains('open')) {
      menu.classList.remove('open');
    }
  }
}
customElements.define('icon-dropdown', IconDropdown);
