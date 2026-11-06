// Normalize stored icon URLs so projects work on local and production hosts.
function parseIconUrl(iconUrl) {
    if (typeof iconUrl !== 'string' || !iconUrl || iconUrl === 'none') return iconUrl;
    if (iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
        try { return new URL(iconUrl).pathname; } catch (_) { return iconUrl; }
    }
    return iconUrl;
}

String.prototype.toTitleCase = function () {
    return this.replace(/\w\S*/g, function (txt) {
        return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase();
    });
};

// Setup search window event listener
function setupSearchWindow() {
    const searchWindow = document.getElementById("searchwindow");
    if (searchWindow) {
        searchWindow.addEventListener("keyup", function(event) {
            const query = event.target.value;
            window.searchQueryChanged(query);
            
            if (event.key === "Enter") {
                event.preventDefault();
            }
        });
    }
}

// Setup toolbar interface - call this on page load
function setupToolInterface() {
    setupSearchWindow();
}
// Search Box functions
window.searchQueryChanged = function (value) {
  const items = [];
  const ids = [];
  const searchList = document.getElementById("searchList");
  resetLayers();

  if (value.length > 0) {
    Object.values(processGroupByMethodSystem).forEach(processes => {
      processes.forEach(process => {
        process.nodes.forEach(node => {
          if (node.name.toLowerCase().includes(value.toLowerCase()) && !items.includes(node.name) && items.length < 12) {
            items.push(node.name);
            ids.push(process.id);
          }
        });
      });
    });

    const html = items.map((item, i) =>
      `<li onclick='window.goToProcess(${ids[i]}, "${item}")'>${item}</li>`
    );
    searchList.innerHTML = html.join("");
    searchList.style.display = items.length ? "block" : "none";
  } else {
    searchList.innerHTML = "";
    searchList.style.display = "none";
  }
};

window.goToProcess = function (processId, text) {
  const searchList = document.getElementById("searchList");
  searchList.innerHTML = "";
  searchList.style.display = "none";

  const metabolismContainer = document.getElementById("metabolism-container");
  metabolismContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Reset any existing highlights
  if (window.resetLayers) window.resetLayers();
  if (window.removeHighlight) window.removeHighlight();

  // First reset zoom to identity
  window.metabolismSvg.transition()
    .duration(800)
    .call(window.zoomBehavior.transform, d3.zoomIdentity)
    .on("end", () => {
      const formattedNodeName = text.replace(/\s+/g, '_');
      const nodeSelector = `[id^="node-${formattedNodeName}-"]`;

      const targetNodes = window.metabolismSvg.selectAll(nodeSelector);

      if (targetNodes.empty()) {
        console.warn(`No nodes found with selector: ${nodeSelector}`);
        return;
      }

      // Calculate bounding box for all matching nodes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      targetNodes.each(function() {
        const bbox = this.getBBox();
        minX = Math.min(minX, bbox.x);
        minY = Math.min(minY, bbox.y);
        maxX = Math.max(maxX, bbox.x + bbox.width);
        maxY = Math.max(maxY, bbox.y + bbox.height);
      });

      const nodesBBox = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      };

      // Get SVG dimensions
      const svgWidth = window.metabolismSvg.node().clientWidth || window.metabolismSvg.node().viewBox.baseVal.width;
      const svgHeight = window.metabolismSvg.node().clientHeight || window.metabolismSvg.node().viewBox.baseVal.height;

      // Calculate zoom scale to fit the nodes with some padding
      const padding = 100;
      const scaleX = svgWidth / (nodesBBox.width + padding * 2);
      const scaleY = svgHeight / (nodesBBox.height + padding * 2);
      const scale = Math.min(scaleX, scaleY, 2); // Cap at 2x zoom

      // Calculate center point for zoom
      const centerX = nodesBBox.x + nodesBBox.width / 2;
      const centerY = nodesBBox.y + nodesBBox.height / 2;

      // Apply zoom to center on the nodes
      window.metabolismSvg.transition()
        .duration(1200)
        .call(
          window.zoomBehavior.transform,
          d3.zoomIdentity
            .translate(svgWidth / 2, svgHeight / 2)
            .scale(scale)
            .translate(-centerX, -centerY)
        );

      // Add highlight rectangle similar to process highlighting
      const highlightLayer = d3.select("#matrix-metabolism .highlight-layer");
      
      // Get main-group transform offset
      const mainGroupTransform = d3.select("#matrix-metabolism .main-group").attr("transform");
      const transformMatch = /translate\(([^,]+),\s*([^)]+)\)/.exec(mainGroupTransform);
      const offsetX = transformMatch ? parseFloat(transformMatch[1]) : 0;
      const offsetY = transformMatch ? parseFloat(transformMatch[2]) : 0;

      highlightLayer
        .append("rect")
        .attr("class", "highlight-node-rect")
        .attr("x", nodesBBox.x + offsetX - 10)
        .attr("y", nodesBBox.y + offsetY - 10)
        .attr("width", nodesBBox.width + 20)
        .attr("height", nodesBBox.height + 20)
        .attr("fill", "none")
        .attr("stroke", "rgba(0, 0, 0, 0.85)")
        .attr("stroke-width", 10)
        .attr("rx", 12)
        .attr("ry", 12);

      highlightLayer.raise();

      // Auto-remove highlight after 3 seconds
      setTimeout(() => {
        if (window.removeHighlight) window.removeHighlight();
      }, 3000);
    });
};
// Confirm, Compute and Undo buttons
function setupDynamicButtons() {
    const confirmButton = document.getElementById("meta-confirmButton");
    const computeButton = document.getElementById("meta-computeButton");
    const undoButton = document.getElementById("meta-undoButton");

    if (metabolismBackstack.length > 0) {
        confirmButton.style.display = 'flex';
        computeButton.style.display = 'flex';
        undoButton.style.display = 'flex';

        confirmButton.onclick = () => {
            // Start loading animations
            if (typeof startLoad !== 'undefined') {
                startLoad("metabolism-svg-wrapper", "Saving project...");
                startLoad("io-svg-wrapper", "Saving project...");
            }
            
            // Set up one-time listeners for save response
            window.socket.once('save_project_success', (data) => {
                // Update loader text before finishing
                if (typeof updateLoaderText !== 'undefined') {
                    updateLoaderText("Save complete! Refreshing diagrams...", 100);
                }
                
                // Clear both backstacks
                if (typeof iodataBackstack !== 'undefined') {
                    iodataBackstack.length = 0;
                }
                metabolismBackstack.length = 0;
                
                // Small delay to show success message
                setTimeout(() => {
                    // Finish loading animations
                    if (typeof finishLoad !== 'undefined') {
                        finishLoad("metabolism-svg-wrapper");
                        finishLoad("io-svg-wrapper");
                    }
                    
                    // Redraw both diagrams with fresh state
                    drawMetabolismDiagram(window.metabolism, true);
                    if (typeof drawDiagram !== 'undefined') {
                        drawDiagram(true);
                    }
                }, 500);
            });
            
            window.socket.once('save_project_error', (errorData) => {
                console.error("Save failed:", errorData.error);
                
                // Finish loading animations
                if (typeof finishLoad !== 'undefined') {
                    finishLoad("metabolism-svg-wrapper");
                    finishLoad("io-svg-wrapper");
                }
                
                // Show error alert
                alert(errorData.error || 'Failed to save project. Please try again.');
            });
            
            // Emit save request
            window.socket.emit('save_project', {
                projectId: projectId,
                sysColor: window.defaultSystems,
                ioData: window.iodata,
                metabolism: window.metabolism,
                env: info
            });
        };

        computeButton.onclick = () => drawMetabolismDiagram(metabolism, true);
        undoButton.onclick = () => {
            drawMetabolismDiagram(metabolismBackstack.pop());
        };
    } else {
        confirmButton.style.display = 'none';
        computeButton.style.display = 'none';
        undoButton.style.display = 'none';

        confirmButton.onclick = null;
        computeButton.onclick = null;
        undoButton.onclick = null;
    }
}



// Toolbar expand/collapse
function toggleToolbar(expand = true, id = '') {
    const tool = document.getElementById(id);
    const minimized = tool.querySelector('.minimized-toolbar');
    const expanded = tool.querySelector('.expanded-toolbar');

    minimized?.style.setProperty('display', expand ? 'none' : 'flex');
    expanded?.style.setProperty('display', expand ? 'flex' : 'none');
}



// Navigation Bar
function createNaviDict(processGroupByMethodSystem, feedbackLoopByLoopSystem, syscolor) {
    let naviDict = {};
    for (const [key, value] of Object.entries(syscolor)) {
        if (!naviDict[key]) naviDict[key] = {};
        naviDict[key]["syscolor"] = value;
    }
    for (const [key, value] of Object.entries(processGroupByMethodSystem)) {
        if (!naviDict[key]) naviDict[key] = {};
        naviDict[key]["process"] = value.map(item => item.method.name);
    }
    for (const [key, value] of Object.entries(feedbackLoopByLoopSystem)) {
        if (!naviDict[key]) naviDict[key] = {};
        naviDict[key]["feedback"] = value.map(item => item.name);
    }
    return naviDict;
}

function createNaviBar() {
    const naviDict = createNaviDict(window.processGroupByMethodSystem, window.feedbackLoopByLoopSystem, window.defaultSystems);
    console.log(window.defaultSystems);
    let navibarContainer = document.getElementById("navibar-container");
    let createSystem = function (key, value) {
        let toggle = document.createElement("div");
        toggle.classList.add("toggle");
        toggle.id = key;

        var wrapperDiv = document.createElement('div');
        wrapperDiv.classList.add('syswrapper-div');
        wrapperDiv.appendChild(createIcon(key, value.syscolor));
        wrapperDiv.appendChild(createSysTitle(key, value.syscolor));
        toggle.appendChild(wrapperDiv);

        var wrapperDiv2 = document.createElement('div');
        wrapperDiv2.classList.add('navilistwrapper-div');
        if (value.process) wrapperDiv2.appendChild(createProcess(value.process));
        if (value.feedback) wrapperDiv2.appendChild(createFeedback(value.feedback));
        toggle.appendChild(wrapperDiv2);

        return toggle;
    }

    let createIcon = function (key, syscolorValue) {
        let icon = document.createElement('div');
        icon.classList.add('icon-common');

        // Handle undefined/unknown systems
        if (!syscolorValue || !Array.isArray(syscolorValue) || syscolorValue.length < 2) {
            syscolorValue = ['#888', 'static/icon/Iconsystem-dark-unknown.png']; // Default for unknown systems
        }

        let iconUrl = parseIconUrl(syscolorValue[1]);
        icon.style.backgroundColor = syscolorValue[0];

        let textdiv = function () {
            let textdiv = document.createElement('p');
            textdiv.innerText = key.charAt(0).toUpperCase();
            textdiv.classList.add('icon-placeholder');
            textdiv.style.display = 'flex';
            icon.appendChild(textdiv);
            return textdiv;
        }

        if (!iconUrl) {
            textdiv().style.display = 'flex';
        } else {
            fetch(iconUrl, { method: 'HEAD' })
                .then(response => {
                    if (response.ok) {
                        icon.style.backgroundImage = `url(${iconUrl})`;
                        icon.style.backgroundSize = 'contain';
                        textdiv().style.display = 'none';
                    } else {
                        textdiv().style.display = 'flex';
                    }
                })
                .catch(error => {
                    // console.error(`Error fetching icon URL for ${key}:`, error);
                    textdiv.style.display = 'flex';
                });
        }
        return icon;
    }

    let createSysTitle = function (key, syscolorValue) {
        let sysTitle = document.createElement('div');
        sysTitle.classList.add('system-title');
        
        // Handle undefined/unknown systems
        if (!syscolorValue || !Array.isArray(syscolorValue) || syscolorValue.length < 1) {
            syscolorValue = ['#888', 'static/icon/Iconsystem-dark-unknown.png']; // Default for unknown systems
        }
        
        sysTitle.style.color = syscolorValue[0];
        sysTitle.innerText = key;
        return sysTitle;
    }

    let createProcess = function (processList) {
        if (!processList) return;
        let processDiv = document.createElement('div');
        processDiv.innerText = 'Expanded System Methods'
        processDiv.classList.add('navilist');

        let processListElement = document.createElement('ul');
        processListElement.classList.add('process-list');
        processList.forEach(proc => {
            let procItem = document.createElement('li');
            procItem.innerText = proc.toTitleCase();
            procItem.addEventListener("click", (event) => {
                event.stopPropagation();
                scrollToProcess(proc);
                highlightProcess(proc);
            });
            processListElement.appendChild(procItem);
        });
        processDiv.appendChild(processListElement);
        return processDiv;
    }
    let createFeedback = function (feedbackList) {
        if (!feedbackList) return;
        let feedbackDiv = document.createElement('div');
        feedbackDiv.innerText = 'Regeneration Loops'
        feedbackDiv.classList.add('navilist');
        if (feedbackList) {
            let feedbackListElement = document.createElement('ul');
            feedbackListElement.classList.add('feedback-list');
            feedbackList.forEach(fb => {
                let fbItem = document.createElement('li');
                fbItem.innerText = fb.toTitleCase();

                fbItem.addEventListener("click", () => {
                    scrollToFeedback(fb);

                    // simulate feedback circle click
                    setTimeout(() => {
                        const feedbackCircle = document.querySelector(`.feedback-title-item[data-loop="${fb}"] circle`);
                        if (feedbackCircle) {
                            feedbackCircle.dispatchEvent(new Event('click', { bubbles: true }));
                        } else {
                            console.warn("Feedback circle not found:", fb);
                        }
                    }, 400); // slight delay ensures DOM is ready after scroll
                });

                feedbackListElement.appendChild(fbItem);
            });
            feedbackDiv.appendChild(feedbackListElement);
        }
        return feedbackDiv;
    }

    navibarContainer.innerHTML = '<div>Navigation</div>';
    Object.entries(naviDict).forEach(([key, value]) => {
        navibarContainer.appendChild(createSystem(key, value));
    })


    function scrollToSystem(systemKey) {
        const target = document.querySelector(`.system-title[text-anchor='left'][fill='${colorBySystem(systemKey, 1)}']`);
        if (target) scrollToElement(target);
    }

    function scrollToProcess(processName) {
        const titleElements = document.querySelectorAll(".title-group .process-title");
        let found = false;

        titleElements.forEach(titleEl => {
            // Handle wrapped text by joining tspan elements
            const tspans = titleEl.querySelectorAll('tspan');
            const actualText = tspans.length > 0 
                ? Array.from(tspans).map(t => t.textContent).join(' ').trim()
                : titleEl.textContent.trim();
                
            if (actualText.toLowerCase() === processName.trim().toLowerCase()) {
                scrollToElement(titleEl);
                found = true;
            }
        });

        if (!found) {
            console.warn("Process not found:", processName);
        }
    }

    function scrollToFeedback(feedbackName) {
        const feedbackItems = document.querySelectorAll(`.feedback-title-item`);
        let found = false;

        feedbackItems.forEach(item => {
            if (item.getAttribute("data-loop").trim().toLowerCase() === feedbackName.trim().toLowerCase()) {
                scrollToElement(item);
                found = true;
            }
        });

        if (!found) {
            console.warn("Feedback not found:", feedbackName);
        }
    }


}


