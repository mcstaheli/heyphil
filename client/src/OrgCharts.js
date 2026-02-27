import React, { useState, useEffect } from 'react';
import './OrgCharts.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function OrgCharts({ user, onBack }) {
  const [charts, setCharts] = useState([]);
  const [currentChart, setCurrentChart] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showNodeEditor, setShowNodeEditor] = useState(false);
  const [draggedNode, setDraggedNode] = useState(null);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('authToken');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  // Load all charts
  useEffect(() => {
    loadCharts();
  }, []);

  const loadCharts = async () => {
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
  };

  const loadChart = async (chartId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/orgcharts/${chartId}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentChart(data);
        setNodes(data.nodes || []);
      }
    } catch (error) {
      console.error('Failed to load chart:', error);
    }
  };

  const createChart = async () => {
    const name = prompt('Chart name:');
    if (!name) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/orgcharts`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name })
      });
      
      if (res.ok) {
        const data = await res.json();
        console.log('Chart created:', data);
        await loadCharts();
        // Auto-open the newly created chart
        if (data.id) {
          loadChart(data.id);
        }
      } else {
        const error = await res.json();
        alert(`Failed to create chart: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to create chart:', error);
      alert(`Failed to create chart: ${error.message}`);
    }
  };

  const addNode = () => {
    const newNode = {
      id: Date.now(),
      title: 'New Position',
      name: '',
      parentId: selectedNode?.id || null,
      x: 400,
      y: 100,
      children: []
    };
    setNodes([...nodes, newNode]);
    setSelectedNode(newNode);
    setShowNodeEditor(true);
  };

  const updateNode = (nodeId, updates) => {
    setNodes(nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n));
  };

  const deleteNode = (nodeId) => {
    if (!window.confirm('Delete this node and all children?')) return;
    
    const deleteRecursive = (id) => {
      const childIds = nodes.filter(n => n.parentId === id).map(n => n.id);
      childIds.forEach(deleteRecursive);
      setNodes(prev => prev.filter(n => n.id !== id));
    };
    
    deleteRecursive(nodeId);
    setSelectedNode(null);
  };

  const saveChart = async () => {
    if (!currentChart) return;

    try {
      await fetch(`${API_BASE_URL}/api/orgcharts/${currentChart.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ nodes })
      });
      alert('Chart saved!');
    } catch (error) {
      console.error('Failed to save chart:', error);
    }
  };

  const handleDragStart = (e, node) => {
    setDraggedNode(node);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e, targetNode) => {
    e.preventDefault();
    if (draggedNode && draggedNode.id !== targetNode.id) {
      // Check if target is not a descendant of dragged node
      const isDescendant = (parent, child) => {
        if (parent.id === child.id) return true;
        const children = nodes.filter(n => n.parentId === parent.id);
        return children.some(c => isDescendant(parent, c));
      };

      if (!isDescendant(draggedNode, targetNode)) {
        updateNode(draggedNode.id, { parentId: targetNode.id });
      }
    }
    setDraggedNode(null);
  };

  const renderNode = (node, depth = 0) => {
    const children = nodes.filter(n => n.parentId === node.id);
    
    return (
      <div key={node.id} className="org-node-container">
        <div
          className={`org-node ${selectedNode?.id === node.id ? 'selected' : ''}`}
          draggable
          onDragStart={(e) => handleDragStart(e, node)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, node)}
          onClick={() => setSelectedNode(node)}
        >
          <div className="org-node-title">{node.title}</div>
          {node.name && <div className="org-node-name">{node.name}</div>}
          {node.department && <div className="org-node-dept">{node.department}</div>}
        </div>
        
        {children.length > 0 && (
          <div className="org-node-children">
            {children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Chart selection view
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

        <div className="charts-list">
          <div className="charts-toolbar">
            <h2>Your Charts</h2>
            <button className="btn-primary" onClick={createChart}>+ New Chart</button>
          </div>

          <div className="charts-grid">
            {charts.map(chart => (
              <div
                key={chart.id}
                className="chart-card"
                onClick={() => loadChart(chart.id)}
              >
                <h3>{chart.name}</h3>
                <p>{chart.nodeCount || 0} positions</p>
                <small>Updated {new Date(chart.updatedAt).toLocaleDateString()}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Chart editor view
  const rootNodes = nodes.filter(n => !n.parentId);

  return (
    <div className="app-container">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn-secondary" onClick={() => setCurrentChart(null)}>← Charts</button>
          <h1>📊 {currentChart.name}</h1>
        </div>
        <div className="user-info">
          <button className="btn-secondary" onClick={saveChart}>💾 Save</button>
          {user?.picture && <img src={user.picture} alt={user.name} />}
          <span>{user?.name}</span>
        </div>
      </header>

      <div className="org-chart-editor">
        <div className="org-toolbar">
          <button className="btn-primary" onClick={addNode}>
            + Add {selectedNode ? 'Child' : 'Root'} Position
          </button>
          {selectedNode && (
            <>
              <button className="btn-secondary" onClick={() => setShowNodeEditor(true)}>✏️ Edit</button>
              <button className="btn-danger" onClick={() => deleteNode(selectedNode.id)}>🗑️ Delete</button>
            </>
          )}
        </div>

        <div className="org-canvas">
          {rootNodes.length === 0 ? (
            <div className="org-empty">
              <p>No positions yet. Click "Add Root Position" to start.</p>
            </div>
          ) : (
            <div className="org-tree">
              {rootNodes.map(node => renderNode(node))}
            </div>
          )}
        </div>
      </div>

      {showNodeEditor && selectedNode && (
        <NodeEditor
          node={selectedNode}
          onSave={(updates) => {
            updateNode(selectedNode.id, updates);
            setShowNodeEditor(false);
          }}
          onClose={() => setShowNodeEditor(false)}
        />
      )}
    </div>
  );
}

function NodeEditor({ node, onSave, onClose }) {
  const [formData, setFormData] = useState({
    title: node.title || '',
    name: node.name || '',
    department: node.department || '',
    email: node.email || '',
    phone: node.phone || ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Position</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Job Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Department</label>
            <input
              type="text"
              value={formData.department}
              onChange={(e) => setFormData({ ...formData, department: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default OrgCharts;
