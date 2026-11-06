// Shared utility functions for both IO and Metabolism sections
// Helper functions
function escapeSelector(str) {
    return str.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Color system utility with caching
const colorBySystem = (function () {
  const cache = new Map();

  function main(system, alpha = 1, syscolor = window.defaultSystems) {
    const cacheKey = `${system}_${alpha}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    let colorArray = syscolor[system]?.[0];

    if (!colorArray) {
      const fallbackColor = `rgba(210, 210, 210, ${alpha})`;
      cache.set(cacheKey, fallbackColor);
      return fallbackColor;
    }

    if (Array.isArray(colorArray)) {
      colorArray = colorArray[0];
    }

    let result;

    if (typeof colorArray === 'string') {
      if (colorArray.startsWith("#") || colorArray.startsWith("rgba")) {
        result = colorArray;
      } else if (colorArray.startsWith("rgb(")) {
        result = colorArray.replace(/^rgb\((.*)\)$/, `rgba($1, ${alpha})`);
      } else {
        console.error(`Invalid string color definition for system: ${system}`);
        result = `rgba(210, 210, 210, ${alpha})`;
      }
    } else if (Array.isArray(colorArray) && colorArray.length >= 3) {
      result = `rgba(${colorArray[0]}, ${colorArray[1]}, ${colorArray[2]}, ${alpha})`;
    } else {
      console.error(`Unsupported color format for system: ${system}`, colorArray);
      result = `rgba(210, 210, 210, ${alpha})`;
    }

    cache.set(cacheKey, result);
    return result;
  }

  main.clearCache = () => cache.clear();

  return main;
})();


// Validate color using D3
function isValidColor(color) {
  return d3.color(color) !== null;
}

// Wrap text with ellipsis for overflow handling
function wrapTextWithEllipsis(text, width, maxLines = 2) {
  text.each(function () {
    const textEl = d3.select(this);
    const originalY = +textEl.attr("y"); // Ensure it's a number
    const words = textEl.text().split(/\s+/).reverse();
    let word;
    let line = [];
    let lineNumber = 0;
    const lineHeight = 1.2; // in em units
    const x = textEl.attr("x");

    // Clear any existing text content
    textEl.text("");

    // Create the first tspan
    let tspan = textEl.append("tspan")
      .attr("x", x)
      .attr("dy", "0em")
      .text("");

    while ((word = words.pop())) {
      line.push(word);
      tspan.text(line.join(" "));

      // If the current line exceeds the width:
      if (tspan.node().getComputedTextLength() > width) {
        // If we're NOT on the last allowed line, move the word to a new tspan:
        if (lineNumber < maxLines - 1) {
          line.pop(); // Remove the word that caused overflow
          tspan.text(line.join(" "));
          line = [word]; // Start new line with the word
          lineNumber++;
          tspan = textEl.append("tspan")
            .attr("x", x)
            .attr("dy", `${lineHeight}em`)
            .text(word);
        } else {
          // We're on the last allowed line.
          // Remove words until the line (with an ellipsis appended) fits the width.
          while (line.length > 0 && tspan.node().getComputedTextLength() > width) {
            line.pop();
            tspan.text(line.join(" ") + "…");
          }
          // Once ellipsis is appended and fits, exit the loop.
          break;
        }
      }
    }

    // Compute the bounding box of the whole text block.
    const bbox = textEl.node().getBBox();
    // Calculate vertical offset so the text block is centered at the original y.
    const offsetY = originalY - (bbox.y + bbox.height / 2);
    // Apply transform to shift the entire text element.
    textEl.attr("transform", `translate(0, ${offsetY})`);
  });
}


/************************************************************************
 ******** Generate Paths in Metabolism Graphs ******** 
 ************************************************************************/

// Draw Path with Rounded Corners
function filletPath(points, radius = 5) {
  const path = d3.path();
  let prevPoint = points[0];

  path.moveTo(prevPoint.x, prevPoint.y);

  for (let i = 1; i < points.length - 1; i++) {
    const currPoint = points[i];
    const nextPoint = points[i + 1];

    // Calculate direction vectors
    const v1 = { x: currPoint.x - prevPoint.x, y: currPoint.y - prevPoint.y };
    const v2 = { x: nextPoint.x - currPoint.x, y: nextPoint.y - currPoint.y };

    // Normalize vectors
    const v1Length = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const v2Length = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    const v1Norm = { x: v1.x / v1Length, y: v1.y / v1Length };
    const v2Norm = { x: v2.x / v2Length, y: v2.y / v2Length };

    // Find the fillet start and end points
    const start = {
      x: currPoint.x - v1Norm.x * radius,
      y: currPoint.y - v1Norm.y * radius
    };
    const end = {
      x: currPoint.x + v2Norm.x * radius,
      y: currPoint.y + v2Norm.y * radius
    };

    // Draw the straight line segment
    path.lineTo(start.x, start.y);

    // Draw the rounded corner
    path.arcTo(currPoint.x, currPoint.y, end.x, end.y, radius);

    prevPoint = end;
  }

  // Draw final segment
  path.lineTo(points[points.length - 1].x, points[points.length - 1].y);

  return path.toString();
}