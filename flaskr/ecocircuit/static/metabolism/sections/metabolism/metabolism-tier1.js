drawMetabolismDiagram(metabolism, true);
setupToolInterface(); // Initialize toolbar and search functionality
var metabolismBackstack = [];

window.offsetGap = 10;

function addBackStackEntryMetabolism(metabolismData) {
    const clone = JSON.parse(JSON.stringify(metabolismData));
    metabolismBackstack.push(clone);
}

function drawMetabolismDiagram(metabolismData, isFresh = false) {
    if (isFresh) {
        metabolismBackstack = [];
    }
    renderMetabolism({
        metabolism: metabolismData,
        containerSelector: "#matrix-metabolism",
        rectWidth: 180,
        rectHeight: 60,
        rowSpacing: 60,
        colSpacing: 120,
        processSpacing: 120,
        systemSpacing: 150,
        bgAlpha: 0.75,
        isCenterJustified: true,
        scaleMiddleRectCoeff: 1,
        showLoop: true,
        portGap: window.offsetGap,
        laneGap: window.offsetGap,
    });
}

function renderMetabolism({
    metabolism,
    containerSelector,
    syscolor,
    rectWidth,
    rectHeight,
    rowSpacing,
    colSpacing,
    processSpacing,
    systemSpacing,
    bgAlpha,
    isCenterJustified,
    scaleMiddleRectCoeff,
    showLoop,
    portGap,
    laneGap,
}) {
    d3.select("#matrix-metabolism").selectAll("*").remove();

    const margin = { top: 0, right: rectWidth * 3, bottom: 60, left: rectWidth * 3 };

    // ================================================================
    //  0) PREP & DEDUP WITHIN SYSTEMS
    // ================================================================
    const [processGroupByMethodSystem, feedbackLoopByLoopSystem] = preprocessMetabolism(metabolism);

    // Generate noted_links using new encoding scheme - initialize MetabolismNode here
    MetabolismNode.clear();
    generateNotedLinks(processGroupByMethodSystem, feedbackLoopByLoopSystem);
    generateGlobalRow(processGroupByMethodSystem);
    console.log("processGroupByMethodSystem:", processGroupByMethodSystem);
    console.log("feedbackLoopByLoopSystem:", feedbackLoopByLoopSystem);
    const dedupedMetabolismProcess = Array.from(Object.values(processGroupByMethodSystem)).flat();
    window.processGroupByMethodSystem = processGroupByMethodSystem;
    window.feedbackLoopByLoopSystem = feedbackLoopByLoopSystem;
    createNaviBar();
    setupDynamicButtons();
    // ================================================================
    // 1) BASIC LAYOUT VARIABLES
    // ================================================================   
    const maxCol = Math.max(...dedupedMetabolismProcess.flatMap(proc => proc.nodes.map(d => d.col))) + 1;
    const rectWidthByIdx = {};
    for (let i = 0; i < maxCol; i++) {
        rectWidthByIdx[i] = i === 0 || i === maxCol - 1 ? rectWidth : rectWidth * scaleMiddleRectCoeff;
    }
    const rectHeightByIdx = {};
    for (let i = 0; i < maxCol; i++) {
        rectHeightByIdx[i] = i === 0 || i === maxCol - 1 ? rectHeight : rectHeight * scaleMiddleRectCoeff;
    }
    const xCoorByIdx = {};
    for (let i = 0; i < maxCol; i++) {
        xCoorByIdx[i] = i === 0 ? 0 : xCoorByIdx[i - 1] + rectWidthByIdx[i - 1] + colSpacing;
    }

    const nodeScaleX = rectWidth + colSpacing;
    const nodeScaleY = rectHeight + rowSpacing;




    const processHeight = dedupedMetabolismProcess.map(proc => {
        if (!proc.nodes.length) return 0;
        const maxRow = Math.max(...proc.nodes.map(d => d.row)) + 1;
        return maxRow * nodeScaleY + processSpacing;
    });
    const processHeightById = dedupedMetabolismProcess.reduce((acc, proc, i) => {
        acc[proc.id] = processHeight[i];
        return acc;
    }, {});

    const systemOffset = {};
    const systems = Object.keys(processGroupByMethodSystem);
    systems.forEach((system, i) => {
        systemOffset[system] = i * systemSpacing;
    });

    const processOffsetbyId = {};
    Object.entries(processGroupByMethodSystem).forEach(([system, processes]) => {
        processes.forEach((process) => {
            const i = process.id;
            const sumHeightAbove = processHeight.slice(0, i).reduce((a, b) => a + b, 0);
            const sumSystemOffset = systemOffset[system];
            processOffsetbyId[i] = sumHeightAbove + sumSystemOffset;
        });
    });

    const numProcesses = dedupedMetabolismProcess.length;
    const totalWidth = xCoorByIdx[maxCol - 1] + rectWidthByIdx[maxCol - 1];
    window.totalWidth = totalWidth;
    const totalHeight =
        processOffsetbyId[numProcesses - 1] +
        processHeight[numProcesses - 1];

    // ================================================================
    // 2) CREATE SVG & ZOOMABLE CONTAINER
    // ================================================================
    const svg = d3.select(containerSelector)
        .attr("width", totalWidth + margin.left + margin.right)
        .attr("height", totalHeight + margin.top + margin.bottom)
        .attr("viewBox", `0 0 ${totalWidth + margin.left + margin.right} ${totalHeight + margin.top + margin.bottom}`);

    // Make svg globally accessible for utility functions
    window.metabolismSvg = svg;

    // Append a zoomable container group.
    // All elements you want to be zoomable will be children of this group.
    const zoomLayer = svg.append("g")
        .attr("class", "zoom-layer");

    // Append the main group inside zoomLayer with the margin transformation.
    const g = zoomLayer.append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`)
        .attr("class", "main-group");
    const highlightLayer = zoomLayer.append("g")
        .attr("class", "highlight-layer");

    const zoomFitContainer = document.querySelector(containerSelector);
    const containerHeight = zoomFitContainer.clientHeight;
    const containerWidth = zoomFitContainer.clientWidth;

    // calculate scale factor based on height
    const scaleFactor = containerHeight / (totalHeight + margin.top + margin.bottom);

    // Calculate translation to center diagram horizontally after scaling
    const translateX = (containerWidth - (totalWidth + margin.left + margin.right) * scaleFactor) / 2;
    const translateY = 0;  // Align top vertically, adjust if vertical centering desired

    // Initial transform to fit container height
    const initialTransform = d3.zoomIdentity
        .translate(translateX, translateY)
        .scale(scaleFactor);

    // Configure zoom behavior
    zoomBehavior = d3.zoom()
        .scaleExtent([scaleFactor * 0.8, Infinity]) // relative scale range
        .wheelDelta(event => -event.deltaY * 0.001)
        .filter(event => event.type === "wheel" ? event.ctrlKey : true)
        .on("zoom", event => {
            zoomLayer.attr("transform", event.transform);
        });

    // Make zoomBehavior globally accessible
    window.zoomBehavior = zoomBehavior;


    svg.call(zoomBehavior);
    // svg.call(zoomBehavior.transform, initialTransform);
    // Prevent the browser's default zoom behavior when Ctrl+wheel is used.
    svg.node().addEventListener("wheel", function (e) {
        if (e.ctrlKey) e.preventDefault();
    }, { passive: false });


    // Compute the center of the SVG container.
    const center = [svg.attr("width") / 2, svg.attr("height") / 2];

    document.addEventListener("keydown", function (e) {
        if (e.ctrlKey) {
            e.preventDefault();
            if (e.key === "+" || e.key === "=") {
                svg.transition().duration(750).call(zoomBehavior.scaleBy, 1.2, center);
            } else if (e.key === "-") {
                svg.transition().duration(750).call(zoomBehavior.scaleBy, 1 / 1.2, center);
            } else if (e.key === "0") {
                svg.transition().duration(750).call(zoomBehavior.transform, d3.zoomIdentity);
            }
        }
    });


    // ================================================================
    // 3) SET UP DEFINITIONS & MARKERS
    // ================================================================
    let defs = g.select("defs");
    if (defs.empty()) {
        defs = g.append("defs");
    }

    const feedbackGroup = g.append("g")
        .attr("class", "feedback-links")
        .style("display", showLoop ? "block" : "none");

    let fbdefs = feedbackGroup.select("defs");
    if (fbdefs.empty()) {
        fbdefs = feedbackGroup.append("defs");
    }

    const markerByColor = {};
    function getOrCreateMarker(color) {
        const markerId = `arrow-${color.replace(/[^\w-]/g, "")}`;
        if (!markerByColor[color]) {
            markerByColor[color] = markerId;
            defs.append("marker")
                .attr("id", markerId)
                .attr("viewBox", "0 0 10 10")
                .attr("refX", 9)                 // adjusted for larger marker
                .attr("refY", 5)
                .attr("markerWidth", 14)          // slightly smaller size
                .attr("markerHeight", 14)         // slightly smaller size
                .attr("markerUnits", "userSpaceOnUse")
                .attr("orient", "auto")
                .append("path")
                .attr("d", "M 0 0 L 9 5 L 0 9 z")
                .attr("fill", color);
        }
        return `url(#${markerId})`;
    }

    const feedbackMarkerByColor = {};
    function getOrCreateFeedbackMarker(color) {
        const sanitizedColor = color.replace(/[^a-zA-Z0-9-_]/g, "_");
        const markerId = `feedback-${sanitizedColor}`;
        if (!feedbackMarkerByColor[color]) {
            feedbackMarkerByColor[color] = markerId;
            fbdefs.append("marker")
                .attr("id", markerId)
                .attr("viewBox", "0 0 10 10")
                .attr("refX", 9)                  // adjusted for larger feedback marker
                .attr("refY", 5)
                .attr("markerWidth", 14)           // slightly smaller size
                .attr("markerHeight", 14)          // slightly smaller size
                .attr("markerUnits", "userSpaceOnUse")
                .attr("orient", "auto")
                .append("path")
                .attr("d", "M 0 0 L 10 5 L 0 10 z")
                .attr("fill", color);
        }
        return `url(#${feedbackMarkerByColor[color]})`;
    }

    function createWhiteHaloFilter(defsSelection, filterId = "white-halo", radius = 1.5) {
        const filter = defsSelection.append("filter")
            .attr("id", filterId)
            .attr("filterUnits", "userSpaceOnUse");

        filter.append("feMorphology")
            .attr("in", "SourceGraphic")
            .attr("operator", "dilate")
            .attr("radius", radius)
            .attr("result", "halo");

        filter.append("feComposite")
            .attr("in", "halo")
            .attr("in2", "SourceGraphic")
            .attr("operator", "xor")
            .attr("result", "halo-xor");

        filter.append("feFlood")
            .attr("flood-color", "white")
            .attr("flood-opacity", "1")
            .attr("result", "color");

        filter.append("feComposite")
            .attr("in", "color")
            .attr("in2", "halo-xor")
            .attr("operator", "in")
            .attr("result", "halo-colored");

        filter.append("feComposite")
            .attr("in", "SourceGraphic")
            .attr("in2", "halo-colored")
            .attr("operator", "over");
    }

    // Usage with your existing `defs` and `fbdefs` selections:
    createWhiteHaloFilter(defs, "white-halo", 1);
    createWhiteHaloFilter(fbdefs, "feedback-white-halo", 3); // if you need a separate one for feedback paths


    // Restore node position lookup for compatibility
    const nodePositionLookup = {};
    const nodePositionLookUpBySystemGroup = {};
    const yCoorByIdx = {}; // Map global row index to Y coordinate

    function computeNodePosition(nodeName, processId, x, y, isSource = false, isTarget = false, col, row) {
        return { x, y, isSource, isTarget, col, row, nodeName };
    }

    Object.entries(processGroupByMethodSystem).forEach(([system, processes]) => {
        processes.forEach((process, processIdx) => {
            const i = process.id;
            const srcName = process.source;
            const tgtName = process.target;
            const maxLocalCol = Math.max(...process.nodes.map(d => d.col));
            const pad = isCenterJustified ? (maxCol - 1 - maxLocalCol) : 0;

            const hasConflict = process.nodes.some(n => n.col === 0 && n.name !== srcName);
            process.nodes.forEach(node => {
                let nodeOriginalCol = node.col;
                if (isCenterJustified && pad > 0) {
                    node.col += Math.floor(pad / 2);
                }
                if (node.name === srcName && !hasConflict) {
                    node.col = 0;
                } else if (node.name === tgtName) {
                    node.col = maxCol - 1;
                }

                const y = node.row * nodeScaleY;
                const absX = xCoorByIdx[node.col];
                const absY = y + processOffsetbyId[i] + rowSpacing + processSpacing + rectHeight / 2 - rectHeightByIdx[node.col] / 2;

                if (!nodePositionLookup[node.name]) {
                    nodePositionLookup[node.name] = {};
                }
                if (!nodePositionLookUpBySystemGroup[node.name]) {
                    nodePositionLookUpBySystemGroup[node.name] = {};
                }
                const nodePosition = computeNodePosition(node.name, i, absX, absY, node.name === srcName, node.name === tgtName, nodeOriginalCol, node.row);
                nodePositionLookup[node.name][i] = nodePosition;
                nodePositionLookUpBySystemGroup[node.name][system] = nodePosition;

                // Store in simplified MetabolismNode class with global row/col
                const nodeKey = `${node.name}-${process.method.name}-${system}`;

                // Store Y coordinate for this global row
                yCoorByIdx[node.globalRow] = absY;

                MetabolismNode.set(nodeKey, {
                    x: absX,
                    y: absY,
                    globalCol: node.col,  // This is already the global column after adjustment
                    globalRow: node.globalRow,
                    col: nodeOriginalCol,  // Store original column too if needed
                    row: node.row          // Store local row too
                });
            });
        });
    });
    // console.log("yCoorByIdx", yCoorByIdx);
    // Simplified connection type lookup using noted_links
    const conTypeEntriesByRowCol = {};

    // Flatten noted_links from processGroupByMethodSystem and feedbackLoopByLoopSystem
    const processNotedLinks = Object.values(processGroupByMethodSystem)
        .flatMap(processes => processes.flatMap(process => process.noted_links || []));
    const feedbackNotedLinks = Object.values(feedbackLoopByLoopSystem)
        .flatMap(feedbackLoops => feedbackLoops.flatMap(loop => loop.noted_links || []));
    const allNotedLinks = [...processNotedLinks, ...feedbackNotedLinks];
    console.log("feedbackNotedLinks", feedbackNotedLinks);
    allNotedLinks.forEach(link => {
        if (link && link[0] && link[1]) {
            conTypeEntriesByRowCol[`${link[0]}|||${link[1]}`] = connectorTypeByGlobalRowCol(link);
        }
    });

    console.log("conTypeEntriesByRowCol", conTypeEntriesByRowCol);


    // ================================================================
    // 5) DRAW THE DIAGRAM
    // ================================================================
    // Append the overlay to the zoomLayer so it scales with the diagram.
    window.feedbackOverlay = zoomLayer.append("rect")
        .attr("class", "feedback-overlay")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", totalWidth + margin.left + margin.right)
        .attr("height", totalHeight + margin.top + margin.bottom)
        .attr("fill", "white")
        .attr("opacity", 0)
        .style("pointer-events", "none");

    // Append title group to zoomLayer.
    const titleGroup = zoomLayer.append("g")
        .attr("class", "title-group")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    Object.entries(processGroupByMethodSystem).forEach(([system, processes]) => {
        const systemGroup = g.append("g")
            .attr("class", "system-group");
        const systemText = titleGroup.append("text")
            .attr("class", "system-title")
            .attr("x", nodeScaleX)
            .attr("y", processOffsetbyId[processes[0].id] + 50)
            .attr("text-anchor", "left")
            .attr("font-size", "42px")
            .attr("font-weight", "bold")
            .text("POTENTIAL " + system.toUpperCase() + " METHODS ...")
            .attr("fill", colorBySystem(system, bgAlpha))
            .attr("stroke", colorBySystem(system, bgAlpha))
            .attr("stroke-width", "1px")
            .attr("paint-order", "stroke")

        // Add background rectangle behind system title
        const systemBBox = systemText.node().getBBox();
        // Add extra width to ensure "..." is fully covered
        const extraWidth = 90; // Extra padding to cover the ellipsis
        titleGroup.insert("rect", "text.system-title")
            .attr("x", systemBBox.x - 15)
            .attr("y", systemBBox.y - 5)
            .attr("width", systemBBox.width + extraWidth)  // Increased padding to fully cover "..."
            .attr("height", systemBBox.height + 10)
            .attr("fill", "white")
            .attr("fill-opacity", 0.75)
            .attr("rx", 5)
            .attr("ry", 5);

        systemGroup.append("rect")
            .attr("x", nodeScaleX)
            .attr("y", processOffsetbyId[processes[0].id])
            .attr("width", totalWidth - 2 * nodeScaleX)
            .attr("height", () => processes.reduce((sum, process) => sum + processHeightById[process.id], 0))
            .attr("fill", 'none')
            .attr("rx", 100)
            .attr("ry", 100);

        processes.forEach((process) => {
            const i = process.id;
            if (!process.nodes.length) return;
            // if (!process.method || !process.method.name) return;
            const processGroup = systemGroup.append("g")
                .attr("class", "process-group")
                .attr("id", "process-group-" + i);

            const squareSize = 24;
            const gap = 24;

            // Calculate maximum width for text (leaving space for buttons and padding)
            const maxTextWidth = totalWidth / 2 - (2 * squareSize) - (2 * gap) - 160; // 80px total padding

            const textEl = titleGroup.append("text")
                .attr("class", "process-title")
                .attr("x", totalWidth / 2)
                .attr("y", processOffsetbyId[i] + processSpacing - 9)
                .attr("text-anchor", "middle")
                .attr("font-size", "28px")
                .style("cursor", "default")
                .text(process.method.name.toUpperCase())
                .attr("fill", "#93969A");

            // Apply text wrapping if needed
            wrapTextWithEllipsis(textEl, maxTextWidth, 2);

            // Get bounding box after text wrapping
            const bbox = textEl.node().getBBox();
            // Calculate the left edge of the centered text
            const textLeftEdge = (totalWidth / 2) - (bbox.width / 2);
            // Position elements at fixed distance from text left edge
            const squareX = textLeftEdge - gap - squareSize;
            const circleX = squareX - squareSize;

            // For vertical positioning, align with the vertical center of the first line
            // When text wraps, we want buttons aligned with first line, not the entire text block
            const buttonY = processOffsetbyId[i] + processSpacing - 9; // Original y position of text

            titleGroup.insert("rect", "text.process-title")
                .attr("x", circleX - squareSize / 2 - 10)
                .attr("y", bbox.y - 5)
                .attr("width", bbox.width + squareSize * 2 + gap * 2 + 20)
                .attr("height", bbox.height + 10)
                .attr("fill", "white")
                .attr("fill-opacity", 0.6)
                .attr("rx", 5)
                .attr("ry", 5);

            titleGroup.append("rect")
                .attr("class", "process-title")
                .attr("x", squareX)
                .attr("y", buttonY - (squareSize / 2) - 2)
                .attr("width", squareSize)
                .attr("height", squareSize)
                .attr("fill", colorBySystem(process.method.system, bgAlpha));

            // Add (-) button for process group
            titleGroup.append("circle")
                .attr("class", "process-title")
                .attr("cx", circleX)
                .attr("cy", buttonY)
                .attr("r", squareSize / 2)
                .attr("fill", "#93969A")
                .style("cursor", "pointer")
                .on("click", function (event) {
                    event.stopPropagation();
                    removeProcess(process.id, metabolism, window.iodata);
                    drawMetabolismDiagram(metabolism);
                    drawDiagram();
                });

            titleGroup.append("text")
                .attr("class", "process-title")
                .attr("x", circleX)
                .attr("y", buttonY)
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .attr("font-size", "24px")
                .attr("fill", "white")
                .text("-")
                .attr("pointer-events", "none");

            const nodeGroup = processGroup.selectAll("g.node")
                .data(process.nodes.map(d => {
                    const nodeKey = `${d.name}-${process.method.name}-${system}`;
                    const metabolismNode = MetabolismNode.get(nodeKey);
                    return {
                        ...d,
                        metabolismNode: metabolismNode,
                        x: metabolismNode.x,
                        y: metabolismNode.y
                    };
                }))
                .enter()
                .append("g")
                .attr("class", "node")
                .attr("id", d => `node-${escapeSelector(`${d.name}-${process.method.name}-${system}`)}`);

            nodeGroup.append("rect")
                .attr("x", d => d.x)
                .attr("y", d => d.y)
                .attr("width", d => rectWidthByIdx[d.metabolismNode.globalCol])
                .attr("height", d => (d.metabolismNode.globalCol === 0 || d.metabolismNode.globalCol === maxCol - 1)
                    ? rectHeight
                    : rectHeight * scaleMiddleRectCoeff)
                .attr("fill", d => colorBySystem(d.system, 1))
                .attr("rx", 5)
                .attr("fill-opacity", d => {
                    const op = d.metabolismNode.globalCol === 0 ? bgAlpha : d.metabolismNode.globalCol === maxCol - 1 ? bgAlpha : 0.2;
                    d.originalOpacity = op;
                    return op;
                })
                .style("pointer-events", "none");



            nodeGroup.append("text")
                .attr("x", d => d.x + rectWidthByIdx[d.metabolismNode.globalCol] / 2)
                .attr("y", d => d.y + rectHeightByIdx[d.metabolismNode.globalCol] / 2)
                .attr("dy", "0.35em")
                .attr("font-size", "14px")
                .attr("font-weight", "bold")
                .attr("text-anchor", "middle")
                .style("pointer-events", "none")
                .text(d => d.name)
                .each(function (d) {
                    const maxWidth = d.metabolismNode.globalCol === maxCol - 1 ? rectWidth - 10 : rectWidth * scaleMiddleRectCoeff - 10;
                    wrapTextWithEllipsis(d3.select(this), maxWidth, 3);
                });

            // Simplified node occurrence tracking
            nodeGroup.each(function (d) {
                // Find all nodes with the same name
                const allOccurrences = d3.selectAll(".node").filter(function (nodeData) {
                    return nodeData && nodeData.name === d.name;
                }).nodes();

                const occurrenceCount = allOccurrences.length;
                const currentIdx = allOccurrences.indexOf(this);

                if (occurrenceCount > 1) {
                    // Add occurrence indicator as text label
                    d3.select(this)
                        .append("text")
                        .attr("x", d.x + rectWidthByIdx[d.metabolismNode.globalCol] - 16)
                        .attr("y", d.y + rectHeightByIdx[d.metabolismNode.globalCol] - 5)
                        .attr("dy", "0.35em")
                        .attr("text-anchor", "middle")
                        .attr("font-weight", "600")
                        .attr("font-size", "11px")
                        .attr("fill", "#555")
                        .style("cursor", "pointer")
                        .text(`(${currentIdx + 1}/${occurrenceCount})`)
                        .on("mouseenter", () => {
                            wikiTooltip.style("opacity", 1)
                                .html(`Occurrence <strong>${currentIdx + 1}</strong> of <strong>${occurrenceCount}</strong><br>Click to navigate to next`);
                        })
                        .on("mousemove", moveWikiTooltip)
                        .on("mouseleave", hideWikiTooltip)
                        .on("click", function (event) {
                            event.stopPropagation();
                            // Navigate to next occurrence
                            removeHighlight();
                            allOccurrences.forEach(node => highlightElement(node));

                            const nextIdx = (currentIdx + 1) % occurrenceCount;
                            scrollToElement(allOccurrences[nextIdx]);
                        });
                }
            });


        });


    });

    // ================================================================
    // BUILD OVERLAP MAPS AND CALCULATE ADJUSTMENTS FIRST
    // ================================================================

    // Build overlap maps for all links
    const overlapMaps = buildOverlapMapsOnly(allNotedLinks, conTypeEntriesByRowCol, {
        rectWidthByIdx,
        rectHeightByIdx,
        colSpacing,
        rowSpacing,
        xCoorByIdx
    });

    // Calculate offsets from overlap maps
    const allAdjustments = calculateOffsets(overlapMaps, {
        portGap,
        laneGap
    }, conTypeEntriesByRowCol);

    // Store for debugging
    window.overlapMaps = overlapMaps;
    window.allAdjustments = allAdjustments;
    console.log("Overlap maps built:", overlapMaps);
    console.log("Adjustments calculated:", allAdjustments);

    // ================================================================
    // UNIFIED LINK DRAWING - Draw all links with adjustments applied
    // ================================================================
    const allLinksGroup = g.append("g")
        .attr("class", "all-links");

    allLinksGroup.selectAll("path.link")
        .data(allNotedLinks)
        .enter()
        .append("path")
        .attr("class", "link")
        .attr("data-link-key", d => `${d[0]}|||${d[1]}`) // Key for later styling
        .attr("data-con-type", d => conTypeEntriesByRowCol[`${d[0]}|||${d[1]}`]) // Store connector type
        .attr("fill", "none")
        .attr("stroke-width", 1)
        .attr("stroke", "black")
        .attr("marker-end", function () {
            return getOrCreateMarker("black");
        })
        .style("filter", "url(#white-halo)")
        .attr("d", link => {
            const conType = conTypeEntriesByRowCol[`${link[0]}|||${link[1]}`];
            return computeCurvePathsFromKeys(link[0], link[1], conType, {
                rectWidthByIdx, rectHeightByIdx, colSpacing, rowSpacing, xCoorByIdx
            }, allAdjustments);  // Pass adjustments with linkId-based lookup
        });

    // Show debug visualizations
    if (typeof showDebugger !== 'undefined') {
        showDebugger();
    }




    // Moved to metabolism-util.js as selectedLoop

    // Append feedback title group inside zoomLayer.
    // Use the same transform as main-group
    const feedbackTitleGroup = zoomLayer.append("g")
        .attr("class", "feedback-title-group")
        .style("display", showLoop ? "block" : "none");

    // Use feedbackLoopByLoopSystem from preprocessing
    const feedbackLinks = Object.values(feedbackLoopByLoopSystem).flat();
    const radius = 12;
    const gap = 8;
    const feedbackTitleX = radius + rectWidth / 4;

    const occupiedRows = new Set();  // Tracks occupied rows for titles

    feedbackLinks.forEach(link => {
        if (!systems.includes(link.system)) return;

        // Collect feedback loop nodes and find min/max rows
        const loopNodes = new Set(link.noted_links.flat());
        let minGlobalRow = Infinity;
        let maxGlobalRow = -Infinity;

        loopNodes.forEach(nodeKey => {
            const nodePos = MetabolismNode.get(nodeKey);
            if (nodePos) {
                minGlobalRow = Math.min(minGlobalRow, nodePos.globalRow);
                maxGlobalRow = Math.max(maxGlobalRow, nodePos.globalRow);
            }
        });

        if (minGlobalRow === Infinity) return; // No valid nodes found

        // Find an available row within the feedback loop's span
        let feedbackRow = minGlobalRow;
        // Try to find an unoccupied row within the loop's range
        for (let row = minGlobalRow; row <= maxGlobalRow; row++) {
            if (!occupiedRows.has(row)) {
                feedbackRow = row;
                break;
            }
        }

        // If no row available within range, find next available after maxRow
        if (occupiedRows.has(feedbackRow)) {
            while (occupiedRows.has(feedbackRow)) {
                feedbackRow += 2;
            }
        }

        occupiedRows.add(feedbackRow); // mark row as occupied
        // Get Y coordinate from the map, or interpolate if row doesn't exist in map
        const feedbackTitleY = yCoorByIdx[feedbackRow] + rectHeight / 2;


        // Update feedback link styling using the unified links
        const feedbackColor = colorBySystem(link.system, bgAlpha);
        link.noted_links.forEach(linkData => {
            const linkKey = `${linkData[0]}|||${linkData[1]}`;
            allLinksGroup.select(`[data-link-key="${linkKey}"]`)
                .attr("stroke-width", 5)
                .attr("stroke", feedbackColor)
                .attr("stroke-linecap", "round")
                .attr("marker-end", getOrCreateFeedbackMarker(feedbackColor))
                .style("filter", "url(#feedback-white-halo)");
        });

        // linkGroup removed - now passing feedback data directly to handlers


        // Draw feedback title and circle at resolved Y-position
        const feedbackTitleItem = feedbackTitleGroup.append("g")
            .attr("class", "feedback-title-item")
            .attr("data-loop", link.name)
            .style("cursor", "pointer")
            .on("mouseenter", () => {
                handleFeedbackHover(true, {
                    name: link.name,
                    notedLinks: link.noted_links,
                    nodes: loopNodes,
                    color: feedbackColor,
                    system: link.system
                });
            })
            .on("mouseleave", () => {
                handleFeedbackHover(false, {
                    name: link.name,
                    notedLinks: link.noted_links,
                    nodes: loopNodes,
                    color: feedbackColor,
                    system: link.system
                });
            });

        feedbackTitleItem.append("circle")
            .attr("cx", feedbackTitleX + radius)
            .attr("cy", feedbackTitleY - 2)
            .attr("r", radius)
            .attr("fill", feedbackColor)
            .style("cursor", "pointer")
            .on("click", event => toggleFeedbackLoop(event, {
                name: link.name,
                notedLinks: link.noted_links,
                nodes: loopNodes,
                color: feedbackColor,
                system: link.system
            }));

        feedbackTitleItem.append("text")
            .attr("class", "feedback-loop-title")
            .attr("x", feedbackTitleX + radius * 2 + gap)
            .attr("y", feedbackTitleY)
            .attr("dominant-baseline", "middle")
            .attr("text-anchor", "start")
            .attr("font-size", "28px")
            .attr("font-weight", "bold")
            .text(link.name.toUpperCase())
            .each(function () {
                wrapTextWithEllipsis(d3.select(this), rectWidth * 2, 3);
            })
            .attr("fill", "#93969A")
            .style("cursor", "default");

        const buttonX = feedbackTitleX - 20;  // Adjust as needed to position button nicely
        const buttonY = feedbackTitleY - 2;

        // Add (-) button for feedback loop removal
        feedbackTitleItem.append("circle")
            .attr("cx", buttonX)
            .attr("cy", buttonY)
            .attr("r", radius)
            .attr("fill", "#93969A")
            .style("cursor", "pointer")
            .on("click", function (event) {
                event.stopPropagation();
                removeFeedbackLoop(link.name, metabolism);
                drawMetabolismDiagram(metabolism);
                drawDiagram();
            });

        feedbackTitleItem.append("text")
            .attr("x", buttonX)
            .attr("y", buttonY + 4)  // Vertical centering adjustment
            .attr("text-anchor", "middle")
            .attr("font-size", "16px")
            .attr("fill", "white")
            .attr("pointer-events", "none")
            .text("-");
    });

    //lower .all-links layer
    svg.select(".all-links").lower();

}

window.highlightElement = function (svgElement) {
    resetLayers();
    const bbox = svgElement.getBBox();
    const mainGroupTransform = d3.select("#matrix-metabolism .main-group").attr("transform");
    const transformMatch = /translate\(([^,]+),\s*([^)]+)\)/.exec(mainGroupTransform);
    const offsetX = transformMatch ? parseFloat(transformMatch[1]) : 0;
    const offsetY = transformMatch ? parseFloat(transformMatch[2]) : 0;
    const highlightLayer = d3.select("#matrix-metabolism .highlight-layer");
    highlightLayer.append("rect")
        .attr("class", "highlight-rect")
        .attr("x", bbox.x + offsetX - 10)
        .attr("y", bbox.y + offsetY - 10)
        .attr("width", bbox.width + 20)
        .attr("height", bbox.height + 20)
        .attr("fill", "none")
        .attr("stroke", 'rgba(0, 0, 0, 0.85)')
        .attr("stroke-width", 10)
        .attr("rx", 12)
        .attr("ry", 12);

    highlightLayer.raise();
};

window.highlightProcess = function (processName) {
    resetLayers();
    removeHighlight();

    // Find the text element first (from process title)
    const titleElements = document.querySelectorAll(".title-group .process-title");
    let targetProcessGroupId = null;

    titleElements.forEach(titleEl => {
        // Handle wrapped text by joining tspan elements
        const tspans = titleEl.querySelectorAll('tspan');
        const actualText = tspans.length > 0
            ? Array.from(tspans).map(t => t.textContent).join(' ').trim()
            : titleEl.textContent.trim();

        if (actualText.toLowerCase() === processName.trim().toLowerCase()) {
            // Extract Y position to match process group
            const titleBBox = titleEl.getBBox();
            const titleY = titleBBox.y;

            // Identify the process-group closest vertically to this title
            const processGroups = Array.from(document.querySelectorAll(".process-group"));
            let minDist = Infinity;

            processGroups.forEach(group => {
                const groupBBox = group.getBBox();
                const dist = Math.abs(groupBBox.y - titleY);
                if (dist < minDist) {
                    minDist = dist;
                    targetProcessGroupId = group.id;
                }
            });
        }
    });

    if (!targetProcessGroupId) {
        console.warn("Process not found:", processName);
        return;
    }

    // Use D3 to select the entire process group
    const targetGroup = d3.select(`#${targetProcessGroupId}`);

    if (targetGroup.empty()) {
        console.error("Target process group not found:", targetProcessGroupId);
        return;
    }

    // Get bounding box of entire process group
    const bbox = targetGroup.node().getBBox();

    // Adjust bbox with main-group's offset
    const mainGroupTransform = d3.select("#matrix-metabolism .main-group").attr("transform");
    const transformMatch = /translate\(([^,]+),\s*([^)]+)\)/.exec(mainGroupTransform);
    const offsetX = transformMatch ? parseFloat(transformMatch[1]) : 0;
    const offsetY = transformMatch ? parseFloat(transformMatch[2]) : 0;
    const highlightLayer = d3.select("#matrix-metabolism .highlight-layer");
    // Add highlight rectangle to highlight-layer
    highlightLayer
        .append("rect")
        .attr("class", "highlight-process-rect")
        .attr("x", 0 + offsetX - 20)
        .attr("y", bbox.y + offsetY - 100)
        .attr("width", window.totalWidth + 40)
        .attr("height", bbox.height + 120)
        .attr("fill", "none")
        .attr("stroke", 'rgba(0, 0, 0, 0.85)')
        .attr("stroke-width", 10)
        .attr("rx", 12)
        .attr("ry", 12);

    highlightLayer.raise();
};

window.removeHighlight = function () {
    d3.select("#matrix-metabolism .highlight-layer").selectAll("*").remove();
};

document.addEventListener('click', function (event) {
    const highlightLayer = document.querySelector('#matrix-metabolism .highlight-layer');
    if (!highlightLayer) return;

    if (!highlightLayer.contains(event.target)) {
        removeHighlight();
    }
});

window.scrollToElement = function (svgElement) {
    const svgWrapper = document.getElementById("metabolism-svg-wrapper");
    const svg = document.getElementById("matrix-metabolism");
    const bbox = svgElement.getBBox();

    const svgViewBoxHeight = svg.viewBox.baseVal.height || svg.clientHeight;
    const scaleY = svg.clientHeight / svgViewBoxHeight;

    const targetY = bbox.y * scaleY;
    const wrapperHeight = svgWrapper.clientHeight;
    const targetScrollTop = targetY - (wrapperHeight / 2) + (bbox.height * scaleY / 2);

    svgWrapper.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
    });
}


const wikiTooltip = d3.select("#wiki-tooltip");

function moveWikiTooltip(event) {
    const parent = wikiTooltip.node().offsetParent; // the parent with relative position
    const parentRect = parent.getBoundingClientRect();

    const x = event.clientX - parentRect.left + parent.scrollLeft;
    const y = event.clientY - parentRect.top + parent.scrollTop;

    wikiTooltip
        .style("left", `${x + 12}px`)
        .style("top", `${y + 12}px`);
}

function hideWikiTooltip() {
    wikiTooltip.style("opacity", 0);
}



