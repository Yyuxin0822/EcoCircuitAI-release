function projectShareUrl(id, location = window.location) {
  const productionHosts = ["ecocircuitai.com", "www.ecocircuitai.com"];
  const origin = productionHosts.includes(location.hostname.toLowerCase())
    ? "https://www.ecocircuitai.com"
    : location.origin;
  return new URL("/ecocircuit/" + encodeURIComponent(id), origin).href;
}

//---------------header-bar------------------//
// Function 1   Save/Dowload
// Helper to inline computed styles into SVG elements
function inlineAllStyles(svgElement) {
  const copySvg = svgElement.cloneNode(true);
  const elements = copySvg.querySelectorAll('*');

  function applyComputedStyle(el, sourceEl) {
    const computedStyle = window.getComputedStyle(sourceEl);
    let styleString = "";
    for (let i = 0; i < computedStyle.length; i++) {
      const key = computedStyle[i];
      const value = computedStyle.getPropertyValue(key);
      styleString += `${key}:${value};`;
    }
    el.setAttribute('style', styleString);
  }

  applyComputedStyle(copySvg, svgElement);
  elements.forEach((el, idx) => applyComputedStyle(el, svgElement.querySelectorAll('*')[idx]));

  return copySvg;
}

// Main download API
async function downloadSvg(containerId, downloadType) {
  const svgElement = document.getElementById(containerId);
  if (!svgElement) {
    throw new Error('Diagram is not ready. Wait for it to load and try again.');
  }

  // Special handling for matrix-io to capture full content without overflow
  let finalSvg = svgElement;
  let width, height;
  
  if (containerId === 'matrix-io') {
    const contentSvg = document.getElementById('matrix-io-content');
    
    // Store original dimensions to restore later
    const originalFOHeight = svgElement.querySelectorAll('foreignObject')[1]?.getAttribute('height');
    const originalDivStyle = contentSvg?.parentElement?.style?.height;
    const originalDivOverflow = contentSvg?.parentElement?.style?.overflow;
    
    // First, expand all containers to accommodate full content before inlining styles
    let originalWithStyles;
    try {
      if (contentSvg && window.matrixIOContentHeight) {
        contentSvg.setAttribute('height', window.matrixIOContentHeight);
        
        // Also expand the foreignObject container
        const contentFO = svgElement.querySelectorAll('foreignObject')[1];
        if (contentFO) {
          contentFO.setAttribute('height', window.matrixIOContentHeight);
        }
        
        // And the div wrapper
        const scrollDiv = contentSvg.parentElement;
        if (scrollDiv) {
          scrollDiv.style.height = window.matrixIOContentHeight + 'px';
          scrollDiv.style.overflow = 'visible';
        }
      }
      
      // Now inline styles while elements are properly sized
      originalWithStyles = inlineAllStyles(svgElement);
    } finally {
      // Restore original dimensions to not affect the live page
      if (originalFOHeight && svgElement.querySelectorAll('foreignObject')[1]) {
        svgElement.querySelectorAll('foreignObject')[1].setAttribute('height', originalFOHeight);
      }
      if (originalDivStyle && contentSvg?.parentElement) {
        contentSvg.parentElement.style.height = originalDivStyle;
      }
      if (originalDivOverflow !== undefined && contentSvg?.parentElement) {
        contentSvg.parentElement.style.overflow = originalDivOverflow;
      }
    }
    
    // Create a new SVG that combines header and full content without overflow
    const foreignObjects = originalWithStyles.querySelectorAll('foreignObject');
    const headerFO = foreignObjects[0]; // First foreignObject is the header
    const contentFO = foreignObjects[1]; // Second foreignObject contains the scrollable content
    
    if (headerFO && contentFO && contentSvg) {
      // Also inline styles for the content SVG while it's in the DOM (after height is set)
      const contentWithStyles = inlineAllStyles(contentSvg);
      
      // Calculate full dimensions
      const headerHeight = parseFloat(headerFO.getAttribute('height')) || 0;
      const contentWidth = parseFloat(contentSvg.getAttribute('width')) || svgElement.getAttribute('width');
      // Use the saved full content height instead of the constrained DOM height
      const contentHeight = window.matrixIOContentHeight || parseFloat(contentSvg.getAttribute('height')) || 0;
      
      width = contentWidth;
      height = headerHeight + contentHeight;
      
      // Create new SVG with full content, preserving the original ID and attributes
      const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      newSvg.setAttribute('width', width);
      newSvg.setAttribute('height', height);
      newSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      // Preserve the original ID and class for CSS selector matching
      newSvg.setAttribute('id', containerId);
      if (svgElement.className) {
        newSvg.setAttribute('class', svgElement.className.baseVal || svgElement.className);
      }
      
      // Clone and add header foreignObject (already has styles inlined)
      const clonedHeader = headerFO.cloneNode(true);
      newSvg.appendChild(clonedHeader);
      
      // Clone the content foreignObject and modify it to remove overflow restrictions
      const clonedContentFO = contentFO.cloneNode(true);
      clonedContentFO.setAttribute('y', headerHeight);
      clonedContentFO.setAttribute('height', contentHeight);
      
      // Find and modify the scrollable div to remove overflow
      const scrollDiv = clonedContentFO.querySelector('div');
      if (scrollDiv) {
        scrollDiv.style.height = contentHeight + 'px';
        scrollDiv.style.overflow = 'visible';
        scrollDiv.style.overflowY = 'visible';
        scrollDiv.style.overflowX = 'visible';
      }
      
      // Replace the content SVG with the styled version
      const clonedContentSvg = clonedContentFO.querySelector('svg');
      if (clonedContentSvg && contentWithStyles) {
        clonedContentSvg.parentNode.replaceChild(contentWithStyles.cloneNode(true), clonedContentSvg);
        const newContentSvg = clonedContentFO.querySelector('svg');
        newContentSvg.setAttribute('height', contentHeight);
      }
      
      newSvg.appendChild(clonedContentFO);
      finalSvg = newSvg;
    } else {
      // Fallback to styled original
      finalSvg = originalWithStyles;
      width = svgElement.getAttribute('width') || svgElement.viewBox.baseVal.width;
      height = svgElement.getAttribute('height') || svgElement.viewBox.baseVal.height;
    }
  } else {
    // Original method for other SVGs - inline styles first
    width = svgElement.getAttribute('width') || svgElement.viewBox.baseVal.width;
    height = svgElement.getAttribute('height') || svgElement.viewBox.baseVal.height;
    finalSvg = inlineAllStyles(svgElement);
  }

  // finalSvg already has styles inlined, just set dimensions
  const svgWithInlineStyles = finalSvg;
  svgWithInlineStyles.setAttribute('width', width);
  svgWithInlineStyles.setAttribute('height', height);

  // Image preparation has its own bounded wait before server conversion.
  if (downloadType === 'png' && typeof inlineExternalImages === 'function') {
    await withExportTimeout(
      inlineExternalImages(svgWithInlineStyles), 30000,
      'Image preparation timed out. Please try again.'
    );
  }

  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svgWithInlineStyles);
  if (!svgString.includes('xmlns="http://www.w3.org/2000/svg"')) {
    svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (downloadType === 'svg') {
    triggerExportDownload(new Blob([svgString], {type: 'image/svg+xml;charset=utf-8'}), containerId + '.svg');
    return;
  }
  if (downloadType !== 'png') throw new Error('Unsupported download format.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch('/ecocircuit/convert-svg-to-jpg', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({svg: svgString, filename: containerId, format: 'png'}),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('PNG conversion failed (HTTP ' + response.status + '). Please try again.');
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith('image/png')) {
      throw new Error('The server did not return a PNG image.');
    }
    triggerExportDownload(blob, containerId + '.png');
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('PNG conversion timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function withExportTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

function triggerExportDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to consume the URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

let exportInProgress = false;
let exportStatus = '';
function updateExportUI(message = exportStatus) {
  exportStatus = message;
  const status = document.getElementById('export-status');
  if (status) status.textContent = message;
  for (const id of ['save-image', 'save-svg']) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.setAttribute('aria-disabled', String(exportInProgress));
    button.setAttribute('aria-busy', String(exportInProgress));
    button.style.opacity = exportInProgress ? '0.5' : '';
    button.style.cursor = exportInProgress ? 'wait' : '';
  }
}

async function runProjectExport(format) {
  if (exportInProgress) return;
  exportInProgress = true;
  let started = 0;
  try {
    for (const [id, label] of [['matrix-io', 'IO diagram'], ['matrix-metabolism', 'metabolism diagram']]) {
      updateExportUI('Preparing download… ' + label + ' (' + (started + 1) + '/2)');
      // Paint feedback before synchronous SVG preparation.
      await new Promise(resolve => setTimeout(resolve, 30));
      await downloadSvg(id, format);
      started++;
    }
    updateExportUI('Two downloads requested. Check Chrome Downloads; allow multiple downloads if prompted.');
  } catch (error) {
    updateExportUI((started ? 'First download requested. ' : '') +
      (error.message || 'Download failed. Please try again.'));
  } finally {
    exportInProgress = false;
    updateExportUI();
  }
}




// Function 2   Share
// Event listener for outside click to close share menu
const shareIcon = document.getElementById('share-icon');
document.addEventListener('click', (event) => {
  const shareMenu = document.getElementById('share-menu');
  if (shareMenu && !shareIcon.contains(event.target)) {
    shareMenu.remove();
  }
});

shareIcon.addEventListener('click', (event) => {
  event.stopPropagation();
  const existingMenu = document.getElementById('share-menu');
  existingMenu ? existingMenu.remove() : createShareMenu();
});


function createShareMenu() {
  const shareMenu = document.createElement('div');
  shareMenu.id = 'share-menu';

  // Handle unauthenticated users
  if (!isAuthenticated) {
    shareMenu.innerHTML = `
      <div class="share-menu-item">
        <div class="item-label">🔒 Please sign in to unlock share access.</div>
        <div class="item-subtext"></div>
      </div>
    `;
    shareMenu.classList.add('locked');
    shareIcon.appendChild(shareMenu);
    return;
  }

  // Build menu based on project access type
  switch (window.projectAccess) {
    case 'public':
      if (window.projectAccessLevel === 'view') {
        // Public view-only: just show share link and save options
        shareMenu.innerHTML = `
          <div class="share-menu-item" id="share-link">
            <div class="item-label">Copy and paste this link to share:</div>
            <div class="item-subtext"></div>
          </div>
          <div class="menu-divider"></div>
          <div class="share-menu-item" id="save-image">
            <div class="item-label">Download PNG</div>
            <div class="item-subtext">For including in a report, blog, etc</div>
          </div>
          <div class="menu-divider"></div>
          <div class="share-menu-item" id="save-svg">
            <div class="item-label">Download SVG</div>
            <div class="item-subtext">For further ideating and editing</div>
          </div>
        `;
      } else {
        // Public with edit access: show toggle, share link, and save options
        shareMenu.innerHTML = `
          <div class="share-menu-item" id="access">
            <div class="item-label">Click to update view access:</div>
            <div class="item-subtext">Public and ready to share</div>
          </div>
          <div class="menu-divider"></div>
          <div class="share-menu-item" id="share-link">
            <div class="item-label">Copy and paste this link to share:</div>
            <div class="item-subtext"></div>
          </div>
          <div class="menu-divider"></div>
          <div class="share-menu-item" id="save-image">
            <div class="item-label">Download PNG</div>
            <div class="item-subtext">For including in a report, blog, etc</div>
          </div>
          <div class="menu-divider"></div>
          <div class="share-menu-item" id="save-svg">
            <div class="item-label">Download SVG</div>
            <div class="item-subtext">For further ideating and editing</div>
          </div>
        `;
      }
      break;

    case 'private':
      shareMenu.innerHTML = `
        <div class="share-menu-item" id="access">
          <div class="item-label">Click to update view access:</div>
          <div class="item-subtext">Private to you</div>
        </div>
        <div class="menu-divider"></div>
        <div class="share-menu-item disabled" id="share-link" style="pointer-events: none; opacity: 0.5;">
          <div class="item-label">🔒 Copy and paste this link to share:</div>
          <div class="item-subtext"></div>
        </div>
        <div class="menu-divider"></div>
        <div class="share-menu-item" id="save-image">
          <div class="item-label">Download PNG</div>
          <div class="item-subtext">For including in a report, blog, etc</div>
        </div>
        <div class="menu-divider"></div>
        <div class="share-menu-item" id="save-svg">
          <div class="item-label">Download SVG</div>
          <div class="item-subtext">For further ideating and editing</div>
        </div>
      `;
      break;

    case 'temporary':
      shareMenu.innerHTML = `
        <div class="share-menu-item" id="access">
          <div class="item-label">Click to update view access:</div>
          <div class="item-subtext">Temporary, the project will be lost once you leave</div>
        </div>
        <div class="menu-divider"></div>
        <div class="share-menu-item disabled" id="share-link" style="pointer-events: none; opacity: 0.5;">
          <div class="item-label">🔒 Copy and paste this link to share:</div>
          <div class="item-subtext"></div>
        </div>
        <div class="menu-divider"></div>
        <div class="share-menu-item" id="save-image">
          <div class="item-label">Download PNG</div>
          <div class="item-subtext">For including in a report, blog, etc</div>
        </div>
        <div class="menu-divider"></div>
        <div class="share-menu-item" id="save-svg">
          <div class="item-label">Download SVG</div>
          <div class="item-subtext">For further ideating and editing</div>
        </div>
      `;
      break;
  }

  const shareUrl = projectShareUrl(projectId);
  const linkText = shareMenu.querySelector('#share-link .item-subtext');
  if (linkText) linkText.textContent = shareUrl;
  const exportFeedback = document.createElement('div');
  exportFeedback.id = 'export-status';
  exportFeedback.className = 'item-subtext';
  exportFeedback.setAttribute('role', 'status');
  exportFeedback.setAttribute('aria-live', 'polite');
  shareMenu.appendChild(exportFeedback);
  shareIcon.appendChild(shareMenu);
  updateExportUI();

  // Add event listeners
  const accessEl = document.getElementById('access');
  accessEl?.addEventListener('click', (event) => {
    const subtextEl = accessEl.querySelector('.item-subtext');
    const shareLinkEl = document.getElementById('share-link');
    const shareLinkLabel = shareLinkEl.querySelector('.item-label');

    if (window.projectAccess === 'private') {
      subtextEl.innerText = 'Public and ready to share';
      window.updateProjectAccess('public');
      shareLinkEl.classList.remove('disabled');
      shareLinkEl.style.pointerEvents = '';
      shareLinkEl.style.opacity = '';
      shareLinkLabel.innerText = 'Copy and paste this link to share:';
    } else {
      subtextEl.innerText = 'Private to you';
      window.updateProjectAccess('private');
      shareLinkEl.classList.add('disabled');
      shareLinkEl.style.pointerEvents = 'none';
      shareLinkEl.style.opacity = '0.5';
      shareLinkLabel.innerText = '🔒 Copy and paste this link to share:';
    }
    event.stopPropagation();
  });

  const shareLinkEl = document.getElementById('share-link');
  shareLinkEl?.addEventListener('click', (event) => {
    navigator.clipboard.writeText(shareLinkEl.querySelector('.item-subtext').innerText);
    alert('Link copied to clipboard');
    event.stopPropagation();
  });

  // Keep the menu open while export progress is displayed.
  for (const [id, format] of [['save-image', 'png'], ['save-svg', 'svg']]) {
    document.getElementById(id)?.addEventListener('click', (event) => {
      event.stopPropagation();
      runProjectExport(format);
    });
  }
}
