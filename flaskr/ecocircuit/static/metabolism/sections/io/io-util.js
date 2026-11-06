// IO-specific utility functions

// Edit node name inline with validation (IO-specific)
function editNodeName(textSelection, data, iodata, deleteNode) {
  const excludedNames = iodata.nodes.map(n => n.name);
  const parent = d3.select(textSelection.node().parentNode); // Overlay input on top of the text
  const bbox = textSelection.node().parentNode.getBBox(); // Get text position & size

  // Create an input field at the text's position
  const foreignObject = parent.append("foreignObject")
    .attr("x", 5)
    .attr("y", 5)
    .attr("width", bbox.width - 10)
    .attr("height", bbox.height - 10);

  const input = foreignObject.append("xhtml:input")  // Use xhtml namespace for compatibility
    .attr("type", "text")
    .attr("value", data.name)
    .style("width", "100%")
    .style("height", "100%");

  input.node().focus(); // Focus input for editing

  function updateName(newName) {
    var newName = newName.toUpperCase().trim();
    if (newName == "") {
      addBackStackEntry();
      deleteNode(data);
    } else if (!excludedNames.includes(newName)) {
      addBackStackEntry();
      // Update Links and Nodes
      iodata.links = iodata.links.map(link => link.map(item => item == data.name ? newName : item));
      data.name = newName;
      textSelection.text(data.name);
      wrapTextWithEllipsis(textSelection, bbox.width - 10, 2)
    }
    drawDiagram();
  }

  // Handle input field events
  input.on("blur", function () { // Save on blur
    updateName(this.value);
  }).on("keydown", function (event) { // Save on Enter
    if (event.key === "Enter") {
      updateName(this.value);
    }
  });
}


window.deleteNode = function(node) {
  window.iodata.nodes = window.iodata.nodes.filter(e => e !== node);

  window.iodata.nodes.forEach(item => {
    if (item.col === node.col && item.row >= node.row) {
      item.row -= 1;
    }
  });

  if (node.col === 0) {
    window.iodata.links = window.iodata.links.filter(e => e[0] !== node.name);
  } else if (node.col === 1) {
    // For method nodes, remove both incoming and outgoing links
    window.iodata.links = window.iodata.links.filter(e => e[0] !== node.name && e[1] !== node.name);
  } else {
    window.iodata.links = window.iodata.links.filter(e => e[1] !== node.name);
  }
};

window.deleteSystem = function(systemName) {
  // Find all nodes with this system
  const nodesToDelete = window.iodata.nodes.filter(node => node.system === systemName);
  
  // Collect all node names for efficient link removal
  const nodeNamesToDelete = new Set(nodesToDelete.map(node => node.name));
  
  // Remove all nodes with this system
  window.iodata.nodes = window.iodata.nodes.filter(node => node.system !== systemName);
  
  // Remove all links that reference any of the deleted nodes
  window.iodata.links = window.iodata.links.filter(link => {
    return !nodeNamesToDelete.has(link[0]) && !nodeNamesToDelete.has(link[1]);
  });
  
  // Reorganize rows for each column after deletion
  [0, 1, 2].forEach(col => {
    const remainingNodes = window.iodata.nodes.filter(n => n.col === col);
    remainingNodes.sort((a, b) => a.row - b.row);
    remainingNodes.forEach((node, index) => {
      node.row = index;
    });
  });
};
