function toggleToolbar(expand = true, id = "") {
    const tool = document.getElementById(id);
    const minimized = tool.querySelector(".minimized-toolbar");
    const expanded = tool.querySelector(".expanded-toolbar");
    minimized?.style.setProperty("display", expand ? "none" : "flex");
    expanded?.style.setProperty("display", expand ? "flex" : "none");
}

function showPage(panelId) {
  const panels = document.querySelectorAll('.page-content');
  
  panels.forEach(panel => {
    console.log(panel.id, panelId);
    panel.style.display = (panel.id === panelId) ? 'flex' : 'none';
  });

  // Update active navigation state
  document.querySelectorAll('#navibar-container li').forEach(li => {
    li.classList.remove('active');
  });
  
  // Find and mark the clicked navigation item as active
  const navItems = document.querySelectorAll('#navibar-container li');
  navItems.forEach(li => {
    if ((panelId === 'api-key-settings' && li.textContent.includes('API Key')) ||
        (panelId === 'project-management' && li.textContent.includes('Projects')) ||
        (panelId === 'account-settings' && li.textContent.includes('Account'))) {
      li.classList.add('active');
    }
  });
}

// Initialize default page on load
document.addEventListener('DOMContentLoaded', () => {
  showPage('api-key-settings');
});
