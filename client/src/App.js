import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import './App.css';
import './Loading.css';
import Landing from './Landing';
import OrgCharts from './OrgCharts';
import Cashflow from './Cashflow';
import Improvements from './Improvements';
import Settings from './Settings';
import SettingsPage from './SettingsPage';
import ProjectDetail from './ProjectDetail';
import Portfolio from './Portfolio';
import StrategyGrid from './StrategyGrid';
import Layout from './Layout';
import { summarizeLedger, computeTimelineMetrics } from './projectMetrics';
import { PRE_POST_COLUMN_IDS } from './boardStages';
import { formatCompactMoney } from './formatMoney';
import { isNoteEntry, canModifyNote, noteAuthorName } from './activityLog';
import { deriveGridInputs } from './strategyGridMath';
import AssigneeInput from './AssigneeInput';
import { ResourceIcon } from './ProjectResources';
import { detectSource, kindLabel, quickOpenLinks } from './resources';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';
const WS_URL = process.env.REACT_APP_WS_URL || API_BASE_URL;

// Board restructure Stage 3: months-to-first-cash is only meaningful
// before operations start - Assets is "producing now" so it's forced to 0
// there instead (see board-db.js's auto-zero hook). No longer edited or
// required-checked in this modal - moved to Project Detail (per request),
// which still respects the same auto-zero-on-Assets server behavior.

function hasLeafItems(items) {
  return (items || []).some((i) => !i.isHeading);
}


// Value shows the goal (what we're aiming for) since that's motivating on
// its own; Budget and Timeline show delta from plan since those are the
// two places drifting off-plan is the thing worth flagging at a glance.
function getCardMetricChips(card) {
  const chips = [];

  if (hasLeafItems(card.value)) {
    const valueLocks = card.valueLocks || [];
    const latestValueLock = valueLocks.length ? valueLocks[valueLocks.length - 1] : null;
    const { totalExpected } = summarizeLedger(card.value, latestValueLock);
    chips.push({ key: 'value', icon: '💰', text: formatCompactMoney(totalExpected), className: '' });
  }

  if (hasLeafItems(card.budget)) {
    const budgetLocks = card.budgetLocks || [];
    const latestBudgetLock = budgetLocks.length ? budgetLocks[budgetLocks.length - 1] : null;
    const { delta } = summarizeLedger(card.budget, latestBudgetLock);
    chips.push({
      key: 'budget',
      icon: '🎯',
      text: formatCompactMoney(delta),
      className: delta > 0 ? 'over' : delta < 0 ? 'under' : ''
    });
  }

  const hasTimeline = (card.timeline || []).some((t) => t.type === 'milestone' && t.date);
  if (hasTimeline) {
    const { finalComparison, daysRemaining } = computeTimelineMetrics(card.timeline, card.timelineLocks);
    if (finalComparison) {
      const days = finalComparison.slippageDays;
      chips.push({
        key: 'timeline',
        icon: '📅',
        text: `${days > 0 ? '+' : ''}${days}d`,
        className: days > 0 ? 'over' : days < 0 ? 'under' : ''
      });
    } else if (daysRemaining !== null) {
      chips.push({
        key: 'timeline',
        icon: '📅',
        text: daysRemaining < 0 ? `${Math.abs(daysRemaining)}d over` : `${daysRemaining}d`,
        className: daysRemaining < 0 ? 'over' : ''
      });
    }
  }

  return chips;
}

// Helper function to generate consistent colors for initials
// Starred ("do or die") items float to the top; Array.prototype.sort is
// stable, so equal-starred items keep whatever order they arrived in.
function sortByStarred(actions) {
  return [...actions].sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));
}

function getInitialsColor(name) {
  const colors = [
    '#4285F4', // Blue
    '#34A853', // Green
    '#FBBC04', // Yellow
    '#EA4335', // Red
    '#9C27B0', // Purple
    '#00ACC1', // Cyan
    '#FF6F00', // Orange
    '#7CB342', // Light Green
  ];
  
  // Simple hash function to get consistent color for same name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Shared photo-or-initials avatar, used both for a card's normal owner
// avatar and the smaller stacked handoff-lead avatar on a card that's in
// handoff - same visual language at two different sizes.
function renderAvatar(name, people, size) {
  if (!name) return null;
  if (people[name]) {
    return (
      <img
        src={people[name]}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid #555' }}
      />
    );
  }
  return (
    <div
      className="avatar-initials"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: getInitialsColor(name),
        color: 'white',
        fontSize: Math.round(size * 0.4),
        fontWeight: 'bold',
        border: '2px solid #555'
      }}
    >
      {name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
    </div>
  );
}

// The alarm for a card that's been in handoff too long - 14 days is a
// starting default, easy to change in one place.
const HANDOFF_ALARM_DAYS = 14;

function daysSince(isoString) {
  if (!isoString) return null;
  const ms = new Date() - new Date(isoString);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// A project IS a card (they're the same row) - converts the raw project
// shape (snake_case fields) that /api/projects/* routes return and
// broadcast (project:created/updated, e.g. from CustomTimeline's PUT, or
// the Begin/End/Cancel Handoff routes) into the board's card shape.
const mapProjectToCard = (project) => ({
  id: project.id,
  title: project.title || 'Untitled',
  description: project.description || '',
  column: project.status || 'backlog',
  owner: project.owner || '',
  notes: project.notes || '',
  annualValue: parseFloat(project.annual_value) || 0,
  dateCreated: project.date_created || new Date(),
  projectType: project.project_type || '',
  needsIc: project.needs_ic || false,
  project_id: project.id, // Self-reference, same as getBoardData - the card modal's "View Project" button and debug check both key off this.
  // Same fields getBoardData exposes for the mini card's metric chips -
  // without these, a project:updated broadcast (e.g. from editing
  // Budget/Value/Timeline) would wipe the card's chips back to nothing
  // until reload, since this whole object gets spread over the old card.
  budget: project.budget || [],
  budgetLocks: project.budget_locks || [],
  value: project.value || [],
  valueLocks: project.value_locks || [],
  timeline: project.timeline || [],
  timelineLocks: project.timeline_locks || [],
  handoff: project.handoff || null,
  capitalCommitted: parseFloat(project.capital_committed) || 0,
  monthsToFirstCash: project.months_to_first_cash !== null && project.months_to_first_cash !== undefined
    ? project.months_to_first_cash
    : null,
  metricSnapshots: project.metric_snapshots || [],
  // Tasks/links from the raw project row carry no cardId (see addTask/
  // addLink) - inject it the same way getBoardData does, or a
  // project:updated broadcast (e.g. from the Timeline editor) silently
  // strips cardId back off every action/link on this card until reload.
  actions: (project.tasks || []).map(task => ({ ...task, cardId: project.id })),
  links: (project.links || []).map(link => ({ ...link, cardId: project.id }))
});

// Task ids are only unique WITHIN a card (every card has a task #1), so
// any board-level "which task" state has to key on card + task - keying on
// the task id alone put task #1 on every card into edit mode at once, and
// each one's blur then saved the typed text onto its own card.
function taskKey(cardId, actionId) {
  return `${cardId}:${actionId}`;
}

// Wrapper component for project detail route
function ProjectDetailRoute({ user }) {
  const { projectId } = useParams();
  const navigate = useNavigate();

  return (
    <ProjectDetail
      projectId={projectId}
      onClose={() => navigate('/labs/board')}
      currentUser={user}
    />
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [user, setUser] = useState(null);
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

  // Authenticated app shell
  return (
    <>
      <Layout user={user} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<Navigate to="/labs/board" replace />} />
          <Route path="/labs/board" element={<OriginationBoard user={user} />} />
          <Route path="/labs/board/projects/:projectId" element={<ProjectDetailRoute user={user} />} />
          <Route path="/labs/portfolio" element={<Portfolio />} />
          <Route path="/labs/strategy-grid" element={<StrategyGrid />} />
          <Route path="/labs/studio" element={<OriginationBoard user={user} studioMode={true} />} />
          <Route path="/labs/orgcharts" element={<OrgCharts />} />
          <Route path="/labs/cashflow" element={<Cashflow />} />
          <Route path="/labs/improvements" element={<Improvements />} />
          <Route path="/settings" element={<SettingsPage user={user} onLogout={handleLogout} />} />
          <Route path="*" element={<Navigate to="/labs/board" replace />} />
        </Routes>
      </Layout>
      {showDevTools && <DevTools user={user} onClose={() => setShowDevTools(false)} />}
      {!showDevTools && (
        <button className="devtools-toggle" onClick={() => setShowDevTools(true)}>
          🔧
        </button>
      )}
    </>
  );

}

function OriginationBoard({ user, studioMode = false }) {
  const navigate = useNavigate();
  const [cards, setCards] = useState([]);
  const [people, setPeople] = useState({});
  const [, setOwnerColors] = useState({});
  const [projectTypeColors, setProjectTypeColors] = useState({});
  // Every team member's name (people above only has those with a photo) -
  // for the "@" task-assignment pickers.
  const [teamMembers, setTeamMembers] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNewCard, setShowNewCard] = useState(false);
  const [newCardColumn, setNewCardColumn] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [quickAddTaskFor, setQuickAddTaskFor] = useState(null); // card id whose inline "+" quick-add input is open
  const [quickAddTaskText, setQuickAddTaskText] = useState({}); // card id -> draft text
  const [quickAddAssignee, setQuickAddAssignee] = useState({}); // card id -> "@" assignee for that draft
  const [pendingCompleteIds, setPendingCompleteIds] = useState(() => new Set()); // taskKey()s mid-"just checked off" flash
  const [editingCardActionId, setEditingCardActionId] = useState(null); // taskKey() of the task being text-edited inline on a card face
  const [editingCardActionText, setEditingCardActionText] = useState('');
  const [sendingReminders, setSendingReminders] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderPreview, setReminderPreview] = useState(null); // { leads: [{name,email,projectCount,itemCount}], skipped }
  const [draggedCard, setDraggedCard] = useState(null);
  // The "isPrePost" columns (see PRE_POST_COLUMN_IDS) default to minimized.
  const [minimizedColumns, setMinimizedColumns] = useState(() => new Set(PRE_POST_COLUMN_IDS));

  const toggleColumnMinimized = (columnId) => {
    setMinimizedColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      return next;
    });
  };
  const [filterOwner, setFilterOwner] = useState('');
  const [filterProjectType, setFilterProjectType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('dateCreated');
  const [showMetrics, setShowMetrics] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [deletedCards, setDeletedCards] = useState([]);

  // Board restructure Stage 1: Origination (blue ramp) -> Execution (green
  // ramp). Handoff used to be an amber column between them; it's now a
  // state a card in any stage can be in (see HandoffPanel). Display/color order only -
  // cards can move to any of these in either direction (forward-only
  // enforcement removed per request). Keep in sync with boardStages.js's
  // ORIGINATION_STAGE_ORDER (used for Strategy Grid scope) and board-db.js's
  // own copy server-side.
  const allColumns = [
    // Restored after Stage 1 folded it into On Deck - see
    // migrations/004-restore-ideation-column.js.
    { id: 'ideation', title: 'Ideation', color: '#bbdefb', section: 'origination' },
    { id: 'on-deck', title: 'On Deck', color: '#90caf9', section: 'origination' },
    { id: 'diligence', title: 'Diligence', color: '#42a5f5', section: 'origination' },
    { id: 'capitalize', title: 'Capitalize', color: '#1565c0', section: 'origination' },
    { id: 'build', title: 'Build', color: '#a5d6a7', section: 'origination' },
    { id: 'operate', title: 'Operate', color: '#66bb6a', section: 'origination' },
    { id: 'assets', title: 'Assets', color: '#388e3c', section: 'origination' },
    // Restored after Stage 1 folded it into Exited - see
    // migrations/005-restore-abandoned-column.js.
    { id: 'abandoned', title: 'Abandoned', color: '#616161', section: 'origination' },
    { id: 'exited', title: 'Exited', color: '#1b5e20', section: 'origination' },
    { id: 'studio-ideation', title: 'Ideation', color: '#bbdefb', section: 'studio' },
    { id: 'studio-diligence', title: 'Diligence', color: '#e1bee7', section: 'studio' },
    { id: 'studio-validation', title: 'Validation', color: '#ce93d8', section: 'studio' },
    { id: 'studio-launch', title: 'Launch', color: '#ba68c8', section: 'studio' },
    { id: 'studio-spinout', title: 'Spinout', color: '#ab47bc', section: 'studio' },
    { id: 'studio-abandoned', title: 'Abandoned', color: '#616161', section: 'studio' },
    { id: 'studio-exited', title: 'Exited', color: '#2196f3', section: 'studio' }
  ];

  const columns = studioMode
    ? allColumns.filter(col => col.section === 'studio')
    : allColumns.filter(col => col.section !== 'studio');

  // Initial load on mount only - loadBoard isn't memoized, so listing it
  // as a dependency would re-run this every render.
  useEffect(() => {
    loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Recalculate metrics based on filtered cards (exclude every pre/post
  // stage - see PRE_POST_COLUMN_IDS - not just Ideation/Exited)
  useEffect(() => {
    if (cards.length === 0) return;

    // Apply same filters as the board view - including section, which this
    // block previously didn't: `cards` holds BOTH origination and studio
    // cards together (only `columns`, used for the kanban display itself,
    // was ever scoped by studioMode), so viewing the Project Board's
    // metrics could pull in Studio-only stages like Spinout, and vice
    // versa on the Studio Board.
    const filteredCards = cards.filter(c => {
      if (PRE_POST_COLUMN_IDS.includes(c.column)) return false;
      if (Boolean(c.column?.startsWith('studio-')) !== studioMode) return false;
      if (filterOwner && c.owner !== filterOwner) return false;
      if (filterProjectType && c.projectType !== filterProjectType) return false;
      if (searchQuery && !c.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });

    // Annual value / capital committed come from each card's Value and
    // Budget ledgers (deriveGridInputs, same as the Strategy Grid) - the
    // old annualValue/capitalCommitted fields are no longer editable.
    const today = new Date();
    const derived = new Map(filteredCards.map(c => [c.id, deriveGridInputs(c, today)]));
    const annualValueOf = (c) => derived.get(c.id).annualValue || 0;

    const newMetrics = {
      totalDeals: filteredCards.length,
      totalValue: filteredCards.reduce((sum, c) => sum + annualValueOf(c), 0),
      totalCapitalCommitted: filteredCards.reduce((sum, c) => sum + (derived.get(c.id).capitalCommitted || 0), 0),
      byStage: {}
    };

    filteredCards.forEach(card => {
      if (!newMetrics.byStage[card.column]) {
        newMetrics.byStage[card.column] = { count: 0, value: 0 };
      }
      newMetrics.byStage[card.column].count++;
      newMetrics.byStage[card.column].value += annualValueOf(card);
    });

    setMetrics(newMetrics);
  }, [cards, filterOwner, filterProjectType, searchQuery, studioMode]);

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
      setTeamMembers(data.teamMembers || Object.keys(data.people || {}));
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
      // The tab that created/restored this card already added it optimistically
      // (with the same server-issued id) before this broadcast round-trips back
      // to it - skip re-adding, or every create/restore duplicates on screen for
      // the initiating user.
      setCards(prevCards => {
        if (prevCards.some(c => c.id === card.id)) return prevCards;
        return [...prevCards, {
          id: card.id,
          title: card.title || 'Untitled',
          description: card.description || '',
          column: card.column || 'on-deck',
          owner: card.owner || '',
          notes: card.notes || '',
          annualValue: card.annualValue || 0,
          dateCreated: card.dateCreated || new Date(),
          projectType: card.projectType || '',
          handoff: card.handoff || null,
          actions: [],
          log: []
        }];
      });
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

    // mapProjectToCard (module level, above) converts the raw project rows
    // these /api/projects/* broadcasts carry.

    socketRef.current.on('project:created', ({ project }) => {
      console.log('📨 Project created:', project.id);
      setCards(prevCards => {
        if (prevCards.some(c => c.id === project.id)) return prevCards;
        return [...prevCards, mapProjectToCard(project)];
      });
    });

    socketRef.current.on('project:updated', ({ project }) => {
      console.log('📨 Project updated:', project.id);
      setCards(prevCards => prevCards.map(c =>
        c.id === project.id ? { ...c, ...mapProjectToCard(project) } : c
      ));
    });

    socketRef.current.on('project:deleted', ({ projectId }) => {
      console.log('📨 Project deleted:', projectId);
      setCards(prevCards => prevCards.filter(c => c.id !== projectId));
    });

    // Listen for action changes
    socketRef.current.on('action:created', ({ actionId, cardId, text, assignee }) => {
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
              completedBy: null,
              starred: false,
              assignee: assignee || null
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

    socketRef.current.on('action:starred', ({ actionId, cardId, starred }) => {
      console.log('📨 Action starred:', actionId, 'starred:', starred);
      setCards(prevCards => prevCards.map(c => {
        if (c.id === cardId) {
          return {
            ...c,
            actions: (c.actions || []).map(a =>
              a.id === actionId ? { ...a, starred } : a
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
    socketRef.current.on('link:created', ({ linkId, cardId, title, url, kind }) => {
      console.log('📨 Link created:', linkId, 'for card:', cardId);
      setCards(prevCards => prevCards.map(c => {
        if (c.id === cardId) {
          return {
            ...c,
            links: [...(c.links || []).filter(l => l.id !== linkId), {
              id: linkId,
              cardId,
              title,
              url,
              kind
            }]
          };
        }
        return c;
      }));
    });
    
    socketRef.current.on('link:updated', ({ cardId, link }) => {
      setCards(prevCards => prevCards.map(c => (
        c.id === cardId
          ? { ...c, links: (c.links || []).map(l => (l.id === link.id ? { ...link, cardId } : l)) }
          : c
      )));
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

    socketRef.current.on('action:assigned', ({ actionId, cardId, assignee }) => {
      setCards(prevCards => prevCards.map(c => (
        c.id === cardId
          ? { ...c, actions: (c.actions || []).map(a => (a.id === actionId ? { ...a, assignee } : a)) }
          : c
      )));
    });

    socketRef.current.on('log:created', ({ cardId, log }) => {
      console.log('📨 Log entry created for card:', cardId);
      setCards(prevCards => prevCards.map(c => {
        if (c.id === cardId) {
          return { ...c, log: [log, ...(c.log || [])] };
        }
        return c;
      }));
    });

    socketRef.current.on('log:updated', ({ cardId, log }) => {
      setCards(prevCards => prevCards.map(c => (
        c.id === cardId
          ? { ...c, log: (c.log || []).map(l => (l.id === log.id ? log : l)) }
          : c
      )));
    });

    socketRef.current.on('log:deleted', ({ cardId, logId }) => {
      setCards(prevCards => prevCards.map(c => (
        c.id === cardId
          ? { ...c, log: (c.log || []).filter(l => l.id !== logId) }
          : c
      )));
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
      // The server broadcasts 'card:created' over the socket BEFORE sending
      // this HTTP response, so that broadcast can (and often does) arrive
      // and get added by the socket handler first - guard here too, not
      // just there, or whichever one loses the race double-adds the card.
      setCards(prevCards => {
        if (prevCards.some(c => c.id === serverCardId)) return prevCards;
        return [...prevCards, newCard];
      });
      setShowNewCard(false);
      
      // Add pending actions if any (now using correct server ID)
      if (pendingActions.length > 0) {
        for (const pending of pendingActions) {
          await addAction(serverCardId, cardData.title, pending.text, pending.assignee);
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
      const response = await apiFetch(`${API_BASE_URL}/api/origination/card/${cardId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(cardData)
      });
      // apiFetch only throws on a 401 or network failure - a 404/500 (e.g.
      // someone else already deleted this card) resolves normally with
      // ok: false, and the card would otherwise still show the edit as
      // applied client-side even though the server rejected it.
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        alert(`Failed to update card:\n\n${result.error || 'Unknown error'}`);
        return;
      }

      // Update locally without loading screen
      setCards(prevCards => prevCards.map(c =>
        c.id === cardId ? { ...c, ...cardData } : c
      ));
      setEditingCard(null);
    } catch (error) {
      console.error('Failed to update card:', error);
      alert('Failed to update card - check console for details');
    }
  };

  // Begin / End / Cancel Handoff - handoff is a state, not a stage (see
  // server/handoff.js). Each returns the updated project, applied here
  // straight away; the project:updated broadcast that follows is the same
  // data. Returns true on success so the panel can reset its own state.
  const runHandoffAction = async (cardId, action, body = {}) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/projects/${cardId}/handoff/${action}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(`Could not ${action} handoff:\n\n${result.error || 'Unknown error'}`);
        return false;
      }
      setCards(prevCards => prevCards.map(c => (
        c.id === cardId ? { ...c, ...mapProjectToCard(result.project) } : c
      )));
      return true;
    } catch (error) {
      console.error(`Failed to ${action} handoff:`, error);
      alert(`Failed to ${action} handoff - check console for details`);
      return false;
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
      const response = await apiFetch(`${API_BASE_URL}/api/origination/card/${cardId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ...card, column: newColumn })
      });
      // See updateCard - apiFetch resolves normally (ok: false) on a
      // rejected write instead of throwing, so this needs its own check
      // to trigger the same revert-on-failure the catch block below does.
      if (!response.ok) {
        console.error('Failed to move card: server rejected the request');
        await loadBoard();
      }
    } catch (error) {
      console.error('Failed to move card:', error);
      // Revert on error
      await loadBoard();
    }
  };

  const boardRef = useRef(null);
  const scrollInterval = useRef(null);

  const handleDragStart = (e, card) => {
    setDraggedCard(card);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Auto-scroll when dragging near edges
    if (!boardRef.current) return;
    
    const board = boardRef.current;
    const threshold = 100; // Distance from edge to trigger scroll
    const scrollSpeed = 15; // Pixels to scroll per frame
    
    const rect = board.getBoundingClientRect();
    const mouseX = e.clientX;
    
    // Clear any existing scroll interval
    if (scrollInterval.current) {
      clearInterval(scrollInterval.current);
      scrollInterval.current = null;
    }
    
    // Check if near left edge
    if (mouseX - rect.left < threshold && board.scrollLeft > 0) {
      scrollInterval.current = setInterval(() => {
        board.scrollLeft -= scrollSpeed;
      }, 16); // ~60fps
    }
    // Check if near right edge
    else if (rect.right - mouseX < threshold && board.scrollLeft < board.scrollWidth - board.clientWidth) {
      scrollInterval.current = setInterval(() => {
        board.scrollLeft += scrollSpeed;
      }, 16);
    }
  };

  const handleDragEnd = () => {
    // Clear scroll interval when drag ends
    if (scrollInterval.current) {
      clearInterval(scrollInterval.current);
      scrollInterval.current = null;
    }
    setDraggedCard(null);
  };

  const handleDrop = (e, columnId) => {
    e.preventDefault();
    if (draggedCard) {
      // Cards move freely in either direction (forward-only enforcement
      // removed per request) - including while in handoff, which is a
      // state rather than a stage.
      moveCard(draggedCard.id, columnId);
    }
    handleDragEnd();
  };
  
  // Clean up scroll interval on unmount or when drag ends
  useEffect(() => {
    return () => {
      if (scrollInterval.current) {
        clearInterval(scrollInterval.current);
      }
    };
  }, []);
  
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

  const toggleActionStar = async (actionId, starred, cardId) => {
    try {
      await apiFetch(`${API_BASE_URL}/api/origination/action/star`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ actionId, starred, cardId })
      });
      // State will be updated via the action:starred Socket.io event
    } catch (error) {
      console.error('Failed to star action:', error);
    }
  };

  const toggleCardIc = async (cardId, needsIc) => {
    // Optimistic - this is a quick one-click toggle from the board face,
    // not a full editingCard save flow.
    setCards(prevCards => prevCards.map(c => c.id === cardId ? { ...c, needsIc } : c));
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/card/${cardId}/ic`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ needsIc })
      });
      if (!response.ok) {
        setCards(prevCards => prevCards.map(c => c.id === cardId ? { ...c, needsIc: !needsIc } : c));
      }
    } catch (error) {
      console.error('Failed to flag card for IC:', error);
      setCards(prevCards => prevCards.map(c => c.id === cardId ? { ...c, needsIc: !needsIc } : c));
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
  
  const openReminderModal = async () => {
    setShowReminderModal(true);
    setReminderPreview(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/send-reminders/preview`, {
        headers: getAuthHeaders()
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to load reminder preview');
      setReminderPreview(result);
    } catch (error) {
      window.alert(`Failed to load reminder preview: ${error.message}`);
      setShowReminderModal(false);
    }
  };

  const sendSelectedReminders = async (emails) => {
    setSendingReminders(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/send-reminders`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ onlyEmails: emails })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send reminders');
      const describeFailure = (f) => {
        try {
          const parsed = JSON.parse(f.error);
          return `${f.to}: ${parsed.message || f.error}`;
        } catch {
          return `${f.to}: ${f.error}`;
        }
      };
      const failedNote = result.failed?.length ? `\nFailed:\n${result.failed.map(describeFailure).join('\n')}` : '';
      window.alert(`Sent ${result.sent.length} reminder email(s)${result.sent.length ? ':\n' + result.sent.join('\n') : '.'}${failedNote}`);
      setShowReminderModal(false);
    } catch (error) {
      window.alert(`Failed to send reminders: ${error.message}`);
    } finally {
      setSendingReminders(false);
    }
  };

  // assignee: a team member's name from the "@" picker, or null. Returns
  // true on success, so callers only clear the typed draft once it's saved.
  const addAction = async (cardId, cardTitle, text, assignee = null) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/action`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ cardId, cardTitle, text, assignee })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        alert(`Could not add task:\n\n${result.error || 'Unknown error'}`);
        return false;
      }
      // State will be updated via Socket.io event (action:created)
      return true;
    } catch (error) {
      console.error('Failed to add action:', error);
      alert('Failed to add task - check console for details');
      return false;
    }
  };

  // Reassign or unassign (null) an existing task. State updates via the
  // action:assigned broadcast, same as the other task edits.
  const setActionAssignee = async (actionId, cardId, assignee) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/action/assign`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ actionId, cardId, assignee })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        alert(`Could not assign task:\n\n${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to assign action:', error);
    }
  };

  const updateAction = async (actionId, text, cardId) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/action/${actionId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ text, cardId })
      });
      
      if (response.ok) {
        // State will be updated via Socket.io event
      }
    } catch (error) {
      console.error('Failed to update action:', error);
    }
  };

  const deleteAction = async (actionId, cardId) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/action/${actionId}?cardId=${cardId}`, {
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

  const addLogEntry = async (cardId, details) => {
    const response = await apiFetch(`${API_BASE_URL}/api/origination/log`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ cardId, details })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to add note');
    // State will be updated via Socket.io event (log:created)
  };

  const updateLogEntry = async (logId, details) => {
    const response = await apiFetch(`${API_BASE_URL}/api/origination/log/${logId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ details })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to update note');
    // Apply the server's copy now rather than waiting on the socket - if the
    // socket has dropped, the edit would otherwise look lost. The
    // log:updated broadcast that follows is an idempotent replace.
    const { log } = result;
    setCards(prevCards => prevCards.map(c => (
      c.id === log.projectId
        ? { ...c, log: (c.log || []).map(l => (l.id === log.id ? log : l)) }
        : c
    )));
  };

  const deleteLogEntry = async (logId) => {
    const response = await apiFetch(`${API_BASE_URL}/api/origination/log/${logId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to delete note');
    // Remove it now (same reason as updateLogEntry); log:deleted is a no-op after.
    setCards(prevCards => prevCards.map(c => (
      (c.log || []).some(l => l.id === logId)
        ? { ...c, log: c.log.filter(l => l.id !== logId) }
        : c
    )));
  };

  const loadDeletedCards = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/trash`, {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        setDeletedCards(data.cards || []);
      }
    } catch (error) {
      console.error('Failed to load deleted cards:', error);
    }
  };

  const restoreCard = async (cardId) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/origination/card/${cardId}/restore`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        const restoredCard = data.card;
        
        // Remove from deleted cards list
        setDeletedCards(prev => prev.filter(c => c.id !== cardId));
        
        // Immediately add card back to board (optimistic update). Same race
        // as createCard: the server broadcasts 'card:created' before this
        // HTTP response is sent, so guard against it having already been
        // added by the socket handler.
        setCards(prevCards => {
          if (prevCards.some(c => c.id === restoredCard.id)) return prevCards;
          return [...prevCards, {
            id: restoredCard.id,
            title: restoredCard.title,
            description: restoredCard.description || '',
            column: restoredCard.column_name || restoredCard.column,
            owner: restoredCard.owner || '',
            notes: restoredCard.notes || '',
            annualValue: restoredCard.annual_value || 0,
            dateCreated: restoredCard.date_created,
            projectType: restoredCard.project_type || '',
            actions: [],
            links: [],
            log: []
          }];
        });
      }
    } catch (error) {
      console.error('Failed to restore card:', error);
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

      // Update local state - people/ownerColors are no longer part of this
      // payload (Settings.js only sends projectTypeColors now; team
      // management moved to the global Settings page/`/api/people`), so
      // don't overwrite them with undefined here - loadBoard below already
      // re-fetches both fresh from the server regardless.
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
          <button className="btn-secondary" onClick={() => setShowSettings(true)}>⚙️ Board Settings</button>
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
            <option value="annualValue">Annual Value</option>
            <option value="daysInStage">Time in Stage</option>
          </select>
        </div>
        <div className="board-actions">
          <button className="btn-secondary" onClick={() => setShowMetrics(!showMetrics)}>
            📊 {showMetrics ? 'Hide' : 'Show'} Metrics
          </button>
          <button className="btn-secondary" onClick={exportToCSV}>
            📥 Export CSV
          </button>
          <button className="btn-secondary" onClick={openReminderModal}>
            📧 Send Reminder
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
            <h3>{formatCompactMoney(metrics.totalValue)}</h3>
            <p>Total Annual Value</p>
          </div>
          <div className="metric-card">
            <h3>{formatCompactMoney(metrics.totalCapitalCommitted)}</h3>
            <p>Total Capital Committed</p>
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

      <div className="kanban-board" ref={boardRef}>
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
            if (sortBy === 'annualValue') {
              return (deriveGridInputs(b).annualValue || 0) - (deriveGridInputs(a).annualValue || 0);
            }
            if (sortBy === 'daysInStage') return (b.daysInStage || 0) - (a.daysInStage || 0);
            return 0;
          });
          
          const isEmpty = filteredCards.length === 0;
          const isPrePost = PRE_POST_COLUMN_IDS.includes(column.id);
          const isMinimized = minimizedColumns.has(column.id);

          return (
          <div
            key={column.id}
            className={`kanban-column ${isMinimized ? 'column-minimized' : (isEmpty ? 'column-empty' : '')} ${isPrePost ? `column-${column.id}` : ''}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, column.id)}
          >
            <div className="column-header" style={{ backgroundColor: column.color }}>
              <h3>{column.title}</h3>
              <span className="card-count">
                {filteredCards.length}
              </span>
              <div className="column-header-actions">
                {isPrePost && (
                  <button
                    className="column-minimize-btn"
                    onClick={() => toggleColumnMinimized(column.id)}
                    title={isMinimized ? 'Expand column' : 'Minimize column'}
                  >
                    {isMinimized ? '▸' : '▾'}
                  </button>
                )}
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
                const isPrePost = PRE_POST_COLUMN_IDS.includes(column.id);
                const metricChips = isPrePost ? [] : getCardMetricChips(card);
                const isHandoff = !studioMode && !!card.handoff;
                const handoffDays = isHandoff ? daysSince(card.handoff.startedAt) : null;
                return (
                  <div
                    key={card.id}
                    className={`kanban-card ${isPrePost ? 'card-prepost' : ''} ${card.daysInStage > 30 ? 'stale-deal' : ''} ${card.needsIc ? 'card-needs-ic' : ''}`}
                    style={{
                      borderLeft: card.projectType && projectTypeColors[card.projectType] 
                        ? `4px solid ${projectTypeColors[card.projectType]}` 
                        : '4px solid transparent'
                    }}
                    draggable
                    onDragStart={(e) => handleDragStart(e, card)}
                    onDragEnd={handleDragEnd}
                    onClick={() => setEditingCard(card)}
                  >
                    {isHandoff && handoffDays !== null && (
                      <div
                        className={`handoff-days-badge ${handoffDays >= HANDOFF_ALARM_DAYS ? 'handoff-days-alarm' : ''}`}
                        title={`Handing off to ${card.handoff.lead} - ${handoffDays} day${handoffDays === 1 ? '' : 's'} so far`}
                      >
                        ⏳ {handoffDays}d in handoff
                      </div>
                    )}
                    {metricChips.length > 0 && (
                      <div className="card-metric-chips">
                        {metricChips.map((chip) => (
                          <span key={chip.key} className={`card-metric-chip ${chip.className}`}>
                            {chip.icon} {chip.text}
                          </span>
                        ))}
                      </div>
                    )}
                    {!isPrePost && card.daysInStage > 30 && <div className="stale-indicator" title={`${card.daysInStage} days in stage`}>⚠️</div>}
                    {!isPrePost && (
                      <button
                        type="button"
                        className={`card-ic-btn ${card.needsIc ? 'active' : ''}`}
                        title={card.needsIc ? 'Remove IC flag' : 'Flag for Investment Committee discussion'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCardIc(card.id, !card.needsIc);
                        }}
                      >IC</button>
                    )}
                    <div className="card-main">
                      {card.owner && (
                        <div className={`card-photo ${isHandoff ? 'card-photo-stacked' : ''}`}>
                          {renderAvatar(card.owner, people, 60)}
                          {/* In handoff: the current lead (existing avatar, unchanged
                              position/size) plus the incoming handoff lead as a smaller
                              offset avatar - both from the same people list. */}
                          {isHandoff && card.handoff.lead && (
                            <div className="card-photo-operator" title={`Handoff lead: ${card.handoff.lead}`}>
                              {renderAvatar(card.handoff.lead, people, 28)}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="card-content">
                        <h4>{card.title}</h4>
                        {quickOpenLinks(card.links).length > 0 && (
                          <div className="card-quick-links">
                            {quickOpenLinks(card.links).map((link) => (
                              <a
                                key={link.id}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Open ${kindLabel(link.kind)}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ResourceIcon type={detectSource(link.url).type} size={16} />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {!isPrePost && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="card-quick-add-btn"
                          title="Add a task"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuickAddTaskFor(quickAddTaskFor === card.id ? null : card.id);
                          }}
                        >+</button>
                      </div>
                    )}
                    {quickAddTaskFor === card.id && (
                      <div className="card-quick-add-row" onClick={(e) => e.stopPropagation()}>
                        <AssigneeInput
                          autoFocus
                          className="card-quick-add-input"
                          placeholder="Add a task... (@ to assign)"
                          value={quickAddTaskText[card.id] || ''}
                          onChange={(text) => setQuickAddTaskText(prev => ({ ...prev, [card.id]: text }))}
                          assignee={quickAddAssignee[card.id] || null}
                          onAssigneeChange={(name) => setQuickAddAssignee(prev => ({ ...prev, [card.id]: name }))}
                          people={teamMembers}
                          renderAvatar={(name, size) => renderAvatar(name, people, size)}
                          onSubmit={async () => {
                            const text = (quickAddTaskText[card.id] || '').trim();
                            if (text && await addAction(card.id, card.title, text, quickAddAssignee[card.id] || null)) {
                              setQuickAddTaskText(prev => ({ ...prev, [card.id]: '' }));
                              setQuickAddAssignee(prev => ({ ...prev, [card.id]: null }));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setQuickAddTaskFor(null);
                            }
                          }}
                          onBlur={() => setQuickAddTaskFor(null)}
                        />
                      </div>
                    )}
                    {!isPrePost && card.actions && card.actions.filter(a => !a.completedOn || pendingCompleteIds.has(taskKey(card.id, a.id))).length > 0 && (
                      <div className="card-actions-section">
                        {sortByStarred(card.actions.filter(a => !a.completedOn || pendingCompleteIds.has(taskKey(card.id, a.id)))).slice(0, 3).map((action) => (
                          <div key={action.id} className={`card-action-item ${action.starred ? 'starred' : ''}`} onClick={(e) => {
                            e.stopPropagation();
                            const key = taskKey(card.id, action.id);
                            if (pendingCompleteIds.has(key)) return;
                            // Show the checkmark for a beat before the item
                            // actually disappears from this "pending" list -
                            // toggleAction alone updates real state (via the
                            // action:toggled socket event) almost instantly,
                            // which filtered the row out before the user
                            // ever saw it checked.
                            setPendingCompleteIds(prev => new Set(prev).add(key));
                            toggleAction(action.id, true, action.cardId, action.cardTitle);
                            setTimeout(() => {
                              setPendingCompleteIds(prev => {
                                const next = new Set(prev);
                                next.delete(key);
                                return next;
                              });
                            }, 600);
                          }}>
                            <input type="checkbox" checked={pendingCompleteIds.has(taskKey(card.id, action.id))} readOnly />
                            <span
                              className="star-toggle"
                              title={action.starred ? 'Unstar' : 'Mark as do-or-die'}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleActionStar(action.id, !action.starred, action.cardId);
                              }}
                            >{action.starred ? '★' : '☆'}</span>
                            {action.assignee && (
                              <span className="task-assignee-tag" title={`Assigned to ${action.assignee}`}>
                                @{action.assignee}
                              </span>
                            )}
                            {editingCardActionId === taskKey(card.id, action.id) ? (
                              <input
                                type="text"
                                value={editingCardActionText}
                                onChange={(e) => setEditingCardActionText(e.target.value)}
                                onBlur={() => {
                                  if (editingCardActionText.trim() && editingCardActionText !== action.text) {
                                    updateAction(action.id, editingCardActionText.trim(), action.cardId);
                                  }
                                  setEditingCardActionId(null);
                                  setEditingCardActionText('');
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.target.blur(); }
                                  if (e.key === 'Escape') { setEditingCardActionId(null); setEditingCardActionText(''); }
                                }}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                style={{ flex: 1, padding: '2px 4px', border: '1px solid #2196f3' }}
                              />
                            ) : (
                              <span
                                style={{ cursor: 'text' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingCardActionId(taskKey(card.id, action.id));
                                  setEditingCardActionText(action.text);
                                }}
                              >{action.text}</span>
                            )}
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
          teamMembers={teamMembers}
          columns={columns}
          initialColumn={newCardColumn}
          toggleAction={toggleAction}
          onToggleActionStar={toggleActionStar}
          onAddAction={addAction}
          onUpdateAction={updateAction}
          onAddLog={addLogEntry}
          projectTypeColors={projectTypeColors}
          people={people}
          studioMode={studioMode}
          currentUser={user}
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
                const response = await apiFetch(`${API_BASE_URL}/api/origination/card/${id}`, {
                  method: 'DELETE',
                  headers: getAuthHeaders()
                });
                if (!response.ok) {
                  alert('Failed to delete card - it may have already been removed.');
                  return;
                }

                // Remove card locally without loading screen
                setCards(prevCards => prevCards.filter(c => c.id !== id));
                setEditingCard(null);
              } catch (error) {
                console.error('Failed to delete:', error);
                alert('Failed to delete card - check console for details');
              }
            }
          }}
          columns={columns}
          toggleAction={toggleAction}
          onToggleActionStar={toggleActionStar}
          onAddAction={addAction}
          onUpdateAction={updateAction}
          onDeleteAction={deleteAction}
          onSetActionAssignee={setActionAssignee}
          teamMembers={teamMembers}
          onAddLog={addLogEntry}
          onUpdateLog={updateLogEntry}
          onDeleteLog={deleteLogEntry}
          projectTypeColors={projectTypeColors}
          people={people}
          studioMode={studioMode}
          onViewProject={(projectId) => navigate(`/labs/board/projects/${projectId}`)}
          currentUser={user}
          onHandoffAction={runHandoffAction}
        />
      )}

      {showSettings && (
        <Settings
          projectTypeColors={projectTypeColors}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
        />
      )}

      {showTrash && (
        <TrashModal
          deletedCards={deletedCards}
          onClose={() => setShowTrash(false)}
          onRestore={restoreCard}
          people={people}
          projectTypeColors={projectTypeColors}
        />
      )}

      {showReminderModal && (
        <ReminderModal
          preview={reminderPreview}
          sending={sendingReminders}
          onClose={() => setShowReminderModal(false)}
          onSend={sendSelectedReminders}
        />
      )}

      {/* Floating action buttons */}
      <button 
        className="trash-toggle" 
        onClick={() => {
          loadDeletedCards();
          setShowTrash(true);
        }}
        title="View trash"
      >
        🗑️
      </button>

      {/* CHAT FEATURE TEMPORARILY DISABLED */}
    </div>
  );
}

function TrashModal({ deletedCards, onClose, onRestore, people, projectTypeColors }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Trash</h2>
          <button 
            type="button"
            className="modal-icon-btn"
            onClick={onClose}
            title="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {deletedCards.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 16px', opacity: 0.3 }}>
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
              <p>No deleted cards</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {deletedCards.map(card => (
                <div 
                  key={card.id}
                  style={{
                    padding: '16px',
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    backgroundColor: '#f9f9f9',
                    borderLeft: card.project_type && projectTypeColors[card.project_type]
                      ? `4px solid ${projectTypeColors[card.project_type]}`
                      : '4px solid transparent'
                  }}
                >
                  {card.owner && (
                    people[card.owner] ? (
                      <img 
                        src={people[card.owner]} 
                        alt={card.owner}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          border: '2px solid #555'
                        }}
                      />
                    ) : (
                      <div 
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: getInitialsColor(card.owner),
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          border: '2px solid #555'
                        }}
                      >
                        {card.owner.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                    )
                  )}
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{card.title}</h4>
                    <div style={{ fontSize: '13px', color: '#666' }}>
                      {card.description && <span>{card.description} • </span>}
                      {card.column && <span>From: {card.column.replace('-', ' ')} • </span>}
                      Deleted: {new Date(card.deleted_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button 
                    className="btn-primary"
                    onClick={() => {
                      onRestore(card.id);
                    }}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// "Send Reminder" confirmation - every lead with open items is checked by
// default, but any of them can be unchecked before the real send goes out
// (per request, since the plain confirm() this replaced couldn't exclude
// individual people).
function ReminderModal({ preview, sending, onClose, onSend }) {
  const [checked, setChecked] = useState(() => new Set());

  useEffect(() => {
    if (preview) {
      setChecked(new Set(preview.leads.map((lead) => lead.email)));
    }
  }, [preview]);

  const toggle = (email) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Send Reminder</h2>
          <button type="button" className="modal-icon-btn" onClick={onClose} title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {!preview ? (
            <p>Loading who has open items...</p>
          ) : preview.leads.length === 0 ? (
            <p>Nobody has open items right now - nothing to send.</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
                  Unchecking someone skips their email this time only.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className="btn-secondary" onClick={() => setChecked(new Set(preview.leads.map((l) => l.email)))}>
                    Select all
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setChecked(new Set())}>
                    Select none
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {preview.leads.map((lead) => (
                  <label
                    key={lead.email}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 12px',
                      border: '1px solid #e0e0e0',
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(lead.email)}
                      onChange={() => toggle(lead.email)}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{lead.name}</div>
                      <div style={{ fontSize: '13px', color: '#666' }}>{lead.email}</div>
                    </div>
                    <div style={{ fontSize: '13px', color: '#666', whiteSpace: 'nowrap' }}>
                      {lead.itemCount} item{lead.itemCount === 1 ? '' : 's'} · {lead.projectCount} project{lead.projectCount === 1 ? '' : 's'}
                    </div>
                  </label>
                ))}
              </div>
              {preview.skipped.length > 0 && (
                <p style={{ marginTop: '16px', fontSize: '13px', color: '#888' }}>
                  Not listed (no open items, or no email on file): {preview.skipped.map((s) => s.name).join(', ')}
                </p>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!preview || checked.size === 0 || sending}
              onClick={() => onSend([...checked])}
            >
              {sending ? 'Sending...' : `Send Reminder (${checked.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Handoff inside CardModal (existing origination cards only). Handoff is a
// state, not a stage: Begin names who's taking over and starts the
// days-in-handoff clock; End makes them the owner (the originating lead is
// removed); Cancel drops it with the owner unchanged. Each click saves
// immediately via its own route, not the modal's generic Save.
function HandoffPanel({ card, sortedPeople, onHandoffAction }) {
  const handoff = card.handoff;
  const [choosing, setChoosing] = useState(false);
  const [lead, setLead] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action, body) => {
    setBusy(true);
    try {
      const ok = await onHandoffAction(card.id, action, body);
      if (ok) {
        setChoosing(false);
        setLead('');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!handoff) {
    return (
      <div className="handoff-panel handoff-panel-idle">
        {!choosing ? (
          <button type="button" className="btn-secondary" onClick={() => setChoosing(true)}>
            🤝 Begin Handoff
          </button>
        ) : (
          <div className="handoff-begin">
            <label>Who's taking over?</label>
            <div className="handoff-begin-row">
              <select value={lead} onChange={(e) => setLead(e.target.value)} autoFocus>
                <option value="">Choose the handoff lead...</option>
                {sortedPeople.filter((person) => person !== card.owner).map((person) => (
                  <option key={person} value={person}>{person}</option>
                ))}
              </select>
              <button type="button" className="btn-primary" disabled={!lead || busy} onClick={() => run('begin', { lead })}>
                Begin
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setChoosing(false); setLead(''); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const daysIn = daysSince(handoff.startedAt);
  const from = card.owner || 'Unassigned';
  return (
    <div className="handoff-panel">
      <h3>🤝 In handoff</h3>
      <div className="handoff-panel-summary">
        {from} → <strong>{handoff.lead}</strong>
      </div>
      {daysIn !== null && (
        <div className={`handoff-panel-days ${daysIn >= HANDOFF_ALARM_DAYS ? 'handoff-days-alarm' : ''}`}>
          {daysIn} day{daysIn === 1 ? '' : 's'} in handoff
        </div>
      )}
      <div className="handoff-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`End handoff? ${handoff.lead} becomes the lead and ${from} is removed.`)) run('end');
          }}
        >
          ✅ End Handoff
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Cancel the handoff to ${handoff.lead}? ${from} stays the lead.`)) run('cancel');
          }}
        >
          Cancel Handoff
        </button>
      </div>
    </div>
  );
}

function CardModal({ card, onClose, onSave, onDelete, columns, initialColumn, toggleAction, onToggleActionStar, onAddAction, onUpdateAction, onDeleteAction, onSetActionAssignee, teamMembers, onAddLog, onUpdateLog, onDeleteLog, projectTypeColors, people, studioMode, onViewProject, currentUser, onHandoffAction }) {
  const [formData, setFormData] = useState({
    title: card?.title || '',
    description: card?.description || '',
    // Origination's default is explicitly 'on-deck', not "whichever column
    // happens to be first in the array" - that used to be equivalent, but
    // isn't now that Ideation sorts first. Studio still has no ranked
    // default of its own, so it keeps relying on array order.
    column: card?.column || initialColumn || (studioMode ? columns[0].id : 'on-deck'),
    owner: card?.owner || '',
    notes: card?.notes || '',
    annualValue: card?.annualValue || 0,
    capitalCommitted: card?.capitalCommitted || 0,
    monthsToFirstCash: card?.monthsToFirstCash !== null && card?.monthsToFirstCash !== undefined ? card.monthsToFirstCash : '',
    projectType: card?.projectType || ''
  });
  const [newActionText, setNewActionText] = useState('');
  const [newActionAssignee, setNewActionAssignee] = useState(null); // from the "@" picker
  const [assigningActionId, setAssigningActionId] = useState(null); // task whose reassign picker is open
  const [pendingActions, setPendingActions] = useState([]); // new card only: [{ text, assignee }]
  const [newLogText, setNewLogText] = useState('');
  const [addingLog, setAddingLog] = useState(false);
  const [editingLogId, setEditingLogId] = useState(null);
  const [editingLogText, setEditingLogText] = useState('');
  const [savingLog, setSavingLog] = useState(false);
  const currentUserName = noteAuthorName(currentUser);
  const [editingActionId, setEditingActionId] = useState(null);
  const [editingActionText, setEditingActionText] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  
  // Memoize sorted lists to prevent recomputing on every render
  const sortedPeople = useMemo(() => 
    people ? Object.keys(people).sort() : [], 
    [people]
  );
  
  // Everyone on the team for the "@" assignment pickers (falls back to the
  // photo-only people list where the full list wasn't passed).
  const assignablePeople = teamMembers && teamMembers.length ? teamMembers : sortedPeople;

  const sortedProjectTypes = useMemo(() =>
    projectTypeColors ? Object.keys(projectTypeColors) : [],
    [projectTypeColors]
  );

  // Cards can move to any column in either direction (forward-only
  // enforcement removed per request).
  const availableColumns = columns;

  // Ending a handoff changes the owner server-side while this modal is
  // open - follow it here, or a later Save would quietly put the old lead
  // back. Also picks up an owner change someone else made meanwhile.
  const cardOwner = card?.owner;
  useEffect(() => {
    if (cardOwner !== undefined) {
      setFormData((prev) => ({ ...prev, owner: cardOwner || '' }));
    }
  }, [cardOwner]);

  const handleAddAction = async () => {
    if (!newActionText.trim()) return;
    
    if (card) {
      // Existing card - add directly
      if (onAddAction && await onAddAction(card.id, card.title, newActionText.trim(), newActionAssignee)) {
        setNewActionText('');
        setNewActionAssignee(null);
      }
    } else {
      // New card - add to pending list
      setPendingActions([...pendingActions, { text: newActionText.trim(), assignee: newActionAssignee }]);
      setNewActionText('');
      setNewActionAssignee(null);
    }
  };

  const handleAddLog = async () => {
    if (!newLogText.trim() || !card || !onAddLog) return;
    setAddingLog(true);
    try {
      await onAddLog(card.id, newLogText.trim());
      setNewLogText('');
    } catch (err) {
      window.alert(`Failed to add note: ${err.message}`);
    } finally {
      setAddingLog(false);
    }
  };

  const startEditingLog = (entry) => {
    setEditingLogId(entry.id);
    setEditingLogText(entry.details || '');
  };

  const cancelEditingLog = () => {
    setEditingLogId(null);
    setEditingLogText('');
  };

  const handleSaveLogEdit = async () => {
    if (!editingLogText.trim() || !onUpdateLog) return;
    setSavingLog(true);
    try {
      await onUpdateLog(editingLogId, editingLogText.trim());
      cancelEditingLog();
    } catch (err) {
      window.alert(`Failed to update note: ${err.message}`);
    } finally {
      setSavingLog(false);
    }
  };

  const handleDeleteLog = async (entry) => {
    if (!onDeleteLog || !window.confirm('Delete this note?')) return;
    try {
      await onDeleteLog(entry.id);
      if (editingLogId === entry.id) cancelEditingLog();
    } catch (err) {
      window.alert(`Failed to delete note: ${err.message}`);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title || !formData.title.trim()) {
      alert('Please enter a title for the project');
      setEditingTitle(true);
      return;
    }
    onSave(formData, pendingActions);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in inputs (except title input - Escape should close editing)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape' && editingTitle) {
          setEditingTitle(false);
          return;
        }
        // Allow other input behaviors
        return;
      }
      
      // Escape to close modal
      if (e.key === 'Escape') {
        onClose();
      }
      // Shift+Enter to save
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        if (!formData.title || !formData.title.trim()) {
          alert('Please enter a title for the project');
          setEditingTitle(true);
          return;
        }
        onSave(formData, pendingActions);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [formData, pendingActions, onSave, onClose, editingTitle]);

  return (
    <div className="modal-overlay">
      <div className="modal-content wide card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {editingTitle ? (
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setEditingTitle(false);
                }
                if (e.key === 'Escape') {
                  setEditingTitle(false);
                }
              }}
              autoFocus
              style={{
                fontSize: '24px',
                fontWeight: '600',
                border: '2px solid #667eea',
                borderRadius: '4px',
                padding: '8px 12px',
                flex: 1,
                outline: 'none'
              }}
            />
          ) : (
            <h2 
              onClick={() => setEditingTitle(true)}
              style={{ 
                cursor: 'pointer',
                color: formData.title ? '#1f2937' : '#999',
                userSelect: 'none'
              }}
              title="Click to edit title"
            >
              {formData.title || 'New Project'}
            </h2>
          )}
          <div className="modal-header-actions">
            {card && onDelete && (
              <button 
                type="button"
                className="modal-icon-btn delete"
                onClick={() => onDelete(card.id)}
                title="Delete project"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            )}
            <button 
              type="button"
              className="modal-icon-btn"
              onClick={onClose}
              title="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="modal-body">
          <div className="modal-three-column">
            <div className="modal-left-column">
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
              {availableColumns.map(col => (
                <option key={col.id} value={col.id}>{col.title}</option>
              ))}
            </select>
          </div>
          {!studioMode && card && onHandoffAction && (
            <HandoffPanel
              card={card}
              sortedPeople={assignablePeople}
              onHandoffAction={onHandoffAction}
            />
          )}
          <div className="form-group">
            <label>Owner</label>
            <select
              value={formData.owner}
              onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
            >
              <option value="">Unassigned</option>
              {/* Full team list, not just people with a photo - plus the
                  current owner, in case they're no longer on it. */}
              {[...new Set([...assignablePeople, ...(formData.owner ? [formData.owner] : [])])].map(person => (
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
          {/* Annual Value, Capital Committed, and Months to First Cash
              moved to Project Detail (ProjectDetail.js) - per request,
              since Value/Budget there already track the same concepts in
              more detail, and this quick-edit modal doesn't need to
              duplicate them. formData still carries these fields through
              unchanged on save (nothing here mutates them), so View
              Project Detail is the only way to edit them now. */}
          {/* Links moved to Project Detail's Resources row (Project Folder,
              Working Model, Teaser...) - board cards show quick-open icons
              for the folder and model. */}
            </div>
            
            <div className="modal-right-column">
              <h3>Next Actions</h3>
          <div className="action-items-section">
            {card && card.actions && card.actions.length > 0 && (
              <div className="modal-actions-list">
                {sortByStarred([...card.actions].reverse()).map((action, idx) => (
                  <div key={action.id || idx} className={`modal-action-item ${action.completedOn ? 'completed' : ''} ${action.starred ? 'starred' : ''}`}>
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
                    <span
                      className="star-toggle"
                      title={action.starred ? 'Unstar' : 'Mark as do-or-die'}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onToggleActionStar) {
                          onToggleActionStar(action.id, !action.starred, action.cardId);
                        }
                      }}
                    >{action.starred ? '★' : '☆'}</span>
                    {onSetActionAssignee && (
                      assigningActionId === action.id ? (
                        <select
                          className="task-assignee-select"
                          autoFocus
                          value={action.assignee || ''}
                          onChange={(e) => {
                            onSetActionAssignee(action.id, action.cardId, e.target.value || null);
                            setAssigningActionId(null);
                          }}
                          onBlur={() => setAssigningActionId(null)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">Unassigned</option>
                          {[...new Set([...assignablePeople, ...(action.assignee ? [action.assignee] : [])])].map((person) => (
                            <option key={person} value={person}>{person}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          className={`task-assignee-btn ${action.assignee ? 'assigned' : ''}`}
                          title={action.assignee ? `Assigned to ${action.assignee} - click to change` : 'Assign to someone'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssigningActionId(action.id);
                          }}
                        >
                          {action.assignee ? `@${action.assignee}` : '@'}
                        </button>
                      )
                    )}
                    {editingActionId === action.id ? (
                      <input
                        type="text"
                        value={editingActionText}
                        onChange={(e) => setEditingActionText(e.target.value)}
                        onBlur={() => {
                          if (editingActionText.trim() && editingActionText !== action.text) {
                            onUpdateAction(action.id, editingActionText.trim(), action.cardId);
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
                            onDeleteAction(action.id, action.cardId);
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
                {[...pendingActions].reverse().map((pending, idx) => (
                  <div key={idx} className="modal-action-item">
                    {pending.assignee && (
                      <span className="task-assignee-tag" title={`Assigned to ${pending.assignee}`}>
                        @{pending.assignee}
                      </span>
                    )}
                    <span className="action-text">{pending.text}</span>
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
                <AssigneeInput
                  placeholder="Add a next action... (@ to assign)"
                  value={newActionText}
                  onChange={setNewActionText}
                  assignee={newActionAssignee}
                  onAssigneeChange={setNewActionAssignee}
                  people={assignablePeople}
                  renderAvatar={(name, size) => renderAvatar(name, people, size)}
                  onSubmit={handleAddAction}
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
            <div className="modal-activity-column">
              <h3>Activity Log</h3>
              {/* The old free-text Notes field was removed (Improvements #29) -
                  migrations/006-notes-to-activity-log.js copied each card's
                  notes into its log as a 'Notes (migrated)' entry. formData
                  still carries notes through unchanged on save, so the
                  projects.notes column isn't wiped. */}
          {card && (
            <div className="activity-log-list">
              {card.log && card.log.length > 0 ? card.log.map((entry) => (
                isNoteEntry(entry) ? (
                  // Notes a person wrote get a message-bubble treatment so
                  // they stand out from the system activity around them.
                  <div key={entry.id} className="log-entry log-note">
                    <div className="log-note-meta">
                      <span>
                        <span className="log-note-author">{entry.user || 'Note'}</span>
                        {' · '}{new Date(entry.timestamp).toLocaleString()}
                        {entry.action === 'Notes (migrated)' && ' · from the old Notes field'}
                      </span>
                      {editingLogId !== entry.id && onUpdateLog && canModifyNote(entry, currentUserName) && (
                        <span className="log-note-actions">
                          <button type="button" onClick={() => startEditingLog(entry)}>Edit</button>
                          <button type="button" onClick={() => handleDeleteLog(entry)}>Delete</button>
                        </span>
                      )}
                    </div>
                    {editingLogId === entry.id ? (
                      <div className="log-note-edit">
                        <textarea
                          value={editingLogText}
                          onChange={(e) => setEditingLogText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') cancelEditingLog();
                          }}
                          rows="3"
                          autoFocus
                        />
                        <div className="log-note-edit-buttons">
                          <button type="button" className="btn-secondary" onClick={cancelEditingLog} disabled={savingLog}>Cancel</button>
                          <button type="button" className="btn-secondary" onClick={handleSaveLogEdit} disabled={!editingLogText.trim() || savingLog}>
                            {savingLog ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="log-note-text">{entry.details}</div>
                    )}
                  </div>
                ) : (
                  <div key={entry.id} className="log-entry log-system">
                    <div className="log-system-meta">
                      {entry.action}{entry.user ? ` by ${entry.user}` : ''} · {new Date(entry.timestamp).toLocaleString()}
                    </div>
                    <div className="log-system-text">{entry.details}</div>
                  </div>
                )
              )) : (
                <div style={{ color: '#999', fontSize: '13px' }}>No activity yet.</div>
              )}
            </div>
          )}
          {card && (
            <div className="activity-log-add">
              <textarea
                value={newLogText}
                onChange={(e) => setNewLogText(e.target.value)}
                rows="2"
                placeholder="Add a note (e.g. called Brian, he said...)"
                style={{ width: '100%', marginBottom: '4px' }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={handleAddLog}
                disabled={!newLogText.trim() || addingLog}
                style={{ width: '100%' }}
              >
                {addingLog ? 'Adding...' : '+ Add Note'}
              </button>
            </div>
          )}
            </div>
          </div>
          </div>
          
          <div className="modal-footer">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                {card && currentUser?.email === 'chad@philo.ventures' && onViewProject && (
                  <>
                    {!card.project_id && <div style={{ padding: '10px', background: '#fef3c7', borderRadius: '4px', fontSize: '12px' }}>Debug: card.project_id is missing (check console)</div>}
                    {card.project_id && (
                      <button
                        type="button"
                        className="btn-project-detail"
                        onClick={() => {
                          console.log('Card data:', card);
                          onClose();
                          onViewProject(card.project_id);
                        }}
                    style={{
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      color: 'white',
                      border: 'none',
                      padding: '10px 20px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="9" y1="3" x2="9" y2="21"></line>
                    </svg>
                    View Project Detail
                      </button>
                    )}
                  </>
                )}
              </div>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}


// Audited per request ("which of these work, which don't, which are
// worth having") - removed three things that didn't hold up:
// - "Railway Logs"/"Cloudflare Pages" opened the generic dashboard
//   homepages, not this project's actual logs/deploys - a bookmark with
//   an extra login/navigation step, not a real shortcut.
// - "Hey_Phil Spreadsheet" linked to the legacy Google Sheets "database"
//   CLAUDE.md itself documents as stale and off the live data path -
//   actively misleading to leave in a tool meant for debugging the real
//   (Postgres) one.
// - The Console Logs panel only captured what was logged AFTER opening
//   DevTools (patches console.log/error on mount), so it was already
//   missing anything from page load - and the browser's own devtools
//   console, one keypress away, has full history plus search/filtering
//   this never came close to. Kept Auth Info, API Status, and Clear
//   Storage - all three actually do what they say with no caveats.
function DevTools({ user, onClose }) {
  const [apiStatus, setApiStatus] = useState(null);

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
        </div>
      </div>
    </div>
  );
}

export default App;
/* Force rebuild Mon Feb 23 16:25:45 MST 2026 */
