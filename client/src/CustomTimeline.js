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
        color: '#48bb78',
        dependencies: []
      },
      {
        id: '2',
        name: 'Site Visit',
        type: 'task',
        start: '2026-03-01',
        end: '2026-03-03',
        progress: 100,
        owner: 'Chad',
        parentId: '1',
        dependencies: []
      },
      {
        id: '3',
        name: 'Document Review',
        type: 'task',
        start: '2026-03-04',
        end: '2026-03-08',
        progress: 100,
        owner: 'Tracy',
        parentId: '1',
        dependencies: ['2']
      },
      {
        id: '4',
        name: 'Financial Analysis',
        type: 'task',
        start: '2026-03-06',
        end: '2026-03-15',
        progress: 75,
        owner: 'Greg',
        parentId: '1',
        dependencies: ['3']
      },
      {
        id: '5',
        name: 'Phase 2: Financing',
        type: 'phase',
        start: '2026-03-16',
        end: '2026-04-10',
        progress: 30,
        owner: '',
        color: '#667eea',
        dependencies: ['1']
      },
      {
        id: '6',
        name: 'Loan Application',
        type: 'task',
        start: '2026-03-16',
        end: '2026-03-20',
        progress: 100,
        owner: 'Tracy',
        parentId: '5',
        dependencies: []
      },
      {
        id: '7',
        name: 'Underwriting',
        type: 'task',
        start: '2026-03-21',
        end: '2026-04-05',
        progress: 40,
        owner: 'Bank',
        parentId: '5',
        dependencies: ['6']
      },
      {
        id: '8',
        name: 'Loan Approval',
        type: 'milestone',
        date: '2026-04-10',
        owner: 'Bank',
        parentId: '5',
        dependencies: ['7']
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
      owner: '',
      dependencies: []
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
  
  // Organize tasks hierarchically
  const organizeHierarchy = () => {
    const hierarchy = [];
    const phases = tasks.filter(t => t.type === 'phase');
    
    phases.forEach(phase => {
      hierarchy.push(phase);
      const children = tasks.filter(t => t.parentId === phase.id);
      hierarchy.push(...children);
    });
    
    // Add any orphaned tasks
    const orphans = tasks.filter(t => !t.parentId && t.type !== 'phase');
    hierarchy.push(...orphans);
    
    return hierarchy;
  };
  
  const displayTasks = organizeHierarchy();
  
  // Calculate dependency arrow positions
  const getDependencyArrows = () => {
    const arrows = [];
    
    displayTasks.forEach((task, taskIndex) => {
      if (!task.dependencies || task.dependencies.length === 0) return;
      
      task.dependencies.forEach(depId => {
        const depTask = tasks.find(t => t.id === depId);
        if (!depTask) return;
        
        const depIndex = displayTasks.findIndex(t => t.id === depId);
        if (depIndex === -1) return;
        
        const fromPos = getTaskPosition(depTask);
        const toPos = getTaskPosition(task);
        
        // Calculate row positions (50px per row)
        const fromY = depIndex * 50 + 25;
        const toY = taskIndex * 50 + 25;
        
        arrows.push({
          fromX: fromPos.left + fromPos.width,
          fromY: fromY,
          toX: toPos.left,
          toY: toY,
          fromTask: depTask.name,
          toTask: task.name
        });
      });
    });
    
    return arrows;
  };
  
  const dependencyArrows = getDependencyArrows();

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
              className={`timeline-task-row ${task.type} ${task.parentId ? 'child-task' : ''}`}
              onClick={() => !compact && setEditingTask(task)}
              style={{
                paddingLeft: task.parentId ? '32px' : '16px'
              }}
            >
              <div className="task-name">
                {task.type === 'phase' && '📁 '}
                {task.type === 'milestone' && '🏁 '}
                {task.parentId && '└─ '}
                {task.name}
              </div>
              {task.owner && <div className="task-owner">{task.owner}</div>}
              {task.dependencies && task.dependencies.length > 0 && (
                <div className="task-dependencies" title={`Depends on: ${task.dependencies.join(', ')}`}>
                  ⬅️ {task.dependencies.length}
                </div>
              )}
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

            {/* Dependency Arrows SVG Layer */}
            <svg className="dependency-arrows-layer" style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: '100%', 
              height: displayTasks.length * 50 + 40,
              pointerEvents: 'none',
              zIndex: 1
            }}>
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="10"
                  refX="8"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />
                </marker>
              </defs>
              {dependencyArrows.map((arrow, i) => {
                const containerWidth = document.querySelector('.timeline-grid')?.offsetWidth || 1000;
                
                const x1 = (arrow.fromX / 100) * containerWidth;
                const x2 = (arrow.toX / 100) * containerWidth;
                const y1 = arrow.fromY + 40; // offset for header
                const y2 = arrow.toY + 40;
                
                // Calculate control points for curved arrow
                const midX = (x1 + x2) / 2;
                
                return (
                  <g key={i}>
                    <path
                      d={`M ${x1} ${y1} Q ${midX} ${y1}, ${midX} ${(y1 + y2) / 2} Q ${midX} ${y2}, ${x2} ${y2}`}
                      stroke="#94a3b8"
                      strokeWidth="2"
                      fill="none"
                      markerEnd="url(#arrowhead)"
                      opacity="0.6"
                    />
                  </g>
                );
              })}
            </svg>

            {/* Task Bars */}
            {displayTasks.map((task, index) => {
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
                  
                  {/* Today Marker (render once on first row) */}
                  {index === 0 && (() => {
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

            <label>
              Dependencies (tasks that must finish first):
              <select
                multiple
                value={editingTask.dependencies || []}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, option => option.value);
                  setEditingTask({ ...editingTask, dependencies: selected });
                }}
                style={{ height: '80px' }}
              >
                {tasks.filter(t => t.id !== editingTask.id).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <small style={{ display: 'block', marginTop: '4px', color: '#6b7280' }}>
                Hold Cmd/Ctrl to select multiple
              </small>
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
