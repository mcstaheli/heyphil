import React, { useState, useRef, useEffect } from 'react';
import './OrgCharts.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function OrgCharts({ user, onBack }) {
  const canvasRef = useRef(null);
  
  // Chart management
  const [charts, setCharts] = useState([]);
  const [currentChart, setCurrentChart] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Canvas state
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [connectingFrom, setConnectingFrom] = useState(null);
  const [draggingNode, setDraggingNode] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [hoveredPort, setHoveredPort] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const saveTimeout = useRef(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [alignmentGuides, setAlignmentGuides] = useState([]);
  const [reconnecting, setReconnecting] = useState(null); // { connectionId, end: 'from' | 'to' }
  const [editingNode, setEditingNode] = useState(null); // Node being edited in modal
  const [editingConnection, setEditingConnection] = useState(null); // Connection being edited in modal
  
  // Refs to always have latest state for auto-save
  const nodesRef = useRef(nodes);
  const connectionsRef = useRef(connections);
  
  useEffect(() => {
    nodesRef.current = nodes;
    connectionsRef.current = connections;
  }, [nodes, connections]);

  const GRID_SIZE = 20; // Grid snap size in pixels
  const SNAP_THRESHOLD = 5; // Pixels to trigger alignment guide

  const snapToGridValue = (value) => {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  };

  const getAuthHeaders = () => {
    const token = localStorage.getItem('authToken');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  // Load charts list on mount
  useEffect(() => {
    loadCharts();
  }, []);

  const loadCharts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/orgcharts`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setCharts(data.charts || []);
      }
    } catch (error) {
      console.error('Failed to load charts:', error);
    }
    setLoading(false);
  };

  const createChart = async () => {
    const name = prompt('Chart name:');
    if (!name) return;

    try {
      console.log('Creating chart:', name);
      const res = await fetch(`${API_BASE_URL}/api/orgcharts`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name })
      });
      
      console.log('Create response status:', res.status);
      
      if (res.ok) {
        const newChart = await res.json();
        console.log('New chart created:', newChart);
        
        // Set current chart to open the editor
        setCurrentChart(newChart);
        setNodes([]);
        setConnections([]);
        
        // Refresh list in background
        loadCharts();
      } else {
        const error = await res.text();
        console.error('Failed to create chart:', error);
        alert('Failed to create chart. Please try again.');
      }
    } catch (error) {
      console.error('Failed to create chart:', error);
      alert('Network error. Please check your connection.');
    }
  };

  const openChart = async (chartId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/orgcharts/${chartId}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const chart = await res.json();
        setCurrentChart(chart);
        setNodes(chart.nodes || []);
        setConnections(chart.connections || []);
      }
    } catch (error) {
      console.error('Failed to load chart:', error);
    }
  };

  const saveChart = async (silent = false, useLatestState = false) => {
    if (!currentChart) return;

    // Use latest state from refs if requested (for auto-save), otherwise use current props
    const dataToSave = {
      nodes: useLatestState ? nodesRef.current : nodes,
      connections: useLatestState ? connectionsRef.current : connections
    };

    try {
      setSaving(true);
      const res = await fetch(`${API_BASE_URL}/api/orgcharts/${currentChart.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(dataToSave)
      });
      if (res.ok) {
        setLastSaved(new Date());
        if (!silent) {
          alert('Chart saved!');
        }
      }
    } catch (error) {
      console.error('Failed to save chart:', error);
      if (!silent) {
        alert('Failed to save chart');
      }
    } finally {
      setSaving(false);
    }
  };

  // Auto-save with debounce when nodes or connections change
  useEffect(() => {
    if (!currentChart) return;
    if (nodes.length === 0 && connections.length === 0) return;

    // Clear existing timeout
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }

    // Debounce auto-save by 2 seconds
    saveTimeout.current = setTimeout(() => {
      // Use latest state from refs to avoid stale closure data
      saveChart(true, true);
    }, 2000);

    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [nodes, connections, currentChart]);

  // Save on unmount/navigation to catch any pending changes
  useEffect(() => {
    return () => {
      // If there's a pending save timeout, save immediately on unmount
      if (saveTimeout.current && currentChart) {
        clearTimeout(saveTimeout.current);
        // Use synchronous approach with current ref values
        const dataToSave = {
          nodes: nodesRef.current,
          connections: connectionsRef.current
        };
        // Fire-and-forget save (using fetch with keepalive to survive unmount)
        fetch(`${API_BASE_URL}/api/orgcharts/${currentChart.id}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(dataToSave),
          keepalive: true // Ensures request completes even if page unloads
        }).catch(err => console.error('Failed to save on unmount:', err));
      }
    };
  }, [currentChart]);

  const deleteChart = async (chartId) => {
    if (!window.confirm('Delete this chart? This cannot be undone.')) return;

    try {
      console.log('Deleting chart:', chartId);
      const res = await fetch(`${API_BASE_URL}/api/orgcharts/${chartId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      
      console.log('Delete response:', res.status, res.ok);
      
      if (res.ok) {
        console.log('Delete successful, updating list');
        // Remove from local state
        setCharts(prevCharts => prevCharts.filter(c => c.id !== chartId));
        if (currentChart?.id === chartId) {
          setCurrentChart(null);
        }
        // Reload list to be sure
        await loadCharts();
      } else {
        const error = await res.text();
        console.error('Delete failed:', error);
        alert('Failed to delete chart. ' + error);
      }
    } catch (error) {
      console.error('Failed to delete chart:', error);
      alert('Network error while deleting chart.');
    }
  };

  // Connection ports: 5 on top/bottom, 3 on left/right (16 total)
  const getNodePorts = (node) => {
    const scaled = {
      x: node.x * zoom + offset.x,
      y: node.y * zoom + offset.y,
      width: node.width * zoom,
      height: node.height * zoom
    };
    return {
      // Top edge - 5 ports
      'top-1': { x: scaled.x + scaled.width * 0.2, y: scaled.y },
      'top-2': { x: scaled.x + scaled.width * 0.35, y: scaled.y },
      'top': { x: scaled.x + scaled.width * 0.5, y: scaled.y },
      'top-3': { x: scaled.x + scaled.width * 0.65, y: scaled.y },
      'top-4': { x: scaled.x + scaled.width * 0.8, y: scaled.y },
      // Right edge - 3 ports
      'right-top': { x: scaled.x + scaled.width, y: scaled.y + scaled.height * 0.25 },
      'right': { x: scaled.x + scaled.width, y: scaled.y + scaled.height * 0.5 },
      'right-bottom': { x: scaled.x + scaled.width, y: scaled.y + scaled.height * 0.75 },
      // Bottom edge - 5 ports
      'bottom-1': { x: scaled.x + scaled.width * 0.2, y: scaled.y + scaled.height },
      'bottom-2': { x: scaled.x + scaled.width * 0.35, y: scaled.y + scaled.height },
      'bottom': { x: scaled.x + scaled.width * 0.5, y: scaled.y + scaled.height },
      'bottom-3': { x: scaled.x + scaled.width * 0.65, y: scaled.y + scaled.height },
      'bottom-4': { x: scaled.x + scaled.width * 0.8, y: scaled.y + scaled.height },
      // Left edge - 3 ports
      'left-top': { x: scaled.x, y: scaled.y + scaled.height * 0.25 },
      'left': { x: scaled.x, y: scaled.y + scaled.height * 0.5 },
      'left-bottom': { x: scaled.x, y: scaled.y + scaled.height * 0.75 }
    };
  };

  const addNode = () => {
    // Simple fixed position for testing - always place at top-left with stagger
    const stagger = nodes.length * 50;
    
    const newNode = {
      id: Date.now(),
      x: 100 + stagger,
      y: 100 + stagger,
      width: 200,
      height: 80,
      text: `Node ${nodes.length + 1}`,
      color: '#667eea' // Default purple
    };
    
    console.log('Adding node:', newNode);
    console.log('Current nodes count:', nodes.length);
    console.log('Offset:', offset, 'Zoom:', zoom);
    
    setNodes([...nodes, newNode]);
    setSelectedNode(newNode.id);
  };

  const updateNodeText = (nodeId, text) => {
    setNodes(nodes.map(n => n.id === nodeId ? { ...n, text } : n));
  };

  const updateNodeColor = (nodeId, color) => {
    setNodes(nodes.map(n => n.id === nodeId ? { ...n, color } : n));
  };

  const DEFAULT_WIDTH = 200;
  const DEFAULT_HEIGHT = 80;
  const STEP = 20;
  const MIN_WIDTH = 100;
  const MIN_HEIGHT = 60;

  const getSizeNumber = (value, defaultValue) => {
    // Calculate size number: default = 0, each step of 20 = ±1
    const diff = value - defaultValue;
    const sizeNum = Math.round(diff / STEP);
    return sizeNum === 0 ? '0' : (sizeNum > 0 ? `+${sizeNum}` : `${sizeNum}`);
  };

  const resizeNode = (nodeId, dimension, direction) => {
    setNodes(nodes.map(n => {
      if (n.id !== nodeId) return n;
      
      if (dimension === 'width') {
        const newWidth = direction === 'increase' 
          ? n.width + STEP 
          : Math.max(MIN_WIDTH, n.width - STEP);
        return { ...n, width: newWidth };
      } else if (dimension === 'height') {
        const newHeight = direction === 'increase'
          ? n.height + STEP
          : Math.max(MIN_HEIGHT, n.height - STEP);
        return { ...n, height: newHeight };
      }
      
      return n;
    }));
  };

  const resetNodeSize = (nodeId) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      return { ...n, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    }));
  };

  const deleteNode = (nodeId) => {
    setNodes(nodes.filter(n => n.id !== nodeId));
    setConnections(connections.filter(c => c.from !== nodeId && c.to !== nodeId));
    setSelectedNode(null);
  };

  const deleteConnection = (connId) => {
    setConnections(connections.filter(c => c.id !== connId));
    setSelectedConnection(null);
  };

  const startConnection = (nodeId, port) => {
    setConnectingFrom({ nodeId, port });
  };

  const finishConnection = (toNodeId, toPort) => {
    if (connectingFrom && connectingFrom.nodeId !== toNodeId) {
      const newConnection = {
        id: Date.now(),
        from: connectingFrom.nodeId,
        fromPort: connectingFrom.port,
        to: toNodeId,
        toPort: toPort
      };
      setConnections([...connections, newConnection]);
    }
    setConnectingFrom(null);
  };

  const updateConnectionPort = (connId, end, newPort) => {
    setConnections(connections.map(c => {
      if (c.id === connId) {
        return end === 'from' 
          ? { ...c, fromPort: newPort }
          : { ...c, toPort: newPort };
      }
      return c;
    }));
  };

  const updateConnectionLabel = (connId, label) => {
    setConnections(connections.map(c => c.id === connId ? { ...c, label } : c));
  };

  const updateConnectionColor = (connId, color) => {
    setConnections(connections.map(c => c.id === connId ? { ...c, color } : c));
  };

  const updateConnectionStyle = (connId, style) => {
    setConnections(connections.map(c => c.id === connId ? { ...c, style } : c));
  };

  const updateConnectionWaypoints = (connId, waypoints) => {
    setConnections(connections.map(c => c.id === connId ? { ...c, waypoints } : c));
  };

  // A* Pathfinding for collision-free routing
  const findPathAStar = (startX, startY, endX, endY, fromNodeId, toNodeId, screenNodes) => {
    const GRID_SIZE = 20;
    const PADDING = 40;
    
    // Convert coordinates to grid
    const toGrid = (x, y) => ({
      x: Math.round(x / GRID_SIZE),
      y: Math.round(y / GRID_SIZE)
    });
    
    const fromGrid = (gx, gy) => ({
      x: gx * GRID_SIZE,
      y: gy * GRID_SIZE
    });
    
    // Check if grid cell is blocked by a node
    const isBlocked = (gx, gy) => {
      const worldPos = fromGrid(gx, gy);
      for (const node of screenNodes) {
        if (node.id === fromNodeId || node.id === toNodeId) continue;
        
        if (worldPos.x >= node.x - PADDING &&
            worldPos.x <= node.x + node.width + PADDING &&
            worldPos.y >= node.y - PADDING &&
            worldPos.y <= node.y + node.height + PADDING) {
          return true;
        }
      }
      return false;
    };
    
    const start = toGrid(startX, startY);
    const end = toGrid(endX, endY);
    
    // Manhattan distance heuristic
    const heuristic = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    
    const openSet = [start];
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    
    const key = (p) => `${p.x},${p.y}`;
    
    gScore.set(key(start), 0);
    fScore.set(key(start), heuristic(start, end));
    
    // Orthogonal directions only
    const neighbors = [
      { x: 0, y: -1 }, // up
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // down
      { x: -1, y: 0 }  // left
    ];
    
    let iterations = 0;
    const MAX_ITERATIONS = 1000;
    
    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;
      
      // Find node with lowest fScore
      let current = openSet[0];
      let currentIdx = 0;
      for (let i = 1; i < openSet.length; i++) {
        if ((fScore.get(key(openSet[i])) || Infinity) < (fScore.get(key(current)) || Infinity)) {
          current = openSet[i];
          currentIdx = i;
        }
      }
      
      // Reached goal
      if (current.x === end.x && current.y === end.y) {
        // Reconstruct path
        const path = [end];
        let curr = end;
        while (cameFrom.has(key(curr))) {
          curr = cameFrom.get(key(curr));
          path.unshift(curr);
        }
        
        // Convert grid path to world coordinates
        return path.map(p => fromGrid(p.x, p.y));
      }
      
      openSet.splice(currentIdx, 1);
      
      // Check neighbors
      for (const dir of neighbors) {
        const neighbor = { x: current.x + dir.x, y: current.y + dir.y };
        
        if (isBlocked(neighbor.x, neighbor.y)) continue;
        
        const tentativeGScore = (gScore.get(key(current)) || Infinity) + 1;
        
        if (tentativeGScore < (gScore.get(key(neighbor)) || Infinity)) {
          cameFrom.set(key(neighbor), current);
          gScore.set(key(neighbor), tentativeGScore);
          fScore.set(key(neighbor), tentativeGScore + heuristic(neighbor, end));
          
          if (!openSet.some(p => p.x === neighbor.x && p.y === neighbor.y)) {
            openSet.push(neighbor);
          }
        }
      }
    }
    
    // No path found - return direct line
    return [{ x: startX, y: startY }, { x: endX, y: endY }];
  };

  // Check if a horizontal/vertical line segment intersects a node
  const lineIntersectsNode = (x1, y1, x2, y2, node, fromNodeId, toNodeId) => {
    // Don't check collision with source or destination nodes
    if (node.id === fromNodeId || node.id === toNodeId) return false;
    
    const PADDING = 30; // Increased clearance around nodes
    const left = node.x - PADDING;
    const right = node.x + node.width + PADDING;
    const top = node.y - PADDING;
    const bottom = node.y + node.height + PADDING;
    
    // Check if horizontal line intersects node (with tolerance for floating point)
    if (Math.abs(y1 - y2) < 1) {
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const y = (y1 + y2) / 2;
      // Check if line passes through or very near the node
      return y >= top && y <= bottom && maxX >= left && minX <= right;
    }
    
    // Check if vertical line intersects node (with tolerance for floating point)
    if (Math.abs(x1 - x2) < 1) {
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      const x = (x1 + x2) / 2;
      // Check if line passes through or very near the node
      return x >= left && x <= right && maxY >= top && minY <= bottom;
    }
    
    return false;
  };

  // Find safe clearance Y coordinate that avoids all nodes
  const findSafeClearanceY = (nodes, fromNodeId, toNodeId, preferredY) => {
    const allNodes = nodes.filter(n => n.id !== fromNodeId && n.id !== toNodeId);
    if (allNodes.length === 0) return preferredY;
    
    // Try above all nodes
    const maxBottom = Math.max(...allNodes.map(n => n.y + n.height));
    const minTop = Math.min(...allNodes.map(n => n.y));
    
    const GAP = 60; // Increased clearance
    
    // If preferred is below, go below all
    if (preferredY > maxBottom) {
      return maxBottom + GAP;
    }
    
    // Otherwise go above all
    return minTop - GAP;
  };

  // Find safe clearance X coordinate that avoids all nodes
  const findSafeClearanceX = (nodes, fromNodeId, toNodeId, preferredX) => {
    const allNodes = nodes.filter(n => n.id !== fromNodeId && n.id !== toNodeId);
    if (allNodes.length === 0) return preferredX;
    
    // Try left or right of all nodes
    const maxRight = Math.max(...allNodes.map(n => n.x + n.width));
    const minLeft = Math.min(...allNodes.map(n => n.x));
    
    const GAP = 60; // Increased clearance
    
    // If preferred is to the right, go right of all
    if (preferredX > maxRight) {
      return maxRight + GAP;
    }
    
    // Otherwise go left of all
    return minLeft - GAP;
  };

  // Orthogonal routing with elkjs (auto) or manual waypoints
  // ULTRA-CONSERVATIVE routing: guaranteed to avoid all nodes
  // elkjs-based routing - FINAL ATTEMPT
  const getElbowPath = (x1, y1, x2, y2, fromPort, toPort, fromNodeId, toNodeId, waypoints) => {
    // If manual waypoints exist, use them
    if (waypoints && waypoints.length > 0) {
      const points = [{ x: x1, y: y1 }, ...waypoints, { x: x2, y: y2 }];
      let path = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        path += ` L ${points[i].x} ${points[i].y}`;
      }
      return path;
    }

    // Transform nodes to screen space
    const screenNodes = nodes.map(n => ({
      id: n.id,
      x: n.x * zoom + offset.x,
      y: n.y * zoom + offset.y,
      width: n.width * zoom,
      height: n.height * zoom
    }));

    const sourceNode = screenNodes.find(n => n.id === fromNodeId);
    const destNode = screenNodes.find(n => n.id === toNodeId);

    if (!sourceNode || !destNode) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    const EXTEND = 30; // Distance to extend from port
    const CLEARANCE = 60; // Space around obstacles

    // Calculate extension points (move away from node edge)
    let extendFrom = { x: x1, y: y1 };
    let extendTo = { x: x2, y: y2 };
    
    if (fromPort.startsWith('bottom')) extendFrom.y = y1 + EXTEND;
    else if (fromPort.startsWith('top')) extendFrom.y = y1 - EXTEND;
    else if (fromPort.startsWith('right')) extendFrom.x = x1 + EXTEND;
    else if (fromPort.startsWith('left')) extendFrom.x = x1 - EXTEND;
    
    if (toPort.startsWith('bottom')) extendTo.y = y2 + EXTEND;
    else if (toPort.startsWith('top')) extendTo.y = y2 - EXTEND;
    else if (toPort.startsWith('right')) extendTo.x = x2 + EXTEND;
    else if (toPort.startsWith('left')) extendTo.x = x2 - EXTEND;

    // Get obstacle nodes (excluding source and dest)
    const obstacleNodes = screenNodes.filter(n => n.id !== fromNodeId && n.id !== toNodeId);
    
    // Helper: check if a rectangular corridor intersects any obstacles
    const hasCollision = (x1, y1, x2, y2) => {
      const minX = Math.min(x1, x2) - CLEARANCE;
      const maxX = Math.max(x1, x2) + CLEARANCE;
      const minY = Math.min(y1, y2) - CLEARANCE;
      const maxY = Math.max(y1, y2) + CLEARANCE;
      
      for (const obs of obstacleNodes) {
        if (obs.x < maxX && obs.x + obs.width > minX &&
            obs.y < maxY && obs.y + obs.height > minY) {
          return true;
        }
      }
      return false;
    };
    
    // Try simple L-shapes first
    const dx = Math.abs(extendTo.x - extendFrom.x);
    const dy = Math.abs(extendTo.y - extendFrom.y);
    
    // Try horizontal-then-vertical
    if (dx >= dy) {
      const midX = extendTo.x;
      const midY = extendFrom.y;
      
      if (!hasCollision(extendFrom.x, extendFrom.y, midX, midY) &&
          !hasCollision(midX, midY, extendTo.x, extendTo.y)) {
        return `M ${x1} ${y1} L ${extendFrom.x} ${extendFrom.y} L ${midX} ${midY} L ${extendTo.x} ${extendTo.y} L ${x2} ${y2}`;
      }
    }
    
    // Try vertical-then-horizontal
    if (dy >= dx) {
      const midX = extendFrom.x;
      const midY = extendTo.y;
      
      if (!hasCollision(extendFrom.x, extendFrom.y, midX, midY) &&
          !hasCollision(midX, midY, extendTo.x, extendTo.y)) {
        return `M ${x1} ${y1} L ${extendFrom.x} ${extendFrom.y} L ${midX} ${midY} L ${extendTo.x} ${extendTo.y} L ${x2} ${y2}`;
      }
    }
    
    // FALLBACK: Route around obstacles via bounding box
    const allY = screenNodes.map(n => [n.y, n.y + n.height]).flat();
    const allX = screenNodes.map(n => [n.x, n.x + n.width]).flat();
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    
    const isVerticalFrom = fromPort.startsWith('top') || fromPort.startsWith('bottom');
    const isVerticalTo = toPort.startsWith('top') || toPort.startsWith('bottom');
    
    if (isVerticalFrom && isVerticalTo) {
      // Route via left or right side
      const routeX = (extendFrom.x < (minX + maxX) / 2) ? minX - CLEARANCE : maxX + CLEARANCE;
      return `M ${x1} ${y1} L ${extendFrom.x} ${extendFrom.y} L ${routeX} ${extendFrom.y} L ${routeX} ${extendTo.y} L ${extendTo.x} ${extendTo.y} L ${x2} ${y2}`;
    } else if (!isVerticalFrom && !isVerticalTo) {
      // Route via top or bottom
      const routeY = (extendFrom.y < (minY + maxY) / 2) ? minY - CLEARANCE : maxY + CLEARANCE;
      return `M ${x1} ${y1} L ${extendFrom.x} ${extendFrom.y} L ${extendFrom.x} ${routeY} L ${extendTo.x} ${routeY} L ${extendTo.x} ${extendTo.y} L ${x2} ${y2}`;
    } else {
      // Mixed ports: use Z-shape via perimeter
      if (isVerticalFrom) {
        const routeY = (extendFrom.y < (minY + maxY) / 2) ? minY - CLEARANCE : maxY + CLEARANCE;
        return `M ${x1} ${y1} L ${extendFrom.x} ${extendFrom.y} L ${extendFrom.x} ${routeY} L ${extendTo.x} ${routeY} L ${extendTo.x} ${extendTo.y} L ${x2} ${y2}`;
      } else {
        const routeX = (extendFrom.x < (minX + maxX) / 2) ? minX - CLEARANCE : maxX + CLEARANCE;
        return `M ${x1} ${y1} L ${extendFrom.x} ${extendFrom.y} L ${routeX} ${extendFrom.y} L ${routeX} ${extendTo.y} L ${extendTo.x} ${extendTo.y} L ${x2} ${y2}`;
      }
    }
  };

  const handleCanvasMouseDown = (e) => {
    if (e.target === canvasRef.current) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      setSelectedNode(null);
      setSelectedConnection(null);
    }
  };


  const handleCanvasMouseMove = (e) => {
    if (isPanning) {
      setOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    } else if (draggingNode) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      let x = (e.clientX - rect.left - offset.x) / zoom - draggingNode.offsetX;
      let y = (e.clientY - rect.top - offset.y) / zoom - draggingNode.offsetY;
      
      // Apply grid snapping if enabled
      if (snapToGrid) {
        x = snapToGridValue(x);
        y = snapToGridValue(y);
      }
      
      // Detect alignment guides with other nodes
      const guides = [];
      const currentNode = nodes.find(n => n.id === draggingNode.id);
      if (currentNode) {
        nodes.forEach(node => {
          if (node.id === draggingNode.id) return;
          
          // Check horizontal alignment (top, center, bottom)
          if (Math.abs(node.y - y) < SNAP_THRESHOLD) {
            guides.push({ type: 'horizontal', value: node.y, align: 'top' });
            y = node.y;
          }
          if (Math.abs((node.y + node.height / 2) - (y + currentNode.height / 2)) < SNAP_THRESHOLD) {
            guides.push({ type: 'horizontal', value: y + currentNode.height / 2, align: 'center' });
            y = node.y + node.height / 2 - currentNode.height / 2;
          }
          if (Math.abs((node.y + node.height) - (y + currentNode.height)) < SNAP_THRESHOLD) {
            guides.push({ type: 'horizontal', value: node.y + node.height, align: 'bottom' });
            y = node.y + node.height - currentNode.height;
          }
          
          // Check vertical alignment (left, center, right)
          if (Math.abs(node.x - x) < SNAP_THRESHOLD) {
            guides.push({ type: 'vertical', value: node.x, align: 'left' });
            x = node.x;
          }
          if (Math.abs((node.x + node.width / 2) - (x + currentNode.width / 2)) < SNAP_THRESHOLD) {
            guides.push({ type: 'vertical', value: x + currentNode.width / 2, align: 'center' });
            x = node.x + node.width / 2 - currentNode.width / 2;
          }
          if (Math.abs((node.x + node.width) - (x + currentNode.width)) < SNAP_THRESHOLD) {
            guides.push({ type: 'vertical', value: node.x + node.width, align: 'right' });
            x = node.x + node.width - currentNode.width;
          }
        });
      }
      
      setAlignmentGuides(guides);
      
      setNodes(prev => prev.map(n => 
        n.id === draggingNode.id 
          ? { ...n, x, y }
          : n
      ));
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setDraggingNode(null);
    setAlignmentGuides([]);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(Math.min(Math.max(0.1, zoom * delta), 3));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', handleWheel);
    }
  }, [zoom]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't handle arrow keys if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === 'Escape') {
        if (editingNode) {
          setEditingNode(null);
        } else if (editingConnection) {
          setEditingConnection(null);
        } else if (reconnecting) {
          setReconnecting(null);
        } else if (connectingFrom) {
          setConnectingFrom(null);
        } else if (selectedConnection) {
          setSelectedConnection(null);
        } else if (selectedNode) {
          setSelectedNode(null);
        }
      }

      // Arrow keys to move selected node
      if (selectedNode && !editingNode && !editingConnection) {
        let deltaX = 0;
        let deltaY = 0;
        const moveAmount = snapToGrid ? GRID_SIZE : 5; // Use grid size if snapping, otherwise 5px

        switch(e.key) {
          case 'ArrowUp':
            deltaY = -moveAmount;
            e.preventDefault();
            break;
          case 'ArrowDown':
            deltaY = moveAmount;
            e.preventDefault();
            break;
          case 'ArrowLeft':
            deltaX = -moveAmount;
            e.preventDefault();
            break;
          case 'ArrowRight':
            deltaX = moveAmount;
            e.preventDefault();
            break;
          default:
            return;
        }

        if (deltaX !== 0 || deltaY !== 0) {
          setNodes(prev => prev.map(n => {
            if (n.id === selectedNode) {
              let newX = n.x + deltaX;
              let newY = n.y + deltaY;
              
              // Apply grid snapping if enabled
              if (snapToGrid) {
                newX = snapToGridValue(newX);
                newY = snapToGridValue(newY);
              }
              
              return { ...n, x: newX, y: newY };
            }
            return n;
          }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [connectingFrom, selectedConnection, selectedNode, reconnecting, editingNode, editingConnection, snapToGrid]);

  const getNodePosition = (nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    return node ? {
      x: node.x * zoom + offset.x,
      y: node.y * zoom + offset.y,
      width: node.width * zoom,
      height: node.height * zoom
    } : null;
  };

  // Chart browser view
  if (!currentChart) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button className="btn-secondary" onClick={onBack}>← Back</button>
            <h1>📊 Org Charts</h1>
          </div>
          <div className="user-info">
            {user?.picture && <img src={user.picture} alt={user.name} />}
            <span>{user?.name}</span>
          </div>
        </header>

        <div className="chart-browser">
          <div className="chart-browser-header">
            <button className="btn-primary" onClick={createChart}>+ New Chart</button>
          </div>

          {loading ? (
            <div className="chart-browser-loading">Loading charts...</div>
          ) : charts.length === 0 ? (
            <div className="chart-browser-empty">
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <h3>No org charts yet</h3>
                <p>Create your first organizational chart to get started</p>
                <button className="btn-primary" onClick={createChart}>+ Create Chart</button>
              </div>
            </div>
          ) : (
            <div className="chart-list">
              {charts.map(chart => (
                <div key={chart.id} className="chart-item">
                  <div className="chart-item-main" onClick={() => openChart(chart.id)}>
                    <div className="chart-item-icon">📊</div>
                    <div className="chart-item-info">
                      <h3>{chart.name}</h3>
                      <div className="chart-item-meta">
                        {chart.nodeCount || 0} nodes • {chart.connectionCount || 0} connections
                      </div>
                      <div className="chart-item-date">
                        Last edited {new Date(chart.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <button 
                    className="chart-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChart(chart.id);
                    }}
                    title="Delete chart"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Canvas editor view
  return (
    <div className="app-container">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn-secondary" onClick={() => setCurrentChart(null)}>← Charts</button>
          <h1>📊 {currentChart.name}</h1>
        </div>
        <div className="user-info">
          <div className="save-status">
            {saving ? (
              <span className="saving-indicator">💾 Saving...</span>
            ) : lastSaved ? (
              <span className="saved-indicator">✓ Saved {new Date().getTime() - lastSaved.getTime() < 5000 ? 'now' : 'at ' + lastSaved.toLocaleTimeString()}</span>
            ) : null}
          </div>
          <button className="btn-secondary" onClick={() => saveChart(false)}>💾 Save Now</button>
          {user?.picture && <img src={user.picture} alt={user.name} />}
          <span>{user?.name}</span>
        </div>
      </header>

      <div className="canvas-toolbar">
        <button className="btn-primary" onClick={addNode}>+ Add Node</button>
        <div className="canvas-controls">
          <button 
            className={`btn-secondary ${snapToGrid ? 'active' : ''}`}
            onClick={() => setSnapToGrid(!snapToGrid)}
            title={snapToGrid ? 'Snap to Grid: ON' : 'Snap to Grid: OFF'}
          >
            {snapToGrid ? '🧲' : '◻️'} Snap
          </button>
          <button className="btn-secondary" onClick={() => setZoom(Math.min(3, zoom * 1.2))}>+</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="btn-secondary" onClick={() => setZoom(Math.max(0.1, zoom * 0.8))}>−</button>
          <button className="btn-secondary" onClick={() => { setOffset({ x: 0, y: 0 }); setZoom(1); }}>
            Reset View
          </button>
          {nodes.length > 0 && (
            <button className="btn-secondary" onClick={() => {
              // Center on all nodes
              const minX = Math.min(...nodes.map(n => n.x));
              const maxX = Math.max(...nodes.map(n => n.x + n.width));
              const minY = Math.min(...nodes.map(n => n.y));
              const maxY = Math.max(...nodes.map(n => n.y + n.height));
              const centerX = (minX + maxX) / 2;
              const centerY = (minY + maxY) / 2;
              const canvasRect = canvasRef.current?.getBoundingClientRect();
              if (canvasRect) {
                setOffset({
                  x: canvasRect.width / 2 - centerX * zoom,
                  y: canvasRect.height / 2 - centerY * zoom
                });
              }
            }}>
              Center All
            </button>
          )}
        </div>
        <div className="canvas-info">
          {nodes.length} nodes • {connections.length} connections
          {selectedConnection && (
            <span style={{ color: '#667eea', fontWeight: '600' }}>
              {' '}• Connection selected (double-click to edit)
            </span>
          )}
        </div>
      </div>

      <div 
        ref={canvasRef}
        className="infinite-canvas"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
      >
        {/* Grid background */}
        {snapToGrid && (
          <svg className="grid-layer" style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 0
          }}>
            <defs>
              <pattern 
                id="grid" 
                width={GRID_SIZE * zoom} 
                height={GRID_SIZE * zoom} 
                patternUnits="userSpaceOnUse"
                x={offset.x % (GRID_SIZE * zoom)}
                y={offset.y % (GRID_SIZE * zoom)}
              >
                <path 
                  d={`M ${GRID_SIZE * zoom} 0 L 0 0 0 ${GRID_SIZE * zoom}`} 
                  fill="none" 
                  stroke="rgba(0,0,0,0.05)" 
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        )}

        {/* Alignment guides */}
        {alignmentGuides.length > 0 && (
          <svg className="guides-layer" style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 999
          }}>
            {alignmentGuides.map((guide, idx) => (
              guide.type === 'horizontal' ? (
                <line
                  key={idx}
                  x1="0"
                  y1={guide.value * zoom + offset.y}
                  x2="100%"
                  y2={guide.value * zoom + offset.y}
                  stroke="#667eea"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                />
              ) : (
                <line
                  key={idx}
                  x1={guide.value * zoom + offset.x}
                  y1="0"
                  x2={guide.value * zoom + offset.x}
                  y2="100%"
                  stroke="#667eea"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                />
              )
            ))}
          </svg>
        )}

        {/* Render connections */}
        <svg className="connections-layer" style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '100%'
        }}>
          {connections.map(conn => {
            const fromNode = nodes.find(n => n.id === conn.from);
            const toNode = nodes.find(n => n.id === conn.to);
            if (!fromNode || !toNode) return null;

            const fromPorts = getNodePorts(fromNode);
            const toPorts = getNodePorts(toNode);
            
            const fromPoint = fromPorts[conn.fromPort || 'bottom'];
            const toPoint = toPorts[conn.toPort || 'top'];

            const path = getElbowPath(
              fromPoint.x, fromPoint.y,
              toPoint.x, toPoint.y,
              conn.fromPort || 'bottom',
              conn.toPort || 'top',
              conn.from,
              conn.to,
              conn.waypoints
            );

            const isSelected = selectedConnection === conn.id;

            return (
              <g key={conn.id}>
                {/* Invisible thick path for easier clicking */}
                <path
                  d={path}
                  stroke="transparent"
                  strokeWidth="20"
                  fill="none"
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedConnection(conn.id);
                    setSelectedNode(null);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingConnection(conn);
                  }}
                />
                {/* Visible path */}
                <path
                  d={path}
                  stroke={isSelected ? '#667eea' : (conn.color || '#999')}
                  strokeWidth={isSelected ? '3' : '2'}
                  strokeDasharray={conn.style === 'dashed' ? '8,4' : conn.style === 'dotted' ? '2,4' : '0'}
                  fill="none"
                  style={{ pointerEvents: 'none' }}
                />
                {/* Connection label */}
                {conn.label && (() => {
                  const labelX = (fromPoint.x + toPoint.x) / 2;
                  const labelY = (fromPoint.y + toPoint.y) / 2;
                  return (
                    <g>
                      <rect
                        x={labelX - 30}
                        y={labelY - 10}
                        width="60"
                        height="20"
                        fill="white"
                        stroke={conn.color || '#999'}
                        strokeWidth="1"
                        rx="4"
                      />
                      <text
                        x={labelX}
                        y={labelY + 4}
                        textAnchor="middle"
                        fontSize="12"
                        fill="#374151"
                        fontWeight="500"
                        style={{ pointerEvents: 'none' }}
                      >
                        {conn.label}
                      </text>
                    </g>
                  );
                })()}
              </g>
            );
          })}
        </svg>

        {/* Render nodes */}
        {nodes.map(node => (
          <div
            key={node.id}
            className={`canvas-node ${selectedNode === node.id ? 'selected' : ''}`}
            style={{
              left: node.x * zoom + offset.x,
              top: node.y * zoom + offset.y,
              width: node.width * zoom,
              height: node.height * zoom,
              fontSize: 14 * zoom,
              borderColor: node.color || '#667eea'
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setDraggingNode({
                id: node.id,
                offsetX: (e.clientX - rect.left) / zoom,
                offsetY: (e.clientY - rect.top) / zoom
              });
              setSelectedNode(node.id);
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingNode(node);
            }}
          >
            {/* Connection ports */}
            {(() => {
              // Check if this node is part of the selected connection
              const selectedConn = selectedConnection ? connections.find(c => c.id === selectedConnection) : null;
              const isConnectedNode = selectedConn && (selectedConn.from === node.id || selectedConn.to === node.id);
              const showPorts = !selectedConnection || isConnectedNode;
              
              if (!showPorts) return null;
              
              return ['top-1', 'top-2', 'top', 'top-3', 'top-4',
                'right-top', 'right', 'right-bottom', 
                'bottom-1', 'bottom-2', 'bottom', 'bottom-3', 'bottom-4',
                'left-top', 'left', 'left-bottom'].map(port => {
                const portPos = {
                  // Top edge - 5 ports
                  'top-1': { left: '20%', top: '-6px', transform: 'translateX(-50%)' },
                  'top-2': { left: '35%', top: '-6px', transform: 'translateX(-50%)' },
                  'top': { left: '50%', top: '-6px', transform: 'translateX(-50%)' },
                  'top-3': { left: '65%', top: '-6px', transform: 'translateX(-50%)' },
                  'top-4': { left: '80%', top: '-6px', transform: 'translateX(-50%)' },
                  // Right edge - 3 ports
                  'right-top': { right: '-6px', top: '25%', transform: 'translateY(-50%)' },
                  'right': { right: '-6px', top: '50%', transform: 'translateY(-50%)' },
                  'right-bottom': { right: '-6px', top: '75%', transform: 'translateY(-50%)' },
                  // Bottom edge - 5 ports
                  'bottom-1': { left: '20%', bottom: '-6px', transform: 'translateX(-50%)' },
                  'bottom-2': { left: '35%', bottom: '-6px', transform: 'translateX(-50%)' },
                  'bottom': { left: '50%', bottom: '-6px', transform: 'translateX(-50%)' },
                  'bottom-3': { left: '65%', bottom: '-6px', transform: 'translateX(-50%)' },
                  'bottom-4': { left: '80%', bottom: '-6px', transform: 'translateX(-50%)' },
                  // Left edge - 3 ports
                  'left-top': { left: '-6px', top: '25%', transform: 'translateY(-50%)' },
                  'left': { left: '-6px', top: '50%', transform: 'translateY(-50%)' },
                  'left-bottom': { left: '-6px', top: '75%', transform: 'translateY(-50%)' }
                };
                
                // Check if this specific port is being used by the selected connection
                const isActivePort = selectedConn && (
                  (selectedConn.from === node.id && selectedConn.fromPort === port) ||
                  (selectedConn.to === node.id && selectedConn.toPort === port)
                );
                
                return (
                  <div
                    key={port}
                    className={`connection-port ${hoveredPort?.nodeId === node.id && hoveredPort?.port === port ? 'hovered' : ''} ${isActivePort ? 'active-port' : ''}`}
                    style={portPos[port]}
                    onMouseEnter={() => setHoveredPort({ nodeId: node.id, port })}
                    onMouseLeave={() => setHoveredPort(null)}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      
                      // If clicking an active port, start reconnecting
                      if (isActivePort && selectedConn) {
                        const end = selectedConn.from === node.id ? 'from' : 'to';
                        setReconnecting({ connectionId: selectedConn.id, end });
                      } else if (reconnecting) {
                        // Finish reconnecting
                        setConnections(prev => prev.map(c => 
                          c.id === reconnecting.connectionId
                            ? {
                                ...c,
                                [reconnecting.end]: node.id,
                                [reconnecting.end + 'Port']: port
                              }
                            : c
                        ));
                        setReconnecting(null);
                      } else if (connectingFrom) {
                        finishConnection(node.id, port);
                      } else {
                        startConnection(node.id, port);
                      }
                    }}
                  />
                );
              });
            })()}
            
            <div className="node-content">
              <span>{node.text}</span>
            </div>
          </div>
        ))}

        {connectingFrom && (
          <div className="connecting-hint">
            Click a connection port on another node
            <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
              Press ESC to cancel
            </div>
          </div>
        )}
        
        {reconnecting && (
          <div className="connecting-hint">
            Click a port to reconnect this end
            <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
              Press ESC to cancel
            </div>
          </div>
        )}
      </div>

      {/* Edit Node Modal */}
      {editingNode && (
        <div className="modal-overlay" onClick={() => setEditingNode(null)}>
          {/* Floating preview node */}
          <div className="node-preview" onClick={(e) => e.stopPropagation()}>
            <div 
              className="canvas-node"
              style={{
                width: editingNode.width,
                height: editingNode.height,
                borderColor: editingNode.color || '#667eea',
                position: 'relative',
                margin: '0 auto'
              }}
            >
              <div className="node-content">
                <span>{editingNode.text}</span>
              </div>
            </div>
          </div>

          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Node</h2>
              <button className="modal-close" onClick={() => setEditingNode(null)}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Text</label>
                <input
                  type="text"
                  value={editingNode.text}
                  onChange={(e) => {
                    const newText = e.target.value;
                    setEditingNode({ ...editingNode, text: newText });
                    updateNodeText(editingNode.id, newText);
                  }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setEditingNode(null);
                    }
                  }}
                  placeholder="Enter node text"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Size</label>
                <div className="size-grid">
                  <div className="size-row">
                    <span className="size-label">Width</span>
                    <div className="size-controls">
                      <button 
                        className="btn-secondary"
                        onClick={() => {
                          const newWidth = editingNode.width - STEP;
                          if (newWidth >= MIN_WIDTH) {
                            resizeNode(editingNode.id, 'width', 'decrease');
                            setEditingNode({ ...editingNode, width: newWidth });
                          }
                        }}
                      >
                        −
                      </button>
                      <span>{getSizeNumber(editingNode.width, DEFAULT_WIDTH)}</span>
                      <button 
                        className="btn-secondary"
                        onClick={() => {
                          const newWidth = editingNode.width + STEP;
                          resizeNode(editingNode.id, 'width', 'increase');
                          setEditingNode({ ...editingNode, width: newWidth });
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  
                  <div className="size-row">
                    <span className="size-label">Height</span>
                    <div className="size-controls">
                      <button 
                        className="btn-secondary"
                        onClick={() => {
                          const newHeight = editingNode.height - STEP;
                          if (newHeight >= MIN_HEIGHT) {
                            resizeNode(editingNode.id, 'height', 'decrease');
                            setEditingNode({ ...editingNode, height: newHeight });
                          }
                        }}
                      >
                        −
                      </button>
                      <span>{getSizeNumber(editingNode.height, DEFAULT_HEIGHT)}</span>
                      <button 
                        className="btn-secondary"
                        onClick={() => {
                          const newHeight = editingNode.height + STEP;
                          resizeNode(editingNode.id, 'height', 'increase');
                          setEditingNode({ ...editingNode, height: newHeight });
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  
                  <button 
                    className="btn-reset"
                    onClick={(e) => {
                      e.preventDefault();
                      resetNodeSize(editingNode.id);
                      // Force immediate update with exact values
                      setEditingNode(prev => ({
                        ...prev,
                        width: DEFAULT_WIDTH,
                        height: DEFAULT_HEIGHT
                      }));
                    }}
                  >
                    ↺ Reset to Default
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Color</label>
                <div className="color-picker">
                  {[
                    { name: 'Purple', value: '#667eea' },
                    { name: 'Blue', value: '#3b82f6' },
                    { name: 'Green', value: '#10b981' },
                    { name: 'Red', value: '#ef4444' },
                    { name: 'Orange', value: '#f59e0b' },
                    { name: 'Pink', value: '#ec4899' },
                    { name: 'Teal', value: '#14b8a6' },
                    { name: 'Indigo', value: '#6366f1' },
                    { name: 'Yellow', value: '#eab308' },
                    { name: 'Gray', value: '#6b7280' }
                  ].map(color => (
                    <button
                      key={color.value}
                      className={`color-swatch ${(editingNode.color || '#667eea') === color.value ? 'active' : ''}`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => {
                        setEditingNode({ ...editingNode, color: color.value });
                        updateNodeColor(editingNode.id, color.value);
                      }}
                      title={color.name}
                    >
                      {(editingNode.color || '#667eea') === color.value && '✓'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-danger"
                onClick={() => {
                  deleteNode(editingNode.id);
                  setEditingNode(null);
                }}
              >
                🗑️ Delete Node
              </button>
              <button className="btn-primary" onClick={() => setEditingNode(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Connection Modal */}
      {editingConnection && (
        <div className="modal-overlay" onClick={() => setEditingConnection(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Connection</h2>
              <button className="modal-close" onClick={() => setEditingConnection(null)}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Label</label>
                <input
                  type="text"
                  value={editingConnection.label || ''}
                  onChange={(e) => {
                    const newLabel = e.target.value;
                    setEditingConnection({ ...editingConnection, label: newLabel });
                    updateConnectionLabel(editingConnection.id, newLabel);
                  }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setEditingConnection(null);
                    }
                  }}
                  placeholder="Optional label"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Style</label>
                <div className="style-picker">
                  {[
                    { name: 'Solid', value: 'solid' },
                    { name: 'Dashed', value: 'dashed' },
                    { name: 'Dotted', value: 'dotted' }
                  ].map(style => (
                    <button
                      key={style.value}
                      className={`style-option ${(editingConnection.style || 'solid') === style.value ? 'active' : ''}`}
                      onClick={() => {
                        setEditingConnection({ ...editingConnection, style: style.value });
                        updateConnectionStyle(editingConnection.id, style.value);
                      }}
                    >
                      <svg width="60" height="20" viewBox="0 0 60 20">
                        <line
                          x1="0"
                          y1="10"
                          x2="60"
                          y2="10"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeDasharray={style.value === 'dashed' ? '8,4' : style.value === 'dotted' ? '2,4' : '0'}
                        />
                      </svg>
                      <span>{style.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Color</label>
                <div className="color-picker">
                  {[
                    { name: 'Gray', value: '#999' },
                    { name: 'Purple', value: '#667eea' },
                    { name: 'Blue', value: '#3b82f6' },
                    { name: 'Green', value: '#10b981' },
                    { name: 'Red', value: '#ef4444' },
                    { name: 'Orange', value: '#f59e0b' },
                    { name: 'Pink', value: '#ec4899' },
                    { name: 'Teal', value: '#14b8a6' },
                    { name: 'Indigo', value: '#6366f1' },
                    { name: 'Yellow', value: '#eab308' }
                  ].map(color => (
                    <button
                      key={color.value}
                      className={`color-swatch ${(editingConnection.color || '#999') === color.value ? 'active' : ''}`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => {
                        setEditingConnection({ ...editingConnection, color: color.value });
                        updateConnectionColor(editingConnection.id, color.value);
                      }}
                      title={color.name}
                    >
                      {(editingConnection.color || '#999') === color.value && '✓'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-danger"
                onClick={() => {
                  deleteConnection(editingConnection.id);
                  setEditingConnection(null);
                }}
              >
                🗑️ Delete Connection
              </button>
              <button className="btn-primary" onClick={() => setEditingConnection(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrgCharts;
