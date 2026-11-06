// Normalize stored icon URLs so projects work on local and production hosts.
function parseIconUrl(iconUrl) {
    if (typeof iconUrl !== 'string' || !iconUrl || iconUrl === 'none') return iconUrl;
    if (iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
        try { return new URL(iconUrl).pathname; } catch (_) { return iconUrl; }
    }
    return iconUrl;
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('project-container');
  if (!container) return;
  if (!Array.isArray(projects)) {
    container.innerHTML = '<div class="empty-state"><p>No projects found.</p></div>';
    return;
  }

  if (projects.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>You haven\'t created any projects yet. <a href="/ecocircuit/">Create your first project</a></p></div>';
    return;
  }

  // Render immediately; refresh only thumbnails that fail to load.
  setTimeout(() => {
    projects.forEach(project => {
      let systemData = project.system;
      if (typeof systemData === "string") {
        try {
          systemData = JSON.parse(systemData);
        } catch (e) {
          console.error("Invalid JSON string in project.system");
          systemData = {};
        }
      }

      // Filter: keep only key-value pairs where value is [a, b]
      const filteredSystem = Object.entries(systemData || {}).reduce((acc, [key, value]) => {
        if (Array.isArray(value) && value.length === 2) {
          acc[key] = value;
        }
        return acc;
      }, {});

      const cell = document.createElement('div');
      cell.className = 'content-grid';
      cell.dataset.projectId = project.id;

      // Create the link with image
      const link = document.createElement('a');
      link.href = `/ecocircuit/${project.id}`;

      const imgWrapper = document.createElement('div');
      imgWrapper.className = 'indeximg';

      // Handle thumbnails
      let thumbnails = {};
      if (project.thumbnails) {
        try {
          thumbnails = JSON.parse(project.thumbnails);
        } catch (e) {
          console.error('Invalid thumbnails JSON:', e);
        }
      }

      // Create two images for alternating display
      const img1 = document.createElement('img');
      const img2 = document.createElement('img');
      
      img1.className = 'flashing-image';
      img2.className = 'flashing-image';
      img1.loading = 'lazy';
      img2.loading = 'lazy';

      const blankSvg = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" text-anchor="middle" fill="#666" font-family="sans-serif" font-size="16">Preview unavailable</text></svg>'
      );
      let refreshPromise;
      const refreshOnce = () => {
        if (!refreshPromise) {
          refreshPromise = (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
              const response = await fetch(
                `/ecocircuit/regenerate-thumbnail/${encodeURIComponent(project.id)}`,
                {signal: controller.signal}
              );
              if (!response.ok) return {};
              const data = await response.json();
              return data.status === 'success' ? data : {};
            } catch (_) {
              return {};
            } finally {
              clearTimeout(timer);
            }
          })();
        }
        return refreshPromise;
      };

      const configureThumbnail = (img, key, label) => {
        img.alt = `${project.title || 'Project'} - ${label}`;
        const fallback = () => {
          img.onerror = null;
          img.src = blankSvg;
          img.alt = 'Preview unavailable';
        };
        const recover = async () => {
          // Both images share one request; never retry a failed refreshed URL.
          img.onerror = null;
          img.src = blankSvg;
          const fresh = await refreshOnce();
          if (typeof fresh[key] === 'string' && fresh[key]) {
            img.onerror = fallback;
            img.src = fresh[key]; // Signed URLs must not be modified.
          } else {
            fallback();
          }
        };
        img.onerror = recover;
        if (typeof thumbnails[key] === 'string' && thumbnails[key]) {
          img.src = thumbnails[key];
        } else {
          recover();
        }
      };
      configureThumbnail(img1, 'matrix_io', 'Matrix IO');
      configureThumbnail(img2, 'matrix_metabolism', 'Matrix Metabolism');

      imgWrapper.appendChild(img1);
      imgWrapper.appendChild(img2);
      link.appendChild(imgWrapper);
      cell.appendChild(link);

      // System badges (floating top-left)
      const systemWrapper = document.createElement('div');
      systemWrapper.className = 'system-wrapper';

      // System colors are extracted directly from the system data

      Object.entries(filteredSystem).forEach(([key, value]) => {
        const systemItem = document.createElement('div');
        systemItem.className = 'system-item tooltip-wrapper';
        
        const systemIcon = document.createElement('span');
        systemIcon.className = 'system-icon';
        
        // Extract color and icon URL from system data array structure [color, icon_path]
        let backgroundColor = '#888'; // Default fallback
        let iconUrl = null;
        
        if (Array.isArray(value) && value.length >= 1) {
          backgroundColor = value[0]; // First element is the color
          if (value.length >= 2 && value[1]) {
            iconUrl = parseIconUrl(value[1]); // Second element is the icon URL
          }
        }
        
        systemIcon.style.backgroundColor = backgroundColor;
        
        // If icon URL exists, use it as background image
        if (iconUrl && iconUrl !== null && iconUrl !== undefined) {
          systemIcon.style.backgroundImage = `url(${iconUrl})`;
          systemIcon.style.backgroundSize = 'cover';
          systemIcon.style.backgroundPosition = 'center';
          systemIcon.style.backgroundRepeat = 'no-repeat';
          systemIcon.textContent = ''; // Hide text when icon is shown
        } else {
          // Fallback to first letter when no icon
          systemIcon.style.backgroundImage = 'none';
          systemIcon.textContent = key.charAt(0).toUpperCase();
        }
        
        const tooltipText = document.createElement('span');
        tooltipText.className = 'tooltip-text';
        tooltipText.textContent = key;
        
        systemItem.appendChild(systemIcon);
        systemItem.appendChild(tooltipText);
        systemWrapper.appendChild(systemItem);
      });
      
      cell.appendChild(systemWrapper);

      // Hover bar (floating top-right)
      const hoverBar = document.createElement('div');
      hoverBar.className = 'hover-bar';
      
      const funcWrapper = document.createElement('div');
      funcWrapper.className = 'func-wrapper';
      funcWrapper.innerHTML = `
        <icon-dropdown>
          <div slot="menu" class="menu-option" data-action="share" data-project-id="${project.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <polyline points="16,6 12,2 8,6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            Share
          </div>
          <div slot="menu" class="menu-option danger" data-action="remove" data-project-id="${project.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3,6 5,6 21,6"/>
              <path d="m19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1 2-2h4a2,2 0 0,1 2,2v2"/>
            </svg>
            Remove
          </div>
        </icon-dropdown>
      `;
      
      hoverBar.appendChild(funcWrapper);
      cell.appendChild(hoverBar);

      container.appendChild(cell);
    });

    // Add event delegation for dropdown menu items
    container.addEventListener('click', (e) => {
      if (e.target.closest('.menu-option')) {
        const item = e.target.closest('.menu-option');
        const action = item.dataset.action;
        const projectId = item.dataset.projectId;

        if (action === 'share') {
          // Handle share action
          const projectUrl = `${window.location.origin}/ecocircuit/${projectId}`;
          navigator.clipboard.writeText(projectUrl).then(() => {
            alert('Project link copied to clipboard!');
          }).catch(() => {
            alert(`Project link: ${projectUrl}`);
          });
        } else if (action === 'remove') {
          // Handle remove action with confirmation
          if (confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
            // Remove the project card from DOM immediately for better UX
            const projectCard = document.querySelector(`[data-project-id="${projectId}"]`).closest('.content-grid');
            projectCard.remove();
            
            fetch(`/ecocircuit/project/${projectId}`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
              }
            })
            .then(response => {
              if (response.ok) {
                // Show success message
                alert('Project deleted successfully');
              } else {
                // If failed, we could add the card back, but for now just show error
                response.json().then(data => {
                  alert(data.message || 'Failed to delete project. Please refresh the page.');
                });
              }
            })
            .catch(error => {
              alert('Error deleting project: ' + error.message + '. Please refresh the page.');
            });
          }
        }
      }
    });

  }, 0);
});