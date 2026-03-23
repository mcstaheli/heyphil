import React, { useState, useEffect } from 'react';
import './CustomTimeline.css';

function CustomTimeline({ projectId, compact = false, people = {} }) {
  // Debug people data
  useEffect(() => {
    console.log('CustomTimeline received people prop:', people);
  }, [people]);
  
  const [tasks, setTasks] = useState([]);
  const [viewMode, setViewMode] = useState('week');
  const [editingTask, setEditingTask] = useState(null);
  const [timelineRange, setTimelineRange] = useState({ start: null, end: null });
  const [draggingTask, setDraggingTask] = useState(null);
  const [dragStartX, setDragStartX] = useState(null);
  const [dragStartDate, setDragStartDate] = useState(null);
  const [hasDragged, setHasDragged] = useState(false);
  const [resizingTask, setResizingTask] = useState(null);
  const [resizeStartX, setResizeStartX] = useState(null);
  const [resizeStartDuration, setResizeStartDuration] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [reorderingTask, setReorderingTask] = useState(null);
  const [reorderTargetIndex, setReorderTargetIndex] = useState(null);
  const [phasePopover, setPhasePopover] = useState(null);
  const [ownerFilter, setOwnerFilter] = useState(null);

  useEffect(() => {
    loadTasks();
  }, [projectId]);

  useEffect(() => {
    if (tasks.length > 0) {
      calculateTimelineRange();
    }
  }, [tasks]);

  // Handle drag events
  useEffect(() => {
    if (!draggingTask) return;

    let lastDeltaDays = 0;

    const handleMouseMove = (e) => {
      if (!dragStartX || !dragStartDate || !timelineRange.start || !timelineRange.end) return;

      const gridElement = document.querySelector('.timeline-grid');
      if (!gridElement) return;

      const gridWidth = gridElement.offsetWidth;
      const totalDays = getDaysBetween(timelineRange.start, timelineRange.end);
      
      const deltaX = e.clientX - dragStartX;
      const deltaDays = Math.round((deltaX / gridWidth) * totalDays);
      
      // Mark as dragged if mouse moved significantly
      if (Math.abs(deltaX) > 5) {
        setHasDragged(true);
      }
      
      // Only update if we've moved to a different day
      if (deltaDays === lastDeltaDays) return;
      lastDeltaDays = deltaDays;
      
      const task = tasks.find(t => t.id === draggingTask);
      if (!task) return;

      let newStartDate = new Date(dragStartDate);
      newStartDate.setDate(newStartDate.getDate() + deltaDays);

      // Check dependency constraints - clamp to minimum without auto-adjusting
      if (task.dependencies && task.dependencies.length > 0) {
        const latestDepEndDate = task.dependencies.reduce((latest, depId) => {
          const depTask = tasks.find(t => t.id === depId);
          if (!depTask) return latest;
          
          const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? new Date(depTask.date) : new Date(depTask.end);
          depEnd.setHours(0, 0, 0, 0);
          return depEnd > latest ? depEnd : latest;
        }, new Date(0));
        
        // Add one day buffer after dependency
        const minStartDate = new Date(latestDepEndDate);
        minStartDate.setDate(minStartDate.getDate() + 1);
        
        // Clamp to minimum date - don't allow earlier
        if (newStartDate < minStartDate) {
          newStartDate = minStartDate;
          // Don't update lastDeltaDays so it won't jump when moving back to valid range
          return;
        }
      }

      if (task.type === 'milestone') {
        updateTask(task.id, {
          date: newStartDate.toISOString().split('T')[0]
        });
      } else {
        const duration = getDaysBetween(new Date(task.start), new Date(task.end));
        const newEndDate = new Date(newStartDate);
        newEndDate.setDate(newEndDate.getDate() + duration);

        updateTask(task.id, {
          start: newStartDate.toISOString().split('T')[0],
          end: newEndDate.toISOString().split('T')[0]
        });
      }
    };

    const handleMouseUp = () => {
      setDraggingTask(null);
      setDragStartX(null);
      setDragStartDate(null);
      
      // Reset hasDragged after a brief delay so click handler can check it
      setTimeout(() => {
        setHasDragged(false);
      }, 100);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingTask, dragStartX, dragStartDate, tasks, timelineRange]);

  // Handle resize events
  useEffect(() => {
    if (!resizingTask) return;

    let lastDuration = resizeStartDuration;

    const handleMouseMove = (e) => {
      if (!resizeStartX || resizeStartDuration === null) return;

      const deltaX = e.clientX - resizeStartX;
      
      // Much more sensitive: 15px per day (easier to control)
      const pixelsPerDay = 15;
      const deltaDays = Math.round(deltaX / pixelsPerDay);
      
      const newDuration = Math.max(1, resizeStartDuration + deltaDays);
      
      // Only update if duration changed (prevents choppy updates)
      if (newDuration === lastDuration) return;
      lastDuration = newDuration;
      
      const task = tasks.find(t => t.id === resizingTask);
      if (!task) return;

      const newEndDate = new Date(task.start);
      newEndDate.setDate(newEndDate.getDate() + newDuration);

      updateTask(task.id, {
        end: newEndDate.toISOString().split('T')[0]
      });
      
      // Auto-expand timeline range if resizing beyond current view
      const currentEnd = new Date(timelineRange.end);
      if (newEndDate > currentEnd) {
        // Extend timeline to accommodate the new end date + buffer
        const extendedEnd = new Date(newEndDate);
        extendedEnd.setDate(extendedEnd.getDate() + 14); // 2 week buffer
        setTimelineRange({
          ...timelineRange,
          end: extendedEnd
        });
      }
    };

    const handleMouseUp = () => {
      setResizingTask(null);
      setResizeStartX(null);
      setResizeStartDuration(null);
      
      setTimeout(() => {
        setHasDragged(false);
      }, 100);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingTask, resizeStartX, resizeStartDuration, tasks, timelineRange]);

  // Handle Escape key to close modal, context menu, and popover
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (editingTask) {
          setEditingTask(null);
        }
        if (contextMenu) {
          setContextMenu(null);
        }
        if (phasePopover) {
          setPhasePopover(null);
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [editingTask, contextMenu, phasePopover]);

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
        type: 'event',
        date: '2026-04-10',
        owner: 'Bank',
        parentId: '5',
        dependencies: ['7']
      },
      {
        id: '9',
        name: 'Closing Meeting',
        type: 'event',
        date: '2026-04-12',
        owner: 'Chad',
        dependencies: []
      }
    ];
    setTasks(mockTasks);
  };

  const calculateTimelineRange = () => {
    const dates = tasks.flatMap(task => {
      if (task.type === 'milestone' || task.type === 'event') {
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
    // Normalize both dates to start of day for accurate day calculation
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);
    
    const diff = Math.abs(endDay - startDay);
    return Math.round(diff / (1000 * 60 * 60 * 24));
  };

  const getDateColumns = () => {
    if (!timelineRange.start || !timelineRange.end) return [];

    const columns = [];
    const current = new Date(timelineRange.start);
    const end = new Date(timelineRange.end);

    // Always show daily columns
    while (current <= end) {
      columns.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return columns;
  };

  const getTaskPosition = (task) => {
    if (!timelineRange.start) return { left: 0, width: 0 };

    const totalDays = getDaysBetween(timelineRange.start, timelineRange.end);
    
    let startDate, endDate;
    if (task.type === 'milestone' || task.type === 'event') {
      startDate = new Date(task.date);
      endDate = new Date(task.date);
    } else {
      startDate = new Date(task.start);
      endDate = new Date(task.end);
    }
    
    // Normalize to start of day
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);

    const startOffset = getDaysBetween(timelineRange.start, startDate);
    const duration = (task.type === 'milestone' || task.type === 'event') ? 1 : getDaysBetween(startDate, endDate);

    const leftPercent = (startOffset / totalDays) * 100;
    const widthPercent = (duration / totalDays) * 100;

    return { left: leftPercent, width: widthPercent };
  };

  const formatDate = (date, prevDate = null, format = 'short') => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const isMonthStart = !prevDate || date.getMonth() !== prevDate.getMonth();
    
    if (format === 'short') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
          {isMonthStart && (
            <div style={{ fontSize: '10px', color: '#667eea', fontWeight: '700', marginBottom: '2px' }}>
              {monthNames[date.getMonth()]}
            </div>
          )}
          <div style={{ fontSize: '13px', fontWeight: '600' }}>{date.getDate()}</div>
        </div>
      );
    }
    return date.toLocaleDateString();
  };

  // Get task color, inheriting from parent phase if child task
  const getTaskColor = (task) => {
    // If owner filter is active and task owner doesn't match, return light gray
    if (ownerFilter && task.owner !== ownerFilter) {
      return '#e5e7eb';
    }
    
    if (task.color) return task.color;
    
    if (task.type === 'phase') {
      return '#48bb78'; // default green for phases
    }
    
    if (task.type === 'milestone') {
      return '#f59e0b'; // default orange for milestones
    }
    
    if (task.type === 'event') {
      if (task.parentId) {
        const parentPhase = tasks.find(t => t.id === task.parentId);
        if (parentPhase && parentPhase.color) {
          return parentPhase.color;
        }
      }
      return '#f59e0b'; // default orange for events
    }
    
    if (task.parentId) {
      const parentPhase = tasks.find(t => t.id === task.parentId);
      if (parentPhase && parentPhase.color) {
        // Return a lighter shade (40% opacity) of parent color for child tasks
        // Convert hex to rgba for transparency
        const hex = parentPhase.color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, 0.7)`;
      }
    }
    
    return '#667eea'; // default blue for orphan tasks
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
    const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, ...updates } : t);
    
    // If dependencies changed, enforce start date constraints
    if (updates.dependencies !== undefined) {
      const task = updatedTasks.find(t => t.id === taskId);
      if (task && task.dependencies && task.dependencies.length > 0) {
        const latestEndDate = task.dependencies.reduce((latest, depId) => {
          const depTask = updatedTasks.find(t => t.id === depId);
          if (!depTask) return latest;
          
          const depEnd = depTask.type === 'milestone' ? new Date(depTask.date) : new Date(depTask.end);
          return depEnd > latest ? depEnd : latest;
        }, new Date(0));
        
        // Add one day buffer
        latestEndDate.setDate(latestEndDate.getDate() + 1);
        
        const currentStart = new Date(task.start);
        if (currentStart < latestEndDate) {
          const daysDiff = Math.ceil((new Date(task.end) - currentStart) / (1000 * 60 * 60 * 24));
          task.start = latestEndDate.toISOString().split('T')[0];
          
          // Adjust end date to maintain duration
          const newEnd = new Date(latestEndDate);
          newEnd.setDate(newEnd.getDate() + daysDiff);
          task.end = newEnd.toISOString().split('T')[0];
        }
      }
    }
    
    setTasks(updatedTasks);
  };

  const deleteTask = (taskId) => {
    if (window.confirm('Delete this task?')) {
      setTasks(tasks.filter(t => t.id !== taskId));
      setEditingTask(null);
    }
  };

  const dateColumns = getDateColumns();
  
  // Auto-calculate phase dates and progress from children
  const calculatePhaseMetrics = () => {
    const updatedTasks = [...tasks];
    
    updatedTasks.forEach(task => {
      if (task.type === 'phase') {
        const children = tasks.filter(t => t.parentId === task.id && t.type !== 'milestone' && t.type !== 'event');
        
        if (children.length > 0) {
          // Calculate start date (earliest child start)
          const earliestStart = children.reduce((earliest, child) => {
            const childStart = new Date(child.start);
            return childStart < earliest ? childStart : earliest;
          }, new Date(children[0].start));
          
          // Calculate end date (latest child end)
          const latestEnd = children.reduce((latest, child) => {
            const childEnd = new Date(child.end);
            return childEnd > latest ? childEnd : latest;
          }, new Date(children[0].end));
          
          // Calculate average progress
          const avgProgress = children.reduce((sum, child) => sum + (child.progress || 0), 0) / children.length;
          
          task.start = earliestStart.toISOString().split('T')[0];
          task.end = latestEnd.toISOString().split('T')[0];
          task.progress = Math.round(avgProgress);
        }
      }
    });
    
    return updatedTasks;
  };
  
  // Apply phase calculations
  const calculatedTasks = calculatePhaseMetrics();
  
  // Organize tasks hierarchically
  const organizeHierarchy = () => {
    const hierarchy = [];
    const phases = calculatedTasks.filter(t => t.type === 'phase');
    
    phases.forEach(phase => {
      hierarchy.push(phase);
      const children = calculatedTasks.filter(t => t.parentId === phase.id);
      hierarchy.push(...children);
    });
    
    // Add any orphaned tasks
    const orphans = calculatedTasks.filter(t => !t.parentId && t.type !== 'phase');
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
  
  // Get minimum allowed start date for a task based on dependencies
  const getMinStartDate = (task) => {
    if (!task.dependencies || task.dependencies.length === 0) return null;
    
    const latestDepEndDate = task.dependencies.reduce((latest, depId) => {
      const depTask = tasks.find(t => t.id === depId);
      if (!depTask) return latest;
      
      const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? new Date(depTask.date) : new Date(depTask.end);
      depEnd.setHours(0, 0, 0, 0);
      return depEnd > latest ? depEnd : latest;
    }, new Date(0));
    
    // Add one day buffer
    const minDate = new Date(latestDepEndDate);
    minDate.setDate(minDate.getDate() + 1);
    
    return minDate.toISOString().split('T')[0];
  };

  // Get unique owners for filter
  const uniqueOwners = [...new Set(tasks.filter(t => t.owner).map(t => t.owner))].sort();

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

      {/* Filter Bar */}
      {!compact && uniqueOwners.length > 0 && (
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '500' }}>Filter by:</span>
          <button
            onClick={() => setOwnerFilter(null)}
            style={{
              padding: '4px 12px',
              border: ownerFilter === null ? '2px solid #667eea' : '1px solid #e2e8f0',
              borderRadius: '16px',
              background: ownerFilter === null ? '#667eea' : 'white',
              color: ownerFilter === null ? 'white' : '#334155',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500'
            }}
          >
            All
          </button>
          {uniqueOwners.map(owner => {
            const ownerPhotoUrl = people[owner];
            const getOwnerColor = (name) => {
              const colors = {
                'Chad': '#3b82f6',
                'Tracy': '#8b5cf6',
                'Greg': '#10b981',
                'Scott': '#f59e0b',
                'Bank': '#6b7280'
              };
              return colors[name] || '#94a3b8';
            };
            
            return (
              <button
                key={owner}
                onClick={() => setOwnerFilter(ownerFilter === owner ? null : owner)}
                style={{
                  padding: '4px 12px',
                  border: ownerFilter === owner ? '2px solid #667eea' : '1px solid #e2e8f0',
                  borderRadius: '16px',
                  background: ownerFilter === owner ? '#667eea' : 'white',
                  color: ownerFilter === owner ? 'white' : '#334155',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: '500',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {ownerPhotoUrl ? (
                  <img
                    src={ownerPhotoUrl}
                    alt={owner}
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      objectFit: 'cover'
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: getOwnerColor(owner),
                      fontSize: '8px',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: '600'
                    }}
                  >
                    {owner.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </div>
                )}
                {owner}
              </button>
            );
          })}
        </div>
      )}

      <div className="timeline-container">
        {/* Task List Column */}
        <div className="timeline-tasks-column">
          <div className="timeline-header-cell">
            Tasks
          </div>
          {displayTasks.map((task, taskIndex) => {
            const getOwnerInitials = (name) => {
              if (!name) return '';
              return name.split(' ').map(n => n[0]).join('').toUpperCase();
            };
            
            const getOwnerColor = (name) => {
              const colors = {
                'Chad': '#3b82f6',
                'Tracy': '#8b5cf6',
                'Greg': '#10b981',
                'Scott': '#f59e0b',
                'Bank': '#6b7280'
              };
              return colors[name] || '#94a3b8';
            };
            
            const ownerPhotoUrl = task.owner && people[task.owner];
            
            // Debug logging
            if (task.owner && taskIndex === 1) {
              console.log('Task owner:', task.owner);
              console.log('People keys:', Object.keys(people));
              console.log('Photo URL:', ownerPhotoUrl);
            }
            
            return (
              <div 
                key={task.id} 
                className={`timeline-task-row ${task.type} ${task.parentId ? 'child-task' : ''} ${reorderingTask === task.id ? 'reordering' : ''} ${reorderTargetIndex === taskIndex ? 'drop-target' : ''}`}
                style={(() => {
                  // If owner filter is active and this task doesn't match, make it light gray
                  if (ownerFilter && task.owner !== ownerFilter) {
                    return { backgroundColor: '#f9fafb' };
                  }
                  
                  // Otherwise, phase rows get their tinted background
                  if (task.type === 'phase' && task.color) {
                    const hex = task.color.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16);
                    const g = parseInt(hex.substring(2, 4), 16);
                    const b = parseInt(hex.substring(4, 6), 16);
                    return { backgroundColor: `rgba(${r}, ${g}, ${b}, 0.1)` };
                  }
                  
                  return {};
                })()}
                onClick={(e) => {
                  if (compact) return;
                  if (task.type === 'phase') {
                    setPhasePopover({
                      taskId: task.id,
                      x: e.clientX,
                      y: e.clientY
                    });
                  } else {
                    setEditingTask(task);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setReorderTargetIndex(taskIndex);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (reorderingTask && reorderTargetIndex !== null) {
                    const draggedTask = tasks.find(t => t.id === reorderingTask);
                    const targetTask = displayTasks[reorderTargetIndex];
                    
                    if (!draggedTask || !targetTask || draggedTask.id === targetTask.id) {
                      setReorderingTask(null);
                      setReorderTargetIndex(null);
                      return;
                    }
                    
                    // Can't drag a phase into its own children
                    if (draggedTask.type === 'phase' && targetTask.parentId === draggedTask.id) {
                      setReorderingTask(null);
                      setReorderTargetIndex(null);
                      return;
                    }
                    
                    // Determine new parent
                    let newParentId = null;
                    if (targetTask.type === 'phase') {
                      // Dropping onto a phase - make it a child
                      newParentId = targetTask.id;
                    } else if (targetTask.parentId) {
                      // Dropping onto a child - use same parent
                      newParentId = targetTask.parentId;
                    }
                    
                    // Update the task
                    const newTasks = tasks.map(t => 
                      t.id === draggedTask.id ? { ...t, parentId: newParentId } : t
                    );
                    setTasks(newTasks);
                    // TODO: Save to API
                  }
                  setReorderingTask(null);
                  setReorderTargetIndex(null);
                }}
              >
                {/* Drag Handle */}
                {!compact && (
                  <div 
                    className="task-drag-handle"
                    draggable
                    onDragStart={(e) => {
                      setReorderingTask(task.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setReorderingTask(null);
                      setReorderTargetIndex(null);
                    }}
                    title="Drag to reorder"
                  >
                    ⋮⋮
                  </div>
                )}
                
                <div className="task-row-content" style={{
                  opacity: ownerFilter && task.owner !== ownerFilter ? 0.4 : 1
                }}>
                  {/* Days Badge */}
                  {task.type !== 'phase' && (task.start || task.date) && (
                    <div className="task-days-badge">
                      {task.type === 'milestone' || task.type === 'event' 
                        ? '1'
                        : getDaysBetween(new Date(task.start), new Date(task.end))}
                    </div>
                  )}
                  
                  {task.owner && (
                    ownerPhotoUrl ? (
                      <img
                        src={ownerPhotoUrl}
                        alt={task.owner}
                        className="owner-avatar owner-avatar-image"
                        title={task.owner}
                        onError={(e) => {
                          console.error('Failed to load image:', ownerPhotoUrl);
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div 
                        className="owner-avatar"
                        style={{ backgroundColor: getOwnerColor(task.owner) }}
                        title={task.owner}
                      >
                        {getOwnerInitials(task.owner)}
                      </div>
                    )
                  )}
                  <div className="task-name-simple">
                    {task.type === 'phase' && '📁 '}
                    {task.type === 'milestone' && '🏁 '}
                    {task.type === 'event' && '💎 '}
                    {task.name}
                    {task.type === 'phase' && task.start && task.end && (
                      <span style={{ 
                        marginLeft: '8px', 
                        color: '#6c757d', 
                        fontSize: '11px',
                        fontWeight: '500'
                      }}>
                        ({getDaysBetween(new Date(task.start), new Date(task.end))} days)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Timeline Grid */}
        <div className="timeline-grid-wrapper">
          <div className="timeline-grid">
            {/* Column Grid Lines & Weekend Stripes */}
            <div className="grid-overlay">
              {dateColumns.map((date, i) => {
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                
                return (
                  <div
                    key={i}
                    className="grid-column"
                    style={{
                      background: isWeekend ? 'rgba(0, 0, 0, 0.02)' : 'transparent'
                    }}
                  />
                );
              })}
            </div>

            {/* Date Headers */}
            <div className="timeline-header-row">
              {dateColumns.map((date, i) => {
                const isWeekend = date.getDay() === 0 || date.getDay() === 6; // Sunday = 0, Saturday = 6
                const prevDate = i > 0 ? dateColumns[i - 1] : null;
                return (
                  <div key={i} className={`timeline-date-header ${isWeekend ? 'weekend' : ''}`}>
                    {formatDate(date, prevDate)}
                  </div>
                );
              })}
            </div>

            {/* Today Marker - Full Height */}
            {(() => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const totalDays = getDaysBetween(timelineRange.start, timelineRange.end);
              const todayOffset = getDaysBetween(timelineRange.start, today);
              const todayPercent = (todayOffset / totalDays) * 100;
              
              return todayPercent >= 0 && todayPercent <= 100 ? (
                <div 
                  className="timeline-today-marker-full" 
                  style={{ 
                    left: `${todayPercent}%`,
                    height: displayTasks.length * 50 + 40
                  }} 
                />
              ) : null;
            })()}

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
                
                // Check if items are immediately adjacent (within 50px = one row height)
                const isAdjacent = Math.abs(y2 - y1) <= 50;
                
                let pathData;
                if (isAdjacent) {
                  // Straight line down for adjacent items
                  pathData = `M ${x1} ${y1} L ${x2} ${y2}`;
                } else {
                  // 90-degree angle path for non-adjacent items
                  const midX = x1 + (x2 - x1) * 0.5;
                  pathData = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
                }
                
                return (
                  <g key={i}>
                    <path
                      d={pathData}
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
              const isEvent = task.type === 'event';
              const isPhase = task.type === 'phase';

              const handleMouseDown = (e) => {
                if (compact) return;
                if (isPhase) return; // Phases are read-only, no dragging
                e.preventDefault();
                e.stopPropagation();
                
                setHasDragged(false); // Reset drag flag at start of new drag
                setDraggingTask(task.id);
                setDragStartX(e.clientX);
                setDragStartDate((task.type === 'milestone' || task.type === 'event') ? new Date(task.date) : new Date(task.start));
              };
              
              const handleBarClick = (e) => {
                e.stopPropagation();
                // Don't open anything for phases
                if (isPhase) return;
                // Don't open modal if we just dragged
                if (!hasDragged && !compact) {
                  setEditingTask(task);
                }
              };

              const hasDependencies = task.dependencies && task.dependencies.length > 0;

              return (
                <div key={task.id} className="timeline-row">
                  {isEvent ? (
                    // Diamond shape for events
                    <div
                      className={`timeline-event ${draggingTask === task.id ? 'dragging' : ''}`}
                      style={{
                        left: `calc(${position.left}% + ${position.width / 2}%)`,
                        cursor: compact ? 'default' : 'grab'
                      }}
                      onMouseDown={handleMouseDown}
                      onClick={handleBarClick}
                      title={task.name}
                    >
                      <div className="event-diamond" style={{
                        backgroundColor: getTaskColor(task)
                      }} />
                    </div>
                  ) : (
                    <div 
                      className={`timeline-bar ${task.type} ${draggingTask === task.id ? 'dragging' : ''} ${hasDependencies ? 'has-dependencies' : ''}`}
                      style={{
                        left: isMilestone ? `calc(${position.left}% - 10px)` : `${position.left}%`,
                        width: isMilestone ? '24px' : `${position.width}%`,
                        backgroundColor: isMilestone ? 'transparent' : getTaskColor(task),
                        cursor: compact || isPhase ? 'default' : 'grab',
                        borderLeft: hasDependencies ? '3px solid rgba(0, 0, 0, 0.2)' : 'none',
                        display: isMilestone ? 'flex' : 'block',
                        alignItems: isMilestone ? 'center' : 'initial',
                        justifyContent: isMilestone ? 'center' : 'initial'
                      }}
                      onMouseDown={handleMouseDown}
                      onClick={handleBarClick}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          taskId: task.id
                        });
                      }}
                    >
                      {isMilestone && (
                        <div 
                          style={{
                            width: '4px',
                            height: '40px',
                            backgroundColor: getTaskColor(task),
                            borderRadius: '2px'
                          }}
                        />
                      )}
                      {!isMilestone && !isEvent && (
                        <>
                          <div 
                            className="timeline-bar-progress"
                            style={{ 
                              width: `${task.progress}%`,
                              backgroundColor: `color-mix(in srgb, ${getTaskColor(task)} 80%, black)`
                            }}
                          />
                          {!compact && position.width > 5 && (
                            <div className="timeline-bar-label">{task.progress}%</div>
                          )}
                          {/* Resize Handle - disabled for phases */}
                          {!compact && !isPhase && (
                            <div 
                              className="timeline-resize-handle"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setResizingTask(task.id);
                                setResizeStartX(e.clientX);
                                const duration = getDaysBetween(new Date(task.start), new Date(task.end));
                                setResizeStartDuration(duration);
                                setHasDragged(true); // Prevent click from opening modal
                              }}
                              title="Drag to resize"
                            />
                          )}
                        </>
                      )}
                      {/* Show duration tooltip while resizing */}
                      {resizingTask === task.id && (
                        <div className="resize-tooltip-enhanced">
                          <div className="resize-days-badge">
                            {getDaysBetween(new Date(task.start), new Date(task.end))}
                          </div>
                          <div className="resize-days-label">days</div>
                          <div className="resize-dates">
                            {new Date(task.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {' → '}
                            {new Date(task.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
                <option value="event">Event</option>
              </select>
            </label>

            {editingTask.type !== 'event' && (
              <>
                <label>
                  Start Date:
                  <input
                    type="date"
                    value={editingTask.start}
                    min={getMinStartDate(editingTask)}
                    onChange={(e) => setEditingTask({ ...editingTask, start: e.target.value })}
                    disabled={editingTask.type === 'phase'}
                  />
                  {editingTask.type === 'phase' && (
                    <small style={{ display: 'block', marginTop: '4px', color: '#6b7280', fontSize: '11px' }}>
                      📊 Auto-calculated from child tasks
                    </small>
                  )}
                  {editingTask.dependencies && editingTask.dependencies.length > 0 && editingTask.type !== 'phase' && (
                    <small style={{ display: 'block', marginTop: '4px', color: '#ef4444', fontSize: '11px' }}>
                      ⚠️ Cannot start before dependencies finish
                    </small>
                  )}
                </label>

                <label>
                  Duration (days):
                  <input
                    type="number"
                    min="1"
                    value={editingTask.start && editingTask.end ? 
                      getDaysBetween(new Date(editingTask.start), new Date(editingTask.end)) : 1}
                    onChange={(e) => {
                      const days = parseInt(e.target.value) || 1;
                      const newEnd = new Date(editingTask.start);
                      newEnd.setDate(newEnd.getDate() + days);
                      setEditingTask({ ...editingTask, end: newEnd.toISOString().split('T')[0] });
                    }}
                    disabled={editingTask.type === 'phase'}
                  />
                  {editingTask.type !== 'phase' && (
                    <small style={{ display: 'block', marginTop: '4px', color: '#6b7280', fontSize: '11px' }}>
                      Or set end date below
                    </small>
                  )}
                </label>

                <label>
                  End Date:
                  <input
                    type="date"
                    value={editingTask.end}
                    min={editingTask.start}
                    onChange={(e) => setEditingTask({ ...editingTask, end: e.target.value })}
                    disabled={editingTask.type === 'phase'}
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
                    disabled={editingTask.type === 'phase'}
                  />
                  <span>{editingTask.progress}%</span>
                  {editingTask.type === 'phase' && (
                    <small style={{ display: 'block', marginTop: '4px', color: '#6b7280', fontSize: '11px' }}>
                      📊 Average of child tasks
                    </small>
                  )}
                </label>
              </>
            )}

            {(editingTask.type === 'milestone' || editingTask.type === 'event') && (
              <label>
                Date:
                <input
                  type="date"
                  value={editingTask.date}
                  min={getMinStartDate(editingTask)}
                  onChange={(e) => setEditingTask({ ...editingTask, date: e.target.value })}
                />
                {editingTask.dependencies && editingTask.dependencies.length > 0 && (
                  <small style={{ display: 'block', marginTop: '4px', color: '#ef4444', fontSize: '11px' }}>
                    ⚠️ Cannot occur before dependencies finish
                  </small>
                )}
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
                // Validate dependency dates before saving
                if (editingTask.dependencies && editingTask.dependencies.length > 0) {
                  const latestEndDate = editingTask.dependencies.reduce((latest, depId) => {
                    const depTask = tasks.find(t => t.id === depId);
                    if (!depTask) return latest;
                    
                    const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? new Date(depTask.date) : new Date(depTask.end);
                    return depEnd > latest ? depEnd : latest;
                  }, new Date(0));
                  
                  const taskStart = (editingTask.type === 'milestone' || editingTask.type === 'event') ? new Date(editingTask.date) : new Date(editingTask.start);
                  
                  if (taskStart <= latestEndDate) {
                    if (!window.confirm('This task starts before its dependencies finish. Auto-adjust start date?')) {
                      return;
                    }
                    
                    // Auto-adjust
                    latestEndDate.setDate(latestEndDate.getDate() + 1);
                    if (editingTask.type === 'milestone' || editingTask.type === 'event') {
                      editingTask.date = latestEndDate.toISOString().split('T')[0];
                    } else {
                      const duration = Math.ceil((new Date(editingTask.end) - new Date(editingTask.start)) / (1000 * 60 * 60 * 24));
                      editingTask.start = latestEndDate.toISOString().split('T')[0];
                      
                      const newEnd = new Date(latestEndDate);
                      newEnd.setDate(newEnd.getDate() + duration);
                      editingTask.end = newEnd.toISOString().split('T')[0];
                    }
                  }
                }
                
                updateTask(editingTask.id, editingTask);
                setEditingTask(null);
              }}>Save</button>
              <button onClick={() => deleteTask(editingTask.id)} className="delete">Delete</button>
              <button onClick={() => setEditingTask(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Right-Click Context Menu for Dependencies */}
      {contextMenu && (
        <div 
          className="timeline-context-menu"
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-header">Add Dependency</div>
          <div className="context-menu-list">
            {tasks.filter(t => t.id !== contextMenu.taskId).map(t => {
              const currentTask = tasks.find(task => task.id === contextMenu.taskId);
              const isAlreadyDep = currentTask?.dependencies?.includes(t.id);
              
              return (
                <div
                  key={t.id}
                  className={`context-menu-item ${isAlreadyDep ? 'selected' : ''}`}
                  onClick={() => {
                    const task = tasks.find(task => task.id === contextMenu.taskId);
                    if (!task) return;
                    
                    const deps = task.dependencies || [];
                    const newDeps = isAlreadyDep
                      ? deps.filter(d => d !== t.id)
                      : [...deps, t.id];
                    
                    updateTask(task.id, { dependencies: newDeps });
                    setContextMenu(null);
                  }}
                >
                  {isAlreadyDep && '✓ '}
                  {t.name}
                </div>
              );
            })}
          </div>
          <div className="context-menu-footer">
            <button onClick={() => setContextMenu(null)}>Close</button>
          </div>
        </div>
      )}

      {/* Click anywhere to close context menu */}
      {contextMenu && (
        <div 
          className="context-menu-backdrop"
          onClick={() => setContextMenu(null)}
        />
      )}

      {/* Phase Settings Popover */}
      {phasePopover && (
        <>
          <div 
            className="context-menu-backdrop"
            onClick={() => setPhasePopover(null)}
          />
          <div
            className="timeline-phase-popover"
            style={{
              position: 'fixed',
              left: `${phasePopover.x}px`,
              top: `${phasePopover.y}px`,
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 1001,
              minWidth: '200px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const phase = tasks.find(t => t.id === phasePopover.taskId);
              if (!phase) return null;
              
              return (
                <>
                  <div style={{ fontWeight: '600', marginBottom: '12px', fontSize: '13px' }}>
                    Edit Phase
                  </div>
                  
                  <label style={{ display: 'block', marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Title</div>
                    <input
                      type="text"
                      value={phase.name}
                      onChange={(e) => {
                        updateTask(phase.id, { name: e.target.value });
                      }}
                      style={{
                        width: '100%',
                        padding: '6px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        fontSize: '13px',
                        fontWeight: '500'
                      }}
                    />
                  </label>
                  
                  <label style={{ display: 'block', marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Color</div>
                    <input
                      type="color"
                      value={phase.color || '#48bb78'}
                      onChange={(e) => {
                        updateTask(phase.id, { color: e.target.value });
                      }}
                      style={{
                        width: '100%',
                        height: '32px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    />
                  </label>
                  
                  <button
                    onClick={() => setPhasePopover(null)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      background: '#667eea',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '500'
                    }}
                  >
                    Done
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}

export default CustomTimeline;
