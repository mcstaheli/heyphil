import React, { useState, useEffect } from 'react';
import './CustomTimeline.css';

function CustomTimeline({ projectId, compact = false }) {
  const [tasks, setTasks] = useState([]);
  const [viewMode, setViewMode] = useState('week');
  const [editingTask, setEditingTask] = useState(null);
  const [timelineRange, setTimelineRange] = useState({ start: null, end: null });

  useEffect(() => {
    loadTasks();
  }, [projectId]);

  useEffect(() => {
    if (tasks.length > 0) {
      calculateTimelineRange();
    }
  }, [tasks]);

  const loadTasks = () => {
    // TODO: Load from API
    const mockTasks = [
      {
        id: '1',
        name: 'Phase 1: Diligence',
        type: 'phase',
        start: '2026-03-01',
        end: '2026-03-15',
        progress: 80,
        owner: '',
        color: '#48bb78'
      },
      {
        id: '2',
        name: 'Site Visit',
        type: 'task',
        start: '2026-03-01',
        end: '2026-03-03',
        progress: 100,
        owner: 'Chad',
        parentId: '1'
      },
      {
        id: '3',
        name: 'Document Review',
        type: 'task',
        start: '2026-03-04',
        end: '2026-03-08',
        progress: 100,
        owner: 'Tracy',
        parentId: '1'
      },
      {
        id: '4',
        name: 'Financial Analysis',
        type: 'task',
        start: '2026-03-06',
        end: '2026-03-15',
        progress: 75,
        owner: 'Greg',
        parentId: '1'
      },
      {
        id: '5',
        name: 'Phase 2: Financing',
        type: 'phase',
        start: '2026-03-16',
        end: '2026-04-10',
        progress: 30,
        owner: '',
        color: '#667eea'
      },
      {
        id: '6',
        name: 'Loan Application',
        type: 'task',
        start: '2026-03-16',
        end: '2026-03-20',
        progress: 100,
        owner: 'Tracy',
        parentId: '5'
      },
      {
        id: '7',
        name: 'Underwriting',
        type: 'task',
        start: '2026-03-21',
        end: '2026-04-05',
        progress: 40,
        owner: 'Bank',
        parentId: '5'
      },
      {
        id: '8',
        name: 'Loan Approval',
        type: 'milestone',
        date: '2026-04-10',
        owner: 'Bank',
        parentId: '5'
      }
    ];
    setTasks(mockTasks);
  };

  const calculateTimelineRange = () => {
    const dates = tasks.flatMap(task => {
      if (task.type === 'milestone') {
        return [new Date(task.date)];
      }
      return [new Date(task.start), new Date(task.end)];
    });

    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    // Add buffer
    minDate.setDate(minDate.getDate() - 3);
    maxDate.setDate(maxDate.getDate() + 7);

    setTimelineRange({ start: minDate, end: maxDate });
  };

  const getDaysBetween = (start, end) => {
    const diff = Math.abs(end - start);
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const getDateColumns = () => {
    if (!timelineRange.start || !timelineRange.end) return [];

    const columns = [];
    const current = new Date(timelineRange.start);
    const end = new Date(timelineRange.end);

    while (current <= end) {
      columns.push(new Date(current));
      
      if (viewMode === 'day') {
        current.setDate(current.getDate() + 1);
      } else if (viewMode === 'week') {
        current.setDate(current.getDate() + 7);
      } else if (viewMode === 'month') {
        current.setMonth(current.getMonth() + 1);
      }
    }

    return columns;
  };

  const getTaskPosition = (task) => {
    if (!timelineRange.start) return { left: 0, width: 0 };

    const totalDays = getDaysBetween(timelineRange.start, timelineRange.end);
    
    let startDate, endDate;
    if (task.type === 'milestone') {
      startDate = new Date(task.date);
      endDate = new Date(task.date);
    } else {
      startDate = new Date(task.start);
      endDate = new Date(task.end);
    }

    const startOffset = getDaysBetween(timelineRange.start, startDate);
    const duration = task.type === 'milestone' ? 1 : getDaysBetween(startDate, endDate);

    const leftPercent = (startOffset / totalDays) * 100;
    const widthPercent = (duration / totalDays) * 100;

    return { left: leftPercent, width: widthPercent };
  };

  const formatDate = (date, format = 'short') => {
    if (format === 'short') {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }
    return date.toLocaleDateString();
  };

  const addTask = () => {
    const newTask = {
      id: String(Date.now()),
      name: 'New Task',
      type: 'task',
      start: new Date().toISOString().split('T')[0],
      end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      progress: 0,
      owner: ''
    };
    setTasks([...tasks, newTask]);
    setEditingTask(newTask);
  };

  const updateTask = (taskId, updates) => {
    setTasks(tasks.map(t => t.id === taskId ? { ...t, ...updates } : t));
  };

  const deleteTask = (taskId) => {
    if (window.confirm('Delete this task?')) {
      setTasks(tasks.filter(t => t.id !== taskId));
      setEditingTask(null);
    }
  };

  const dateColumns = getDateColumns();
  const displayTasks = tasks.filter(t => !t.parentId || tasks.find(p => p.id === t.parentId)?.type === 'phase');

  return (
    <div className={`custom-timeline ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="timeline-toolbar">
          <select value={viewMode} onChange={(e) => setViewMode(e.target.value)} className="timeline-view-select">
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          <button onClick={addTask} className="timeline-add-btn">+ Add Task</button>
        </div>
      )}

      <div className="timeline-container">
        {/* Task List Column */}
        <div className="timeline-tasks-column">
          <div className="timeline-header-cell">Tasks</div>
          {displayTasks.map(task => (
            <div 
              key={task.id} 
              className={`timeline-task-row ${task.type}`}
              onClick={() => !compact && setEditingTask(task)}
            >
              <div className="task-name">
                {task.type === 'phase' && '📁 '}
                {task.type === 'milestone' && '🏁 '}
                {task.name}
              </div>
              {task.owner && <div className="task-owner">{task.owner}</div>}
            </div>
          ))}
        </div>

        {/* Timeline Grid */}
        <div className="timeline-grid-wrapper">
          <div className="timeline-grid">
            {/* Date Headers */}
            <div className="timeline-header-row">
              {dateColumns.map((date, i) => (
                <div key={i} className="timeline-date-header">
                  {formatDate(date)}
                </div>
              ))}
            </div>

            {/* Task Bars */}
            {displayTasks.map(task => {
              const position = getTaskPosition(task);
              const isMilestone = task.type === 'milestone';
              const isPhase = task.type === 'phase';

              return (
                <div key={task.id} className="timeline-row">
                  <div 
                    className={`timeline-bar ${task.type}`}
                    style={{
                      left: `${position.left}%`,
                      width: isMilestone ? '4px' : `${position.width}%`,
                      backgroundColor: task.color || (isPhase ? '#48bb78' : '#667eea')
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      !compact && setEditingTask(task);
                    }}
                  >
                    {!isMilestone && (
                      <>
                        <div 
                          className="timeline-bar-progress"
                          style={{ 
                            width: `${task.progress}%`,
                            backgroundColor: task.color ? 
                              `color-mix(in srgb, ${task.color} 80%, black)` : 
                              (isPhase ? '#38a169' : '#5568d3')
                          }}
                        />
                        {!compact && position.width > 5 && (
                          <div className="timeline-bar-label">{task.progress}%</div>
                        )}
                      </>
                    )}
                  </div>
                  
                  {/* Today Marker */}
                  {i === 0 && (() => {
                    const today = new Date();
                    const totalDays = getDaysBetween(timelineRange.start, timelineRange.end);
                    const todayOffset = getDaysBetween(timelineRange.start, today);
                    const todayPercent = (todayOffset / totalDays) * 100;
                    
                    return todayPercent >= 0 && todayPercent <= 100 ? (
                      <div className="timeline-today-marker" style={{ left: `${todayPercent}%` }} />
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Edit Panel */}
      {editingTask && !compact && (
        <div className="timeline-edit-overlay" onClick={() => setEditingTask(null)}>
          <div className="timeline-edit-panel" onClick={(e) => e.stopPropagation()}>
            <h3>Edit {editingTask.type === 'milestone' ? 'Milestone' : 'Task'}</h3>
            
            <label>
              Name:
              <input
                type="text"
                value={editingTask.name}
                onChange={(e) => setEditingTask({ ...editingTask, name: e.target.value })}
              />
            </label>

            <label>
              Type:
              <select
                value={editingTask.type}
                onChange={(e) => setEditingTask({ ...editingTask, type: e.target.value })}
              >
                <option value="task">Task</option>
                <option value="phase">Phase</option>
                <option value="milestone">Milestone</option>
              </select>
            </label>

            {editingTask.type !== 'milestone' && (
              <>
                <label>
                  Start Date:
                  <input
                    type="date"
                    value={editingTask.start}
                    onChange={(e) => setEditingTask({ ...editingTask, start: e.target.value })}
                  />
                </label>

                <label>
                  End Date:
                  <input
                    type="date"
                    value={editingTask.end}
                    onChange={(e) => setEditingTask({ ...editingTask, end: e.target.value })}
                  />
                </label>

                <label>
                  Progress:
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={editingTask.progress}
                    onChange={(e) => setEditingTask({ ...editingTask, progress: parseInt(e.target.value) })}
                  />
                  <span>{editingTask.progress}%</span>
                </label>
              </>
            )}

            {editingTask.type === 'milestone' && (
              <label>
                Date:
                <input
                  type="date"
                  value={editingTask.date}
                  onChange={(e) => setEditingTask({ ...editingTask, date: e.target.value })}
                />
              </label>
            )}

            <label>
              Owner:
              <select
                value={editingTask.owner}
                onChange={(e) => setEditingTask({ ...editingTask, owner: e.target.value })}
              >
                <option value="">Unassigned</option>
                <option value="Chad">Chad</option>
                <option value="Tracy">Tracy</option>
                <option value="Greg">Greg</option>
                <option value="Scott">Scott</option>
              </select>
            </label>

            <div className="timeline-edit-actions">
              <button onClick={() => {
                updateTask(editingTask.id, editingTask);
                setEditingTask(null);
              }}>Save</button>
              <button onClick={() => deleteTask(editingTask.id)} className="delete">Delete</button>
              <button onClick={() => setEditingTask(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomTimeline;
