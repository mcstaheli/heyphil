import React, { useState, useRef, useEffect } from 'react';
import './OrgCharts.css';

function OrgCharts({ user, onBack }) {
  const canvasRef = useRef(null);
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

  // Connection ports: top, right, bottom, left
  const getNodePorts = (node) => {
    const scaled = {
      x: node.x * zoom + offset.x,
      y: node.y * zoom + offset.y,
      width: node.width * zoom,
      height: node.height * zoom
    };
    return {
      top: { x: scaled.x + scaled.width / 2, y: scaled.y },
      right: { x: scaled.x + scaled.width, y: scaled.y + scaled.height / 2 },
      bottom: { x: scaled.x + scaled.width / 2, y: scaled.y + scaled.height },
      left: { x: scaled.x, y: scaled.y + scaled.height / 2 }
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
      text: `Node ${nodes.length + 1}`
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

  // Generate simple elbow path - always one 90° bend
  const getElbowPath = (x1, y1, x2, y2, fromPort, toPort) => {
    // Horizontal connections (left/right ports)
    if ((fromPort === 'right' || fromPort === 'left') && (toPort === 'right' || toPort === 'left')) {
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    }
    
    // Vertical connections (top/bottom ports)
    if ((fromPort === 'top' || fromPort === 'bottom') && (toPort === 'top' || toPort === 'bottom')) {
      const midY = (y1 + y2) / 2;
      return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }
    
    // Mixed: right/left to top/bottom
    if ((fromPort === 'right' || fromPort === 'left') && (toPort === 'top' || toPort === 'bottom')) {
      return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
    }
    
    // Mixed: top/bottom to right/left
    if ((fromPort === 'top' || fromPort === 'bottom') && (toPort === 'right' || toPort === 'left')) {
      return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
    }
    
    // Fallback
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
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - offset.x) / zoom;
      const y = (e.clientY - rect.top - offset.y) / zoom;
      
      setNodes(nodes.map(n => 
        n.id === draggingNode.id 
          ? { ...n, x: x - draggingNode.offsetX, y: y - draggingNode.offsetY }
          : n
      ));
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setDraggingNode(null);
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

  const getNodePosition = (nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    return node ? {
      x: node.x * zoom + offset.x,
      y: node.y * zoom + offset.y,
      width: node.width * zoom,
      height: node.height * zoom
    } : null;
  };

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

      <div className="canvas-toolbar">
        <button className="btn-primary" onClick={addNode}>+ Add Node</button>
        <div className="canvas-controls">
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
              ✕
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
              fontSize: 14 * zoom
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
          >
            {/* Connection ports */}
            {['top', 'right', 'bottom', 'left'].map(port => {
              const portPos = {
                top: { left: '50%', top: '-6px', transform: 'translateX(-50%)' },
                right: { right: '-6px', top: '50%', transform: 'translateY(-50%)' },
                bottom: { left: '50%', bottom: '-6px', transform: 'translateX(-50%)' },
                left: { left: '-6px', top: '50%', transform: 'translateY(-50%)' }
              };
              
              return (
                <div
                  key={port}
                  className={`connection-port ${hoveredPort?.nodeId === node.id && hoveredPort?.port === port ? 'hovered' : ''}`}
                  style={portPos[port]}
                  onMouseEnter={() => setHoveredPort({ nodeId: node.id, port })}
                  onMouseLeave={() => setHoveredPort(null)}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (connectingFrom) {
                      finishConnection(node.id, port);
                    } else {
                      startConnection(node.id, port);
                    }
                  }}
                />
              );
            })}
            
            <div className="node-content">
              {selectedNode === node.id ? (
                <input
                  type="text"
                  value={node.text}
                  onChange={(e) => updateNodeText(node.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  autoFocus
                  style={{ fontSize: 14 * zoom }}
                />
              ) : (
                <span>{node.text}</span>
              )}
            </div>
            {selectedNode === node.id && (
              <div className="node-actions">
                <button 
                  className="node-btn node-btn-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNode(node.id);
                  }}
                  title="Delete node"
                >
                  🗑️
                </button>
              </div>
            )}
          </div>
        ))}

        {connectingFrom && (
          <div className="connecting-hint">
            Click a connection port on another node
          </div>
        )}
      </div>
    </div>
  );
}

export default OrgCharts;
