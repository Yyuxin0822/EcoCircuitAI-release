// Normalize stored icon URLs so projects work on local and production hosts.
function parseIconUrl(iconUrl) {
    if (typeof iconUrl !== 'string' || !iconUrl || iconUrl === 'none') return iconUrl;
    if (iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
        try { return new URL(iconUrl).pathname; } catch (_) { return iconUrl; }
    }
    return iconUrl;
}

function renderIcon(icon, textdiv, iconUrl, color) {
    iconUrl = parseIconUrl(iconUrl);
    if (iconUrl && iconUrl !== 'none' && iconUrl !== '') {
        icon.style.backgroundImage = iconUrl.startsWith('url(') ? iconUrl : `url(${iconUrl})`;
        textdiv.style.display = 'none';
    } else {
        icon.style.backgroundImage = 'none';
        textdiv.style.display = 'flex';
    }
    icon.style.backgroundColor = color;
}

function isCosmeticOnlyChange(oldSystems, newSystems) {
    // Get the system names
    const oldNames = Object.keys(oldSystems).sort();
    const newNames = Object.keys(newSystems).sort();
    
    // If system names are different (added/removed/renamed), it's a content change
    if (oldNames.length !== newNames.length || !oldNames.every((name, i) => name === newNames[i])) {
        return false;
    }
    
    // Names are the same, so this is only a cosmetic change
    // (colors and/or icons changed but system names remain the same)
    return true;
}

class SystemBar {
    constructor(container) {
        this.container = container;
        const existingModal = document.getElementById("modal-popup-system");
        if (existingModal) {
          existingModal.remove();
        }
        SystemBar.processSystems(container, window.defaultSystems);
        this.modalSystem = new SystemModal(this.container);
        this.container.addEventListener('click', () => {
            if (this.modalSystem.modal.style.display === 'block') {
                this.modalSystem.closeModal();
            } else {
                this.modalSystem.openModal();
            }
        });
    }

    static processSystems(container, systemJSONObject) {
        if (!container) return;

        container.querySelectorAll('.toggle').forEach(toggle => toggle.remove());

        Object.entries(systemJSONObject).forEach(([content, [color, iconUrl]]) => {
            new System(container, content, color, iconUrl);
        });
    }

    static processModalSystems(container, systemJSONObject, modalInstance) {
        if (!container) return;

        container.querySelectorAll('.toggle').forEach(toggle => toggle.remove());

        Object.entries(systemJSONObject).forEach(([content, [color, iconUrl]]) => {
            modalInstance.appendToggle(container, content, color, iconUrl);
        });
    }

}


class SystemModal {
    constructor(associatedSystemBar, container = document.body) {
        this.container = container;
        this.associatedSystemBar = associatedSystemBar;
        this.modal = this.createModal();
        this.container.appendChild(this.modal);

        window.currentSystems = { ...window.defaultSystems };
        SystemBar.processModalSystems(this.modal.querySelector('#syslist'), defaultSystems, this);
        // this.activeToggle = null;
        //set the first toggle to active
        const firstToggle = this.modal.querySelector('#syslist .toggle');
        if (firstToggle) {
            firstToggle.classList.add('active');
            firstToggle.classList.remove('inactive');
        }
        this.colorPicker = new ColorPicker(
            this.modal.querySelector("#colorPicker"),
            this.modal.querySelector("#hexInput")
        );

        this.applyToggleBehaviors();
        this.setupEventListeners();
        this.setupModalButtons();
    }

    createModal() {
        const modalHTML = `
        <div id="modal-popup-system">
          <div class="modal-system" id="modal-system">
            <span class="icon-common icon-close" id="icon-close-system"></span>
            <div class="frame">
              <div class="sub-frame-1">
                <div class="syslist-wrapper">
                  <div class="wrapper" id="syslist">
                    <div class="normal modalbtn" id="addnew">+ Add New</div>
                  </div>
                </div>
                <div class="icon-editer stopper">
                  <div id="colorPicker"></div>
                  <input type="text" id="hexInput" placeholder="#FFFFFF" maxlength="7" />
                </div>
              </div>
              <div class="sub-frame-2">
                <div class="component-bar-2">
                  <span class="icon-common icon-add"></span>
                  <div id="set-system" class="set-system emphasis"
                    style="cursor: pointer; text-align: center; border: none; background-color: transparent;">
                    Set System
                  </div>
                </div>
                <div class="normal modalbtn" id="reset-system">+ Reset System</div>
              </div>
            </div>
          </div>
        </div>`;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = modalHTML.trim();
        return tempDiv.firstChild;
    }

    setupEventListeners() {
        const closeIcon = this.modal.querySelector('#icon-close-system');
        closeIcon.addEventListener('click', () => this.closeModal());
        document.addEventListener('click', this.handleClickOutside.bind(this));
    }

    setupModalButtons() {
        const syslist = this.modal.querySelector('#syslist');
      
        this.modal.querySelector('#addnew').onclick = () => this.addNewSystem(syslist);
        this.modal.querySelector('#reset-system').onclick = () => this.resetToDefault(syslist);
      
        this.modal.querySelector('#set-system').onclick = () => {
          const oldSystemsSnapshot = JSON.parse(JSON.stringify(window.defaultSystems));
          const oldSystemNames = Object.keys(oldSystemsSnapshot);
      
          this.setSystem();
          
          const newSystemsSnapshot = JSON.parse(JSON.stringify(window.defaultSystems));
          const newSystemNames = Object.keys(newSystemsSnapshot);
          
          // Check if this is only a cosmetic change (colors/icons changed but names are the same)
          const isCosmeticChange = isCosmeticOnlyChange(oldSystemsSnapshot, newSystemsSnapshot);
          
          if (isCosmeticChange) {
            // Only cosmetic changes - emit socket event without adding to backstack
            if (window.socket && window.projectId) {
              // Use setTimeout to make socket emit truly non-blocking
              setTimeout(() => {
                window.socket.emit('update_system_cosmetic', {
                  projectId: window.projectId,
                  sysColor: newSystemsSnapshot
                });
                // console.log('System cosmetic update sent to server');
              }, 0);
            }
            
            colorBySystem.clearCache();
            
            // Use requestAnimationFrame to defer heavy rendering operations
            requestAnimationFrame(() => {
              drawDiagram();
              
              // Also update metabolism diagram if it exists
              if (typeof drawMetabolismDiagram === 'function' && window.metabolism) {
                drawMetabolismDiagram(window.metabolism);
              }
            });
          } else {
            // Content changes (names added/removed/changed) - use backstack
            const deletedSystems = oldSystemNames.filter(s => !newSystemNames.includes(s));
            
            // Save to backstack BEFORE making any changes
            iodataBackstack.push({
              iodata: JSON.parse(JSON.stringify(window.iodata)),
              syscolor: oldSystemsSnapshot, // original systems before changes
            });
            
            // Delete all nodes and links for deleted systems
            if (deletedSystems.length > 0) {
              deletedSystems.forEach(systemName => {
                if (typeof window.deleteSystem === 'function') {
                  window.deleteSystem(systemName);
                }
                if (typeof window.deleteSystemFromMetabolism === 'function') {
                  window.deleteSystemFromMetabolism(systemName);
                }
              });
            }
            
            colorBySystem.clearCache();
            
            // Use requestAnimationFrame to defer heavy rendering operations
            requestAnimationFrame(() => {
              drawDiagram();
              
              // Also update metabolism diagram if it exists
              if (typeof drawMetabolismDiagram === 'function' && window.metabolism) {
                drawMetabolismDiagram(window.metabolism);
              }
            });
          }
        };
      }
      
      

    addNewSystem(sys, color = 'rgba(161, 173, 204, 1)', iconUrl = null) {
        let placeholder = 'CUSTOM SYSTEM';
        let count = 2;
        while (window.currentSystems[placeholder]) {
            placeholder = `CUSTOM SYSTEM ${count++}`;
        }

        if (Object.keys(window.currentSystems).length >= 7) {
            alert('You can only add up to 7 systems.');
            return;
        }

        window.currentSystems[placeholder] = [color, iconUrl];
        const toggle = this.appendToggle(sys, placeholder, color, iconUrl);
        this.activateToggle(toggle);
    }


    resetToDefault(sys) {
        window.currentSystems = { ...window.defaultSystems };
        this.colorPicker.setColor("#ffffff");

        // Remove old toggles
        sys.querySelectorAll('.toggle').forEach(toggle => toggle.remove());

        Object.entries(window.defaultSystems).forEach(([content, [color, iconUrl]]) => {
            this.appendToggle(sys, content, color, iconUrl);
        });

        this.applyToggleBehaviors();
    }


    setSystem() {
        if (!this.updateCurrentSystemsFromToggles()) {
            return; // duplicates found, exit early
        }

        if (Object.keys(window.currentSystems).length === 0) {
            alert('Please add at least one system.');
            return;
        }

        const placeholderRegex = /^CUSTOM SYSTEM( \d+)?$/i;

        if (Object.keys(window.currentSystems).some(content =>
            content.trim() === '' || placeholderRegex.test(content.trim()))) {
            alert('Please fill in custom or empty system names.');
            return;
        }
        window.defaultSystems = { ...window.currentSystems };
        // window.defaultSystems = sortSystemsByHue(window.currentSystems);
        SystemBar.processSystems(this.associatedSystemBar, window.defaultSystems);
        this.closeModal();
    }

    updateCurrentSystemsFromToggles() {
        const toggles = this.modal.querySelectorAll('#syslist .toggle');
        const systemEntries = [];

        toggles.forEach(toggle => {
            const content = toggle.querySelector('.systext').textContent.trim().toUpperCase();
            const icon = toggle.querySelector('.icon-common:not(.icon-close2)');
            const bgColor = icon ? window.getComputedStyle(icon).backgroundColor : '#FFFFFF';
            const iconUrl = icon?.style.backgroundImage.slice(5, -2) || null;

            systemEntries.push([content, [bgColor, iconUrl]]);
        });

        const systemNames = systemEntries.map(entry => entry[0]);
        const uniqueNames = new Set(systemNames);

        if (uniqueNames.size !== systemNames.length) {
            alert('System names must be unique.');
            return false; // indicate failure due to duplicates
        }

        window.currentSystems = Object.fromEntries(systemEntries);
        return true; // indicate success
    }

    appendToggle(container, content, color, iconUrl = null) {
        const toggle = document.createElement('div');
        toggle.classList.add('toggle', 'inactive');
        toggle.id = validId(content);

        const sysicon = document.createElement('div');
        sysicon.classList.add('sysicon');

        const icon = document.createElement('span');
        icon.classList.add('icon-common');

        const textdiv = document.createElement('p');
        textdiv.classList.add('icon-letter');
        textdiv.textContent = content.charAt(0).toUpperCase();
        icon.appendChild(textdiv);

        renderIcon(icon, textdiv, iconUrl, color);
        sysicon.appendChild(icon);
        toggle.appendChild(sysicon);

        const closeBtn = document.createElement('span');
        closeBtn.classList.add('icon-common', 'icon-close2');
        toggle.appendChild(closeBtn);

        const systext = document.createElement('p');
        systext.classList.add('systext');
        systext.textContent = content;
        toggle.appendChild(systext);

        container.insertBefore(toggle, container.querySelector('#addnew'));

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            delete window.currentSystems[content];
            toggle.remove();
        });

        toggle.addEventListener('click', (e) => {
            if (e.target === closeBtn) return;
            this.activateToggle(toggle);
        });

        return toggle;
    }

    applyToggleBehaviors() {
        const toggles = this.modal.querySelectorAll('#syslist .toggle');
        toggles.forEach(toggle => {
            const closeBtn = toggle.querySelector('.icon-close2');

            toggle.onclick = (e) => {
                if (e.target === closeBtn) return;
                this.activateToggle(toggle);
            };

            if (closeBtn) {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggle.remove();
                };
            }
        });
    }


    activateToggle(activeToggle) {
        const toggles = this.modal.querySelectorAll('#syslist .toggle');

        toggles.forEach(toggle => {
            let systext = toggle.querySelector('.systext');
            let textdiv = toggle.querySelector('.icon-letter');

            if (toggle === activeToggle) {
                toggle.classList.add('active');
                toggle.classList.remove('inactive');

                systext.contentEditable = 'true';
                systext.focus();

                document.querySelector('.icon-editer').classList.add('active');
                this.syncColorPicker(toggle);

                // Store the original key and icon data before editing
                const originalKey = Object.keys(window.currentSystems).find(
                    key => validId(key) === toggle.id
                );
                const icon = toggle.querySelector('.icon-common:not(.icon-close2)');
                const originalIconUrl = icon?.style.backgroundImage || '';
                const originalBgColor = icon?.style.backgroundColor || '';

                // On input, update the icon based on current text
                systext.oninput = () => {
                    const currentText = systext.textContent.trim();
                    if (currentText) {
                        textdiv.textContent = currentText.charAt(0).toUpperCase();
                        
                        // Check if current text exists in currentSystems
                        const currentTextUpper = currentText.toUpperCase();
                        if (window.currentSystems[currentTextUpper]) {
                            const [, iconUrl] = window.currentSystems[currentTextUpper];  // Only extract iconUrl, ignore color
                            renderIcon(icon, textdiv, iconUrl, originalBgColor);  // Use originalBgColor instead of saved color
                        } else {
                            // No associated system - show placeholder letter with original color
                            renderIcon(icon, textdiv, null, originalBgColor);
                        }
                    }
                };

                // On blur, update placeholder and internal data
                systext.onblur = () => {
                    const newText = systext.textContent.trim().toUpperCase();
                    if (newText) {
                        textdiv.textContent = newText.charAt(0).toUpperCase();

                        const oldKey = Object.keys(window.currentSystems).find(
                            key => validId(key) === toggle.id
                        );
                        if (oldKey && oldKey !== newText) {
                            window.currentSystems[newText] = window.currentSystems[oldKey];
                            delete window.currentSystems[oldKey];
                            toggle.id = validId(newText);
                        }
                    }
                };

                // Handle Enter key to confirm edits without newline
                systext.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();  // Stops newline insertion
                        systext.blur();      // Confirm edits and trigger onblur
                    }
                };
            } else {
                toggle.classList.remove('active');
                toggle.classList.add('inactive');
                if (systext) {
                    systext.contentEditable = 'false';
                    systext.blur();
                }
            }
        });
    }


    syncColorPicker(toggle) {
        const icon = toggle.querySelector('.icon-common:not(.icon-close2)');
        const bgColor = icon ? window.getComputedStyle(icon).backgroundColor : '#FFFFFF';

        // Set the color picker to reflect current toggle color
        this.colorPicker.setColor(bgColor);
    }

    handleClickOutside(event) {
        const clickedInsideSyslist = event.target.closest('#syslist');
        const clickedInsideIconEditor = event.target.closest('.icon-editer');

        if (!clickedInsideSyslist && !clickedInsideIconEditor) {
            this.deactivateAllToggles();
        }
    }

    deactivateAllToggles() {
        const toggles = this.modal.querySelectorAll('#syslist .toggle');
        toggles.forEach(toggle => {
            toggle.classList.remove('active');
            toggle.classList.add('inactive');
            const systext = toggle.querySelector('.systext');
            if (systext) {
                systext.contentEditable = 'false';
                systext.blur();
            }
        });
        document.querySelector('.icon-editer').classList.remove('active');
    }
    closeModal() {
        console.log("Closing modal");
        this.modal.style.display = 'none';
        this.resetToDefault(this.modal.querySelector('#syslist'));
    }

    openModal() {
        this.modal.style.display = 'block';
        this.modal.querySelector('.modal-system').style.visibility = 'visible';
    }
}


class ColorPicker {
    constructor(pickerContainer, hexInputContainer) {
        this.pickerElement = pickerContainer;
        this.hexInput = hexInputContainer;
        this.initPicker();
        this.initHexInput();
    }

    initPicker() {
        this.colorPicker = new iro.ColorPicker(this.pickerElement, {
            width: 200,
            layout: [{ component: iro.ui.Wheel }]
        });

        this.colorPicker.on('color:change', (color) => {
            this.updateHexInput(color.hexString);
            this.applyColor(color.hexString);
        });
    }

    initHexInput() {
        this.hexInput.addEventListener('change', () => {
            const hex = this.hexInput.value.trim();
            if (/^#([0-9A-F]{6})$/i.test(hex)) {
                this.colorPicker.color.set(hex);
                this.applyColor(hex);
            } else {
                alert("Please enter a valid hex color code (e.g., #FF0000).");
                this.hexInput.value = this.colorPicker.color.hexString;
            }
        });
    }

    updateHexInput(hexString) {
        this.hexInput.value = hexString;
    }

    applyColor(hexString) {
        const activeToggle = document.querySelector('#syslist .active .icon-common');
        if (activeToggle) {
            activeToggle.style.backgroundColor = hexString;
        }
    }

    setColor(colorString) {
        let hexColor;

        if (colorString.startsWith('rgb')) {
            const rgbValues = colorString.match(/\d+/g);
            if (rgbValues && rgbValues.length === 3) {
                hexColor = '#' + rgbValues.map(v => {
                    const hex = parseInt(v).toString(16);
                    return hex.length === 1 ? '0' + hex : hex;
                }).join('');
            } else {
                console.warn(`Invalid RGB string provided to setColor: ${colorString}`);
                return;
            }
        } else if (/^#([0-9A-F]{6})$/i.test(colorString)) {
            hexColor = colorString;
        } else {
            console.warn(`Invalid color string provided to setColor: ${colorString}`);
            return;
        }

        this.colorPicker.color.set(hexColor);
        this.updateHexInput(hexColor);
    }

}

window.sortSystemsByHue = function(systems) {
    function colorToHue(color) {
        let r, g, b;

        if (color.startsWith('rgba') || color.startsWith('rgb')) {
            [r, g, b] = color.match(/\d+/g).map(Number);
        } else {
            if (color.length === 4) {
                color = '#' + [...color.slice(1)].map(ch => ch + ch).join('');
            }
            r = parseInt(color.substr(1, 2), 16);
            g = parseInt(color.substr(3, 2), 16);
            b = parseInt(color.substr(5, 2), 16);
        }

        r /= 255;
        g /= 255;
        b /= 255;

        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0;

        if (max !== min) {
            const d = max - min;
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
                case g: h = ((b - r) / d + 2); break;
                case b: h = ((r - g) / d + 4); break;
            }
            h *= 60;
        }

        return h;
    }


    const entries = Object.entries(systems);
    entries.sort((a, b) => {
        const colorA = a[1][0];
        const colorB = b[1][0];
        return colorToHue(colorA) - colorToHue(colorB);
    });
    //reverse the order
    entries.reverse();
    return Object.fromEntries(entries);
}

class System {
    constructor(container, content, color, iconUrl) {
        this._container = container;
        this._content = content;
        this._id = validId(content);
        this._color = color;
        this._iconUrl = iconUrl;
        this.init();
    }
    init() {
        let toggle = document.createElement('div');
        toggle.classList.add('toggle');
        toggle.id = this.id;

        let icon = document.createElement('div');
        icon.classList.add('icon-common');
        toggle.appendChild(icon);
        let textdiv = document.createElement('p');
        textdiv.innerText = this._content.charAt(0).toUpperCase();
        textdiv.classList.add('icon-letter');
        icon.appendChild(textdiv);
        renderIcon(icon, textdiv, this._iconUrl, this._color);
        toggle.appendChild(document.createTextNode(this._content));
        this._container.appendChild(toggle);
    }
    get id() {
        return this._id;
    }
    get content() {
        return this._content;
    }
    get color() {
        return this._color;
    }
    set color(color) {
        this._color = color;
        let toggle = this._container.querySelector(`#${this._id}`);
        toggle.querySelector('.icon-common').style.backgroundColor = color;
    }
    static returnSysArray() {
        const sysBtn = document.getElementById('system-bar').querySelector('.active');
        if (sysBtn) {
            const systemName = sysBtn.innerText.trim();
            const bgColor = sysBtn.querySelector('.icon-common').style.backgroundColor;

            if (currentSystems[systemName]) {
                currentSystems[systemName][0] = bgColor;
            }
        }

        const data = { project_id: projectId, system: currentSystems };
        return emitSocket("save_system", data).then(() => {
            return currentSystems;
        }).catch(error => {
            console.error("Failed to emit socket:", error);
            throw error;
        });
    }
}


