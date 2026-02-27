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

  const addNode = () => {
    // Get canvas center in world coordinates
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const centerX = canvasRect ? (canvasRect.width / 2 - offset.x) / zoom : 400;
    const centerY = canvasRect ? (canvasRect.height / 2 - offset.y) / zoom : 300;
    
    // Stagger nodes slightly so they don't stack
    const stagger = nodes.length * 20;
    
    const newNode = {
      id: Date.now(),
      x: centerX + stagger,
      y: centerY + stagger,
      width: 200,
      height: 80,
      text: 'New Node'
    };
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

  const startConnection = (nodeId) => {
    setConnectingFrom(nodeId);
  };

  const finishConnection = (toNodeId) => {
    if (connectingFrom && connectingFrom !== toNodeId) {
      const newConnection = {
        id: Date.now(),
        from: connectingFrom,
        to: toNodeId
      };
      setConnections([...connections, newConnection]);
    }
    setConnectingFrom(null);
  };

  const handleCanvasMouseDown = (e) => {
    if (e.target === canvasRef.current) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      setSelectedNode(null);
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
          height: '100%',
          pointerEvents: 'none'
        }}>
          {connections.map(conn => {
            const fromPos = getNodePosition(conn.from);
            const toPos = getNodePosition(conn.to);
            if (!fromPos || !toPos) return null;

            const x1 = fromPos.x + fromPos.width / 2;
            const y1 = fromPos.y + fromPos.height;
            const x2 = toPos.x + toPos.width / 2;
            const y2 = toPos.y;

            return (
              <line
                key={conn.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#00f5ff"
                strokeWidth="2"
              />
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
              if (connectingFrom) {
                finishConnection(node.id);
              }
            }}
          >
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
                  className="node-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    startConnection(node.id);
                  }}
                  title="Connect to another node"
                >
                  🔗
                </button>
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
            Click another node to connect
          </div>
        )}
      </div>
    </div>
  );
}

export default OrgCharts;
