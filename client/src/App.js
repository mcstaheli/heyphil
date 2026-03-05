import React, { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import './App.css';
import './Loading.css';
import Landing from './Landing';
import HotelVisual from './HotelVisual';
import OrgCharts from './OrgCharts';
import Settings from './Settings';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';
const WS_URL = process.env.REACT_APP_WS_URL || API_BASE_URL;

function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [user, setUser] = useState(null);
  const [currentApp, setCurrentAppState] = useState(() => {
    return localStorage.getItem('currentApp') || null;
  });
  const [showDevTools, setShowDevTools] = useState(false);
  
  const setCurrentApp = (app) => {
    setCurrentAppState(app);
    if (app) {
      localStorage.setItem('currentApp', app);
    } else {
      localStorage.removeItem('currentApp');
    }
  };

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
    
    // Check token expiry every 5 minutes
    const tokenCheckInterval = setInterval(() => {
      checkTokenExpiry();
    }, 5 * 60 * 1000);
    
    return () => clearInterval(tokenCheckInterval);
  }, []);
  
  const checkTokenExpiry = () => {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    
    try {
      // Decode JWT (simple base64 decode of payload)
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp = payload.exp * 1000; // Convert to milliseconds
      const now = Date.now();
      const timeLeft = exp - now;
      
      // Warn if less than 30 minutes left
      if (timeLeft < 30 * 60 * 1000 && timeLeft > 0) {
        console.warn('Token expires in', Math.floor(timeLeft / 60000), 'minutes');
        // Could show a toast notification here
      }
      
      // Auto-logout if expired
      if (timeLeft <= 0) {
        console.error('Token expired');
        localStorage.removeItem('authToken');
        setAuthenticated(false);
        alert('Your session has expired. Please log in again.');
      }
    } catch (error) {
      console.error('Failed to check token expiry:', error);
    }
  };

  const checkAuth = async () => {
    const startTime = Date.now();
    const token = localStorage.getItem('authToken');
    
    if (!token) {
      // Ensure loading screen shows for at least 1 second
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 1000 - elapsed);
      setTimeout(() => setAuthenticated(false), remaining);
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
        // Ensure loading screen shows for at least 1 second
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 1000 - elapsed);
        setTimeout(() => {
          setAuthenticated(true);
          setUser(data.user);
        }, remaining);
      } else {
        localStorage.removeItem('authToken');
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 1000 - elapsed);
        setTimeout(() => setAuthenticated(false), remaining);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem('authToken');
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 1000 - elapsed);
      setTimeout(() => setAuthenticated(false), remaining);
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
          <div className="loading-logo">
            <img src="/logo-c.svg" alt="Philo Logo" className="logo-c-animated" />
          </div>
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
            <h1>✨ 🤖 HeyPhil</h1>
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
                <h3>Project Board</h3>
                <p>Manage projects with your team</p>
              </div>
              <div className="app-card" onClick={() => setCurrentApp('studio')}>
                <div className="app-icon">🎬</div>
                <h3>Studio Board</h3>
                <p>Venture studio pipeline</p>
              </div>
              <div className="app-card" onClick={() => setCurrentApp('orgcharts')}>
                <div className="app-icon">📊</div>
                <h3>Org Charts</h3>
                <p>Infinite canvas with nodes & connections</p>
              </div>
              <div className="app-card disabled">
                <div className="app-icon">🏨</div>
                <h3>Hotel Empire</h3>
                <p>Coming soon...</p>
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
            🔧
          </button>
        )}
      </>
    );
  }

  // Hotel Empire app
  if (currentApp === 'hotel-tycoon') {
    return (
      <>
        <HotelVisual user={user} onBack={() => setCurrentApp(null)} />
        {showDevTools && <DevTools user={user} onClose={() => setShowDevTools(false)} />}
        {!showDevTools && (
          <button className="devtools-toggle" onClick={() => setShowDevTools(true)}>
            🔧
          </button>
        )}
      </>
    );
  }

  // Org Charts app
  if (currentApp === 'orgcharts') {
    return (
      <>
        <OrgCharts user={user} onBack={() => setCurrentApp(null)} />
        {showDevTools && <DevTools user={user} onClose={() => setShowDevTools(false)} />}
        {!showDevTools && (
          <button className="devtools-toggle" onClick={() => setShowDevTools(true)}>
            🔧
          </button>
        )}
      </>
    );
  }

  // Project Board app
  if (currentApp === 'origination') {
    return (
      <>
        <OriginationBoard user={user} onBack={() => setCurrentApp(null)} onLogout={handleLogout} />
        {showDevTools && <DevTools user={user} onClose={() => setShowDevTools(false)} />}
        {!showDevTools && (
          <button className="devtools-toggle" onClick={() => setShowDevTools(true)}>
            🔧
          </button>
        )}
      </>
    );
  }

  // Studio Board app
  if (currentApp === 'studio') {
    return (
      <>
        <OriginationBoard 
          user={user} 
          onBack={() => setCurrentApp(null)} 
          onLogout={handleLogout}
          studioMode={true}
        />
        {showDevTools && <DevTools user={user} onClose={() => setShowDevTools(false)} />}
        {!showDevTools && (
          <button className="devtools-toggle" onClick={() => setShowDevTools(true)}>
            🔧
          </button>
        )}
      </>
    );
  }

}

function OriginationBoard({ user, onBack, onLogout, studioMode = false }) {
  const [cards, setCards] = useState([]);
  const [people, setPeople] = useState({});
  const [_ownerColors, setOwnerColors] = useState({});
  const [projectTypeColors, setProjectTypeColors] = useState({});
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNewCard, setShowNewCard] = useState(false);
  const [newCardColumn, setNewCardColumn] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [draggedCard, setDraggedCard] = useState(null);
  const [filterOwner, setFilterOwner] = useState('');
  const [filterProjectType, setFilterProjectType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('dateCreated');
  const [showMetrics, setShowMetrics] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [visibleSections, setVisibleSections] = useState(
    studioMode 
      ? { studio: true } 
      : {
          origination: true,
          studio: false,
          development: true,
          operations: true,
          other: true
        }
  );

  const allColumns = [
    { id: 'ideation', title: 'Ideation', color: '#bbdefb', section: 'origination' },
    { id: 'on-deck', title: 'On Deck', color: '#90caf9', section: 'origination' },
    { id: 'ic-diligence', title: 'IC - Diligence', color: '#e0e0e0', section: 'origination' },
    { id: 'due-diligence', title: 'Due Diligence', color: '#64b5f6', section: 'origination' },
    { id: 'ic-capitalization', title: 'IC - Capitalization', color: '#bdbdbd', section: 'origination' },
    { id: 'capitalization', title: 'Capitalization', color: '#42a5f5', section: 'origination' },
    { id: 'ic-close', title: 'IC - Close', color: '#9e9e9e', section: 'origination' },
    { id: 'assets', title: 'Assets', color: '#1976d2', section: 'origination' },
    { id: 'ic-assets', title: 'IC - Assets', color: '#757575', section: 'origination' },
    { id: 'studio-ideation', title: 'Ideation', color: '#bbdefb', section: 'studio' },
    { id: 'studio-diligence', title: 'Diligence', color: '#e1bee7', section: 'studio' },
    { id: 'ic-studio-validation', title: 'IC - Validation', color: '#e0e0e0', section: 'studio' },
    { id: 'studio-validation', title: 'Validation', color: '#ce93d8', section: 'studio' },
    { id: 'ic-studio-launch', title: 'IC - Launch', color: '#bdbdbd', section: 'studio' },
    { id: 'studio-launch', title: 'Launch', color: '#ba68c8', section: 'studio' },
    { id: 'ic-studio-spinout', title: 'IC - Spinout', color: '#9e9e9e', section: 'studio' },
    { id: 'studio-spinout', title: 'Spinout', color: '#ab47bc', section: 'studio' },
    { id: 'studio-abandoned', title: 'Abandoned', color: '#616161', section: 'studio' },
    { id: 'studio-exited', title: 'Exited', color: '#2196f3', section: 'studio' },
    { id: 'development', title: 'Development', color: '#66bb6a', section: 'development' },
    { id: 'operations', title: 'Operations', color: '#ef6c00', section: 'operations' },
    { id: 'abandoned', title: 'Abandoned', color: '#616161', section: 'other' },
    { id: 'closed', title: 'Exited', color: '#2196f3', section: 'other' }
  ];

  // Filter columns based on visible sections
  const columns = allColumns.filter(col => visibleSections[col.section]);

  const toggleSection = (section) => {
    setVisibleSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  useEffect(() => {
    loadBoard();
  }, []);
  
  // Recalculate metrics based on filtered cards (exclude Ideation, Closed, and Abandoned)
  useEffect(() => {
    if (cards.length === 0) return;
    
    // Apply same filters as the board view
    const filteredCards = cards.filter(c => {
      if (c.column === 'ideation' || c.column === 'closed' || c.column === 'abandoned') return false;
      if (filterOwner && c.owner !== filterOwner) return false;
      if (filterProjectType && c.projectType !== filterProjectType) return false;
      if (searchQuery && !c.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
    
    const newMetrics = {
      totalDeals: filteredCards.length,
      totalValue: filteredCards.reduce((sum, c) => sum + (c.dealValue || 0), 0),
      byStage: {}
    };
    
    filteredCards.forEach(card => {
      if (!newMetrics.byStage[card.column]) {
        newMetrics.byStage[card.column] = { count: 0, value: 0 };
      }
      newMetrics.byStage[card.column].count++;
      newMetrics.byStage[card.column].value += (card.dealValue || 0);
    });
    
    setMetrics(newMetrics);
  }, [cards, filterOwner, filterProjectType, searchQuery]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('authToken');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  const handleApiResponse = async (res) => {
    if (res.status === 401) {
      // Token expired or invalid - auto logout
      localStorage.removeItem('authToken');
      alert('Your session has expired. Please log in again.');
      window.location.href = '/';
      throw new Error('Session expired');
    }
    return res;
  };

  const apiFetch = async (url, options = {}, retries = 3) => {
    let lastError;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url, options);
        return await handleApiResponse(res);
      } catch (error) {
        lastError = error;
        
        // Don't retry on session expired
        if (error.message === 'Session expired') {
          throw error;
        }
        
        // Don't retry on 400 errors (bad request)
        if (error.status >= 400 && error.status < 500) {
          throw error;
        }
        
        // Wait before retry (exponential backoff)
        if (attempt < retries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.log(`API call failed, retrying in ${delay}ms... (attempt ${attempt + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  };

  const loadBoard = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const startTime = Date.now();
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/origination/board`, {
        headers: getAuthHeaders()
      });
      await handleApiResponse(res);
      const data = await res.json();
      setCards(data.cards || []);
      setPeople(data.people || {});
      setOwnerColors(data.ownerColors || {});
      setProjectTypeColors(data.projectTypeColors || {});
      setMetrics(data.metrics || null);
    } catch (error) {
      console.error('Failed to load board:', error);
    }
    
    if (showLoading) {
      // Ensure loading screen shows for at least 1.5 seconds
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 1500 - elapsed);
      setTimeout(() => setLoading(false), remaining);
    }
  };

  // Socket.io real-time updates
  const socketRef = useRef(null);
  
  useEffect(() => {
    // Connect to WebSocket server
    const wsUrl = WS_URL || API_BASE_URL;
    console.log('🔌 Connecting to WebSocket server:', wsUrl);
    
    socketRef.current = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });
    
    socketRef.current.on('connect', () => {
      console.log('✅ WebSocket connected to', wsUrl, '(ID:', socketRef.current.id + ')');
      setWsConnected(true);
    });
    
    socketRef.current.on('disconnect', (reason) => {
      console.log('❌ WebSocket disconnected:', reason);
      setWsConnected(false);
    });
    
    socketRef.current.on('connect_error', (err) => {
      console.error('❌ WebSocket connection error:', err.message);
      setWsConnected(false);
    });
    
    socketRef.current.on('error', (err) => {
      console.error('❌ WebSocket error:', err);
    });
    
    // Listen for card changes
    socketRef.current.on('card:created', (card) => {
      console.log('📨 Card created:', card.id);
      setCards(prevCards => [...prevCards, {
        id: card.id,
        title: card.title || 'Untitled',
        description: card.description || '',
        column: card.column || 'backlog',
        owner: card.owner || '',
        notes: card.notes || '',
        dealValue: card.dealValue || 0,
        dateCreated: card.dateCreated || new Date(),
        projectType: card.projectType || '',
        actions: [],
        log: []
      }]);
    });
    
    socketRef.current.on('card:updated', (update) => {
      console.log('📨 Card updated:', update.id);
      setCards(prevCards => prevCards.map(c => 
        c.id === update.id ? { ...c, ...update } : c
      ));
    });
    
    socketRef.current.on('card:deleted', ({ id }) => {
      console.log('📨 Card deleted:', id);
      setCards(prevCards => prevCards.filter(c => c.id !== id));
    });
    
    // Listen for action changes
    socketRef.current.on('action:created', ({ actionId, cardId, text }) => {
      console.log('📨 Action created:', actionId, 'for card:', cardId);
      setCards(prevCards => prevCards.map(c => {
        if (c.id === cardId) {
          return {
            ...c,
            actions: [...(c.actions || []), {
              id: actionId,
              cardId,
              text,
              completedOn: null,
              completedBy: null
            }]
          };
        }
        return c;
      }));
    });
    
    socketRef.current.on('action:toggled', ({ actionId, cardId, completed, completedOn, completedBy }) => {
      console.log('📨 Action toggled:', actionId, 'completed:', completed);
      setCards(prevCards => prevCards.map(c => {
        if (c.id === cardId) {
          return {
            ...c,
            actions: (c.actions || []).map(a => 
              a.id === actionId ? { ...a, completedOn, completedBy } : a
            )
          };
        }
        return c;
      }));
    });
    
    socketRef.current.on('action:updated', ({ actionId, cardId, text }) => {
      console.log('📨 Action updated:', actionId);
      setCards(prevCards => prevCards.map(c => {
        if (c.id === cardId) {
          return {
            ...c,
            actions: (c.actions || []).map(a => 
              a.id === actionId ? { ...a, text } : a
            )
          };
        }
        return c;
      }));
    });
    
    socketRef.current.on('action:deleted', ({ actionId, cardId }) => {
      console.log('📨 Action deleted:', actionId);
      setCards(prevCards => prevCards.map(c => {
        if (c.id === cardId) {
          return {
            ...c,
            actions: (c.actions || []).filter(a => a.id !== actionId)
          };
        }
        return c;
      }));
    });
    
    // Listen for link changes
    socketRef.current.on('link:created', ({ linkId, cardId, title, url }) => {
      console.log('📨 Link created:', linkId, 'for card:', cardId);
      setCards(prevCards => prevCards.map(c => {
        if (c.id === cardId) {
          return {
            ...c,
            links: [...(c.links || []), {
              id: linkId,
              cardId,
              title,
              url
            }]
          };
        }
        return c;
      }));
    });
    
    socketRef.current.on('link:deleted', ({ linkId, cardId }) => {
      console.log('📨 Link deleted:', linkId);
      setCards(prevCards => prevCards.map(c => {
        if (c.id === cardId) {
          return {
            ...c,
            links: (c.links || []).filter(l => l.id !== linkId)
          };
        }
        return c;
      }));
    });
    
    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const createCard = async (cardData, pendingActions = []) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/card`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(cardData)
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        console.error('Create card failed:', result);
        const errorMsg = result.details || result.error || 'Unknown error';
        alert(`Failed to create card:\n\n${errorMsg}`);
        return;
      }
      
      // Use server-generated card ID (critical fix)
      const serverCardId = result.card?.id || result.id;
      const newCard = {
        ...cardData,
        id: serverCardId,
        actions: [],
        links: [],
        log: [],
        daysInStage: 0,
        dateCreated: new Date().toISOString()
      };
      setCards(prevCards => [...prevCards, newCard]);
      setShowNewCard(false);
      
      // Add pending actions if any (now using correct server ID)
      if (pendingActions.length > 0) {
        for (const actionText of pendingActions) {
          await addAction(serverCardId, cardData.title, actionText);
        }
      }
      
      // No need for background refresh - WebSocket will sync
    } catch (error) {
      console.error('Failed to create card:', error);
      alert('Failed to create card - check console for details');
    }
  };

  const updateCard = async (cardId, cardData) => {
    try {
      await apiFetch(`${API_BASE_URL}/api/origination/card/${cardId}`, {
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
      await apiFetch(`${API_BASE_URL}/api/origination/card/${cardId}`, {
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
  
  const toggleAction = async (actionId, completed, cardId, cardTitle) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/action/toggle`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ actionId, completed, cardId, cardTitle })
      });
      
      if (response.ok) {
        // State will be updated via Socket.io event
        // No need to manually update here anymore
      }
    } catch (error) {
      console.error('Failed to toggle action:', error);
    }
  };
  
  const exportToCSV = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/export`, {
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
  
  const addAction = async (cardId, cardTitle, text) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/action`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ cardId, cardTitle, text })
      });
      
      if (response.ok) {
        // State will be updated via Socket.io event
        // No need to manually update here anymore
      }
    } catch (error) {
      console.error('Failed to add action:', error);
    }
  };

  const updateAction = async (actionId, text) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/action/${actionId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ text })
      });
      
      if (response.ok) {
        // State will be updated via Socket.io event
      }
    } catch (error) {
      console.error('Failed to update action:', error);
    }
  };

  const deleteAction = async (actionId) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/action/${actionId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        // State will be updated via Socket.io event
      }
    } catch (error) {
      console.error('Failed to delete action:', error);
    }
  };

  const addLink = async (cardId, title, url) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/link`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ cardId, title, url })
      });
      
      if (response.ok) {
        // State will be updated via Socket.io event
      }
    } catch (error) {
      console.error('Failed to add link:', error);
    }
  };

  const deleteLink = async (linkId) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/link/${linkId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        // State will be updated via Socket.io event
      }
    } catch (error) {
      console.error('Failed to delete link:', error);
    }
  };

  const handleSaveSettings = async (settings) => {
    try {
      console.log('Saving settings to backend:', settings);
      
      const response = await fetch(`${API_BASE_URL}/api/origination/settings`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(settings)
      });

      console.log('Settings save response:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Settings save failed:', errorData);
        throw new Error(errorData.error || 'Failed to save settings');
      }

      const result = await response.json();
      console.log('Settings saved successfully:', result);

      // Update local state
      setPeople(settings.people);
      setOwnerColors(settings.ownerColors);
      setProjectTypeColors(settings.projectTypeColors);
      setShowSettings(false);
      
      // Reload board to reflect changes
      await loadBoard(false);
      
      alert('Settings saved successfully!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert(`Failed to save settings: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-content">
          <div className="loading-logo">
            <img src="/logo-c.svg" alt="Philo Logo" className="logo-c-animated" />
          </div>
          <h2 className="loading-text">Loading Board</h2>
          <p className="loading-subtext">Please wait...</p>
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
          <h1>{studioMode ? '🎬 Studio Board' : '📋 Project Board'}</h1>
          <span 
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px', 
              borderRadius: '4px',
              backgroundColor: wsConnected ? '#4caf50' : '#ff9800',
              color: 'white',
              fontWeight: 'bold'
            }}
            title={wsConnected ? 'Real-time updates active' : 'Connecting...'}
          >
            {wsConnected ? '● LIVE' : '○ Connecting...'}
          </span>
        </div>
        <div className="user-info">
          {user?.picture && <img src={user.picture} alt={user.name} />}
          <span>{user?.name}</span>
          <button className="btn-secondary" onClick={() => setShowSettings(true)}>⚙️ Settings</button>
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
          <select value={filterProjectType} onChange={(e) => setFilterProjectType(e.target.value)}>
            <option value="">All Project Types</option>
            {projectTypeColors && Object.keys(projectTypeColors).map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="dateCreated">Newest First</option>
            <option value="title">Alphabetical</option>
            <option value="dealValue">Deal Size</option>
            <option value="daysInStage">Time in Stage</option>
          </select>
          
          {!studioMode && (
            <div className="board-section-filters">
              <label className="section-filter-checkbox">
                <input
                  type="checkbox"
                  checked={visibleSections.origination}
                  onChange={() => toggleSection('origination')}
                />
                <span>Origination</span>
              </label>
              <label className="section-filter-checkbox">
                <input
                  type="checkbox"
                  checked={visibleSections.development}
                  onChange={() => toggleSection('development')}
                />
                <span>Development</span>
              </label>
              <label className="section-filter-checkbox">
                <input
                  type="checkbox"
                  checked={visibleSections.operations}
                  onChange={() => toggleSection('operations')}
                />
                <span>Operations</span>
              </label>
              <label className="section-filter-checkbox">
                <input
                  type="checkbox"
                  checked={visibleSections.other}
                  onChange={() => toggleSection('other')}
                />
                <span>Other</span>
              </label>
            </div>
          )}
        </div>
        <div className="board-actions">
          <button className="btn-secondary" onClick={() => setShowMetrics(!showMetrics)}>
            📊 {showMetrics ? 'Hide' : 'Show'} Metrics
          </button>
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
            if (filterProjectType && c.projectType !== filterProjectType) return false;
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
          const isPrePost = column.id === 'ideation' || column.id === 'closed' || column.id === 'abandoned' || 
                            column.id === 'studio-ideation' || column.id === 'studio-exited' || column.id === 'studio-abandoned';
          
          return (
          <div
            key={column.id}
            className={`kanban-column ${isEmpty ? 'column-empty' : ''} ${isPrePost ? `column-${column.id}` : ''}`}
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
                const isPrePost = column.id === 'ideation' || column.id === 'closed' || column.id === 'abandoned' || 
                                  column.id === 'studio-ideation' || column.id === 'studio-exited' || column.id === 'studio-abandoned';
                return (
                  <div
                    key={card.id}
                    className={`kanban-card ${isPrePost ? 'card-prepost' : ''} ${card.daysInStage > 30 ? 'stale-deal' : ''}`}
                    style={{
                      borderLeft: card.projectType && projectTypeColors[card.projectType] 
                        ? `4px solid ${projectTypeColors[card.projectType]}` 
                        : '4px solid transparent'
                    }}
                    draggable
                    onDragStart={(e) => handleDragStart(e, card)}
                    onClick={() => setEditingCard(card)}
                  >
                    {!isPrePost && card.daysInStage > 30 && <div className="stale-indicator" title={`${card.daysInStage} days in stage`}>⚠️</div>}
                    <div className="card-main">
                      {card.owner && people[card.owner] && (
                        <div className="card-photo">
                          <img 
                            src={people[card.owner]} 
                            alt={card.owner}
                            style={{
                              border: '2px solid #555'
                            }}
                          />
                        </div>
                      )}
                      <div className="card-content">
                        <h4>{card.title}</h4>
                        {!isPrePost && card.dealValue > 0 && (
                          <div className="card-deal-value">${card.dealValue.toLocaleString()}</div>
                        )}
                        {!isPrePost && card.description && <p>{card.description}</p>}
                      </div>
                    </div>
                    {!isPrePost && card.actions && card.actions.filter(a => !a.completedOn).length > 0 && (
                      <div className="card-actions-section">
                        {card.actions.filter(a => !a.completedOn).slice(0, 3).map((action) => (
                          <div key={action.id} className="card-action-item" onClick={(e) => {
                            e.stopPropagation();
                            toggleAction(action.id, true, action.cardId, action.cardTitle);
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
          onUpdateAction={updateAction}
          onAddLink={addLink}
          onDeleteLink={deleteLink}
          projectTypeColors={projectTypeColors}
          people={people}
        />
      )}

      {editingCard && (
        <CardModal
          card={cards.find(c => c.id === editingCard.id) || editingCard}
          onClose={() => setEditingCard(null)}
          onSave={(data) => updateCard(editingCard.id, data)}
          onDelete={async (id) => {
            if (window.confirm('Are you sure you want to delete this deal? This cannot be undone.')) {
              try {
                await apiFetch(`${API_BASE_URL}/api/origination/card/${id}`, {
                  method: 'DELETE',
                  headers: getAuthHeaders()
                });
                
                // Remove card locally without loading screen
                setCards(prevCards => prevCards.filter(c => c.id !== id));
                setEditingCard(null);
              } catch (error) {
                console.error('Failed to delete:', error);
              }
            }
          }}
          columns={columns}
          toggleAction={toggleAction}
          onAddAction={addAction}
          onUpdateAction={updateAction}
          onDeleteAction={deleteAction}
          onAddLink={addLink}
          onDeleteLink={deleteLink}
          projectTypeColors={projectTypeColors}
          people={people}
        />
      )}

      {showSettings && (
        <Settings
          people={people}
          ownerColors={_ownerColors}
          projectTypeColors={projectTypeColors}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
        />
      )}

      {/* CHAT FEATURE TEMPORARILY DISABLED */}
    </div>
  );
}

function CardModal({ card, onClose, onSave, onDelete, columns, initialColumn, toggleAction, onAddAction, onUpdateAction, onDeleteAction, onAddLink, onDeleteLink, projectTypeColors, people }) {
  const [formData, setFormData] = useState({
    title: card?.title || '',
    description: card?.description || '',
    column: card?.column || initialColumn || columns[0].id,
    owner: card?.owner || '',
    notes: card?.notes || '',
    dealValue: card?.dealValue || 0,
    projectType: card?.projectType || ''
  });
  const [newActionText, setNewActionText] = useState('');
  const [pendingActions, setPendingActions] = useState([]);
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [editingActionId, setEditingActionId] = useState(null);
  const [editingActionText, setEditingActionText] = useState('');
  const [showActivity, setShowActivity] = useState(false);
  
  // Memoize sorted lists to prevent recomputing on every render
  const sortedPeople = useMemo(() => 
    people ? Object.keys(people).sort() : [], 
    [people]
  );
  
  const sortedProjectTypes = useMemo(() =>
    projectTypeColors ? Object.keys(projectTypeColors) : [],
    [projectTypeColors]
  );
  
  const handleAddAction = async () => {
    if (!newActionText.trim()) return;
    
    if (card) {
      // Existing card - add directly
      if (onAddAction) {
        await onAddAction(card.id, card.title, newActionText.trim());
        setNewActionText('');
      }
    } else {
      // New card - add to pending list
      setPendingActions([...pendingActions, newActionText.trim()]);
      setNewActionText('');
    }
  };

  const handleAddLink = async () => {
    if (!newLinkTitle.trim() || !newLinkUrl.trim()) return;
    
    if (card && onAddLink) {
      // Existing card - add directly
      await onAddLink(card.id, newLinkTitle.trim(), newLinkUrl.trim());
      setNewLinkTitle('');
      setNewLinkUrl('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData, pendingActions);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{card ? 'Edit Project' : 'New Project'}</h2>
        </div>
        <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="modal-body">
          <div className="modal-two-column">
            <div className="modal-left-column">
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
              {sortedPeople.map(person => (
                <option key={person} value={person}>{person}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Project Type</label>
            <select
              value={formData.projectType}
              onChange={(e) => setFormData({ ...formData, projectType: e.target.value })}
            >
              <option value="">Select type...</option>
              {sortedProjectTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Deal Value ($)</label>
            <input
              type="text"
              value={formData.dealValue ? formData.dealValue.toLocaleString() : ''}
              onChange={(e) => {
                const numericValue = e.target.value.replace(/,/g, '');
                setFormData({ ...formData, dealValue: parseFloat(numericValue) || 0 });
              }}
              placeholder="e.g., 500,000"
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

          <div className="form-group">
            <label>Links</label>
            {card && card.links && card.links.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                {card.links.map((link) => (
                  <div key={link.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '8px' }}>
                    <a 
                      href={link.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ color: '#2196f3', textDecoration: 'none', flex: 1 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      🔗 {link.title}
                    </a>
                    {onDeleteLink && (
                      <button 
                        type="button"
                        className="btn-remove-action"
                        onClick={() => {
                          if (window.confirm('Delete this link?')) {
                            onDeleteLink(link.id);
                          }
                        }}
                        title="Delete link"
                        style={{ padding: '2px 6px', fontSize: '14px' }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {card && (
              <div>
                <input
                  type="text"
                  placeholder="Link title (e.g., SmartSheets)"
                  value={newLinkTitle}
                  onChange={(e) => setNewLinkTitle(e.target.value)}
                  style={{ width: '100%', marginBottom: '4px' }}
                />
                <input
                  type="url"
                  placeholder="URL (https://...)"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddLink();
                    }
                  }}
                  style={{ width: '100%', marginBottom: '4px' }}
                />
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={handleAddLink}
                  disabled={!newLinkTitle.trim() || !newLinkUrl.trim()}
                  style={{ width: '100%' }}
                >
                  + Add Link
                </button>
              </div>
            )}
          </div>
            </div>
            
            <div className="modal-right-column">
              <h3>Next Actions</h3>
          <div className="action-items-section">
            {card && card.actions && card.actions.length > 0 && (
              <div className="modal-actions-list">
                {[...card.actions].reverse().map((action, idx) => (
                  <div key={action.id || idx} className={`modal-action-item ${action.completedOn ? 'completed' : ''}`}>
                    <input
                      type="checkbox"
                      checked={!!action.completedOn}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (toggleAction) {
                          toggleAction(action.id, !action.completedOn, action.cardId, action.cardTitle);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {editingActionId === action.id ? (
                      <input
                        type="text"
                        value={editingActionText}
                        onChange={(e) => setEditingActionText(e.target.value)}
                        onBlur={() => {
                          if (editingActionText.trim() && editingActionText !== action.text) {
                            onUpdateAction(action.id, editingActionText.trim());
                          }
                          setEditingActionId(null);
                          setEditingActionText('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.target.blur();
                          }
                          if (e.key === 'Escape') {
                            setEditingActionId(null);
                            setEditingActionText('');
                          }
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        style={{ flex: 1, padding: '4px', border: '1px solid #2196f3' }}
                      />
                    ) : (
                      <span 
                        className="action-text"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingActionId(action.id);
                          setEditingActionText(action.text);
                        }}
                        style={{ cursor: 'text' }}
                      >
                        {action.text}
                      </span>
                    )}
                    {action.completedOn && (
                      <span className="action-meta">
                        ✓ {action.completedBy} • {new Date(action.completedOn).toLocaleDateString()}
                      </span>
                    )}
                    {onDeleteAction && (
                      <button 
                        type="button"
                        className="btn-remove-action"
                        onClick={() => {
                          if (window.confirm('Delete this action?')) {
                            onDeleteAction(action.id);
                          }
                        }}
                        title="Delete action"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!card && pendingActions.length > 0 && (
              <div className="modal-actions-list">
                {[...pendingActions].reverse().map((text, idx) => (
                  <div key={idx} className="modal-action-item">
                    <span className="action-text">{text}</span>
                    <button 
                      type="button"
                      className="btn-remove-action"
                      onClick={() => setPendingActions(pendingActions.filter((_, i) => i !== pendingActions.length - 1 - idx))}
                    >
                      ×
                    </button>
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
            </div>
          </div>
          </div>
          
          <div className="modal-footer">
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
              <button type="submit" className="btn-primary">💾 Save</button>
            </div>
          </div>
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
        <h3>🔧</h3>
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
          <button className="devtools-btn" onClick={() => window.open('https://docs.google.com/spreadsheets/d/1bdXv9eA4fbNDj4vGGZf2kU6v24yYaLow2BVVHWtZaYQ', '_blank')}>
            Hey_Phil Spreadsheet
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
