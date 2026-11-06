// Enhanced scroll snap functionality for metabolism page
(function() {
  'use strict';
  
  let scrollTimeout;
  let snapElements;
  let initialized = false;

  function updateIOViewportHeight() {
    const visuals = document.getElementById('main-visuals');
    if (!visuals) return;
    // Use document coordinates so scrolling does not change the panel height.
    const top = visuals.getBoundingClientRect().top + window.scrollY;
    const height = Math.max(0, window.innerHeight - top);
    visuals.style.setProperty('--io-viewport-height', `${height}px`);
  }
  
  // Initialize when DOM is ready
  function init() {
    updateIOViewportHeight();
    if (initialized) return;
    initialized = true;
    
    snapElements = document.querySelectorAll('.scroll-snap');
    
    if (snapElements.length === 0) {
      console.warn('[ScrollSnap] No snap elements found');
      return;
    }
    
    window.addEventListener('resize', updateIOViewportHeight);
    if (typeof ResizeObserver !== 'undefined') {
      const headerObserver = new ResizeObserver(updateIOViewportHeight);
      ['header-bar', 'flash-message', 'error-container'].forEach(id => {
        const element = document.getElementById(id);
        if (element) headerObserver.observe(element, { box: 'border-box' });
      });
    }

    // Found snap elements
    
    // Setup scroll listener
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      
      scrollTimeout = setTimeout(() => {
        snapToClosestElement();
      }, 100); // Adjust delay if needed
    });
    
    // Setup click handlers for scroll triggers
    setupClickHandlers();
    
    // Initialization complete
  }

  function snapToClosestElement() {
    let closestElement = null;
    let closestDistance = Infinity;
    let snapToTop = false;
    
    // Check distance to top of page (for header-bar)
    const distanceToPageTop = Math.abs(window.scrollY);
    if (distanceToPageTop < 150) { // Threshold for snapping to top
      closestDistance = distanceToPageTop;
      snapToTop = true;
    }
    
    snapElements.forEach((elem) => {
      const rect = elem.getBoundingClientRect();
      
      // IO shares its landing position with the functional bar above it.
      if (elem.id === 'io-container') {
        if (distanceToPageTop < closestDistance) {
          closestDistance = distanceToPageTop;
          closestElement = null;
          snapToTop = true;
        }
      } else if (elem.id === 'footer') {
        // For footer, measure distance from bottom of viewport
        const distanceToBottom = Math.abs(window.innerHeight - rect.bottom);
        if (distanceToBottom < closestDistance) {
          closestDistance = distanceToBottom;
          closestElement = elem;
          snapToTop = false;
        }
      } else {
        // For other elements, measure distance from top
        const distanceToTop = Math.abs(rect.top);
        if (distanceToTop < closestDistance) {
          closestDistance = distanceToTop;
          closestElement = elem;
          snapToTop = false;
        }
      }
    });
    
    if (snapToTop) {
      // Snap to very top of page
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    } else if (closestElement) {
      // For footer, scroll to bottom
      if (closestElement.id === 'footer') {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        });
      } else {
        closestElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }
  }
  
  // Setup click handlers for scroll triggers
  function setupClickHandlers() {
    const scrollTriggers = document.querySelectorAll('.scroll-trigger');
    
    scrollTriggers.forEach(trigger => {
      trigger.addEventListener('click', function(e) {
        e.preventDefault();
        
        const targetId = this.getAttribute('data-scroll-target');
        if (targetId === 'io-container') {
          clearTimeout(scrollTimeout);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        
        if (targetId) {
          const targetElement = document.getElementById(targetId);
          if (targetElement) {
            targetElement.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'start' 
            });
          } else {
            console.warn(`[ScrollSnap] Target element not found: ${targetId}`);
          }
        }
      });
    });
  }
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded
    setTimeout(init, 0);
  }
  
  // Also initialize after all resources are loaded
  window.addEventListener('load', () => {
    // Re-initializing after page load
    init();
  });

})();