import React, { useState, useEffect } from 'react';
import './ProjectDetail.css';
import CustomTimeline from './CustomTimeline';

function ProjectDetail({ projectId, onClose, currentUser }) {
  const [project, setProject] = useState(null);
  const [activeModal, setActiveModal] = useState(null);
  const [people, setPeople] = useState({});

  useEffect(() => {
    // Load project data
    fetchProject();
    fetchPeople();
  }, [projectId]);

  const fetchProject = async () => {
    // TODO: Fetch from API
    // For now, mock data
    setProject({
      id: projectId,
      name: 'Sample Project',
      stage: 'Diligence',
      owner: 'Chad Staheli',
      startDate: '2026-01-15',
      targetClose: '2026-04-30',
      budget: 50000,
      actualSpend: 45200,
      health: 'at_risk'
    });
  };

  const fetchPeople = async () => {
    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${API_BASE_URL}/api/origination/board`, {
        credentials: 'include'
      });
      const data = await response.json();
      setPeople(data.people || {});
    } catch (error) {
      console.error('Failed to load people:', error);
    }
  };

  if (!project) return <div className="loading">Loading project...</div>;

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
              <div className="stat-value">{new Date(project.targetClose).toLocaleDateString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Budget</div>
              <div className="stat-value">
                ${project.actualSpend.toLocaleString()} / ${project.budget.toLocaleString()}
              </div>
              <div className="stat-progress">
                <div 
                  className="stat-progress-bar" 
                  style={{ width: `${(project.actualSpend / project.budget) * 100}%` }}
                />
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Health</div>
              <div className={`stat-value health-${project.health}`}>
                {project.health === 'on_track' && '✓ On Track'}
                {project.health === 'at_risk' && '⚠️ At Risk'}
                {project.health === 'blocked' && '🔴 Blocked'}
              </div>
            </div>
          </div>

          {/* Main Content: Timeline + Sidebar */}
          <div className="project-main-content">
            {/* Timeline (Custom) - Main Area */}
            <div className="timeline-main-section">
              <CustomTimeline projectId={projectId} compact={false} people={people} />
            </div>

            {/* Quick Access Modules - Sidebar */}
            <div className="modules-sidebar">
              <h3>Quick Access</h3>
              {modules.filter(m => m.id !== 'timeline').map(module => (
                <div 
                  key={module.id}
                  className="module-card-compact"
                  onClick={() => setActiveModal(module.id)}
                >
                  <div className="module-icon-small">{module.icon}</div>
                  <div className="module-info">
                    <div className="module-name-small">{module.name}</div>
                    <div className="module-description-small">{module.description}</div>
                  </div>
                </div>
              ))}
            </div>
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
