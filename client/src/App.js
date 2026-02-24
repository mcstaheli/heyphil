import React, { useState, useEffect } from 'react';
import './App.css';
import './Loading.css';
import Landing from './Landing';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [user, setUser] = useState(null);
  const [currentApp, setCurrentApp] = useState(null);
  const [showDevTools, setShowDevTools] = useState(false);

  useEffect(() => {
    // Check for token in URL (after OAuth callback)
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    if (token) {
      localStorage.setItem('authToken', token);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('authToken');
    
    if (!token) {
      setAuthenticated(false);
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE_URL}/auth/status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (res.ok) {
        const data = await res.json();
        setAuthenticated(true);
        setUser(data.user);
      } else {
        localStorage.removeItem('authToken');
        setAuthenticated(false);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem('authToken');
      setAuthenticated(false);
    }
  };

  const handleLogin = () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    setAuthenticated(false);
    setUser(null);
    setCurrentApp(null);
  };

  // Login screen
  if (authenticated === false) {
    return <Landing onSignIn={handleLogin} />;
  }

  // Loading
  if (authenticated === null) {
    return (
      <div className="loading">
        <div className="loading-content">
          <div className="loading-icon">⚙️</div>
          <h2 className="loading-text">Initializing</h2>
          <p className="loading-subtext">System Authentication</p>
          <div className="loading-spinner">
            <div className="spinner-dot"></div>
            <div className="spinner-dot"></div>
            <div className="spinner-dot"></div>
          </div>
        </div>
      </div>
    );
  }

  // App launcher
  if (!currentApp) {
    return (
      <>
        <div className="app-container">
          <header className="app-header">
            <h1>🤖 HeyPhil</h1>
            <div className="user-info">
              {user?.picture && <img src={user.picture} alt={user.name} />}
              <span>{user?.name}</span>
              <button className="btn-secondary" onClick={handleLogout}>Logout</button>
            </div>
          </header>
          <div className="app-launcher">
            <h2>Your Apps</h2>
            <div className="app-grid">
              <div className="app-card" onClick={() => setCurrentApp('origination')}>
                <div className="app-icon">📋</div>
                <h3>Origination Board</h3>
                <p>Manage projects with your team</p>
              </div>
              <div className="app-card disabled">
                <div className="app-icon">📧</div>
                <h3>Email Triage</h3>
                <p>Coming soon...</p>
              </div>
            </div>
          </div>
        </div>
        {showDevTools && <DevTools user={user} onClose={() => setShowDevTools(false)} />}
        {!showDevTools && (
          <button className="devtools-toggle" onClick={() => setShowDevTools(true)}>
            🔧 Dev Tools
          </button>
        )}
      </>
    );
  }

  // Origination Board app
  if (currentApp === 'origination') {
    return (
      <>
        <OriginationBoard user={user} onBack={() => setCurrentApp(null)} onLogout={handleLogout} />
        {showDevTools && <DevTools user={user} onClose={() => setShowDevTools(false)} />}
        {!showDevTools && (
          <button className="devtools-toggle" onClick={() => setShowDevTools(true)}>
            🔧 Dev Tools
          </button>
        )}
      </>
    );
  }

}

function OriginationBoard({ user, onBack, onLogout }) {
  const [cards, setCards] = useState([]);
  const [people, setPeople] = useState({});
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNewCard, setShowNewCard] = useState(false);
  const [newCardColumn, setNewCardColumn] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [draggedCard, setDraggedCard] = useState(null);
  const [filterOwner, setFilterOwner] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('dateCreated');
  const [selectedCards, setSelectedCards] = useState(new Set());
  const [showMetrics, setShowMetrics] = useState(false);
  const [showBulkActions, setShowBulkActions] = useState(false);

  const columns = [
    { id: 'ideation', title: 'Ideation', color: '#bbdefb' },
    { id: 'on-deck', title: 'On Deck', color: '#90caf9' },
    { id: 'ic-diligence', title: 'IC - Diligence', color: '#e0e0e0' },
    { id: 'due-diligence', title: 'Due Diligence', color: '#64b5f6' },
    { id: 'ic-capitalization', title: 'IC - Capitalization', color: '#bdbdbd' },
    { id: 'capitalization', title: 'Capitalization', color: '#42a5f5' },
    { id: 'ic-close', title: 'IC - Close', color: '#9e9e9e' },
    { id: 'closed', title: 'Closed', color: '#2196f3' }
  ];

  useEffect(() => {
    loadBoard();
  }, []);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('authToken');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  const loadBoard = async () => {
    setLoading(true);
    const startTime = Date.now();
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/origination/board`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      setCards(data.cards || []);
      setPeople(data.people || {});
      setMetrics(data.metrics || null);
    } catch (error) {
      console.error('Failed to load board:', error);
    }
    
    // Ensure loading screen shows for at least 1.5 seconds
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, 1500 - elapsed);
    setTimeout(() => setLoading(false), remaining);
  };

  const createCard = async (cardData) => {
    try {
      await fetch(`${API_BASE_URL}/api/origination/card`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(cardData)
      });
      
      // Add card locally without loading screen
      const newCard = {
        ...cardData,
        id: `card_${Date.now()}_temp`,
        actions: [],
        activity: [],
        daysInStage: 0,
        dateCreated: new Date().toISOString()
      };
      setCards(prevCards => [...prevCards, newCard]);
      setShowNewCard(false);
      
      // Refresh in background to get real ID
      setTimeout(() => loadBoard(), 1000);
    } catch (error) {
      console.error('Failed to create card:', error);
    }
  };

  const updateCard = async (cardId, cardData) => {
    try {
      await fetch(`${API_BASE_URL}/api/origination/card/${cardId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(cardData)
      });
      
      // Update locally without loading screen
      setCards(prevCards => prevCards.map(c => 
        c.id === cardId ? { ...c, ...cardData } : c
      ));
      setEditingCard(null);
    } catch (error) {
      console.error('Failed to update card:', error);
    }
  };

  const moveCard = async (cardId, newColumn) => {
    const card = cards.find(c => c.id === cardId);
    if (!card || card.column === newColumn) return;

    // Optimistic update - update UI immediately
    setCards(prevCards => 
      prevCards.map(c => 
        c.id === cardId ? { ...c, column: newColumn } : c
      )
    );

    // Update backend in background
    try {
      await fetch(`${API_BASE_URL}/api/origination/card/${cardId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ...card, column: newColumn })
      });
    } catch (error) {
      console.error('Failed to move card:', error);
      // Revert on error
      await loadBoard();
    }
  };

  const handleDragStart = (e, card) => {
    setDraggedCard(card);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, columnId) => {
    e.preventDefault();
    if (draggedCard) {
      moveCard(draggedCard.id, columnId);
      setDraggedCard(null);
    }
  };
  
  const toggleAction = async (rowIndex, completed, cardId, cardTitle) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/origination/action/toggle`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ rowIndex, completed, cardId, cardTitle })
      });
      
      if (response.ok && editingCard) {
        // Update the editing card locally
        const updatedCard = {
          ...editingCard,
          actions: editingCard.actions.map(action => 
            action.rowIndex === rowIndex
              ? {
                  ...action,
                  completedOn: completed ? new Date().toISOString() : null,
                  completedBy: completed ? user?.name || user?.email : null
                }
              : action
          )
        };
        setEditingCard(updatedCard);
        
        // Update cards array for card view
        setCards(prevCards => prevCards.map(c => 
          c.id === cardId ? updatedCard : c
        ));
      }
    } catch (error) {
      console.error('Failed to toggle action:', error);
    }
  };
  
  const exportToCSV = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/origination/export`, {
        headers: getAuthHeaders()
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `origination-board-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export:', error);
    }
  };
  
  const bulkUpdateCards = async (updates) => {
    try {
      await fetch(`${API_BASE_URL}/api/origination/bulk-update`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ cardIds: Array.from(selectedCards), updates })
      });
      setSelectedCards(new Set());
      setShowBulkActions(false);
      await loadBoard();
    } catch (error) {
      console.error('Failed bulk update:', error);
    }
  };
  
  const addAction = async (cardId, cardTitle, text) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/origination/action`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ cardId, cardTitle, text })
      });
      
      if (response.ok && editingCard) {
        // Update the editing card locally without full reload
        const updatedCard = {
          ...editingCard,
          actions: [
            ...(editingCard.actions || []),
            {
              cardId,
              cardTitle,
              text,
              completedOn: null,
              completedBy: null,
              rowIndex: -1 // Will be updated on next full refresh
            }
          ]
        };
        setEditingCard(updatedCard);
        
        // Update cards array in background for card view
        setCards(prevCards => prevCards.map(c => 
          c.id === cardId ? updatedCard : c
        ));
      }
    } catch (error) {
      console.error('Failed to add action:', error);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-content">
          <div className="loading-icon">⚙️</div>
          <h2 className="loading-text">Loading</h2>
          <p className="loading-subtext">Project Board</p>
          <div className="loading-spinner">
            <div className="spinner-dot"></div>
            <div className="spinner-dot"></div>
            <div className="spinner-dot"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn-secondary" onClick={onBack}>← Back</button>
          <h1>📋 Origination Board</h1>
        </div>
        <div className="user-info">
          {user?.picture && <img src={user.picture} alt={user.name} />}
          <span>{user?.name}</span>
          <button className="btn-secondary" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <div className="board-toolbar">
        <div className="board-filters">
          <input
            type="text"
            placeholder="🔍 Search deals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)}>
            <option value="">All Owners</option>
            {Object.keys(people).map(person => (
              <option key={person} value={person}>{person}</option>
            ))}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="dateCreated">Newest First</option>
            <option value="title">Alphabetical</option>
            <option value="dealValue">Deal Size</option>
            <option value="daysInStage">Time in Stage</option>
          </select>
        </div>
        <div className="board-actions">
          <button className="btn-secondary" onClick={() => setShowMetrics(!showMetrics)}>
            📊 {showMetrics ? 'Hide' : 'Show'} Metrics
          </button>
          {selectedCards.size > 0 && (
            <button className="btn-primary" onClick={() => setShowBulkActions(true)}>
              ⚡ Bulk Actions ({selectedCards.size})
            </button>
          )}
          <button className="btn-secondary" onClick={exportToCSV}>
            📥 Export CSV
          </button>
        </div>
      </div>

      {showMetrics && metrics && (
        <div className="metrics-dashboard">
          <div className="metric-card">
            <h3>{metrics.totalDeals}</h3>
            <p>Total Deals</p>
          </div>
          <div className="metric-card">
            <h3>${(metrics.totalValue / 1000000).toFixed(1)}M</h3>
            <p>Total Value</p>
          </div>
          {Object.entries(metrics.byStage).map(([stage, data]) => (
            <div key={stage} className="metric-card">
              <h3>{data.count}</h3>
              <p>{stage.replace('-', ' ')}</p>
              <small>${(data.value / 1000).toFixed(0)}K</small>
            </div>
          ))}
        </div>
      )}

      <div className="kanban-board">
        {columns.map(column => {
          let filteredCards = cards.filter(c => {
            if (c.column !== column.id) return false;
            if (filterOwner && c.owner !== filterOwner) return false;
            if (searchQuery && !c.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
          });
          
          // Sort cards
          filteredCards.sort((a, b) => {
            if (sortBy === 'dateCreated') return new Date(b.dateCreated) - new Date(a.dateCreated);
            if (sortBy === 'title') return a.title.localeCompare(b.title);
            if (sortBy === 'dealValue') return (b.dealValue || 0) - (a.dealValue || 0);
            if (sortBy === 'daysInStage') return (b.daysInStage || 0) - (a.daysInStage || 0);
            return 0;
          });
          
          const isEmpty = filteredCards.length === 0;
          
          return (
          <div
            key={column.id}
            className={`kanban-column ${isEmpty ? 'column-empty' : ''}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, column.id)}
          >
            <div className="column-header" style={{ backgroundColor: column.color }}>
              <h3>{column.title}</h3>
              <div className="column-header-actions">
                <span className="card-count">
                  {filteredCards.length}
                </span>
                <button 
                  className="column-add-btn"
                  onClick={() => {
                    setShowNewCard(true);
                    setNewCardColumn(column.id);
                  }}
                  title="Add card"
                >
                  +
                </button>
              </div>
            </div>
            <div className="column-cards">
              {filteredCards.map(card => {
                const isIdeation = column.id === 'ideation';
                return (
                  <div
                    key={card.id}
                    className={`kanban-card ${isIdeation ? 'card-ideation' : ''} ${card.daysInStage > 30 ? 'stale-deal' : ''} ${selectedCards.has(card.id) ? 'selected' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, card)}
                    onClick={(e) => {
                      if (e.target.type === 'checkbox') return;
                      setEditingCard(card);
                    }}
                  >
                    <input
                      type="checkbox"
                      className="card-select-checkbox"
                      checked={selectedCards.has(card.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        const newSelected = new Set(selectedCards);
                        if (e.target.checked) {
                          newSelected.add(card.id);
                        } else {
                          newSelected.delete(card.id);
                        }
                        setSelectedCards(newSelected);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {card.daysInStage > 30 && <div className="stale-indicator" title={`${card.daysInStage} days in stage`}>⚠️</div>}
                    <div className="card-main">
                      {card.owner && people[card.owner] && (
                        <div className="card-photo">
                          <img src={people[card.owner]} alt={card.owner} />
                        </div>
                      )}
                      <div className="card-content">
                        <h4>{card.title}</h4>
                        {!isIdeation && card.description && <p>{card.description}</p>}
                      </div>
                    </div>
                    {card.actions && card.actions.filter(a => !a.completedOn).length > 0 && (
                      <div className="card-actions-section">
                        {card.actions.filter(a => !a.completedOn).slice(0, 3).map((action, idx) => (
                          <div key={idx} className="card-action-item" onClick={(e) => {
                            e.stopPropagation();
                            toggleAction(action.rowIndex, true, action.cardId, action.cardTitle);
                          }}>
                            <input type="checkbox" checked={false} readOnly />
                            <span>{action.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
        })}
      </div>

      {showNewCard && (
        <CardModal
          onClose={() => {
            setShowNewCard(false);
            setNewCardColumn(null);
          }}
          onSave={createCard}
          columns={columns}
          initialColumn={newCardColumn}
          toggleAction={toggleAction}
          onAddAction={addAction}
        />
      )}

      {editingCard && (
        <CardModal
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onSave={(data) => updateCard(editingCard.id, data)}
          onDelete={async (id) => {
            if (window.confirm('Are you sure you want to delete this deal? This cannot be undone.')) {
              try {
                await fetch(`${API_BASE_URL}/api/origination/card/${id}`, {
                  method: 'DELETE',
                  headers: getAuthHeaders()
                });
                setEditingCard(null);
                await loadBoard();
              } catch (error) {
                console.error('Failed to delete:', error);
              }
            }
          }}
          columns={columns}
          toggleAction={toggleAction}
          onAddAction={addAction}
        />
      )}
      
      {showBulkActions && (
        <BulkActionsModal
          selectedCount={selectedCards.size}
          columns={columns}
          people={Object.keys(people)}
          onClose={() => setShowBulkActions(false)}
          onApply={bulkUpdateCards}
        />
      )}
    </div>
  );
}

function CardModal({ card, onClose, onSave, onDelete, columns, initialColumn, toggleAction, onAddAction }) {
  const [formData, setFormData] = useState({
    title: card?.title || '',
    description: card?.description || '',
    column: card?.column || initialColumn || columns[0].id,
    owner: card?.owner || '',
    notes: card?.notes || '',
    dealValue: card?.dealValue || 0
  });
  const [newActionText, setNewActionText] = useState('');
  const [showActivity, setShowActivity] = useState(false);
  
  const handleAddAction = async () => {
    if (!newActionText.trim() || !card) return;
    if (onAddAction) {
      await onAddAction(card.id, card.title, newActionText.trim());
      setNewActionText('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>{card ? 'Edit Project' : 'New Project'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows="3"
            />
          </div>
          <div className="form-group">
            <label>Status</label>
            <select
              value={formData.column}
              onChange={(e) => setFormData({ ...formData, column: e.target.value })}
            >
              {columns.map(col => (
                <option key={col.id} value={col.id}>{col.title}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Owner</label>
            <select
              value={formData.owner}
              onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
            >
              <option value="">Unassigned</option>
              <option value="Chad">Chad</option>
              <option value="Greg">Greg</option>
              <option value="Scott">Scott</option>
            </select>
          </div>
          <div className="form-group">
            <label>Deal Value ($)</label>
            <input
              type="number"
              min="0"
              step="1000"
              value={formData.dealValue || ''}
              onChange={(e) => setFormData({ ...formData, dealValue: parseFloat(e.target.value) || 0 })}
              placeholder="e.g., 500000"
            />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows="2"
              placeholder="Additional notes..."
            />
          </div>
          
          {card && (
            <div className="action-items-section">
              <label>Next Actions</label>
              {card.actions && card.actions.length > 0 && (
                <div className="modal-actions-list">
                  {card.actions.map((action, idx) => (
                    <div key={idx} className={`modal-action-item ${action.completedOn ? 'completed' : ''}`}>
                      <input
                        type="checkbox"
                        checked={!!action.completedOn}
                        onChange={() => toggleAction && toggleAction(action.rowIndex, !action.completedOn, action.cardId, action.cardTitle)}
                      />
                      <span className="action-text">{action.text}</span>
                      {action.completedOn && (
                        <span className="action-meta">
                          ✓ {action.completedBy} • {new Date(action.completedOn).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="add-action-input">
                <input
                  type="text"
                  placeholder="Add a next action..."
                  value={newActionText}
                  onChange={(e) => setNewActionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddAction();
                    }
                  }}
                />
                <button 
                  type="button" 
                  className="btn-add-action"
                  onClick={handleAddAction}
                  disabled={!newActionText.trim()}
                >
                  + Add
                </button>
              </div>
            </div>
          )}
          
          {card && card.activity && card.activity.length > 0 && (
            <div className="activity-section">
              <button 
                type="button"
                className="btn-secondary"
                onClick={() => setShowActivity(!showActivity)}
              >
                📅 {showActivity ? 'Hide' : 'Show'} Activity ({card.activity.length})
              </button>
              {showActivity && (
                <div className="activity-timeline">
                  {card.activity.slice().reverse().map((log, idx) => (
                    <div key={idx} className="activity-item">
                      <span className="activity-time">{new Date(log.timestamp).toLocaleString()}</span>
                      <span className="activity-action">{log.action}</span>
                      <span className="activity-user">{log.user}</span>
                      {log.details && <span className="activity-details">{log.details}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          <div className="modal-actions">
            <div>
              {card && onDelete && (
                <button 
                  type="button" 
                  className="btn-danger"
                  onClick={() => onDelete(card.id)}
                >
                  🗑️ Delete
                </button>
              )}
            </div>
            <div>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkActionsModal({ selectedCount, columns, people, onClose, onApply }) {
  const [bulkAction, setBulkAction] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  
  const handleApply = () => {
    if (!bulkAction || !bulkValue) return;
    const updates = {};
    if (bulkAction === 'move') updates.column = bulkValue;
    if (bulkAction === 'assign') updates.owner = bulkValue;
    onApply(updates);
  };
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content bulk-modal" onClick={(e) => e.stopPropagation()}>
        <h2>⚡ Bulk Actions</h2>
        <p>{selectedCount} deals selected</p>
        
        <div className="form-group">
          <label>Action</label>
          <select value={bulkAction} onChange={(e) => setBulkAction(e.target.value)}>
            <option value="">Choose action...</option>
            <option value="move">Move to Stage</option>
            <option value="assign">Assign Owner</option>
          </select>
        </div>
        
        {bulkAction === 'move' && (
          <div className="form-group">
            <label>Target Stage</label>
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
              <option value="">Choose stage...</option>
              {columns.map(col => (
                <option key={col.id} value={col.id}>{col.title}</option>
              ))}
            </select>
          </div>
        )}
        
        {bulkAction === 'assign' && (
          <div className="form-group">
            <label>Assign To</label>
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
              <option value="">Choose owner...</option>
              {people.map(person => (
                <option key={person} value={person}>{person}</option>
              ))}
            </select>
          </div>
        )}
        
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button 
            className="btn-primary" 
            onClick={handleApply}
            disabled={!bulkAction || !bulkValue}
          >
            Apply to {selectedCount} Deals
          </button>
        </div>
      </div>
    </div>
  );
}

function DevTools({ user, onClose }) {
  const [logs, setLogs] = useState([]);
  const [apiStatus, setApiStatus] = useState(null);

  useEffect(() => {
    // Capture console logs
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args) => {
      setLogs(prev => [...prev.slice(-50), { type: 'log', msg: args.join(' '), time: new Date().toLocaleTimeString() }]);
      originalLog(...args);
    };
    
    console.error = (...args) => {
      setLogs(prev => [...prev.slice(-50), { type: 'error', msg: args.join(' '), time: new Date().toLocaleTimeString() }]);
      originalError(...args);
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
    };
  }, []);

  const checkAPIStatus = async () => {
    try {
      const start = Date.now();
      const res = await fetch(`${API_BASE_URL}/auth/status`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
      });
      const duration = Date.now() - start;
      setApiStatus({ ok: res.ok, status: res.status, duration: `${duration}ms` });
    } catch (error) {
      setApiStatus({ ok: false, error: error.message });
    }
  };

  const clearStorage = () => {
    if (window.confirm('Clear localStorage and reload?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const token = localStorage.getItem('authToken');

  return (
    <div className="devtools-panel">
      <div className="devtools-header">
        <h3>🔧 Dev Tools</h3>
        <button onClick={onClose}>✕</button>
      </div>
      
      <div className="devtools-content">
        <div className="devtools-section">
          <h4>Auth Info</h4>
          <div className="devtools-info">
            <strong>User:</strong> {user?.email || 'Not authenticated'}
          </div>
          <div className="devtools-info">
            <strong>Token:</strong> {token ? `${token.substring(0, 20)}...` : 'None'}
          </div>
        </div>

        <div className="devtools-section">
          <h4>API Status</h4>
          <button className="devtools-btn" onClick={checkAPIStatus}>Check API</button>
          {apiStatus && (
            <div className="devtools-info" style={{ color: apiStatus.ok ? 'green' : 'red' }}>
              {apiStatus.ok ? `✓ ${apiStatus.status} (${apiStatus.duration})` : `✗ ${apiStatus.error || apiStatus.status}`}
            </div>
          )}
        </div>

        <div className="devtools-section">
          <h4>Quick Actions</h4>
          <button className="devtools-btn" onClick={clearStorage}>Clear Storage</button>
          <button className="devtools-btn" onClick={() => window.open('https://railway.app/', '_blank')}>
            Railway Logs
          </button>
          <button className="devtools-btn" onClick={() => window.open('https://dash.cloudflare.com/', '_blank')}>
            Cloudflare Pages
          </button>
        </div>

        <div className="devtools-section">
          <h4>Console Logs ({logs.length})</h4>
          <div className="devtools-logs">
            {logs.slice(-10).map((log, i) => (
              <div key={i} className={`devtools-log ${log.type}`}>
                <span className="devtools-log-time">{log.time}</span>
                <span className="devtools-log-msg">{log.msg}</span>
              </div>
            ))}
            {logs.length === 0 && <div className="devtools-log">No logs yet...</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
/* Force rebuild Mon Feb 23 16:25:45 MST 2026 */
