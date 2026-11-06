// Metabolism Debugger - Debug visualization tools for metabolism diagrams

function showDebugger() {
    // Debug flag for showing connector types
    const showConnectorTypeDebug = true;

    if (!showConnectorTypeDebug) return;

    // Find the main SVG and groups
    const svg = d3.select("#matrix-metabolism svg");
    const g = svg.select("g");
    const allLinksGroup = g.select(".all-links");
    
    // Get connector type mappings from the links data
    const conTypeEntriesByRowCol = {};
    allLinksGroup.selectAll("path.link").each(function() {
        const linkKey = d3.select(this).attr("data-link-key");
        // Infer connector type from path characteristics if needed
        // For now, we'll store it as data on the element
        const linkData = d3.select(this).datum();
        if (linkData && linkData.conType) {
            conTypeEntriesByRowCol[linkKey] = linkData.conType;
        }
    });

    // Debug annotations for connector types
    const debugGroup = g.append("g")
        .attr("class", "debug-connector-types");
    
    // Iterate through all rendered paths
    allLinksGroup.selectAll("path.link").each(function() {
        const pathElement = d3.select(this);
        const linkKey = pathElement.attr("data-link-key");
        const conType = conTypeEntriesByRowCol[linkKey] || pathElement.attr("data-con-type");
        
        // Skip if no valid path data
        if (!this.getTotalLength || this.getTotalLength() === 0) {
            console.warn(`Skipping empty path for link: ${linkKey}`);
            return;
        }
        
        // Get the actual path's midpoint
        const pathLength = this.getTotalLength();
        const midpoint = this.getPointAtLength(pathLength / 2);
        
        // Create simple label
        let label = conType;
        // Convert to short names for readability
        if (typeof ConnectorType !== 'undefined') {
            switch(Number(conType)) {
                case ConnectorType.VERTICAL_DIRECT: label = "V_DIR"; break;
                case ConnectorType.HORIZONTAL_DIRECT: label = "H_DIR"; break;
                case ConnectorType.VERTICAL_LONGPATH: label = "V_LONG"; break;
                case ConnectorType.TILTED_LONGPATH: label = "T_LONG"; break;
                case ConnectorType.TILTED_VERYLONGPATH: label = "T_VLONG"; break;
                default: label = "?";
            }
        }
        
        // Add debug label at the path's true midpoint
        debugGroup.append("text")
            .attr("class", "debug-label")
            .attr("fill", "red")
            .attr("font-size", "10px")
            .attr("font-weight", "bold")
            .attr("text-anchor", "middle")
            .attr("pointer-events", "none")
            .attr("x", midpoint.x)
            .attr("y", midpoint.y - 5)
            .text(label);
    });
}