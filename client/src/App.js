import React, { useState, useEffect } from 'react';
import './App.css';

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
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>🤖 HeyPhil</h1>
          <p>Project management and productivity tools</p>
          <button className="btn-primary" onClick={handleLogin}>
            <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // Loading
  if (authenticated === null) {
    return <div className="loading">Loading...</div>;
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
  const [loading, setLoading] = useState(true);
  const [showNewCard, setShowNewCard] = useState(false);
  const [draggedCard, setDraggedCard] = useState(null);

  const columns = [
    { id: 'backlog', title: 'Backlog', color: '#e3e3e3' },
    { id: 'in-progress', title: 'In Progress', color: '#fff3cd' },
    { id: 'review', title: 'Review', color: '#d1ecf1' },
    { id: 'done', title: 'Done', color: '#d4edda' }
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
    try {
      const res = await fetch(`${API_BASE_URL}/api/origination/board`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      setCards(data.cards || []);
    } catch (error) {
      console.error('Failed to load board:', error);
    }
    setLoading(false);
  };

  const createCard = async (cardData) => {
    try {
      await fetch(`${API_BASE_URL}/api/origination/card`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(cardData)
      });
      await loadBoard();
      setShowNewCard(false);
    } catch (error) {
      console.error('Failed to create card:', error);
    }
  };

  const moveCard = async (cardId, newColumn) => {
    const card = cards.find(c => c.id === cardId);
    if (!card || card.column === newColumn) return;

    try {
      await fetch(`${API_BASE_URL}/api/origination/card/${cardId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ...card, column: newColumn })
      });
      await loadBoard();
    } catch (error) {
      console.error('Failed to move card:', error);
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

  if (loading) {
    return <div className="loading">Loading board...</div>;
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

      <div className="board-controls">
        <button className="btn-primary" onClick={() => setShowNewCard(true)}>+ New Project</button>
      </div>

      <div className="kanban-board">
        {columns.map(column => (
          <div
            key={column.id}
            className="kanban-column"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, column.id)}
          >
            <div className="column-header" style={{ backgroundColor: column.color }}>
              <h3>{column.title}</h3>
              <span className="card-count">
                {cards.filter(c => c.column === column.id).length}
              </span>
            </div>
            <div className="column-cards">
              {cards
                .filter(card => card.column === column.id)
                .map(card => (
                  <div
                    key={card.id}
                    className="kanban-card"
                    draggable
                    onDragStart={(e) => handleDragStart(e, card)}
                  >
                    <h4>{card.title}</h4>
                    {card.description && <p>{card.description}</p>}
                    <div className="card-meta">
                      {card.owner && <span className="card-owner">👤 {card.owner}</span>}
                      {card.dueDate && <span className="card-due">📅 {card.dueDate}</span>}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {showNewCard && (
        <NewCardModal
          onClose={() => setShowNewCard(false)}
          onCreate={createCard}
        />
      )}
    </div>
  );
}

function NewCardModal({ onClose, onCreate }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    column: 'backlog',
    owner: '',
    dueDate: '',
    notes: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate(formData);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>New Project</h2>
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
            <label>Due Date</label>
            <input
              type="date"
              value={formData.dueDate}
              onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows="2"
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Create Project</button>
          </div>
        </form>
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
