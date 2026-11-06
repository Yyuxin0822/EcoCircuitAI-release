/**
 * Project Access Management
 * Handles project access control, authentication, and user permissions
 */
(function() {
  'use strict';

  // Wait for DOM and required globals
  document.addEventListener("DOMContentLoaded", () => {
    // Check if user needs to claim project as private
    if (window.showClaimPrompt && window.isAuthenticated) {
      updateProjectAccess("private");
    }

    // Update UI based on project access
    updateAccessUI();
  });

  /**
   * Updates UI elements based on current project access and authentication status
   */
  function updateAccessUI() {
    // Handle temporary projects for unauthenticated users
    if (!window.isAuthenticated && window.projectAccess === 'temporary') {
      document.getElementById('io-annotation').innerText = `IO Interface ( By ${window.author}. Please sign in to save. The project will be lost once you leave. 🔒)`;
      document.getElementById('metabolism-annotation').innerText = `Metabolism ( By ${window.author}. Please sign in to save. The project will be lost once you leave. 🔒)`;
    }

    // Handle view-only mode
    if (window.projectAccessLevel === 'view') {
      if (window.projectAccess === 'public' || window.projectAccess === 'temporary') {
        document.getElementById('io-annotation').innerText = `IO Interface ( By ${window.author}. View only 🔒)`;
        document.getElementById('metabolism-annotation').innerText = `Metabolism ( By ${window.author}. View only 🔒)`;

        document.getElementById('main-visuals').classList.add('view-only');
        const exemptIds = ['scroll-container-1', 'scroll-container-2', 'right-toolbar-container', 'fixed-elements'];
        document.getElementById('main-visuals').addEventListener('click', function (e) {
          let el = e.target;
          while (el && el !== this) {
            if (exemptIds.includes(el.id)) {
              return;
            }
            el = el.parentElement;
          }
          e.stopPropagation();
          e.preventDefault();
        }, true);
      }
    }
  }

  /**
   * Updates project access level
   * @param {string} access - Access level: 'private', 'public', or 'temporary'
   */
  window.updateProjectAccess = function(access) {
    if (!window.socket) {
      console.error("Socket not initialized - cannot update project access");
      return;
    }

    // Get project variables from global scope or fallback to local variables
    const projectIdValue = window.projectId || (typeof projectId !== 'undefined' ? projectId : null);
    const userIdValue = window.userId || (typeof userId !== 'undefined' ? userId : null);

    if (!projectIdValue) {
      console.error("Project ID not found - cannot update access");
      return;
    }

    console.log(`Updating project access to: ${access}`);

    window.socket.emit("update_access", {
      project_id: projectIdValue,
      access: access,
      author_id: userIdValue,
    });

    // Handle response from server
    window.socket.on("update_access_response", (data) => {
      if (data.status === "success") {
        window.projectAccess = access;
        console.log("✅ Project access updated successfully to:", access);
        
        // Dispatch custom event for other components to listen to
        window.dispatchEvent(new CustomEvent('projectAccessUpdated', {
          detail: { access: access, data: data }
        }));
      } else {
        console.error("❌ Error updating project access:", data.error);
        
        // Dispatch error event
        window.dispatchEvent(new CustomEvent('projectAccessError', {
          detail: { error: data.error }
        }));
      }
    });
  };



})();