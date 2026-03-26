import React, { useState, useEffect } from 'react';
import './ProjectDetail.css';
import CustomTimeline from './CustomTimeline';

function ProjectDetail({ projectId, onClose, currentUser }) {
  const [project, setProject] = useState(null);
  const [activeModal, setActiveModal] = useState(null);
  const [people, setPeople] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load project data
    loadData();
  }, [projectId]);

  const loadData = async () => {
    setLoading(true);
    await Promise.all([fetchProject(), fetchPeople()]);
    setLoading(false);
  };

  const fetchProject = async () => {
    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || '';
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
        targetClose: '-',
        budget: '-',
        actualSpend: '-',
        health: '-'
      });
    } catch (error) {
      console.error('Failed to fetch project:', error);
    }
  };

  const fetchPeople = async () => {
    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || '';
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

  const modules = [
    { id: 'timeline', name: 'Timeline', icon: '📅', description: 'Gantt chart & tasks' },
    { id: 'budget', name: 'Budget', icon: '💰', description: 'Financial tracking' },
    { id: 'team', name: 'Team', icon: '👥', description: 'People & roles' },
    { id: 'files', name: 'Files', icon: '📁', description: 'Documents' },
    { id: 'notes', name: 'Notes', icon: '📝', description: 'Project journal' },
    { id: 'calendar', name: 'Calendar', icon: '🗓️', description: 'Schedule view' }
  ];

  return (
    <div className="project-detail-page">
      {/* Header */}
      <div className="project-detail-header">
        <button className="back-button" onClick={onClose}>
          ← Back to Board
        </button>
        <div className="project-header-info">
          <h1>{project.name}</h1>
          <span className={`stage-badge stage-${project.stage.toLowerCase()}`}>
            {project.stage}
          </span>
        </div>
      </div>

        {/* Dashboard Overview */}
        <div className="project-dashboard">
          {/* Quick Stats */}
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-label">Owner</div>
              <div className="stat-value">{project.owner}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Target Close</div>
              <div className="stat-value">{project.targetClose}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Budget</div>
              <div className="stat-value">{project.budget}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Health</div>
              <div className="stat-value">{project.health}</div>
            </div>
          </div>

          {/* Quick Access Cards - Above Timeline */}
          <div className="quick-access-section">
            <h3>Quick Access</h3>
            <div className="quick-access-grid">
              {modules.filter(m => m.id !== 'timeline').map(module => (
                <div 
                  key={module.id}
                  className="quick-access-card"
                  onClick={() => setActiveModal(module.id)}
                >
                  <div className="quick-access-icon">{module.icon}</div>
                  <div className="quick-access-info">
                    <div className="quick-access-name">{module.name}</div>
                    <div className="quick-access-description">{module.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline - Full Width */}
          <div className="timeline-full-section">
            <CustomTimeline projectId={projectId} compact={false} people={people} />
          </div>
        </div>

        {/* Modals */}
        {activeModal === 'timeline' && (
          <div className="project-modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="project-modal timeline-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>📅 Timeline - Advanced View</h2>
                <button onClick={() => setActiveModal(null)}>×</button>
              </div>
              <div className="modal-body timeline-modal-body">
                <CustomTimeline projectId={projectId} compact={false} people={people} />
              </div>
            </div>
          </div>
        )}

        {activeModal === 'budget' && (
          <div className="project-modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="project-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>💰 Budget Tracker</h2>
                <button onClick={() => setActiveModal(null)}>×</button>
              </div>
              <div className="modal-body">
                <p className="coming-soon">Budget tracker coming soon...</p>
              </div>
            </div>
          </div>
        )}

        {activeModal === 'team' && (
          <div className="project-modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="project-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>👥 Team</h2>
                <button onClick={() => setActiveModal(null)}>×</button>
              </div>
              <div className="modal-body">
                <p className="coming-soon">Team management coming soon...</p>
              </div>
            </div>
          </div>
        )}

        {activeModal === 'files' && (
          <div className="project-modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="project-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>📁 Files</h2>
                <button onClick={() => setActiveModal(null)}>×</button>
              </div>
              <div className="modal-body">
                <p className="coming-soon">File management coming soon...</p>
              </div>
            </div>
          </div>
        )}

        {activeModal === 'notes' && (
          <div className="project-modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="project-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>📝 Notes</h2>
                <button onClick={() => setActiveModal(null)}>×</button>
              </div>
              <div className="modal-body">
                <p className="coming-soon">Notes coming soon...</p>
              </div>
            </div>
          </div>
        )}

        {activeModal === 'calendar' && (
          <div className="project-modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="project-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>🗓️ Calendar</h2>
                <button onClick={() => setActiveModal(null)}>×</button>
              </div>
              <div className="modal-body">
                <p className="coming-soon">Calendar view coming soon...</p>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

export default ProjectDetail;
