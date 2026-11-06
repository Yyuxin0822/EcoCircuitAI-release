window.offsetGap = 10;

// Link type generator
const ConnectorType = {
  VERTICAL_DIRECT: 1,
  VERTICAL_LONGPATH: 2,

  HORIZONTAL_DIRECT: 3,
  HORIZONTAL_LONGPATH: 4,

  TILTED_LONGPATH: 5,
  TILTED_VERYLONGPATH: 9,
};

// Improved connector type determination using MetabolismNode with proper source/target logic
function connectorTypeByGlobalRowCol([key1, key2], tolerance = 1e-6) {
  const node1 = MetabolismNode.get(key1);
  const node2 = MetabolismNode.get(key2);

  if (!node1 || !node2) return ConnectorType.VERTICAL_DIRECT;

  const xDiff = Math.abs(node1.globalCol - node2.globalCol);
  const yDiff = Math.abs(node1.globalRow - node2.globalRow);

  // Determine which columns are first/last (source/target columns)
  // Get all nodes to find the maximum column
  const allNodes = Array.from(MetabolismNode.values());
  const maxCol = Math.max(...allNodes.map(n => n.globalCol));

  // Check if nodes are source (column 0) or target (last column) nodes
  const isNode1Source = node1.globalCol === 0;
  const isNode1Target = node1.globalCol === maxCol;
  const isNode2Source = node2.globalCol === 0;
  const isNode2Target = node2.globalCol === maxCol;

  // Special cases: both source nodes or both target nodes
  if (isNode1Source && isNode2Source) {
    return ConnectorType.VERTICAL_LONGPATH;
  }
  if (isNode1Target && isNode2Target) {
    return ConnectorType.VERTICAL_LONGPATH;
  }

  // Source node logic (one of the nodes is in column 0)
  if (isNode1Source || isNode2Source) {
    const sourceNode = isNode1Source ? node1 : node2;
    const otherNode = isNode1Source ? node2 : node1;

    // Check if there are nodes in between
    const hasIntermediateNodes = Array.from(MetabolismNode.values()).some(node => {
      // Check nodes in columns between source and other node, at same row as other node
      return node.globalCol > 0 &&
        node.globalCol < otherNode.globalCol &&
        Math.abs(node.globalRow - otherNode.globalRow) <= tolerance;
    });

    if (!hasIntermediateNodes) {
      return yDiff <= tolerance ? ConnectorType.HORIZONTAL_DIRECT : ConnectorType.TILTED_LONGPATH;
    }
    // If there are intermediate nodes, use longer paths
    return ConnectorType.TILTED_VERYLONGPATH;
  }

  // Target node logic (one of the nodes is in last column)
  if (isNode1Target || isNode2Target) {
    const targetNode = isNode1Target ? node1 : node2;
    const otherNode = isNode1Target ? node2 : node1;

    // Check if there are nodes in between
    const hasIntermediateNodes = Array.from(MetabolismNode.values()).some(node => {
      // Check nodes in columns between other node and target, at same row as other node
      return node.globalCol > otherNode.globalCol &&
        node.globalCol < maxCol &&
        Math.abs(node.globalRow - otherNode.globalRow) <= tolerance;
    });

    if (!hasIntermediateNodes) {
      return yDiff <= tolerance ? ConnectorType.HORIZONTAL_DIRECT : ConnectorType.TILTED_LONGPATH;
    }
    if (yDiff <= tolerance) {
      // Same row but far apart columns - use special long path
      return ConnectorType.HORIZONTAL_LONGPATH; // test horizontal_longpath for now
    } else {
      // console.log("assigning tilted_VERYLONGPATH for key111:", key1, key2);
      // Different rows and far apart columns
      return ConnectorType.TILTED_VERYLONGPATH;
    }
  }

  // Standard cases for middle nodes (neither source nor target)
  if (xDiff <= tolerance) { // Nodes are in same column
    if (Math.abs(yDiff - 1) <= tolerance) {
      return ConnectorType.VERTICAL_DIRECT;  // Vertically adjacent
    } else {
      return ConnectorType.VERTICAL_LONGPATH; // Same column, not adjacent
    }
  }

  if (Math.abs(xDiff - 1) <= tolerance) { // Nodes are in adjacent columns
    if (yDiff <= tolerance) {
      return ConnectorType.HORIZONTAL_DIRECT; // Same row
    } else {
      return ConnectorType.TILTED_LONGPATH;   // Different rows
    }
  }

  // Far apart nodes (more than 1 column apart)
  if (xDiff > 1) {
    if (yDiff <= tolerance) {
      // console.log("Horizontal long path");
      // console.log(key1,key2);
      // Same row but far apart columns - use special long path
      return ConnectorType.HORIZONTAL_LONGPATH; // test horizontal_longpath for now
    } else {
      // console.log("assigning tilted_VERYLONGPATH for key222:", key1, key2);
      // Different rows and far apart columns
      return ConnectorType.TILTED_VERYLONGPATH;
    }
  }

  // Default fallback
  return ConnectorType.VERTICAL_DIRECT;
}

// Small geometry helpers for ports-based routing
function getNodeMetrics(node, rectWidthByIdx, rectHeightByIdx) {
  const col = node.globalCol;
  const w = rectWidthByIdx[col];
  const h = rectHeightByIdx[col];
  const cx = node.x + w / 2;
  const cy = node.y + h / 2;
  return { col, w, h, cx, cy };
}

// Build common ports on a node.
// Ports: upper_right, upper_left, bottom_right, bottom_left, up, bottom
function buildPorts({ cx, cy, w, h }, k = window.offsetGap / 2) {
  return {
    upper_right: { x: cx + w / 2, y: cy - k },
    upper_left: { x: cx - w / 2, y: cy - k },
    bottom_right: { x: cx + w / 2, y: cy + k },
    bottom_left: { x: cx - w / 2, y: cy + k },
    up: { x: cx, y: cy - h / 2 },
    bottom: { x: cx, y: cy + h / 2 },
  };
}

// Build common X-rails (vertical rails) for upward/downward routing
function buildXRails(colx, k = window.offsetGap / 2) {
  return {
    upward: { x: colx - k },
    downward: { x: colx + k },
  };
}

// Build common Y-rails (horizontal rails) for forward/backward routing  
function buildYRails(rowy, k = window.offsetGap / 2) {
  return {
    forward: { y: rowy + k },
    backward: { y: rowy - k },
  };
}


// Choose ports and calculate rails based on connector type and node positions
function choosePortsAndRails(srcNode, tgtNode, src, tgt, conType, params) {
  const { colSpacing, rowSpacing } = params;

  const srcPorts = buildPorts(src);
  const tgtPorts = buildPorts(tgt);
  const forward = srcNode.globalCol <= tgtNode.globalCol;
  const downward = srcNode.globalRow <= tgtNode.globalRow;

  switch (conType) {
    case ConnectorType.HORIZONTAL_DIRECT:
      return {
        ports: forward
          ? [srcPorts.upper_right, tgtPorts.upper_left]
          : [srcPorts.bottom_left, tgtPorts.bottom_right],
        rails: []
      };
    case ConnectorType.HORIZONTAL_LONGPATH: {
      const ports = forward
        ? [srcPorts.upper_right, tgtPorts.upper_left]
        : [srcPorts.bottom_left, tgtPorts.bottom_right];
      let railSrc = forward ? buildXRails(ports[0].x + colSpacing / 2).upward.x : buildXRails(ports[0].x - colSpacing / 2).downward.x;
      const railY = forward ? buildYRails(src.cy - src.h / 2 - rowSpacing / 2).forward.y : buildYRails(src.cy + src.h / 2 + rowSpacing / 2).backward.y;
      let railTgt = forward ? buildXRails(ports[1].x - colSpacing / 2).downward.x : buildXRails(ports[1].x + colSpacing / 2).upward.x;
      return { 
        ports, 
        rails: [
          { x: railSrc, dir: forward ? 'upward' : 'downward' },
          { y: railY, dir: forward ? 'forward' : 'backward' },
          { x: railTgt, dir: forward ? 'downward' : 'upward' }
        ] 
      };
    };
    case ConnectorType.VERTICAL_DIRECT:
      return {
        ports: downward
          ? [srcPorts.bottom, tgtPorts.up]
          : [srcPorts.up, tgtPorts.bottom],
        rails: []
      };

    case ConnectorType.VERTICAL_LONGPATH: {
      const ports = downward
        ? [srcPorts.upper_right, tgtPorts.bottom_right]
        : [srcPorts.upper_left, tgtPorts.bottom_left];

      const railX = downward ? buildXRails(ports[0].x + colSpacing / 2).downward.x : buildXRails(ports[0].x - colSpacing / 2).upward.x;
      return { ports, rails: [{ x: railX }] };
    }
    case ConnectorType.TILTED_LONGPATH: {
      const ports = forward
        ? [srcPorts.upper_right, tgtPorts.upper_left]
        : [srcPorts.bottom_left, tgtPorts.bottom_right];

      var railX = forward
        ? downward ? buildXRails(ports[0].x + colSpacing / 2).downward.x : buildXRails(ports[0].x + colSpacing / 2).upward.x
        : downward ? buildXRails(ports[1].x + colSpacing / 2).downward.x : buildXRails(ports[1].x + colSpacing / 2).upward.x;
      // Edge column adjustments
      const colCount = Object.keys(params.rectWidthByIdx || {}).length;
      if (srcNode.globalCol === 0) {
        railX = downward ? buildXRails(ports[0].x + colSpacing / 2).downward.x : buildXRails(ports[0].x + colSpacing / 2).upward.x;
      } else if (srcNode.globalCol === colCount - 1) {
        railX = downward ? buildXRails(ports[0].x - colSpacing / 2).downward.x : buildXRails(ports[0].x - colSpacing / 2).upward.x;
      } else if (tgtNode.globalCol === 0) {
        railX = downward ? buildXRails(ports[1].x + colSpacing / 2).downward.x : buildXRails(ports[1].x + colSpacing / 2).upward.x;
      } else if (tgtNode.globalCol === colCount - 1) {
        railX = downward ? buildXRails(ports[1].x - colSpacing / 2).downward.x : buildXRails(ports[1].x - colSpacing / 2).upward.x;
      }
      return { ports, rails: [{ x: railX }] };
    }
    case ConnectorType.TILTED_VERYLONGPATH: {
      const ports = forward
        ? [srcPorts.upper_right, tgtPorts.upper_left]
        : [srcPorts.bottom_left, tgtPorts.bottom_right];

      let railSrc = forward
        ? downward ? buildXRails(ports[0].x + colSpacing / 2).downward.x : buildXRails(ports[0].x + colSpacing / 2).upward.x
        : downward ? buildXRails(ports[0].x - colSpacing / 2).downward.x : buildXRails(ports[0].x - colSpacing / 2).upward.x;
      const midY = forward ? buildYRails(src.cy - src.h / 2 - rowSpacing / 2).forward.y : buildYRails(src.cy + src.h / 2 + rowSpacing / 2).backward.y;
      let railTgt = forward
        ? downward ? buildXRails(ports[1].x - colSpacing / 2).downward.x : buildXRails(ports[1].x - colSpacing / 2).upward.x
        : downward ? buildXRails(ports[1].x + colSpacing / 2).downward.x : buildXRails(ports[1].x + colSpacing / 2).upward.x;
      return {
        ports,
        rails: [{ x: railSrc }, { y: midY }, { x: railTgt }]
      };
    }

    default:
      return {
        ports: [srcPorts.upper_right, tgtPorts.upper_left],
        rails: []
      };
  }
}


// Helper function to adjust ports based on adjustments
function adjustPorts(ports, key1, key2, src, dst, allAdjustments) {
  const adjustedPorts = [...ports];
  const linkId = `${key1}|||${key2}`;

  // Determine port types based on position
  const srcPortType = inferPortType(ports[0], src);
  const dstPortType = inferPortType(ports[1], dst);

  // Apply source port adjustment - direct lookup using linkId
  if (srcPortType) {
    const adjustmentMap = allAdjustments[`cell${srcPortType}Adjustment`];
    if (adjustmentMap && adjustmentMap[key1] && adjustmentMap[key1][linkId] !== undefined) {
      const adjustment = adjustmentMap[key1][linkId];
      // Corner ports (TopLeft, TopRight, BottomLeft, BottomRight): adjust y
      // Center ports (Up, Down): adjust x
      adjustedPorts[0] = {
        x: ports[0].x + (srcPortType === 'Up' || srcPortType === 'Down' ? adjustment : 0),
        y: ports[0].y + (srcPortType.includes('Top') || srcPortType.includes('Bottom') ? adjustment : 0)
      };
    }
  }

  // Apply destination port adjustment - direct lookup using linkId
  if (dstPortType) {
    const adjustmentMap = allAdjustments[`cell${dstPortType}Adjustment`];
    if (adjustmentMap && adjustmentMap[key2] && adjustmentMap[key2][linkId] !== undefined) {
      const adjustment = adjustmentMap[key2][linkId];
      // Corner ports (TopLeft, TopRight, BottomLeft, BottomRight): adjust y
      // Center ports (Up, Down): adjust x
      adjustedPorts[1] = {
        x: ports[1].x + (dstPortType === 'Up' || dstPortType === 'Down' ? adjustment : 0),
        y: ports[1].y + (dstPortType.includes('Top') || dstPortType.includes('Bottom') ? adjustment : 0)
      };
    }
  }

  return adjustedPorts;
}

// Helper function to infer port type from position
function inferPortType(port, nodeMetrics) {
  const { cx, cy } = nodeMetrics;
  const dx = port.x - cx;
  const dy = port.y - cy;
  const eps = 1e-6;

  // Check vertical ports
  if (Math.abs(dx) < eps) {
    return dy < 0 ? 'Up' : 'Down';
  }

  // Check corner ports
  const isLeft = dx < 0;
  const isTop = dy < 0;

  if (isTop) {
    return isLeft ? 'TopLeft' : 'TopRight';
  } else {
    return isLeft ? 'BottomLeft' : 'BottomRight';
  }
}

// Helper function to adjust rails based on adjustments
function adjustRails(rails, key1, key2, allAdjustments) {
  if (!rails || rails.length === 0) return rails;

  const adjustedRails = [];
  const linkKey = `${key1}|||${key2}`;
  
  // Quantization function (same as OverlapIndex.q)
  const eps = 1e-6;
  const q = (v) => Math.round(v / eps) * eps;

  rails.forEach(rail => {
    let adjustedRail = { ...rail };

    // Adjust horizontal rails (y-coordinate rails)
    if ('y' in rail) {
      const qY = q(rail.y);  // Quantize before lookup
      // Just check both - only one will have a value since rail is stored in only one map
      const forwardAdj = allAdjustments.hLineForwardAdjustment?.[qY]?.[linkKey] || 0;
      const backwardAdj = allAdjustments.hLineBackwardAdjustment?.[qY]?.[linkKey] || 0;
      adjustedRail.y = rail.y + (forwardAdj || backwardAdj);
    }

    // Adjust vertical rails (x-coordinate rails)
    if ('x' in rail) {
      const qX = q(rail.x);  // Quantize before lookup
      // Just check both - only one will have a value since rail is stored in only one map
      const downwardAdj = allAdjustments.vLineDownwardAdjustment?.[qX]?.[linkKey] || 0;
      const upwardAdj = allAdjustments.vLineUpwardAdjustment?.[qX]?.[linkKey] || 0;
      adjustedRail.x = rail.x + (downwardAdj || upwardAdj);
    }

    adjustedRails.push(adjustedRail);
  });

  return adjustedRails;
}


/**
 * Manhattan routing with ordered rails you "ride".
 * Usage:
 *   manhattan(start, end, {x:5}, {y:3}, {x:8});
 *   manhattan(start, end, [{x:5}, {y:3}, {x:8}]); // array form also OK
 *
 * @typedef {{x:number,y:number}} Point
 * @typedef {{x:number}|{y:number}} Rail
 *
 * @param {Point} start
 * @param {Point} end
 * @param {...(Rail|Rail[]|Object)} via   Rails (varargs or array). Optional last arg: options.
 * @returns {Point[]} polyline points (start..end), axis-aligned only.
 */
function manhattan(start, end, ...via) {
  // ---- options ----
  const defaults = { prefer: 'hv', eps: 0 }; // prefer finishing Horizontal-then-Vertical; eps=0 => exact
  // Flatten any arrays in ...via
  const flat = [];
  for (const v of via) Array.isArray(v) ? flat.push(...v) : flat.push(v);

  // Split rails vs options (last arg can be options if not a rail)
  // Ensure a strict boolean and exactly one of x|y present (no lookalikes)
  const isRail = (o) => !!(o && typeof o === 'object' && ((('x' in o) !== ('y' in o))));
  const opts = { ...defaults };
  if (flat.length && !isRail(flat[flat.length - 1])) Object.assign(opts, flat.pop());
  // Simplified debug logging control
  const debug = opts.debug || false;
  const log = (e) => {
    if (!debug) return;
    // eslint-disable-next-line no-console
    if (e?.event === 'snap') console.log('[manhattan] snap to', `${e.axis}-rail`, 'value:', e.value, 'index:', e.index);
    // eslint-disable-next-line no-console
    else if (e?.event === 'ride') console.log('[manhattan] ride', `${e.fromAxis}->${e.toAxis}`, 'target:', e.target, 'at index:', e.index);
    // eslint-disable-next-line no-console
    else if (e?.event === 'move') console.log('[manhattan] move', e.axis, 'from:', e.from, 'to:', e.to);
    // eslint-disable-next-line no-console
    else if (e?.event === 'decide') console.log('[manhattan] decide on end-ride for', e.axis, 'hasFuturePerp:', e.hasFuturePerp, 'endTarget:', e.endTarget);
    // eslint-disable-next-line no-console
    else if (e?.event === 'finish') console.log('[manhattan] finish prefer:', e.prefer, 'end:', e.end);
  };
  const onStep = (typeof opts.onStep === 'function')
    ? (evt) => { try { opts.onStep(evt); } finally { log(evt); } }
    : log;

  // Normalize rails to {axis:'x'|'y', value:number}
  const rails = flat.map((r, i) => {
    if (!isRail(r)) throw new Error(`Item #${i} is not a valid rail: ${JSON.stringify(r)}`);
    const axis = ('x' in r) ? 'x' : 'y';
    const value = Number(r[axis]);
    if (!Number.isFinite(value)) throw new Error(`Rail #${i} ${axis} must be finite`);
    return { axis, value };
  });

  const eq = (a, b) => Math.abs(a - b) <= opts.eps;

  const points = [];
  let current = { x: Number(start.x), y: Number(start.y) };

  const push = (pt) => {
    const last = points[points.length - 1];
    if (last && eq(last.x, pt.x) && eq(last.y, pt.y)) return; // skip duplicates
    const prev = points[points.length - 2];
    if (prev && last) {
      const colX = eq(prev.x, last.x) && eq(last.x, pt.x);
      const colY = eq(prev.y, last.y) && eq(last.y, pt.y);
      if (colX || colY) { points[points.length - 1] = pt; return; }
    }
    points.push(pt);
  };

  const goToX = (x) => {
    if (!eq(current.x, x)) {
      const prev = current;
      current = { x, y: current.y };
      push(current);
      if (onStep) onStep({ event: 'move', axis: 'x', from: prev, to: current });
    }
  };
  const goToY = (y) => {
    if (!eq(current.y, y)) {
      const prev = current;
      current = { x: current.x, y };
      push(current);
      if (onStep) onStep({ event: 'move', axis: 'y', from: prev, to: current });
    }
  };

  push(current);

  // Traverse rails in order. For each rail:
  // - Snap to it.
  // - If the IMMEDIATE next rail is perpendicular, ride to that value.
  // - Else, only ride toward end if there is no perpendicular rail later.
  for (let i = 0; i < rails.length; i++) {
    const r = rails[i];
    if (r.axis === 'x') {
      if (onStep) onStep({ event: 'snap', axis: 'x', value: r.value, index: i });
      goToX(r.value);
      const next = rails[i + 1];
      if (next && next.axis === 'y') {
        // Immediate perpendicular: ride to that y
        if (onStep) onStep({ event: 'ride', fromAxis: 'x', toAxis: 'y', target: next.value, index: i });
        goToY(next.value);
      } else {
        // Only ride toward end if there is no future y-rail at all
        const hasFutureY = rails.slice(i + 1).some(rr => rr.axis === 'y');
        if (onStep) onStep({ event: 'decide', axis: 'x', hasFuturePerp: hasFutureY, endTarget: end.y });
        if (!hasFutureY) goToY(end.y);
      }
    } else {
      if (onStep) onStep({ event: 'snap', axis: 'y', value: r.value, index: i });
      goToY(r.value);
      const next = rails[i + 1];
      if (next && next.axis === 'x') {
        // Immediate perpendicular: ride to that x
        if (onStep) onStep({ event: 'ride', fromAxis: 'y', toAxis: 'x', target: next.value, index: i });
        goToX(next.value);
      } else {
        // Only ride toward end if there is no future x-rail at all
        const hasFutureX = rails.slice(i + 1).some(rr => rr.axis === 'x');
        if (onStep) onStep({ event: 'decide', axis: 'y', hasFuturePerp: hasFutureX, endTarget: end.x });
        if (!hasFutureX) goToX(end.x);
      }
    }
  }

  // Finish to end (≤ 2 moves)
  if (!eq(current.x, end.x) && !eq(current.y, end.y)) {
    if (onStep) onStep({ event: 'finish', prefer: opts.prefer, end });
    if (opts.prefer === 'hv') { goToX(end.x); goToY(end.y); }
    else { goToY(end.y); goToX(end.x); }
  } else if (!eq(current.x, end.x)) {
    if (onStep) onStep({ event: 'finish', prefer: 'h', end });
    goToX(end.x);
  } else if (!eq(current.y, end.y)) {
    if (onStep) onStep({ event: 'finish', prefer: 'v', end });
    goToY(end.y);
  }

  return points;
}


// Clean curve computation using MetabolismNode with manhattan routing
function computeCurvePathsFromKeys(key1, key2, conType, params = {}, allAdjustments = null) {
  if (!conType) return;

  const sourceNode = MetabolismNode.get(key1);
  const targetNode = MetabolismNode.get(key2);
  if (!sourceNode || !targetNode) return;

  const src = getNodeMetrics(sourceNode, params.rectWidthByIdx, params.rectHeightByIdx);
  const dst = getNodeMetrics(targetNode, params.rectWidthByIdx, params.rectHeightByIdx);

  let { ports, rails } = choosePortsAndRails(sourceNode, targetNode, src, dst, conType, params);

  // // Log link and original ports/rails
  // console.log(`Link: ${key1} -> ${key2}`);
  // console.log('Before adjustments:', {
  //   ports: JSON.parse(JSON.stringify(ports)),
  //   rails: JSON.parse(JSON.stringify(rails))
  // });

  // Apply adjustments if provided
  if (allAdjustments) {
    const adjustedPorts = adjustPorts(ports, key1, key2, src, dst, allAdjustments);
    const adjustedRails = adjustRails(rails, key1, key2, allAdjustments);

    // // Log after adjustments
    // console.log('After adjustments:', {
    //   ports: JSON.parse(JSON.stringify(adjustedPorts)),
    //   rails: JSON.parse(JSON.stringify(adjustedRails))
    // });

    // Update ports and rails with adjusted values
    ports = adjustedPorts;
    rails = adjustedRails;
  } else {
    console.log('No adjustments applied');
  }
  // if (conType!=ConnectorType.HORIZONTAL_LONGPATH) return;
  // if (conType!=ConnectorType.TILTED_LONGPATH) return;
  // if (conType!=ConnectorType.VERTICAL_LONGPATH) return;
  // if (conType!=ConnectorType.TILTED_VERYLONGPATH) return;
  const path = manhattan(ports[0], ports[1], ...rails, {});
  return filletPath(path);
}





// Lane-based overlap resolution for metabolism diagrams

// Indexers turn lane number 0,1,2,... into signed offsets (k) you multiply by a gap.
function spiralPlus(n) {
  return n === 0 ? 0 : (n % 2 ? (n + 1) / 2 : -(n / 2));
}

function spiralMinus(n) {
  return n === 0 ? 0 : (n % 2 ? -(n + 1) / 2 : (n / 2));
}

function indexerFromMode(mode) {
  switch (mode) {
    case 'none': return () => 0;
    case 'positive': return n => n;       // 0, +1, +2, ...
    case 'negative': return n => -n;      // 0, -1, -2, ...
    case 'spiral-': return spiralMinus;  // bias negative first
    case 'spiral+':
    default: return spiralPlus;   // default
  }
}

// Default policies for ports
const defaultPortPolicy = {
  upper_right: 'negative',
  upper_left: 'negative',
  bottom_right: 'positive',
  bottom_left: 'positive',
  up: 'spiral+',
  bottom: 'spiral+',
};

// Default policies for lanes/rails
const defaultLanePolicy = {
  horizontal_forward: 'positive',  // offset downward from rail
  horizontal_backward: 'negative',  // offset upward from rail
  vertical_downward: 'positive',  // offset right from rail
  vertical_upward: 'negative',  // offset left from rail
};



class OverlapIndex {
  constructor({ eps = 1e-6 } = {}) {
    this.eps = eps;

    // Port maps (by nodeKey)
    this.cellOverlapTopLeft = new Map();
    this.cellOverlapTopRight = new Map();
    this.cellOverlapBottomLeft = new Map();
    this.cellOverlapBottomRight = new Map();
    this.cellOverlapUp = new Map();
    this.cellOverlapDown = new Map();

    // Rail maps (by rail coordinate)
    this.hLineForwardOverlap = new Map(); // y=const, x increasing
    this.hLineBackwardOverlap = new Map(); // y=const, x decreasing
    this.vLineDownwardOverlap = new Map(); // x=const, y increasing
    this.vLineUpwardOverlap = new Map(); // x=const, y decreasing
  }

  // Quantize rail coordinate for stable grouping
  q(v) {
    const q = this.eps;
    return Math.round(v / q) * q;
  }

  mapForPort(kind) {
    switch (kind) {
      case 'upper_left': return this.cellOverlapTopLeft;
      case 'upper_right': return this.cellOverlapTopRight;
      case 'bottom_left': return this.cellOverlapBottomLeft;
      case 'bottom_right': return this.cellOverlapBottomRight;
      case 'up': return this.cellOverlapUp;
      case 'bottom': return this.cellOverlapDown;
      default: throw new Error('Unknown port kind: ' + kind);
    }
  }

  // Increment port counter and track which link claimed it
  claimPort(nodeKey, kind, linkId) {
    const m = this.mapForPort(kind);
    if (!m.has(nodeKey)) {
      m.set(nodeKey, { count: 0, links: [] });
    }
    const entry = m.get(nodeKey);
    entry.links.push(linkId);
    const index = entry.count;
    entry.count++;
    return index;
  }

  // Record rail segments for overlap tracking
  recordRailSegments(rails, linkId, ports) {
    if (!rails || rails.length === 0) return;

    rails.forEach(rail => {
      if ('y' in rail) {
        // Horizontal rail - use provided direction or calculate
        const dir = rail.dir ? (rail.dir === 'forward' ? +1 : -1) : (ports[0].x < ports[1].x ? +1 : -1);
        const y = this.q(rail.y);
        // Rail extends from first port x to second port x
        const from = Math.min(ports[0].x, ports[1].x);
        const to = Math.max(ports[0].x, ports[1].x);
        const map = dir > 0 ? this.hLineForwardOverlap : this.hLineBackwardOverlap;
        const rec = { id: linkId, axis: 'y', value: y, from, to, dir };
        map.set(y, [...(map.get(y) || []), rec]);
      } else if ('x' in rail) {
        // Vertical rail - use provided direction or calculate
        const dir = rail.dir ? (rail.dir === 'downward' ? +1 : -1) : (ports[0].y < ports[1].y ? +1 : -1);
        const x = this.q(rail.x);
        // Rail extends from first port y to second port y
        const from = Math.min(ports[0].y, ports[1].y);
        const to = Math.max(ports[0].y, ports[1].y);
        const map = dir > 0 ? this.vLineDownwardOverlap : this.vLineUpwardOverlap;
        const rec = { id: linkId, axis: 'x', value: x, from, to, dir };
        map.set(x, [...(map.get(x) || []), rec]);
      }
    });
  }

}

// Infer port kind from port position relative to node center
function inferPortKind(port, nodeMetrics, portK, eps) {
  const { cx, cy, w, h } = nodeMetrics;
  const dx = port.x - cx;
  const dy = port.y - cy;

  // Check if it's a centered port (up/bottom)
  if (Math.abs(dx) < eps) {
    return dy < 0 ? 'up' : 'bottom';
  }

  // Check corners
  const isLeft = dx < 0;
  const isTop = dy < 0;

  if (isTop) {
    return isLeft ? 'upper_left' : 'upper_right';
  } else {
    return isLeft ? 'bottom_left' : 'bottom_right';
  }
}

// Function to only build overlap maps without modifying paths
function buildOverlapMapsOnly(links, conTypeMap, params, opts = {}) {
  const eps = opts.eps ?? 1e-4;
  const portK = opts.portK ?? 2;

  const ov = new OverlapIndex({ eps });

  // Sort links to process HORIZONTAL_DIRECT connections first
  const sortedLinks = links.slice().sort((a, b) => {
    const typeA = conTypeMap[`${a[0]}|||${a[1]}`];
    const typeB = conTypeMap[`${b[0]}|||${b[1]}`];

    // HORIZONTAL_DIRECT gets priority (comes first)
    if (typeA === ConnectorType.HORIZONTAL_DIRECT && typeB !== ConnectorType.HORIZONTAL_DIRECT) return -1;
    if (typeB === ConnectorType.HORIZONTAL_DIRECT && typeA !== ConnectorType.HORIZONTAL_DIRECT) return 1;
    return 0;
  });

  // Process all links to build overlap maps
  for (const link of sortedLinks) {
    const key1 = link[0];
    const key2 = link[1];
    const linkId = `${key1}|||${key2}`;
    const conType = conTypeMap[linkId];

    const sourceNode = MetabolismNode.get(key1);
    const targetNode = MetabolismNode.get(key2);
    if (!sourceNode || !targetNode) continue;

    const src = getNodeMetrics(sourceNode, params.rectWidthByIdx, params.rectHeightByIdx);
    const dst = getNodeMetrics(targetNode, params.rectWidthByIdx, params.rectHeightByIdx);

    const result = choosePortsAndRails(sourceNode, targetNode, src, dst, conType, params);
    if (!result) continue;
    const { ports, rails } = result;

    const srcKind = inferPortKind(ports[0], src, portK, eps);
    const dstKind = inferPortKind(ports[1], dst, portK, eps);

    // Claim ports to track overlaps with linkId
    ov.claimPort(key1, srcKind, linkId);
    ov.claimPort(key2, dstKind, linkId);

    // Only record actual rails as segments (not the port-to-rail connections)
    ov.recordRailSegments(rails, linkId, ports);
  }

  // Return just the overlap maps
  return {
    // Port maps
    cellOverlapTopLeft: ov.cellOverlapTopLeft,
    cellOverlapTopRight: ov.cellOverlapTopRight,
    cellOverlapBottomLeft: ov.cellOverlapBottomLeft,
    cellOverlapBottomRight: ov.cellOverlapBottomRight,
    cellOverlapUp: ov.cellOverlapUp,
    cellOverlapDown: ov.cellOverlapDown,

    // Rail maps
    hLineForwardOverlap: ov.hLineForwardOverlap,
    hLineBackwardOverlap: ov.hLineBackwardOverlap,
    vLineDownwardOverlap: ov.vLineDownwardOverlap,
    vLineUpwardOverlap: ov.vLineUpwardOverlap,
  };
}

// Calculate offsets from overlap maps
function calculateOffsets(overlapMaps, options = {}, conTypeMap = {}) {
  const { portGap = 4, laneGap = 6 } = options;

  // Initialize all adjustment maps
  const adjustments = {
    hLineForwardAdjustment: {},
    hLineBackwardAdjustment: {},
    vLineDownwardAdjustment: {},
    vLineUpwardAdjustment: {},
    cellTopLeftAdjustment: {},
    cellTopRightAdjustment: {},
    cellBottomLeftAdjustment: {},
    cellBottomRightAdjustment: {},
    cellUpAdjustment: {},
    cellDownAdjustment: {}
  };

  // Process port overlaps - simple offset based on count
  processPortOffsets(overlapMaps.cellOverlapTopLeft, adjustments.cellTopLeftAdjustment, 'upper_left', portGap, conTypeMap);
  processPortOffsets(overlapMaps.cellOverlapTopRight, adjustments.cellTopRightAdjustment, 'upper_right', portGap, conTypeMap);
  processPortOffsets(overlapMaps.cellOverlapBottomLeft, adjustments.cellBottomLeftAdjustment, 'bottom_left', portGap, conTypeMap);
  processPortOffsets(overlapMaps.cellOverlapBottomRight, adjustments.cellBottomRightAdjustment, 'bottom_right', portGap, conTypeMap);
  processPortOffsets(overlapMaps.cellOverlapUp, adjustments.cellUpAdjustment, 'up', portGap, conTypeMap);
  processPortOffsets(overlapMaps.cellOverlapDown, adjustments.cellDownAdjustment, 'bottom', portGap, conTypeMap);

  // Process rail overlaps - advanced segment clustering
  processRailOffsets(overlapMaps.hLineForwardOverlap, adjustments.hLineForwardAdjustment, laneGap, defaultLanePolicy.horizontal_forward);
  processRailOffsets(overlapMaps.hLineBackwardOverlap, adjustments.hLineBackwardAdjustment, laneGap, defaultLanePolicy.horizontal_backward);
  processRailOffsets(overlapMaps.vLineDownwardOverlap, adjustments.vLineDownwardAdjustment, laneGap, defaultLanePolicy.vertical_downward);
  processRailOffsets(overlapMaps.vLineUpwardOverlap, adjustments.vLineUpwardAdjustment, laneGap, defaultLanePolicy.vertical_upward);

  return adjustments;
}

// Process port offsets using the policy-based indexers
function processPortOffsets(overlapMap, adjustmentMap, portKind, portGap, conTypeMap = {}) {
  const policy = defaultPortPolicy[portKind] || 'spiral+';
  const indexer = indexerFromMode(policy);

  // For each node that has overlapping connections at this port
  overlapMap.forEach((entry, nodeKey) => {
    // entry now contains {count, links: [linkIds]}
    const linkOffsets = {};

    // Separate HORIZONTAL_DIRECT links from others
    const horizontalDirectLinks = [];
    const otherLinks = [];

    entry.links.forEach(linkId => {
      const conType = conTypeMap[linkId];
      if (conType === ConnectorType.HORIZONTAL_DIRECT) {
        horizontalDirectLinks.push(linkId);
      } else {
        otherLinks.push(linkId);
      }
    });

    // Combine links with HORIZONTAL_DIRECT first, then others
    const orderedLinks = [...horizontalDirectLinks, ...otherLinks];

    // Apply indexed offsets to all links in order
    orderedLinks.forEach((linkId, i) => {
      linkOffsets[linkId] = indexer(i) * portGap;
    });

    adjustmentMap[nodeKey] = linkOffsets;
  });
}

// Process rail offsets using overlap detection and lane assignment
function processRailOffsets(railMap, adjustmentMap, laneGap, policy = 'positive') {
  // For each rail coordinate
  railMap.forEach((segments, railCoord) => {
    if (!segments || segments.length === 0) return; // Skip empty segments

    // Initialize adjustment map for this rail coordinate
    if (!adjustmentMap[railCoord]) {
      adjustmentMap[railCoord] = {};
    }

    // Handle single segment - no offset needed
    if (segments.length === 1) {
      adjustmentMap[railCoord][segments[0].id] = 0;
      return;
    }

    // Multiple segments - need lane assignment
    // Sort segments by their range for greedy lane assignment
    const sortedSegments = segments.slice().sort((a, b) => {
      return (a.from - b.from) || (a.to - b.to);
    });

    // Greedy lane assignment - segments that don't overlap can share lanes
    const lanes = [];

    sortedSegments.forEach(seg => {
      // Find first available lane where this segment doesn't overlap
      let lane = -1;
      for (let i = 0; i < lanes.length; i++) {
        const lastInLane = lanes[i][lanes[i].length - 1];
        // Segments don't overlap if one ends before the other starts (strict inequality)
        if (lastInLane.to < seg.from) {
          lane = i;
          break;
        }
      }

      if (lane === -1) {
        // Need a new lane for this segment
        lane = lanes.length;
        lanes.push([]);
      }

      lanes[lane].push(seg);
      seg.lane = lane;
    });

    // Calculate offsets based on lane assignments and policy
    const offsetFn = indexerFromMode(policy);

    segments.forEach(seg => {
      const offset = offsetFn(seg.lane) * laneGap;
      adjustmentMap[railCoord][seg.id] = offset;
    });
  });
}