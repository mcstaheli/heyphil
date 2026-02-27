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

  const saveChart = async (silent = false) => {
    if (!currentChart) return;

    try {
      setSaving(true);
      const res = await fetch(`${API_BASE_URL}/api/orgcharts/${currentChart.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ nodes, connections })
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
      saveChart(true); // Silent auto-save
    }, 2000);

    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [nodes, connections, currentChart]);

  const deleteChart = async (chartId) => {
    if (!window.confirm('Delete this chart? This cannot be undone.')) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/orgcharts/${chartId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        setCharts(charts.filter(c => c.id !== chartId));
        if (currentChart?.id === chartId) {
          setCurrentChart(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete chart:', error);
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

  const resizeNode = (nodeId, direction) => {
    const STANDARD_WIDTH = 200;
    const STANDARD_HEIGHT = 80;
    const STEP = 20;
    
    setNodes(nodes.map(n => {
      if (n.id !== nodeId) return n;
      
      if (direction === 'increase') {
        // Increase both dimensions
        return {
          ...n,
          width: n.width + STEP,
          height: n.height + STEP
        };
      } else {
        // Decrease
        const newWidth = Math.max(100, n.width - STEP);
        const newHeight = Math.max(40, n.height - STEP);
        
        // If at or above standard size, shrink both dimensions
        if (n.width >= STANDARD_WIDTH || n.height >= STANDARD_HEIGHT) {
          return {
            ...n,
            width: newWidth,
            height: newHeight
          };
        } else {
          // Below standard size - only shrink vertically
          return {
            ...n,
            height: newHeight
          };
        }
      }
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

  // Smart orthogonal routing - minimal segments
  const getElbowPath = (x1, y1, x2, y2, fromPort, toPort) => {
    const GAP = 20;
    
    // Determine port orientation
    const isHorizontalPort = (port) => port.startsWith('right') || port.startsWith('left');
    const isVerticalPort = (port) => port.startsWith('top') || port.startsWith('bottom');
    const isRightSide = (port) => port.startsWith('right');
    const isLeftSide = (port) => port.startsWith('left');
    const isTopSide = (port) => port.startsWith('top');
    const isBottomSide = (port) => port.startsWith('bottom');
    
    // Horizontal → Horizontal (right/left to right/left)
    if (isHorizontalPort(fromPort) && isHorizontalPort(toPort)) {
      const startX = isRightSide(fromPort) ? x1 + GAP : x1 - GAP;
      const endX = isRightSide(toPort) ? x2 + GAP : x2 - GAP;
      const midX = (startX + endX) / 2;
      
      return `M ${x1} ${y1} L ${startX} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${endX} ${y2} L ${x2} ${y2}`;
    }
    
    // Vertical → Vertical (top/bottom to top/bottom)
    if (isVerticalPort(fromPort) && isVerticalPort(toPort)) {
      const startY = isBottomSide(fromPort) ? y1 + GAP : y1 - GAP;
      const endY = isBottomSide(toPort) ? y2 + GAP : y2 - GAP;
      const midY = (startY + endY) / 2;
      
      return `M ${x1} ${y1} L ${x1} ${startY} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${endY} L ${x2} ${y2}`;
    }
    
    // Horizontal → Vertical (simple L or Z-shape)
    if (isHorizontalPort(fromPort) && isVerticalPort(toPort)) {
      // Direct L-shape if target is in the right direction
      if ((isRightSide(fromPort) && x2 >= x1) || (isLeftSide(fromPort) && x2 <= x1)) {
        // Clean L: horizontal to target's X, then vertical to target
        return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
      }
      
      // Z-shape when target is behind
      const startX = isRightSide(fromPort) ? x1 + GAP : x1 - GAP;
      const midY = (y1 + y2) / 2;
      return `M ${x1} ${y1} L ${startX} ${y1} L ${startX} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }
    
    // Vertical → Horizontal (simple L or Z-shape)
    if (isVerticalPort(fromPort) && isHorizontalPort(toPort)) {
      // Direct L-shape if target is in the right direction
      if ((isBottomSide(fromPort) && y2 >= y1) || (isTopSide(fromPort) && y2 <= y1)) {
        // Clean L: vertical to target's Y, then horizontal to target
        return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
      }
      
      // Z-shape when target is behind
      const startY = isBottomSide(fromPort) ? y1 + GAP : y1 - GAP;
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} L ${x1} ${startY} L ${midX} ${startY} L ${midX} ${y2} L ${x2} ${y2}`;
    }
    
    return `M ${x1} ${y1} L ${x2} ${y2}`;
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

  // Handle Escape key to cancel connection mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (editingNode) {
          setEditingNode(null);
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [connectingFrom, selectedConnection, selectedNode, reconnecting, editingNode]);

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
            <h2>Your Org Charts</h2>
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
              {' '}• Connection selected (click ✕ to delete)
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
              conn.toPort || 'top'
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
                />
                {/* Visible path */}
                <path
                  d={path}
                  stroke={isSelected ? '#667eea' : '#999'}
                  strokeWidth={isSelected ? '3' : '2'}
                  fill="none"
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            );
          })}
        </svg>
        
        {/* Connection delete button */}
        {selectedConnection && (() => {
          const conn = connections.find(c => c.id === selectedConnection);
          if (!conn) return null;
          
          const fromNode = nodes.find(n => n.id === conn.from);
          const toNode = nodes.find(n => n.id === conn.to);
          if (!fromNode || !toNode) return null;
          
          const fromPorts = getNodePorts(fromNode);
          const toPorts = getNodePorts(toNode);
          const fromPoint = fromPorts[conn.fromPort || 'bottom'];
          const toPoint = toPorts[conn.toPort || 'top'];
          
          const midX = (fromPoint.x + toPoint.x) / 2;
          const midY = (fromPoint.y + toPoint.y) / 2;
          
          return (
            <button
              className="connection-delete-btn"
              style={{
                position: 'absolute',
                left: midX - 12,
                top: midY - 12
              }}
              onClick={() => deleteConnection(conn.id)}
              title="Delete connection"
            >
              🗑️
            </button>
          );
        })()}

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
                  placeholder="Enter node text"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Size</label>
                <div className="size-controls">
                  <button 
                    className="btn-secondary"
                    onClick={() => {
                      resizeNode(editingNode.id, 'decrease');
                      const updated = nodes.find(n => n.id === editingNode.id);
                      if (updated) setEditingNode(updated);
                    }}
                  >
                    − Smaller
                  </button>
                  <span>{editingNode.width}×{editingNode.height}px</span>
                  <button 
                    className="btn-secondary"
                    onClick={() => {
                      resizeNode(editingNode.id, 'increase');
                      const updated = nodes.find(n => n.id === editingNode.id);
                      if (updated) setEditingNode(updated);
                    }}
                  >
                    + Larger
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
    </div>
  );
}

export default OrgCharts;
