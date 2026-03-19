import React, { useState } from 'react';
import './TaskList.css';

function TaskList({ projectId, people }) {
  const [selectedTask, setSelectedTask] = useState(null);
  const [showDependencies, setShowDependencies] = useState(true);

  // Mock data - will connect to real API later
  const phases = [
    {
      id: 'phase1',
      name: 'Phase 1: Diligence',
      tasks: [
        { id: 't1', name: 'Site Visit', owner: 'C', hasDependency: false },
        { id: 't2', name: 'Document Review', owner: 'T', hasDependency: false },
        { id: 't3', name: 'Financial Analysis', owner: 'G', hasDependency: false }
      ]
    },
    {
      id: 'phase2',
      name: 'Phase 2: Financing',
      tasks: [
        { id: 't4', name: 'Loan Application', owner: 'T', hasDependency: false },
        { id: 't5', name: 'Underwriting', owner: 'B', hasDependency: false },
        { id: 't6', name: 'Loan Approval', owner: 'B', hasDependency: true },
        { id: 't7', name: 'Closing Meeting', owner: 'C', hasDependency: true }
      ]
    }
  ];

  const getOwnerColor = (initial) => {
    const colors = {
      'C': '#4A90E2',
      'T': '#9B59B6',
      'G': '#27AE60',
      'B': '#7F8C8D'
    };
    return colors[initial] || '#95A5A6';
  };

  return (
    <div className="task-list-container">
      <div className="task-list-header">
        <h2>TASKS</h2>
        <button 
          className="toggle-dependencies-btn"
          onClick={() => setShowDependencies(!showDependencies)}
        >
          {showDependencies ? '👁️ Hide' : '👁️‍🗨️ Show'} Dependencies
        </button>
      </div>

      <div className="task-list-content">
        {phases.map(phase => (
          <div key={phase.id} className="phase-section">
            <div className="phase-header">
              <span className="phase-icon">📋</span>
              <span className="phase-name">{phase.name}</span>
            </div>
            
            <div className="tasks-list">
              {phase.tasks.map(task => (
                <div 
                  key={task.id}
                  className={`task-item ${selectedTask === task.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTask(task.id)}
                >
                  <div 
                    className="task-avatar"
                    style={{ backgroundColor: getOwnerColor(task.owner) }}
                  >
                    {task.owner}
                  </div>
                  <div className="task-connector" />
                  {showDependencies && task.hasDependency && (
                    <span className="dependency-icon">💎</span>
                  )}
                  <span className="task-name">{task.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="task-list-footer">
        <button className="add-item-btn">
          + Add Item
        </button>
      </div>
    </div>
  );
}

export default TaskList;
