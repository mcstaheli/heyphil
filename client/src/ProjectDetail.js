import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './ProjectDetail.css';
import BudgetModule from './BudgetModule';
import ValueModule from './ValueModule';
import TimelineModule from './TimelineModule';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';
const WS_URL = process.env.REACT_APP_WS_URL || API_BASE_URL;

function ProjectDetail({ projectId, onClose, currentUser }) {
  const [project, setProject] = useState(null);
  const [people, setPeople] = useState({});
  const [loading, setLoading] = useState(true);
  const [valueExpanded, setValueExpanded] = useState(false);
  const [budgetExpanded, setBudgetExpanded] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(true);
  const socketRef = useRef(null);

  useEffect(() => {
    // Load project data
    loadData();
  }, [projectId]);

  // Keeps this page's own `timeline` snapshot in sync with CustomTimeline's
  // own independent save cycle, so TimelineModule's hero-stat tiles don't
  // go stale relative to whatever the Gantt chart actually shows after a
  // drag/edit there. Deliberately does NOT sync `budget` the same way:
  // BudgetModule lifts every keystroke into this page's state optimistically
  // before it's saved, and blindly overwriting that from a broadcast would
  // clobber in-progress, unsaved edits the moment any other update to this
  // project came in - budget doesn't need it anyway, since nothing else
  // independently mutates it the way CustomTimeline mutates timeline.
  useEffect(() => {
    if (!projectId) return;
    socketRef.current = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    // Re-syncing on every connect (including reconnects after a dropped
    // connection - a laptop sleeping, flaky wifi) closes the gap where a
    // missed broadcast would otherwise leave the hero tiles stale forever.
    // Scoped to timeline only, same as the broadcast handler below and for
    // the same reason - a full fetchProject() here would clobber any
    // in-progress Budget edit exactly like the broadcast handler would.
    socketRef.current.on('connect', () => {
      syncTimelineFromServer();
    });

    socketRef.current.on('project:updated', ({ project: updated }) => {
      if (updated.id !== projectId) return;
      setProject((prev) => (prev ? {
        ...prev,
        timeline: updated.timeline || [],
        timelineLocks: updated.timeline_locks || []
      } : prev));
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [projectId]);

  const loadData = async () => {
    setLoading(true);
    await Promise.all([fetchProject(), fetchPeople()]);
    setLoading(false);
  };

  const fetchProject = async () => {
    try {
      const token = localStorage.getItem('authToken');
      
      // Fetch project data
      const projectRes = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!projectRes.ok) {
        console.error('Failed to fetch project:', projectRes.status);
        return;
      }
      
      const projectData = await projectRes.json();
      const proj = projectData.project;
      
      // Fetch linked card to get owner
      const boardRes = await fetch(`${API_BASE_URL}/api/origination/board`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      let owner = '-';
      if (boardRes.ok) {
        const boardData = await boardRes.json();
        const linkedCard = boardData.cards.find(c => c.project_id === projectId);
        if (linkedCard) {
          owner = linkedCard.owner || '-';
        }
      }
      
      setProject({
        id: proj.id,
        name: proj.title || 'Untitled Project',
        stage: proj.status || 'Unknown',
        owner: owner,
        value: proj.value || [],
        valueLocks: proj.value_locks || [],
        budget: proj.budget || [],
        budgetLocks: proj.budget_locks || [],
        timeline: proj.timeline || [],
        timelineLocks: proj.timeline_locks || []
      });
    } catch (error) {
      console.error('Failed to fetch project:', error);
    }
  };

  // Same field scope as the project:updated broadcast handler above, and
  // for the same reason: only timeline is safe to silently overwrite.
  const syncTimelineFromServer = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const proj = data.project;
      setProject((prev) => (prev ? {
        ...prev,
        timeline: proj.timeline || [],
        timelineLocks: proj.timeline_locks || []
      } : prev));
    } catch (error) {
      console.error('Failed to sync timeline:', error);
    }
  };

  const fetchPeople = async () => {
    try {
      const token = localStorage.getItem('authToken');
      
      const response = await fetch(`${API_BASE_URL}/api/origination/board`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        console.error('API error:', response.status, response.statusText);
        return;
      }
      
      const data = await response.json();
      console.log('ProjectDetail: People data from API:', data.people);
      setPeople(data.people || {});
    } catch (error) {
      console.error('Failed to load people:', error);
    }
  };

  if (loading || !project) return <div className="loading">Loading project...</div>;

  return (
    <div className="project-detail-page">
      {/* Header */}
      <div className="project-detail-header">
        <button className="back-button" onClick={onClose}>
          ← Back to Board
        </button>
        <div className="project-header-row">
          <div className="project-header-info">
            <h1>{project.name}</h1>
            <span className={`stage-badge stage-${project.stage.toLowerCase()}`}>
              {project.stage}
            </span>
          </div>
          {project.owner && project.owner !== '-' && (
            <div className="project-header-owner">
              <span className="project-header-owner-name">{project.owner}</span>
              {people[project.owner] ? (
                <img src={people[project.owner]} alt={project.owner} className="project-header-owner-photo" />
              ) : (
                <div className="project-header-owner-initials">{project.owner.charAt(0).toUpperCase()}</div>
              )}
            </div>
          )}
        </div>
      </div>

        {/* Dashboard Overview */}
        <div className="project-dashboard">
          {/* Value - Full Width, defaults collapsed */}
          <div className="detail-section">
            <h3 className="section-heading">📈 Value</h3>
            <ValueModule
              projectId={projectId}
              value={project.value}
              valueLocks={project.valueLocks}
              onValueChange={(items) => setProject(prev => ({ ...prev, value: items }))}
              onLocksChange={(locks) => setProject(prev => ({ ...prev, valueLocks: locks }))}
              expanded={valueExpanded}
              onToggleExpanded={() => setValueExpanded(e => !e)}
            />
          </div>

          {/* Budget - Full Width, defaults collapsed */}
          <div className="detail-section">
            <h3 className="section-heading">💰 Budget</h3>
            <BudgetModule
              projectId={projectId}
              budget={project.budget}
              budgetLocks={project.budgetLocks}
              onBudgetChange={(items) => setProject(prev => ({ ...prev, budget: items }))}
              onLocksChange={(locks) => setProject(prev => ({ ...prev, budgetLocks: locks }))}
              expanded={budgetExpanded}
              onToggleExpanded={() => setBudgetExpanded(e => !e)}
            />
          </div>

          {/* Timeline - Full Width, defaults expanded */}
          <div className="detail-section">
            <h3 className="section-heading">📅 Timeline</h3>
            <TimelineModule
              projectId={projectId}
              tasks={project.timeline}
              timelineLocks={project.timelineLocks}
              people={people}
              onLocksChange={(locks) => setProject(prev => ({ ...prev, timelineLocks: locks }))}
              expanded={timelineExpanded}
              onToggleExpanded={() => setTimelineExpanded(e => !e)}
            />
          </div>
        </div>
    </div>
  );
}

export default ProjectDetail;
