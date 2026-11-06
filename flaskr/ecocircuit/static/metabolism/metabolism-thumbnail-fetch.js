async function inlineExternalImages(svg) {
  const XLINK = 'http://www.w3.org/1999/xlink';
  const imgs = Array.from(svg.querySelectorAll('image'));

  await Promise.all(
    imgs.map(async (node) => {
      // read href from either attribute
      let href = node.getAttribute('href') || node.getAttributeNS(XLINK, 'href');
      if (!href || href.startsWith('data:')) return;

      // make absolute (avoids CORS surprises on relative paths)
      try { href = new URL(href, window.location.href).toString(); } catch {}

      let resp, dataUrl;

      // Check if it's an S3 URL - if so, use proxy immediately to avoid CORS
      if (href.includes('amazonaws.com')) {
        try {
          // S3 URL detected, using proxy
          const proxyUrl = `/ecocircuit/img-proxy?url=${encodeURIComponent(href)}`;
          resp = await fetch(proxyUrl);
          
          if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);
          
          const blob = await resp.blob();
          dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          });
          
          // Successfully inlined S3 image via proxy
          
        } catch (proxyError) {
          console.error('Proxy fetch failed for S3 URL:', href, proxyError);
          return; // Skip this image if proxy fails
        }
      } else {
        // Non-S3 URL: try direct fetch
        try {
          // Attempting direct fetch
          resp = await fetch(href, { credentials: 'omit' });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

          const ct = resp.headers.get('content-type') || '';

          if (ct.includes('image/svg+xml')) {
            // Inline SVGs as UTF-8 text (more reliable in some engines)
            const text = await resp.text();
            dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
          } else {
            // Other formats → base64 data URL
            const blob = await resp.blob();
            dataUrl = await new Promise((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve(fr.result);
              fr.onerror = reject;
              fr.readAsDataURL(blob);
            });
          }
          
          // Successfully inlined image via direct fetch
          
        } catch (directError) {
          console.error('Direct fetch failed for non-S3 URL:', href, directError);
          return; // Skip this image if direct fetch fails
        }
      }

      // Write to BOTH attrs for cross-browser compatibility
      node.removeAttributeNS?.(XLINK, 'href');
      node.setAttribute('href', dataUrl);
      node.setAttributeNS(XLINK, 'href', dataUrl);

      // Remove crossorigin (irrelevant for data: URLs)
      node.removeAttribute('crossorigin');

      // Give the renderer a moment to notice
      await new Promise(requestAnimationFrame);
    })
  );
}


// Thumbnail capture and upload functionality for metabolism visualizations
async function svgToPngDataUrl(svgEl, opts = {}) {
  const {
    scale = 1,
    quality = 1,
    background = '#ffffff',
    mime = 'image/png',
    embedImages = true,
    contentOnly = false,  // NEW: capture only main content without headers
  } = opts;

  const svg = svgEl.cloneNode(true);

  // Remove foreignObject elements to prevent canvas tainting
  svg.querySelectorAll('foreignObject').forEach(fo => fo.remove());

  let width, height, viewBoxX = 0, viewBoxY = 0;
  
  if (contentOnly) {
    // Extract only main content g elements, excluding headers
    const mainContentGroups = [];
    
    // Look for main content groups based on known patterns
    const parentGroup = svg.querySelector('g[transform*="translate(0,"]'); // IO diagram main group
    const zoomLayer = svg.querySelector('g.zoom-layer'); // Metabolism diagram zoom layer
    const mainGroup = svg.querySelector('g.main-group'); // Metabolism main group
    
    if (parentGroup) {
      // IO diagram: extract the main group that's translated below header
      mainContentGroups.push(parentGroup);
      // Found IO parent group
    }
    
    if (zoomLayer) {
      // Metabolism diagram: extract zoom layer
      mainContentGroups.push(zoomLayer);
      // Found metabolism zoom layer
    } else if (mainGroup) {
      // Fallback: extract main group
      mainContentGroups.push(mainGroup);
      // Found metabolism main group
    }
    
    if (mainContentGroups.length > 0) {
      // Clear the SVG and add only the main content
      svg.innerHTML = '';
      mainContentGroups.forEach(group => {
        svg.appendChild(group.cloneNode(true));
      });
      
      // Calculate bounding box of content
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      tempSvg.style.visibility = 'hidden';
      tempSvg.style.position = 'absolute';
      document.body.appendChild(tempSvg);
      
      mainContentGroups.forEach(group => {
        tempSvg.appendChild(group.cloneNode(true));
      });
      
      try {
        const bbox = tempSvg.getBBox();
        width = Math.ceil(bbox.width) || 800;
        height = Math.ceil(bbox.height) || 600;
        viewBoxX = Math.floor(bbox.x) || 0;
        viewBoxY = Math.floor(bbox.y) || 0;
        // Content bounding box calculated
      } catch (e) {
        console.warn('Could not calculate bbox, using fallback dimensions');
        width = 800;
        height = 600;
        viewBoxX = 0;
        viewBoxY = 0;
      }
      
      document.body.removeChild(tempSvg);
    } else {
      // No main content groups found, falling back to full SVG
      contentOnly = false;
    }
  }
  
  if (!contentOnly) {
    // Original logic for full SVG
    const vb = svgEl.viewBox?.baseVal;
    width = vb?.width || Math.ceil(svgEl.clientWidth || svgEl.getBBox().width || 1);
    height = vb?.height || Math.ceil(svgEl.clientHeight || svgEl.getBBox().height || 1);
  }
  
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${width} ${height}`);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Inline key computed styles (from earlier version)
  const props = ['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray',
                 'opacity','fill-opacity','stroke-opacity','font','font-family','font-size',
                 'font-weight','font-style','text-anchor','dominant-baseline'];
  const walker = document.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode, cs = getComputedStyle(el);
    const style = props.map(p => {
      const v = cs.getPropertyValue(p);
      return v ? `${p}:${v};` : '';
    }).join('');
    if (style) el.setAttribute('style', (el.getAttribute('style') || '') + style);
  }

if (embedImages) {
  await inlineExternalImages(svg);  // <-- inlines your presigned S3 images
}

  const svgStr = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url); resolve(); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });

  return canvas.toDataURL(mime, quality);
}

// Auto-capture thumbnails after render complete
async function setupThumbnailCapture() {
    // Setting up thumbnail capture
    
    // Wait for visualizations to be ready
    setTimeout(async () => {
        const thumbnails = {};
        
        try {
            // Check and capture matrix-io-content (the actual diagram SVG)
            const ioContentElement = document.getElementById('matrix-io-content');
            if (ioContentElement && ioContentElement.tagName === 'svg') {
                thumbnails.matrix_io = await svgToPngDataUrl(ioContentElement, { 
                    scale: 1.5, 
                    quality: 0.95, 
                    mime: 'image/jpeg',
                    embedImages: true,
                    contentOnly: true  // Capture only main content, exclude header
                });
                // Captured matrix-io-content thumbnail
            } else {
                console.error('matrix-io-content element not found or not ready - cannot capture IO thumbnail');
            }
            
            // Check and capture matrix-metabolism
            const metabolismElement = document.getElementById('matrix-metabolism');
            if (metabolismElement && metabolismElement.tagName === 'svg') {
                thumbnails.matrix_metabolism = await svgToPngDataUrl(metabolismElement, { 
                    scale: 1.5, 
                    quality: 0.95, 
                    mime: 'image/jpeg',
                    embedImages: true,
                    contentOnly: true  // Capture only main content, exclude header
                });
                // Captured matrix-metabolism thumbnail
            } else if (metabolismElement) {
                const metaSvg = metabolismElement.querySelector('svg');
                if (metaSvg) {
                    thumbnails.matrix_metabolism = await svgToPngDataUrl(metaSvg, { 
                        scale: 1.5, 
                        quality: 0.95, 
                        mime: 'image/jpeg',
                        embedImages: true,
                        contentOnly: true  // Capture only main content, exclude header
                    });
                    // Captured matrix-metabolism thumbnail
                } else {
                    // matrix-metabolism not ready or has no SVG content
                }
            } else {
                // matrix-metabolism element not found
            }
            
            // Save thumbnails if any were captured
            if (Object.keys(thumbnails).length > 0) {
                // Thumbnail capture completed
                
                if (!projectId) {
                    console.error('Project ID not available');
                    return;
                }
                
                // Saving thumbnails for project
                
                if (window.socket) {
                    window.socket.emit('save_thumbnails', {
                        projectId: projectId,
                        thumbnails: thumbnails
                    });
                    // Thumbnails sent to server
                } else {
                    console.error('Socket not available for thumbnail upload');
                }
            } else {
                // No thumbnails captured
            }
            
        } catch (err) {
            console.error('Error capturing thumbnails:', err);
        }
    }, 5000); // Wait 5 seconds for visualizations to render
}


// Export functions for global access
window.setupThumbnailCapture = setupThumbnailCapture;
