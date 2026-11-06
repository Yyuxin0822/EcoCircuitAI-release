if (iodata) { window.iodata = iodata; }
console.log(iodata);
drawDiagram(true);
var iodataBackstack = [];

function drawDiagram(isFresh = false) {
  if (isFresh) {
    iodataBackstack = [];
  }

  d3.select("#matrix-io").html("");

  // Render configuration
  const renderConfig = {
    rectWidth: 210,
    rectHeight: 45,
    rowSpacing: 6,
    colSpacing: 45,
    imgWidth: 480,
    bgAlpha: 0.6,
    wDeltaCoEff: 0.6,
    margin: { top: 60, right: 5, bottom: 0, left: 5 }
  };

  // Calculate width for consistency
  const width = 2 * renderConfig.rectWidth + 2 * renderConfig.colSpacing + renderConfig.imgWidth + renderConfig.margin.left + renderConfig.margin.right;

  const svgWrapper = document.getElementById('io-svg-wrapper');
  const maxTotalHeight = svgWrapper ? svgWrapper.clientHeight : window.innerHeight;

  // Create main SVG container
  const mainSvg = d3.select("#matrix-io")
    .attr("width", width)
    .attr("height", maxTotalHeight)
    .attr("viewBox", `0 0 ${width} ${maxTotalHeight}`);

  // Draw header first and get actual height
  const headerHeight = drawIOHeader(mainSvg, width);

  // Create second foreignObject for scrollable diagram content
  const diagramY = headerHeight;
  const diagramHeight = maxTotalHeight - headerHeight;

  const diagramForeignObject = mainSvg.append("foreignObject")
    .attr("id", "matrix-io-content-wrapper")
    .attr("x", 0)
    .attr("y", diagramY)
    .attr("width", width)
    .attr("height", diagramHeight);

  // Create scrollable div
  const scrollDiv = diagramForeignObject.append("xhtml:div")
    .attr("xmlns", "http://www.w3.org/1999/xhtml")
    .style("width", "100%")
    .style("height", "100%")
    .style("overflow-y", "auto")
    .style("overflow-x", "hidden");

  // Create inner SVG for diagram content
  scrollDiv.append("svg")
    .attr("id", "matrix-io-content")
    .attr("width", width);
  // Height will be set by renderIODiagram based on content

  renderIODiagram({
    iodata: window.iodata,
    imgpath: imgpath,
    syscolor: window.defaultSystems,
    containerId: "#matrix-io-content",
    ...renderConfig
  });
}

function addBackStackEntry() {
  const entry = {
    iodata: JSON.parse(JSON.stringify(window.iodata)),
    syscolor: JSON.parse(JSON.stringify(window.defaultSystems)),
  };
  iodataBackstack.push(entry);
  console.log("iodataBackstack", iodataBackstack);
}

function renderIODiagram({
  iodata,
  imgpath,
  syscolor,
  containerId = "#matrix-io-content",
  rectWidth = 200,
  rectHeight = 30,
  rowSpacing = 0,
  colSpacing = 60,
  imgWidth = 600,
  bgAlpha = 0.75,
  wDeltaCoEff = 0.5
}) {
  console.log("renderIODiagram");
  // ---------------------------------------
  // 1) Compute the new layout
  // ---------------------------------------
  const margin = { top: 50, right: 0, bottom: 0, left: 0 };

  // The new max row (after reorder) might have changed
  const sourceRows = iodata.nodes.filter(d => d.col === 0).map(d => d.row);
  const targetRows = iodata.nodes.filter(d => d.col === 2).map(d => d.row);
  const maxSourceRow = sourceRows.length > 0 ? Math.max(...sourceRows) + 1 : 0;
  const maxTargetRow = targetRows.length > 0 ? Math.max(...targetRows) + 1 : 0;


  // Add in an extra row to size for the "Add" button
  const maxRow = Math.max(maxSourceRow, maxTargetRow) + 1; // 0-based => +1, filter method nodes
  const width = 2 * rectWidth + 2 * colSpacing + imgWidth + margin.left + margin.right;
  let computedHeight = maxRow * rectHeight + (maxRow - 1) * rowSpacing + margin.top + margin.bottom;
  const minHeight = imgWidth + margin.top + margin.bottom;  // Square minimum height
  const height = Math.max(computedHeight, minHeight);

  // Save the full content height for download functionality
  window.matrixIOContentHeight = height;

  // Precompute arrays of possible x and y coordinates
  const colX = [0, (imgWidth + rectWidth + 2 * colSpacing) / 2, imgWidth + rectWidth + 2 * colSpacing];
  const rowY = Array.from({ length: maxRow }, (_, i) => i * (rectHeight + rowSpacing));

  // For quick lookup
  const colbyIndex = {};
  colX.forEach((d, i) => (colbyIndex[i] = d));
  const rowbyIndex = {};
  rowY.forEach((d, i) => (rowbyIndex[i] = d));

  // Create a map of node name -> node object for later reference in links and hover events
  const nodeByName = {};
  iodata.nodes.forEach(d => {
    nodeByName[d.name] = d;
  });

  // ---------------------------------------
  // 2) Build the SVG container
  // ---------------------------------------
  const svg = d3.select(containerId)
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  // Annotations at the top of diagram
  const annotationY = 30;

  const textGroup = svg.append("g")
    .attr("transform", `translate(${margin.left + rectWidth / 2}, ${annotationY})`)
    .attr("class", "annotation");

  //Add System Inputs at the first col
  //Add System Outputs at the last col when hover
  //Add System Methods at the middle col
  textGroup.append("text")
    .attr("x", colX[0])
    .attr("text-anchor", "middle")
    .text("System Inputs".toUpperCase())
    .each(function (d) {
      wrapTextWithEllipsis(d3.select(this), rectWidth / 3, 2);
    });

  textGroup.append("text")
    .attr("class", "methodannotation")
    .attr("x", colX[1])
    .attr("text-anchor", "middle")
    .text("System Methods".toUpperCase())
    .each(function (d) {
      wrapTextWithEllipsis(d3.select(this), rectWidth / 3, 2);
    })
    .style("opacity", 0);

  textGroup.append("text")
    .attr("x", colX[2])
    .attr("text-anchor", "middle")
    .text("System Outputs".toUpperCase())
    .each(function (d) {
      wrapTextWithEllipsis(d3.select(this), rectWidth / 3, 2);
    });

  // Main group for diagram content
  const g = svg.append("g")
    .attr("transform", `translate(${margin.left}, ${margin.top})`);

  // Add background so all of svg is a hit region
  g.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "white");

  // ---------------------------------------
  // 3) Append image background
  // ---------------------------------------
  const maskId = "roundedImageMask";
  g.append("defs").append("mask")
    .attr("id", maskId)
    .append("rect")
    .attr("x", rectWidth + colSpacing)
    .attr("y", 0)
    .attr("width", imgWidth)
    .attr("height", height - margin.bottom - margin.top)
    .attr("rx", 10)
    .attr("fill", "white");

  g.append("image")
    .attr("xlink:href", imgpath)
    .attr("x", rectWidth + colSpacing)
    .attr("y", 0)
    .attr("width", imgWidth)
    .attr("height", height - margin.bottom - margin.top)
    .attr("preserveAspectRatio", "xMidYMid slice")
    .attr("mask", `url(#${maskId})`);

  // ---------------------------------------
  // 4) Undo Button
  // ---------------------------------------

  if (iodataBackstack.length > 0) {
    const undoButtonWidth = 60;
    const undoButtonHeight = 20;
    const undoButton = svg
      .append("g")
      .attr("id", "undoButton")
      .attr("transform", `translate(${margin.left + rectWidth + colSpacing + imgWidth - undoButtonWidth}, ${margin.top - 30})`)
      .on("click", function () {
        if (iodataBackstack.length === 0) return;

        const previousState = iodataBackstack.pop();
        window.iodata = previousState.iodata;
        window.defaultSystems = previousState.syscolor;

        // Cleanly reset and redraw SystemBar
        const systemBarContainer = document.getElementById('system-bar');
        systemBarContainer.innerHTML = '';
        new SystemBar(systemBarContainer);

        drawDiagram();
      });


    undoButton.append("rect")
      .attr("width", undoButtonWidth)
      .attr("height", undoButtonHeight)
      .attr("rx", 5)
      .attr("fill", "#1dbf45")

    undoButton.append("text")
      .attr("x", undoButtonWidth / 2 - 10)
      .attr("y", undoButtonHeight / 2)
      .attr("dy", "0.35em")
      .attr("font-size", "10px")
      .attr("text-anchor", "middle")
      .attr("fill", "white")
      .text("UNDO")
      .attr("pointer-events", "none");

    undoButton.append("text")
      .attr("x", undoButtonWidth / 2 + 17)
      .attr("y", undoButtonHeight / 2 - 1)
      .attr("dy", "0.35em")
      .attr("font-size", "30px")
      .attr("text-anchor", "middle")
      .attr("fill", "white")
      .text("⤺")
      .attr("pointer-events", "none");

    // Confirm Button (comes first)
    const confirmButtonWidth = 80;
    const confirmButtonHeight = 20;
    const confirmButton = svg
      .append("g")
      .attr("id", "confirmButton")
      .attr("transform", `translate(${margin.left + rectWidth + colSpacing}, ${margin.top - 30})`)
      .on("click", function (event, d) {
        event.preventDefault();
        
        // Start loading animations for both diagrams
        startLoad("metabolism-svg-wrapper", "Saving project...");
        startLoad("io-svg-wrapper", "Saving project...");
        
        // Set up one-time listeners for save response
        window.socket.once('save_project_success', (data) => {
          // Update loader text before finishing
          updateLoaderText("Save complete! Refreshing diagrams...", 100);
          
          // Clear both backstacks
          iodataBackstack = [];
          metabolismBackstack = [];
          
          // Small delay to show success message
          setTimeout(() => {
            // Finish loading animations
            finishLoad("metabolism-svg-wrapper");
            finishLoad("io-svg-wrapper");
            
            // Redraw both diagrams with fresh state
            drawDiagram(true);
            drawMetabolismDiagram(window.metabolism, true);
          }, 500);
        });
        
        window.socket.once('save_project_error', (errorData) => {
          console.error("Save failed:", errorData.error);
          
          // Finish loading animations
          finishLoad("metabolism-svg-wrapper");
          finishLoad("io-svg-wrapper");
          
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
      });

    confirmButton.append("rect")
      .attr("x", 0)
      .attr("width", confirmButtonWidth)
      .attr("height", confirmButtonHeight)
      .attr("rx", 5)
      .attr("fill", "#c64afd")

    confirmButton.append("text")
      .attr("x", confirmButtonWidth / 2 - 5)
      .attr("y", confirmButtonHeight / 2)
      .attr("dy", "0.35em")
      .attr("font-size", "10px")
      .attr("text-anchor", "middle")
      .attr("fill", "white")
      .text("CONFIRM")
      .attr("pointer-events", "none");
    
    confirmButton.append("text")
      .attr("x", confirmButtonWidth / 2 + 28)
      .attr("y", confirmButtonHeight / 2)
      .attr("dy", "0.35em")
      .attr("font-size", "20px")
      .attr("text-anchor", "middle")
      .attr("fill", "white")
      .attr("font-weight", "bold")
      .text("✓")
      .attr("pointer-events", "none");

    // Compute Button (comes second)
    const computeButtonWidth = 80;
    const computeButtonHeight = 20;
    const computeButton = svg
      .append("g")
      .attr("id", "computeButton")
      .attr("transform", `translate(${margin.left + rectWidth + colSpacing + confirmButtonWidth + 10}, ${margin.top - 30})`)
      .on("click", function (event, d) {
        event.preventDefault();

        //check if there are any empty nodes
        const emptyNodes = iodata.nodes.filter(node => {
          return node.name === "" || node.name.match(/^(INPUT|OUTPUT)\s+\d+$/);
        })
        if (emptyNodes.length > 0) {
          alert("Please fill in all node names or remove empty nodes before computing.");
          return;
        }

        // Start loading animation for metabolism diagram
        startLoad("metabolism-svg-wrapper");
        startLoad("io-svg-wrapper");

        try {
          // Listen for immediate acknowledgment
          window.socket.once('iterate_started', (data) => {
            console.log('Request acknowledged:', data.message);
          });

          // Listen for progress updates
          window.socket.on('iterate_progress', (data) => {
            console.log(`Progress: ${data.percent}% - ${data.message}`);
            updateLoaderText(data.message, data.percent);
          });

          // Listen for final response
          window.socket.once('iterate_response', (data) => {
            console.log('iterate_response received:', data);
            drawMetabolismDiagram(data["parsed_metabolism"], true);
            window.iodata = data["parsed_io"];
            const sortedSystems = sortSystemsByHue(data["syscolor"]);
            window.defaultSystems = sortedSystems;
            window.currentSystems = { ...sortedSystems };
            SystemBar.processSystems(document.getElementById('system-bar'), window.defaultSystems);
            window.metabolism = data["parsed_metabolism"];
            drawDiagram(true);

            finishLoad("metabolism-svg-wrapper");
            finishLoad("io-svg-wrapper");

            // Capture thumbnails after visualizations are rendered
            if (window.setupThumbnailCapture) {
              window.setupThumbnailCapture();
            }

            // Clean up progress listener
            window.socket.off('iterate_progress');
          });

          // Listen for errors
          window.socket.once('iterate_error', (errorData) => {
            console.log('iterate_error received:', errorData);
            alert(errorData.error || 'An error occurred.');

            if (errorData.html) {
              document.getElementById("error-container").innerHTML = errorData.html;
              attachSubmitAPIKeyListener();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }

            finishLoad("metabolism-svg-wrapper");
            finishLoad("io-svg-wrapper");

            // Clean up progress listener
            window.socket.off('iterate_progress');
          });

          // Send SocketIO event
          window.socket.emit('iterate', {
            projectId: projectId,
            sysColor: syscolor,
            ioData: iodata,
            metabolism: metabolism,
            env: info
          });

        } catch (error) {
          console.error('Socket error occurred:', error);
          finishLoad("metabolism-svg-wrapper");
          finishLoad("io-svg-wrapper");
        }
      });


    computeButton.append("rect")
      .attr("x", 0)
      .attr("width", computeButtonWidth)
      .attr("height", computeButtonHeight)
      .attr("rx", 5)
      .attr("fill", "#c64afd")

    computeButton.append("text")
      .attr("x", computeButtonWidth / 2)
      .attr("y", computeButtonHeight / 2)
      .attr("dy", "0.35em")
      .attr("font-size", "10px")
      .attr("text-anchor", "middle")
      .attr("fill", "white")
      .text("COMPUTE ✨")
      .attr("pointer-events", "none");
  }



  // ---------------------------------------
  // 6) Draw nodes
  // ---------------------------------------


  const nodeGroup = g.selectAll(".node")
    .data(iodata.nodes)
    .enter()
    .append("g")
    .attr("class", "node")
    .attr("transform", d => `translate(${colX[d.col]}, ${rowY[d.row]})`);

  // (A) Add Mask so that the rectangle doesn't grow when stroke is added
  const nodeMaskId = "nodeMask";
  nodeGroup.append("defs").append("mask")
    .attr("id", nodeMaskId)
    .append("rect")
    .attr("width", rectWidth)
    .attr("height", rectHeight)
    .attr("rx", 5)
    .attr("fill", "white");

  // (B) Draw the node rectangle
  nodeGroup.append("rect")
    .attr("class", "nodeBackground")
    .attr("width", rectWidth)
    .attr("height", rectHeight)
    .attr("rx", 5)
    .attr("fill", d => colorBySystem(d.system, bgAlpha))
    .attr("stroke", "rgba(255,255,255,0.3)")
    .attr("stroke-width", 1)
    .attr("mask", `url(#${nodeMaskId})`);

  // (C) Draw the node text
  nodeGroup.append("text")
    .attr("x", d => d.col === 0 ? (rectWidth - 20) / 2 : ((rectWidth + 20) / 2))
    .attr("y", rectHeight / 2)
    .attr("dy", "0.35em")
    .attr("font-size", "12px")
    .attr("text-anchor", "middle")
    .attr("fill", "black")
    .text(d => d.name)
    .on("click", function (event, d) {
      editNodeName(d3.select(this), d, iodata, deleteNode);
    })
    .each(function (d) {
      wrapTextWithEllipsis(d3.select(this), rectWidth - 30, 3);
    });

  // Add (+) button for column 0
  var draggingLink = null;
  nodeGroup.filter(d => d.col === 0)
    .append("circle")
    .attr("cx", rectWidth - 15)
    .attr("cy", rectHeight / 2)
    .attr("r", 8)
    .attr("fill", "#1dbf45")
    .on("click", function (event, d) {
      draggingLink = d;
      const link = g.append("path")
        .datum(d)
        .attr("class", "directLink")
        .attr("d", d => {
          let linkData = [
            { x: colbyIndex[d.col] + rectWidth, y: rowbyIndex[d.row] + rectHeight / 2 },
            { x: colbyIndex[d.col] + rectWidth + wDelta, y: rowbyIndex[d.row] + rectHeight / 2 },
            { x: colbyIndex[d.col] + rectWidth + 100 - wDelta, y: rowbyIndex[d.row] + rectHeight / 2 },
            { x: colbyIndex[d.col] + rectWidth + 100 - arrowOffset, y: rowbyIndex[d.row] + rectHeight / 2 }
          ];
          return filletPath(linkData, 15);
        })
        .attr("fill", "none")
        .attr("stroke", colorBySystem(d.system, bgAlpha))
        .attr("stroke-width", 6)
        .attr("marker-end", d => {
          const color = colorBySystem(d.system, bgAlpha);
          return getOrCreateMarker(color);
        });

      g.on("mousemove", function (event) {
        var [x, y] = d3.pointer(event);
        x = Math.max(colbyIndex[d.col] + rectWidth + 100, x);
        x = Math.min(colbyIndex[2], x);
        link.attr("d", item => {
          let linkData = [
            { x: colbyIndex[d.col] + rectWidth, y: rowbyIndex[d.row] + rectHeight / 2 },
            { x: colbyIndex[d.col] + rectWidth + wDelta, y: rowbyIndex[d.row] + rectHeight / 2 },
            { x: x - wDelta, y: y },
            { x: x - arrowOffset, y: y }
          ];
          return filletPath(linkData, 15);
        })
      })

    });

  nodeGroup.filter(d => d.col === 0)
    .append("text")
    .attr("x", rectWidth - 15)
    .attr("y", rectHeight / 2 + 3.5)
    .attr("font-size", "17px")
    .attr("text-anchor", "middle")
    .attr("fill", "white")
    .text("+")
    .attr("pointer-events", "none");

  // Create link when clicking on column index 2
  nodeGroup.filter(d => d.col === 2)
    .on("click", function (event, d) {
      if (draggingLink != null) {
        addBackStackEntry();
        iodata.links.push([
          draggingLink.name,
          d.name
        ]);
        drawDiagram();
      }
    });

  // Add Right click to Delete
  nodeGroup.on("contextmenu", function (event, d) {
    event.preventDefault(); // Prevent default right-click menu
    addBackStackEntry();
    deleteNode(d);
    drawDiagram();
  });

  // Add (-) button for column 2
  nodeGroup.filter(d => d.col === 2)
    .append("circle")
    .attr("cx", 15)
    .attr("cy", rectHeight / 2)
    .attr("r", 8)
    .attr("fill", "#696969")
    .on("click", function (event, d) {
      if (draggingLink != null) { return; }
      const firstLinks = iodata.links.filter(link => link[1] == d.name).map(link => link[0]);
      const uniqueLinks = [...new Set(firstLinks)];

      if (uniqueLinks.length > 1) {
        const optionWidth = 180;
        const optionHeight = 20;
        const optionSpacing = 1;

        const contextMenu = g
          .append("g")
          .attr("class", "contextMenu")
          .attr("transform", `translate(${colX[d.col] + 23}, ${rowY[d.row] + rectHeight / 2 + 8})`);

        contextMenu.style("opacity", 0)
          .transition()
          .duration(200)
          .style("opacity", 1)

        contextMenu.append("rect")
          .attr("class", "contextMenu")
          .attr("width", optionWidth)
          .attr("height", (uniqueLinks.length * (optionHeight + optionSpacing)) - optionSpacing)
          .attr("fill", "#656565");

        uniqueLinks.forEach(link => {
          contextMenu.append("rect")
            .attr("width", optionWidth)
            .attr("height", optionHeight)
            .attr("y", (uniqueLinks.indexOf(link) * (optionHeight + optionSpacing)))
            .attr("fill", "#919191")
            .on("click", function (event) {
              addBackStackEntry()
              iodata.links = iodata.links.filter(k => k[0] != link || k[1] != d.name);
              drawDiagram();
            });
          contextMenu.append("text")
            .attr("x", optionWidth / 2)
            .attr("y", (uniqueLinks.indexOf(link) * (optionHeight + optionSpacing)) + optionHeight / 2)
            .attr("fill", "white")
            .attr("text-anchor", "middle")
            .attr("font-size", "10px")
            .attr("pointer-events", "none")
            .text(link)
            .each(function (d) {
              wrapTextWithEllipsis(d3.select(this), optionWidth, 1);
            });

        });

        setTimeout(() => {
          g.on("click", function () {
            d3.selectAll(".contextMenu").remove();
            g.on("click", null);
          });
        }, 50);
      } else {
        addBackStackEntry()
        iodata.links = iodata.links.filter(link => link[1] != d.name);
        drawDiagram();
      }
    });

  nodeGroup.filter(d => d.col === 2)
    .append("text")
    .attr("x", 15)
    .attr("y", rectHeight / 2 + 5)
    .attr("font-size", "17px")
    .attr("text-anchor", "middle")
    .attr("fill", "white")
    .text("-")
    .attr("pointer-events", "none");


  // ------------------------------------------------
  // Hide the metabolism (middle) nodes by default.
  // We assume these are the nodes in column 1.
  nodeGroup.filter(d => d.col === 1)
    .style("opacity", 0)
    .attr("pointer-events", "none");

  // ---------------------------------------
  // 4) Build link markers (arrows) and gradients
  // ---------------------------------------
  const markerByColor = {};
  const arrowOffset = 10;
  function getOrCreateMarker(color) {
    if (!markerByColor[color]) {
      const markerId = `arrow-${color.replace(/[^\w-]/g, "")}`;
      markerByColor[color] = markerId;
      g.append("defs").append("marker")
        .attr("id", markerId)
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 0)  // <-- this sets where the marker attaches
        .attr("refY", 5)
        .attr("markerUnits", "userSpaceOnUse")
        .attr("markerWidth", arrowOffset)
        .attr("markerHeight", arrowOffset)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M 0 0 L 10 5 L 0 10 z")
        .attr("fill", color);
    }
    return `url(#${markerByColor[color]})`;
  }


  function sanitizeId(str) {
    // Replace any character that is not a letter, digit, hyphen, or underscore.
    return str.toString().replace(/[^a-zA-Z0-9\-_]/g, "_");
  }

  const defs = g.append("defs");
  const gradientByLink = {};
  function getOrCreateGradient(sourceColor, targetColor, linkIndex) {
    // Sanitize the linkIndex to ensure valid characters for an ID.
    const sanitizedLinkIndex = sanitizeId(linkIndex);
    const gradientId = `gradient-${sanitizedLinkIndex}`;

    if (!gradientByLink[gradientId]) {
      gradientByLink[gradientId] = gradientId;
      const gradient = defs.append("linearGradient")
        .attr("id", gradientId)
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", "0%")
        .attr("y1", "0%")
        .attr("x2", "100%")
        .attr("y2", "0%");


      gradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", sourceColor);

      gradient.append("stop")
        .attr("offset", "50%")
        .attr("stop-color", targetColor);
    }

    // Validate the colors:
    // If both source and target are valid, use the gradient.
    if (isValidColor(sourceColor) && isValidColor(targetColor)) {
      return `url(#${gradientId})`;
    }
    // Else if targetColor is valid, fall back to it.
    else if (isValidColor(targetColor)) {
      return targetColor;
    }
    // Otherwise, return a default grey.
    else {
      return "grey";
    }
  }


  // ---------------------------------------
  // 5) Draw Direct links
  // ---------------------------------------
  // Separate the given links into:
  //   • detailedLinks1: input (col0) → method (col1)
  //   • detailedLinks2: method(col1) → output (col2)
  const detailedLinks1 = [];
  const detailedLinks2 = [];
  const directLinks = [];
  const ioDirectLinks = [] // only capture unique io links

  iodata.links.forEach(link => {
    const source = nodeByName[link[0]];
    const target = nodeByName[link[1]];
    if (source.col === 0 && target.col === 1) {
      detailedLinks1.push(link);
    } else if (source.col === 1 && target.col === 2) {
      detailedLinks2.push(link);
    } else if (source.col === 0 && target.col === 2) {
      ioDirectLinks.push({ input: source.name, output: target.name });
    }
  });


  const methodFromInputs = {};   // method node ->[input node names]
  const methodToOutputs = {};    // method node ->[output node names]
  detailedLinks1.forEach(link => {
    const input = nodeByName[link[0]];
    const method = nodeByName[link[1]];
    if (!methodFromInputs[method.name]) methodFromInputs[method.name] = [];
    methodFromInputs[method.name].push(input.name);
  });

  detailedLinks2.forEach(link => {
    const method = nodeByName[link[0]];
    const output = nodeByName[link[1]];
    if (!methodToOutputs[method.name]) methodToOutputs[method.name] = [];
    methodToOutputs[method.name].push(output.name);
  });

  for (const method in methodFromInputs) {
    for (const input of methodFromInputs[method]) {
      // Only push a direct link if the method also connects to an output.
      if (methodToOutputs[method]) {
        for (const output of methodToOutputs[method]) {
          directLinks.push({ input, output, method });
          ioDirectLinks.push({ input, output });
        }
      }
    }
  }

  const uniqueDirectLinks = [];
  const duplicateDirectLinks = [];
  const seenDirectKeys = new Set();

  for (const link of directLinks) {
    const key = `${link.input}|${link.method}|${link.output}`;
    if (seenDirectKeys.has(key)) {
      duplicateDirectLinks.push(link);
    } else {
      seenDirectKeys.add(key);
      uniqueDirectLinks.push(link);
    }
  }

  // For ioDirectLinks: using key = `${input}|${output}`
  const uniqueIoDirectLinks = [];
  const duplicateIoDirectLinks = [];
  const seenIoKeys = new Set();

  for (const link of ioDirectLinks) {
    const key = `${link.input}|${link.output}`;
    if (seenIoKeys.has(key)) {
      duplicateIoDirectLinks.push(link);
    } else {
      seenIoKeys.add(key);
      uniqueIoDirectLinks.push(link);
    }
  }

  // (A) Direct links (col1→col3) are visible by default.
  const directLinkGroup = g.append("g").attr("class", "directLinks")
    .attr("transform", `translate(${rectWidth / 2}, ${rectHeight / 2})`);
  const wDelta = wDeltaCoEff * colSpacing;
  directLinkGroup.selectAll(".directLink")
    .data(uniqueIoDirectLinks) // Remove duplicates
    .enter()
    .append("path")
    .attr("class", "directLink")
    .attr("d", d => {
      const source = nodeByName[d.input];
      const target = nodeByName[d.output];
      // Draw a simple straight link (using two points) between the center of input and output nodes.
      let linkData = [
        { x: colbyIndex[source.col] + rectWidth / 2, y: rowbyIndex[source.row] },
        { x: colbyIndex[source.col] + rectWidth / 2 + wDelta, y: rowbyIndex[source.row] },
        { x: colbyIndex[target.col] - rectWidth / 2 - wDelta, y: rowbyIndex[target.row] },
        { x: colbyIndex[target.col] - rectWidth / 2 - arrowOffset, y: rowbyIndex[target.row] }
      ];
      return filletPath(linkData, 15);
    })
    .attr("fill", "none")
    .attr("stroke", d => {
      const sourceColor = colorBySystem(nodeByName[d.input].system, bgAlpha);
      const targetColor = colorBySystem(nodeByName[d.output].system, bgAlpha);
      return getOrCreateGradient(sourceColor, targetColor, d.input + d.output);
    })
    .attr("stroke-width", 6)
    .attr("marker-end", d => {
      const color = colorBySystem(nodeByName[d.output].system, bgAlpha);
      return getOrCreateMarker(color);
    })
    .style("opacity", 0.5);



  // ---------------------------------------
  // 6) Dynamically Append Method Nodes and Draw Detailed Links
  // ---------------------------------------
  // Add hover interactions for the input (col 0) and output (col 2) nodes.
  // When hovering, we reveal the method nodes associated with the hovered node.

  nodeGroup.filter(d => d.col !== 1)
    .on("mouseover", function (event, d) {

      const hoveredName = d.name;
      const isInput = d.col === 0;
      const strokeWidth = 4;

      // Hightlight the item we are hovering when dragging
      if (draggingLink != null) {
        if (d.col === 2) {
          g.selectAll(".node")
            .filter(d => hoveredName == d.name)
            .select(".nodeBackground")
            .attr("stroke", "black")
            .attr("stroke-width", strokeWidth);
        }
        return;
      }

      textGroup.selectAll(".methodannotation")
        .transition().duration(200)
        .style("opacity", 1);

      // Fade out direct links connected to the hovered node.
      directLinkGroup.selectAll(".directLink")
        .filter(linkData => linkData.input === hoveredName || linkData.output === hoveredName)
        .transition().duration(200)
        .style("opacity", 0);
      // Fade out all direct links to 25% opacity.
      directLinkGroup.selectAll(".directLink")
        .transition().duration(200)
        .style("opacity", 0.25);

      // Filter connected links.
      const connectedLinks = directLinks.filter(linkData =>
        isInput ? linkData.input === hoveredName : linkData.output === hoveredName
      );

      // --- Compute associated node names ---
      // This set will include the hovered node plus its associated method and the other node.
      const associatedNames = new Set();
      associatedNames.add(hoveredName);
      connectedLinks.forEach(linkData => {
        if (isInput) {
          associatedNames.add(linkData.method);
          associatedNames.add(linkData.output);
        } else {
          associatedNames.add(linkData.method);
          associatedNames.add(linkData.input);
        }
      });

      // Outline the existing input/output nodes.
      g.selectAll(".node")
        .filter(d => associatedNames.has(d.name))
        .select(".nodeBackground")
        .attr("stroke", "black")
        .attr("stroke-width", strokeWidth);

      if (connectedLinks.length > 0) {
        // --- Create dynamic method nodes ---

        // Group links by method.
        const linksByMethod = d3.group(connectedLinks, link => link.method);

        // Compute an average row for each method node.
        const methodRow = {};
        linksByMethod.forEach((links, methodName) => {
          const rows = links.flatMap(link =>
            [nodeByName[link.input].row, nodeByName[link.output].row]
          );
          methodRow[methodName] = Math.floor(d3.mean(rows));
        });

        // Adjust duplicate rows to avoid overlaps.
        const sortedMethodNames = Object.keys(methodRow).sort((a, b) => methodRow[a] - methodRow[b]);
        sortedMethodNames.forEach((methodName, i) => {
          if (i > 0 && methodRow[methodName] <= methodRow[sortedMethodNames[i - 1]]) {
            methodRow[methodName] = methodRow[sortedMethodNames[i - 1]] + 1;
          }
        });

        // Vertical align the method nodes group to the average row of all inputs and outputs nodes in the connected links.

        const allRows = connectedLinks.flatMap(link =>
          [nodeByName[link.input].row, nodeByName[link.output].row]
        );
        const overallAvg = Math.floor(d3.mean(allRows));

        // Compute the average row of the method nodes as currently positioned.
        const methodRows = Object.values(methodRow);
        const currentMethodAvg = Math.floor(d3.mean(methodRows));

        // Calculate the offset to align the method nodes' average to the overall average.
        const offset = overallAvg - currentMethodAvg;

        // Apply the offset to each method row.
        Object.keys(methodRow).forEach(method => {
          methodRow[method] += offset;
        });
        const methodRowMin = Math.min(...Object.values(methodRow));
        if (methodRowMin < 0) {
          Object.keys(methodRow).forEach(method => {
            methodRow[method] -= methodRowMin;
          });
        }



        // Create method nodes.
        const methodNodes = Array.from(linksByMethod.keys()).map(methodName => nodeByName[methodName]);
        const methodNodeGroup = g.selectAll(".methodnode")
          .data(methodNodes)
          .enter()
          .append("g")
          .attr("class", "methodnode")
          .attr("transform", d => `translate(${colX[1]}, ${rowY[methodRow[d.name]]})`);

        // Append the method node rectangle.
        methodNodeGroup.append("rect")
          .attr("width", rectWidth)
          .attr("height", rectHeight)
          .attr("rx", 5)
          .attr("fill", d => colorBySystem(d.system, bgAlpha));

        // Append the method node text.
        methodNodeGroup.append("text")
          .attr("x", rectWidth / 2)
          .attr("y", rectHeight / 2)
          .attr("dy", "0.35em")
          .attr("font-size", "12px")
          .attr("text-anchor", "middle")
          .attr("fill", "black")
          .text(d => d.name)
          .each(function (d) {
            wrapTextWithEllipsis(d3.select(this), rectWidth - 10, 2);
          })


        // --- Outline the method nodes that are associated ---
        g.selectAll(".methodnode")
          .filter(d => associatedNames.has(d.name))
          .select("rect")
          .attr("stroke", "black")
          .attr("stroke-width", strokeWidth / 2)


        // Prepare detailed links: .raise(); input→method and method→output.
        const detailedLinks = [];
        connectedLinks.forEach(linkData => {
          detailedLinks.push([linkData.input, linkData.method]);
          detailedLinks.push([linkData.method, linkData.output]);
        });

        const currentDetailedLinksGroup = g.append("g").attr("class", "detailLinks")
          .attr("transform", `translate(${rectWidth / 2}, ${rectHeight / 2})`);


        currentDetailedLinksGroup.selectAll(".detailedLink")
          .data(Array.from(new Set(detailedLinks))) // Remove duplicates.
          .enter()
          .append("path")
          .attr("class", "detailedLink")
          .attr("d", ([sourceName, targetName]) => {
            const source = nodeByName[sourceName];
            const target = nodeByName[targetName];
            const sourceRow = source.col === 1 ? methodRow[source.name] : source.row;
            const targetRow = target.col === 1 ? methodRow[target.name] : target.row;
            let linkData = [
              { x: colbyIndex[source.col] + rectWidth / 2 + (source.col === 1 ? (strokeWidth / 4) : 0), y: rowbyIndex[sourceRow] },
              { x: colbyIndex[source.col] + wDelta + rectWidth / 2, y: rowbyIndex[sourceRow] },
              { x: colbyIndex[target.col] - wDelta - rectWidth / 2 - (target.col === 1 ? (strokeWidth / 4) : 0), y: rowbyIndex[targetRow] },
              { x: colbyIndex[target.col] - rectWidth / 2 - arrowOffset, y: rowbyIndex[targetRow] }
            ];
            return filletPath(linkData, 10);
          })
          .attr("fill", "none")
          .attr("stroke", d => {
            const source = nodeByName[d[0]];
            const target = nodeByName[d[1]];
            const sourceColor = colorBySystem(source.system, bgAlpha);
            const targetColor = colorBySystem(target.system, bgAlpha);
            return getOrCreateGradient(sourceColor, targetColor, d[0] + d[1]);
          })
          .attr("stroke-width", 6)
          .attr("marker-end", d => {
            const target = nodeByName[d[1]];
            const color = colorBySystem(target.system, bgAlpha);
            return getOrCreateMarker(color);
          })
          .style("opacity", 1)

      }
    })
    .on("mouseout", function (event, d) {
      //remove the text
      textGroup.selectAll(".methodannotation")
        .transition().duration(200)
        .style("opacity", 0);

      // Restore direct links’ opacity.
      directLinkGroup.selectAll(".directLink")
        .transition().duration(200)
        .style("opacity", 1);
      // Remove dynamically created method nodes and detailed links.
      g.selectAll(".methodnode").remove();
      g.selectAll(".detailLinks").remove();
      // Remove outlines from input/output nodes.
      g.selectAll(".node")
        .select(".nodeBackground")
        .attr("stroke", null)
        .attr("stroke-width", null);
    });


  // ---------------------------------------
  // 6) Draw Add Buttons
  // ---------------------------------------
  function getNewNodeText(col) {
    let prefix = col === 0 ? "INPUT" : "OUTPUT";
    let i = 1;
    let item = `${prefix} ${i}`;
    while (iodata.nodes.some(d => d.name === item && d.col === col)) {
      item = `${prefix} ${++i}`;
    }
    return item;
  }

  const addSourceButton = g
    .append("g")
    .attr("id", "addSourceButton")
    .attr("transform", `translate(${colX[0]}, ${maxSourceRow * (rectHeight + rowSpacing)})`)
    .on("click", function () {
      addBackStackEntry();
      iodata.nodes.push({
        name: getNewNodeText(0), // Pass column 0
        col: 0,
        row: maxSourceRow,
        system: "ADAPTIVE REUSE"
      });
      drawDiagram();
    });

  addSourceButton.append("rect")
    .attr("width", rectWidth)
    .attr("height", rectHeight)
    .attr("rx", 5)
    .attr("fill", "#1dbf45")

  addSourceButton.append("text")
    .attr("x", rectWidth / 2)
    .attr("y", rectHeight / 2)
    .attr("dy", "0.35em")
    .attr("font-size", "10px")
    .attr("text-anchor", "middle")
    .attr("fill", "white")
    .text("NEW INPUT")

  const addTargetButton = g
    .append("g")
    .attr("id", "addTargetButton")
    .attr("transform", `translate(${colX[2]}, ${maxTargetRow * (rectHeight + rowSpacing)})`)
    .on("click", function () {
      addBackStackEntry();
      iodata.nodes.push({
        name: getNewNodeText(2), // Pass column 2
        col: 2,
        row: maxTargetRow,
        system: "ADAPTIVE REUSE"
      });
      drawDiagram();
    });

  addTargetButton.append("rect")
    .attr("width", rectWidth)
    .attr("height", rectHeight)
    .attr("rx", 5)
    .attr("fill", "#1dbf45")

  addTargetButton.append("text")
    .attr("x", rectWidth / 2)
    .attr("y", rectHeight / 2)
    .attr("dy", "0.35em")
    .attr("font-size", "10px")
    .attr("text-anchor", "middle")
    .attr("fill", "white")
    .text("NEW OUTPUT")
}


function drawIOHeader(svg, width) {
  // svg is already a d3 selection

  // Create header with auto height initially
  const headerForeignObject = svg.append("foreignObject")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", width)
    .attr("height", 1); // Set to 1 initially, will adjust after measuring

  const headerDiv = headerForeignObject.append("xhtml:div")
    .attr("xmlns", "http://www.w3.org/1999/xhtml")
    .style("width", "100%")
    .style("display", "flex")
    .style("flex-direction", "column")
    .style("font-weight", "300")
    .style("font-family", "Comfortaa, sans-serif")
    .style("font-size", "14px")
    .style("gap", "1rem")
    .style("padding", "1rem 0 0.5rem 0");

  // Add annotation
  headerDiv.append("xhtml:div")
    .attr("class", "annotation")
    .text(`IO Interface ( By ${window.authorname || ''} )`);

  // Add prompt text  
  headerDiv.append("xhtml:div")
    .text(() => {
      if (window.is_generated_text) {
        return `Your text prompt | ${window.env || ''}`;
      } else {
        return `Your image prompt interpreted | ${window.env || ''}`;
      }
    });

  // Add system bar container
  const systemBarDiv = headerDiv.append("xhtml:div")
    .attr("id", "system-bar");

  // Initialize SystemBar
  if (typeof SystemBar !== 'undefined') {
    new SystemBar(systemBarDiv.node());
  }

  // Measure actual height of content
  const actualHeight = headerDiv.node().getBoundingClientRect().height;
  // Add buffer for shadow to render properly
  const finalHeight = actualHeight + 10;

  // Update foreignObject height to match content
  headerForeignObject.attr("height", finalHeight);

  return finalHeight;
}


// function pruneIO(iodata) {
//   let col0Nodes = iodata.nodes.filter(n => n.col === 0);
//   let col1Nodes = iodata.nodes.filter(n => n.col === 1);
//   let col2Nodes = iodata.nodes.filter(n => n.col === 2);
//   let col0NodeNames = col0Nodes.map(n => n.name);
//   let col1NodeNames = col1Nodes.map(n => n.name);
//   let col2NodeNames = col2Nodes.map(n => n.name);

//   let inputLinks = iodata.links.filter(link => col0NodeNames.includes(link[0]) && col1NodeNames.includes(link[1]));
//   let outputLinks = iodata.links.filter(link => col1NodeNames.includes(link[0]) && col2NodeNames.includes(link[1]));
//   let ioLinks = iodata.links.filter(link => col0NodeNames.includes(link[0]) && col2NodeNames.includes(link[1]));
//   //a col1Nodes exist only if there are links between col 0-col1-col2
//   //if not, we can remove col1 nodes and link
//   col1Nodes = col1Nodes.filter(n => {
//     return inputLinks.some(link => link[1] === n.name) && outputLinks.some(link => link[0] === n.name);
//   }
//   );
//   col1NodeNames = col1Nodes.map(n => n.name);

//   //prune inputLinks and outputLinks to only include those with col1NodeNames
//   let prunedInputLinks = inputLinks.filter(link => col1NodeNames.includes(link[1]));
//   let prunedOutputLinks = outputLinks.filter(link => col1NodeNames.includes(link[0]));

//   iodata.nodes = col0Nodes.concat(col1Nodes).concat(col2Nodes);
//   iodata.links = prunedInputLinks.concat(prunedOutputLinks).concat(ioLinks);
// }

// Refit the SVG when the space below the top bar changes, without clearing undo.
(function observeIOViewport() {
  const wrapper = document.getElementById('io-svg-wrapper');
  if (!wrapper || typeof ResizeObserver === 'undefined') return;
  let previousSize = '';
  let frame;
  new ResizeObserver(() => {
    const size = wrapper.clientWidth + ':' + wrapper.clientHeight;
    if (size === previousSize) return;
    previousSize = size;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => drawDiagram());
  }).observe(wrapper);
})();
