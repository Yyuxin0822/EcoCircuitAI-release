/**
 * Client-side cleanup utilities for logout
 * This script ensures proper browser cache and storage cleanup during logout
 */

function clearBrowserStorage() {
    // Clear localStorage
    try {
        localStorage.clear();
    } catch (e) {
        console.warn('Could not clear localStorage:', e);
    }

    // Clear sessionStorage
    try {
        sessionStorage.clear();
    } catch (e) {
        console.warn('Could not clear sessionStorage:', e);
    }

    // Clear any application-specific indexed DB data
    if ('indexedDB' in window) {
        try {
            // This is a basic cleanup - you might need to customize for your specific IndexedDB usage
            indexedDB.databases().then(databases => {
                databases.forEach(db => {
                    if (db.name && db.name.includes('ecocircuit')) {
                        indexedDB.deleteDatabase(db.name);
                    }
                });
            }).catch(e => console.warn('Could not clear IndexedDB:', e));
        } catch (e) {
            console.warn('IndexedDB cleanup failed:', e);
        }
    }
}

function clearBrowserCache() {
    // Force reload from server (bypasses cache)
    if ('caches' in window) {
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    return caches.delete(cacheName);
                })
            );
        }).catch(e => console.warn('Could not clear cache storage:', e));
    }
}

function performLogoutCleanup() {
    clearBrowserStorage();
    clearBrowserCache();
    
    // Let the logout link handle navigation - don't force reload
}

// Function to enhance logout links
function enhanceLogoutLinks() {
    const logoutLinks = document.querySelectorAll('a[href*="auth0.logout"], a[id="signout"], a[href*="/logout"]');
    
    logoutLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            // Perform cleanup in parallel with the normal link navigation
            // Don't prevent default - let the link work normally
            performLogoutCleanup();
        });
    });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceLogoutLinks);
} else {
    enhanceLogoutLinks();
}

// Export functions for manual use
window.logoutCleanup = {
    clearStorage: clearBrowserStorage,
    clearCache: clearBrowserCache,
    performCleanup: performLogoutCleanup
};