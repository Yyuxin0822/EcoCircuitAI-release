function preprocessMetabolism(metabolism) {

  // Create deep copy to avoid modifying original object
  const metabolismCopy = JSON.parse(JSON.stringify(metabolism));

  // Filter out invalid processes (those without method, system, or name)
  metabolismCopy.process = metabolismCopy.process.filter(process =>
    process.method &&
    process.method.system &&
    process.method.name
  );

  // Renumber process IDs sequentially after filtering
  metabolismCopy.process.forEach((process, index) => {
    process.id = index;
  });

  function groupProcessesByMethodSystem(metabolism) {
    return metabolism.process.reduce((grouping, process) => {

      const system = process.method.system;
      if (!grouping[system]) {
        grouping[system] = [];
      }
      grouping[system].push(process);
      return grouping;
    }, {});
  }
  const processGroupByMethodSystem = groupProcessesByMethodSystem(metabolismCopy);


  function remapColsInGroups(processGroup) {
    Object.keys(processGroup).forEach((system) => {
      processGroup[system].forEach((process) => {
        const colSet = new Set(process.nodes.map(node => node.col));
        const sortedCols = Array.from(colSet).sort((a, b) => a - b);
        const colMapping = sortedCols.reduce((map, col, idx) => {
          map[col] = idx;
          return map;
        }, {});

        process.nodes.forEach((node) => {
          node.col = colMapping[node.col];
        });
      });
    });
  }
  remapColsInGroups(processGroupByMethodSystem);

  function groupFeedbackLoopsBySystem(metabolism) {
    return metabolism.feedback.reduce((grouping, feedbackLoop) => {
      const system = feedbackLoop.system;
      if (!grouping[system]) {
        grouping[system] = [];
      }
      grouping[system].push(feedbackLoop);
      return grouping;
    }, {});
  }

  const feedbackLoopBySystem = groupFeedbackLoopsBySystem(metabolismCopy);
  return [processGroupByMethodSystem, feedbackLoopBySystem];
}

function generateGlobalRow(processGroupByMethodSystem) {
  let cumulativeRowOffset = 0;

  // Iterate through systems in order
  Object.values(processGroupByMethodSystem).forEach(processes => {
    // Iterate through processes in the current system
    processes.forEach(process => {
      // Find the max local row in this process
      const maxLocalRow = process.nodes.length > 0
        ? Math.max(...process.nodes.map(node => node.row))
        : -1;

      // Set globalRow for each node in this process
      process.nodes.forEach(node => {
        node.globalRow = cumulativeRowOffset + node.row;
      });

      // Update cumulative offset for next process
      // Add 1 to account for 0-based indexing
      cumulativeRowOffset += maxLocalRow + 1;
    });
  });
}

// Generate noted_links as post-processing step
function generateNotedLinks(processGroupByMethodSystem, feedbackLoopByLoopSystem) {
  // Build global node-to-process map storing all occurrences
  const nodeToProcessMap = {};
  Object.entries(processGroupByMethodSystem).forEach(([system, processes]) => {
    processes.forEach(process => {
      process.nodes.forEach(node => {
        if (!nodeToProcessMap[node.name]) {
          nodeToProcessMap[node.name] = [];
        }
        nodeToProcessMap[node.name].push({ process, system });
      });
    });
  });

  // Generate noted_links for each process using new encoding
  Object.entries(processGroupByMethodSystem).forEach(([_system, processes]) => {
    processes.forEach(process => {
      const processMethodName = process.method.name;
      const processSystem = process.method.system;

      process.noted_links = process.links
        .filter(([nodeA, nodeB]) => nodeA !== nodeB)
        .map(([nodeA, nodeB]) => [
          `${nodeA}-${processMethodName}-${processSystem}`,
          `${nodeB}-${processMethodName}-${processSystem}`
        ]);
    });
  });

  // Helper function to find closest system using spiral search
  function findClosestSystemNode(currentSystem, nodeInfos, allSystems) {
    if (!nodeInfos || nodeInfos.length === 0) return null;

    // First check if current system exists
    const currentMatch = nodeInfos.find(info => info.system === currentSystem);
    if (currentMatch) return currentMatch;

    // Get index of current system in circular array
    const currentIndex = allSystems.indexOf(currentSystem);
    if (currentIndex === -1) return null; // No match, return null

    // Spiral search: alternate left and right from current position
    const systemsCount = allSystems.length;
    // Only need to check up to half the circle since we're going both directions
    const maxDistance = Math.ceil(systemsCount / 2);
    for (let distance = 1; distance <= maxDistance; distance++) {
      // Check right (clockwise)
      const rightIndex = (currentIndex + distance) % systemsCount;
      const rightSystem = allSystems[rightIndex];
      const rightMatch = nodeInfos.find(info => info.system === rightSystem);
      if (rightMatch) return rightMatch;

      // Check left (counter-clockwise)
      const leftIndex = (currentIndex - distance + systemsCount) % systemsCount;
      // Avoid checking the same system twice when we've reached the opposite side
      if (leftIndex === rightIndex) break;
      const leftSystem = allSystems[leftIndex];
      const leftMatch = nodeInfos.find(info => info.system === leftSystem);
      if (leftMatch) return leftMatch;
    }

    return null; // No match found in any system
  }

  // Generate noted_links for each feedback loop
  // Use node map to find processes, prioritizing feedback loop's system
  Object.entries(feedbackLoopByLoopSystem).forEach(([system, feedbackLoops]) => {
    feedbackLoops.forEach(feedbackLoop => {
      feedbackLoop.noted_links = feedbackLoop.links
        .filter(([nodeA, nodeB]) => nodeA !== nodeB)
        .map(([nodeA, nodeB]) => {
          const nodeAInfos = nodeToProcessMap[nodeA] || [];
          const nodeBInfos = nodeToProcessMap[nodeB] || [];

          if (nodeAInfos.length === 0 || nodeBInfos.length === 0) return null;

          // Get all systems array
          const allSystems = Object.keys(feedbackLoopByLoopSystem);

          // Use spiral search to find closest system nodes
          const nodeAInfo = findClosestSystemNode(system, nodeAInfos, allSystems);
          const nodeBInfo = findClosestSystemNode(system, nodeBInfos, allSystems);

          // If either node has no match, return null (will be filtered out)
          if (!nodeAInfo || !nodeBInfo) return null;

          return [
            `${nodeA}-${nodeAInfo.process.method.name}-${nodeAInfo.system}`,
            `${nodeB}-${nodeBInfo.process.method.name}-${nodeBInfo.system}`
          ];
        })
        .filter(link => link !== null);
    });
  });
}



window.deleteSystemFromMetabolism = function (systemName) {
  // Remove all processes with this system
  window.metabolism.process = window.metabolism.process.filter(process =>
    !(process.method && process.method.system === systemName)
  );

  // Remove all feedback loops with this system
  if (window.metabolism.feedback) {
    window.metabolism.feedback = window.metabolism.feedback.filter(feedback =>
      feedback.system !== systemName
    );
  }

  // No need to reindex - preprocessMetabolism handles that
};


function removeProcess(processId, metabolism, iodata) {
    addBackStackEntryMetabolism(metabolism);
    addBackStackEntry();
    // remove process and reassign process IDs
    const methodName = metabolism.process.find(proc => proc.id === processId)?.method.name;
    metabolism.process = metabolism.process.filter(proc => proc.id !== processId);
    metabolism.process.forEach((proc, index) => {
        proc.id = index;
    });

    // cleanup feedback loops
    const remainingNodes = metabolism.process.flatMap(proc => proc.nodes.map(node => node.name));

    metabolism.feedback = metabolism.feedback
        .map(feedbackLoop => {
            // Flatten feedback links to check against remaining nodes
            const nodesInLinks = feedbackLoop.links.flat();
            const validNodes = nodesInLinks.filter(nodeName => remainingNodes.includes(nodeName));

            // check for at least 3 unique nodes remaining
            const uniqueValidNodes = [...new Set(validNodes)];

            if (uniqueValidNodes.length <= 3) {
                // feedback loop invalid, remove it
                return null;
            }

            // reconstruct feedback links to preserve original pairs
            const filteredLinks = feedbackLoop.links.filter(pair =>
                remainingNodes.includes(pair[0]) && remainingNodes.includes(pair[1])
            );

            // ensure we still have at least 1 valid link
            if (filteredLinks.length === 0) {
                return null;
            }

            // valid feedback loop with filtered links
            return { ...feedbackLoop, links: filteredLinks };
        })
        .filter(loop => loop !== null);

    //delet relevant node in iodiagram
    //find the node in iodata, whose name is the same as method.name for the process id 

    var nodeToDelete = iodata.nodes.find(
        node => node.name.trim().toUpperCase() === methodName.trim().toUpperCase() && node.col === 1
    );
    if (nodeToDelete) { deleteNode(nodeToDelete); }
}

function removeFeedbackLoop(loopName, metabolism) {
    addBackStackEntryMetabolism(metabolism);
    addBackStackEntry();
    metabolism.feedback = metabolism.feedback.filter(loop => loop.name !== loopName);
}






// Interactivity functions
let selectedLoop = null;

function handleFeedbackHover(isHovering, feedbackData) {
  // Don't interfere if a different loop is selected
  if (selectedLoop && selectedLoop !== feedbackData.name) return;

  if (isHovering) {
    highlightFeedbackLoop(feedbackData);
  } else if (!selectedLoop) {
    resetLayers();
  }
}

function toggleFeedbackLoop(event, feedbackData) {
  event.stopPropagation();
  selectedLoop = (selectedLoop === feedbackData.name) ? null : feedbackData.name;

  if (selectedLoop) {
    highlightFeedbackLoop(feedbackData);
  } else {
    resetLayers();
  }
}

function highlightFeedbackLoop(feedbackData) {
  window.feedbackOverlay.raise()
    .style("pointer-events", "all")
    .transition().duration(200)
    .attr("opacity", 0.8);

  const svg = window.metabolismSvg;
  const svgMainGroup = svg.select(".main-group").raise();
  const allLinksGroup = svg.select(".all-links");

  // Fade all elements
  svgMainGroup.selectAll(".node rect, .node text, .node circle")
    .transition().duration(200)
    .style("opacity", 0.1);

  allLinksGroup.selectAll("path.link")
    .transition().duration(200)
    .style("opacity", 0.1);

  // Highlight the specific links from noted_links
  feedbackData.notedLinks.forEach(linkPair => {
    const linkKey = `${linkPair[0]}|||${linkPair[1]}`;
    allLinksGroup.select(`[data-link-key="${linkKey}"]`)
      .transition().duration(200)
      .style("opacity", 1);
  });

  // Extract unique node names from the noted_links
  // Each node key is like "nodeName-processName-systemName"
  const nodeKeysInLoop = new Set(feedbackData.notedLinks.flat());
  const nodeNamesInLoop = new Set();
  nodeKeysInLoop.forEach(nodeKey => {
    // Extract just the node name (before the first dash followed by process name)
    const parts = nodeKey.split('-');
    // Rejoin parts that might have dashes in the node name itself
    // We know the last two parts are process and system
    const nodeName = parts.slice(0, -2).join('-');
    nodeNamesInLoop.add(nodeName);
  });

  // Highlight nodes in the loop by matching their names
  svgMainGroup.selectAll(".node")
    .filter(d => nodeNamesInLoop.has(d.name))
    .raise()
    .selectAll("rect, text, circle")
    .transition().duration(200)
    .style("opacity", 1);

  svgMainGroup.selectAll(".node")
    .filter(d => nodeNamesInLoop.has(d.name))
    .select("rect")
    .attr("stroke", feedbackData.color)
    .attr("stroke-width", 2);

  // Handle feedback titles visibility
  svg.select(".feedback-title-group").raise();
  svg.selectAll(".feedback-title-item")
    .transition().duration(200)
    .style("opacity", 0.1);
  svg.selectAll(`.feedback-title-item[data-loop="${feedbackData.name}"]`)
    .transition().duration(200)
    .style("opacity", 1);

  window.feedbackOverlay.on("click", resetLayers);
}

window.resetLayers = function () {
  selectedLoop = null;
  window.feedbackOverlay.style("pointer-events", "none")
    .transition().duration(200)
    .attr("opacity", 0);

  const svg = window.metabolismSvg;
  const svgMainGroup = svg.select(".main-group");
  const allLinksGroup = svg.select(".all-links");

  svgMainGroup.selectAll(".node rect, .node text, .node circle")
    .transition().duration(200)
    .style("opacity", 1);

  allLinksGroup.selectAll("path.link")
    .transition().duration(200)
    .style("opacity", 1);

  svgMainGroup.selectAll(".node rect")
    .attr("stroke", null)
    .attr("stroke-width", null);

  svg.selectAll(".feedback-title-item")
    .transition().duration(200)
    .style("opacity", 1);

  svg.select(".all-links").lower();
}



