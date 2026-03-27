import React, { useState, useEffect, useRef } from 'react';
import './CustomTimeline.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function CustomTimeline({ projectId, compact = false, people = {} }) {
  // Debug people data
  useEffect(() => {
    console.log('CustomTimeline received people prop:', people);
    console.log('People keys:', Object.keys(people));
    console.log('People values:', Object.values(people));
  }, [people]);
  
  const [tasks, setTasks] = useState([]);
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
  const [showDependencies, setShowDependencies] = useState(true);
  const [showTightenModal, setShowTightenModal] = useState(false);
  const [tightenChanges, setTightenChanges] = useState([]);
  const [tightenExclusions, setTightenExclusions] = useState(new Set());
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [gridWidth, setGridWidth] = useState(1000);
  const gridRef = useRef(null);

  useEffect(() => {
    loadTasks();
  }, [projectId]);

  useEffect(() => {
    if (tasks.length > 0) {
      calculateTimelineRange();
    }
  }, [tasks]);

  // Update grid width for dependency arrow calculations
  useEffect(() => {
    const updateGridWidth = () => {
      if (gridRef.current) {
        setGridWidth(gridRef.current.offsetWidth);
      }
    };

    updateGridWidth();
    window.addEventListener('resize', updateGridWidth);
    
    // Update on task changes (dragging, resizing)
    const timeout = setTimeout(updateGridWidth, 100);

    return () => {
      window.removeEventListener('resize', updateGridWidth);
      clearTimeout(timeout);
    };
  }, [tasks, draggingTask, resizingTask]);

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

      const originalDuration = (task.type === 'milestone' || task.type === 'event') 
        ? 1 
        : getDaysBetween(new Date(task.start), new Date(task.end)) + 1;

      let newStartDate = new Date(dragStartDate);
      newStartDate.setDate(newStartDate.getDate() + deltaDays);

      // Find constraints
      let minStartDate = null;
      let maxStartDate = null;

      // Check predecessor constraints (earliest we can start)
      if (task.dependencies && task.dependencies.length > 0) {
        const latestDepEndDate = task.dependencies.reduce((latest, depId) => {
          const depTask = tasks.find(t => t.id === depId);
          if (!depTask) return latest;
          
          const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? new Date(depTask.date) : new Date(depTask.end);
          depEnd.setHours(0, 0, 0, 0);
          return depEnd > latest ? depEnd : latest;
        }, new Date(0));
        
        minStartDate = new Date(latestDepEndDate);
      }

      // Check successor constraints (latest we can end)
      const successors = tasks.filter(t => t.dependencies && t.dependencies.includes(task.id));
      if (successors.length > 0) {
        const earliestSuccessorStart = successors.reduce((earliest, successor) => {
          const succStart = (successor.type === 'milestone' || successor.type === 'event')
            ? new Date(successor.date)
            : new Date(successor.start);
          succStart.setHours(0, 0, 0, 0);
          return succStart < earliest ? succStart : earliest;
        }, new Date('2100-01-01'));
        
        // Latest we can start = successor start - duration
        maxStartDate = new Date(earliestSuccessorStart);
        maxStartDate.setDate(maxStartDate.getDate() - originalDuration);
      }

      // Apply constraints
      if (minStartDate && newStartDate < minStartDate) {
        newStartDate = new Date(minStartDate);
      }
      
      if (maxStartDate && newStartDate > maxStartDate) {
        newStartDate = new Date(maxStartDate);
      }

      // Check if task fits between constraints
      if (minStartDate && maxStartDate && minStartDate > maxStartDate) {
        // Task doesn't fit - don't update
        console.warn('Task does not fit between constraints');
        return;
      }

      if (task.type === 'milestone' || task.type === 'event') {
        updateTask(task.id, {
          date: newStartDate.toISOString().split('T')[0]
        });
      } else {
        // Calculate proposed end date (originalDuration is inclusive, so subtract 1)
        let newEndDate = new Date(newStartDate);
        newEndDate.setDate(newEndDate.getDate() + originalDuration - 1);

        // If we have successors, ensure end date doesn't violate them
        if (successors.length > 0) {
          const earliestSuccessorStart = successors.reduce((earliest, successor) => {
            const succStart = (successor.type === 'milestone' || successor.type === 'event')
              ? new Date(successor.date)
              : new Date(successor.start);
            succStart.setHours(0, 0, 0, 0);
            return succStart < earliest ? succStart : earliest;
          }, new Date('2100-01-01'));

          // If proposed end is after successor start, clamp it
          if (newEndDate >= earliestSuccessorStart) {
            console.warn('End date would violate successor - blocking drag');
            return; // Don't allow this position
          }
        }

        // Verify duration is maintained (inclusive)
        const finalDuration = getDaysBetween(newStartDate, newEndDate) + 1;
        if (finalDuration < 1) {
          console.warn('Duration would be less than 1 day - blocking drag');
          return;
        }

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
      newEndDate.setDate(newEndDate.getDate() + newDuration - 1);

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

  // Validate and fix task dependencies
  const validateTaskDependencies = (tasksToValidate) => {
    let fixed = false;
    const validatedTasks = tasksToValidate.map(task => {
      // Phases can't have dependencies
      if (task.type === 'phase' && task.dependencies && task.dependencies.length > 0) {
        fixed = true;
        console.warn(`Removing dependencies from phase "${task.name}"`);
        return { ...task, dependencies: [] };
      }
      
      if (!task.dependencies || task.dependencies.length === 0) return task;
      
      // Filter out any phase dependencies
      const nonPhaseDeps = task.dependencies.filter(depId => {
        const depTask = tasksToValidate.find(t => t.id === depId);
        return depTask && depTask.type !== 'phase';
      });
      
      if (nonPhaseDeps.length !== task.dependencies.length) {
        fixed = true;
        console.warn(`Removing phase dependencies from task "${task.name}"`);
        task = { ...task, dependencies: nonPhaseDeps };
      }
      
      if (nonPhaseDeps.length === 0) return task;
      
      const latestEndDate = nonPhaseDeps.reduce((latest, depId) => {
        const depTask = tasksToValidate.find(t => t.id === depId);
        if (!depTask) return latest;
        
        const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? new Date(depTask.date) : new Date(depTask.end);
        return depEnd > latest ? depEnd : latest;
      }, new Date(0));
      
      latestEndDate.setDate(latestEndDate.getDate() + 1);
      
      const taskStart = (task.type === 'milestone' || task.type === 'event') ? new Date(task.date) : new Date(task.start);
      
      if (taskStart < latestEndDate) {
        fixed = true;
        console.warn(`Fixing dependency violation for task "${task.name}"`);
        
        if (task.type === 'milestone' || task.type === 'event') {
          return { ...task, date: latestEndDate.toISOString().split('T')[0] };
        } else {
          const duration = getDaysBetween(new Date(task.start), new Date(task.end));
          const newEnd = new Date(latestEndDate);
          newEnd.setDate(newEnd.getDate() + duration);
          
          return {
            ...task,
            start: latestEndDate.toISOString().split('T')[0],
            end: newEnd.toISOString().split('T')[0]
          };
        }
      }
      
      return task;
    });
    
    if (fixed) {
      console.log('Fixed dependency violations on load');
    }
    
    return validatedTasks;
  };

  const loadTasks = async () => {
    if (!projectId) {
      console.warn('⚠️ loadTasks called with no projectId');
      setTasks([]);
      return;
    }

    try {
      console.log('📥 Loading timeline for project:', projectId);
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!res.ok) {
        console.error('❌ Failed to load project:', res.status);
        setTasks([]);
        return;
      }
      
      const data = await res.json();
      const loadedTasks = data.project?.timeline || [];
      console.log('✅ Loaded timeline:', loadedTasks.length, 'tasks');
      console.log('Timeline data:', loadedTasks);
      setTasks(validateTaskDependencies(loadedTasks));
    } catch (error) {
      console.error('❌ Error loading timeline:', error);
      setTasks([]);
    }
  };

  const saveTasks = async (updatedTasks) => {
    if (!projectId) {
      console.warn('⚠️ saveTasks called with no projectId - NOT SAVING');
      return;
    }

    try {
      console.log('💾 Saving timeline for project:', projectId);
      console.log('   Tasks to save:', updatedTasks.length);
      console.log('   Task data:', updatedTasks);
      
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({ timeline: updatedTasks })
      });
      
      if (!res.ok) {
        console.error('❌ Failed to save timeline:', res.status);
        const errorText = await res.text();
        console.error('   Error response:', errorText);
      } else {
        console.log('✅ Timeline saved successfully');
      }
    } catch (error) {
      console.error('❌ Error saving timeline:', error);
    }
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
    const duration = (task.type === 'milestone' || task.type === 'event') ? 1 : getDaysBetween(startDate, endDate) + 1;

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
      name: 'New Name',
      type: 'task',
      start: new Date().toISOString().split('T')[0],
      end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      progress: 0,
      owner: '',
      dependencies: []
    };
    const updatedTasks = [...tasks, newTask];
    setTasks(updatedTasks);
    saveTasks(updatedTasks);
    setEditingTask({ ...newTask, isNew: true });
  };

  const updateTask = (taskId, updates) => {
    let updatedTasks = tasks.map(t => t.id === taskId ? { ...t, ...updates } : t);
    
    // Enforce dependency constraints for any update
    const task = updatedTasks.find(t => t.id === taskId);
    
    // Remove dependencies from phases and filter out phase dependencies
    if (task) {
      if (task.type === 'phase' && task.dependencies && task.dependencies.length > 0) {
        task.dependencies = [];
      } else if (task.dependencies && task.dependencies.length > 0) {
        // Filter out any phase dependencies
        task.dependencies = task.dependencies.filter(depId => {
          const depTask = updatedTasks.find(t => t.id === depId);
          return depTask && depTask.type !== 'phase';
        });
      }
    }
    
    if (task && task.dependencies && task.dependencies.length > 0) {
      const latestEndDate = task.dependencies.reduce((latest, depId) => {
        const depTask = updatedTasks.find(t => t.id === depId);
        if (!depTask) return latest;
        
        const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? new Date(depTask.date) : new Date(depTask.end);
        return depEnd > latest ? depEnd : latest;
      }, new Date(0));
      
      // Add one day buffer
      latestEndDate.setDate(latestEndDate.getDate() + 1);
      
      const taskStart = (task.type === 'milestone' || task.type === 'event') ? new Date(task.date) : new Date(task.start);
      
      if (taskStart < latestEndDate) {
        // Prevent the update - task would violate dependency constraint
        console.warn('Task would start before dependency ends - auto-adjusting dates');
        
        if (task.type === 'milestone' || task.type === 'event') {
          task.date = latestEndDate.toISOString().split('T')[0];
        } else {
          const duration = getDaysBetween(new Date(task.start), new Date(task.end)) + 1;
          task.start = latestEndDate.toISOString().split('T')[0];
          
          // Adjust end date to maintain duration (inclusive)
          const newEnd = new Date(latestEndDate);
          newEnd.setDate(newEnd.getDate() + duration - 1);
          task.end = newEnd.toISOString().split('T')[0];
        }
      }
    }
    
    // Cascade changes to dependent tasks
    updatedTasks = cascadeDependencyChanges(updatedTasks, taskId);
    
    setTasks(updatedTasks);
    saveTasks(updatedTasks);
  };
  
  // Calculate what would change if we tighten all dependencies (0 day gaps)
  const calculateTightenChanges = () => {
    const changes = [];
    
    tasks.forEach(task => {
      if (!task.dependencies || task.dependencies.length === 0) return;
      if (task.type === 'phase') return; // Skip phases
      
      // Calculate minimum start date (latest dependency end + 1 day)
      const latestEndDate = task.dependencies.reduce((latest, depId) => {
        const depTask = tasks.find(t => t.id === depId);
        if (!depTask) return latest;
        
        const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') 
          ? new Date(depTask.date) 
          : new Date(depTask.end);
        return depEnd > latest ? depEnd : latest;
      }, new Date(0));
      
      // Allow tasks to start on the same day dependency ends (no buffer)
      
      const currentStart = (task.type === 'milestone' || task.type === 'event')
        ? new Date(task.date)
        : new Date(task.start);
      
      // If there's a gap, this task can be tightened
      if (currentStart > latestEndDate) {
        const gapDays = getDaysBetween(latestEndDate, currentStart);
        
        const newDates = {};
        if (task.type === 'milestone' || task.type === 'event') {
          newDates.date = latestEndDate.toISOString().split('T')[0];
        } else {
          const duration = getDaysBetween(new Date(task.start), new Date(task.end)) + 1;
          const newEnd = new Date(latestEndDate);
          newEnd.setDate(newEnd.getDate() + duration - 1);
          
          newDates.start = latestEndDate.toISOString().split('T')[0];
          newDates.end = newEnd.toISOString().split('T')[0];
        }
        
        changes.push({
          taskId: task.id,
          taskName: task.name,
          taskType: task.type,
          currentDates: task.type === 'milestone' || task.type === 'event'
            ? { date: task.date }
            : { start: task.start, end: task.end },
          newDates,
          gapDays
        });
      }
    });
    
    return changes;
  };
  
  // Apply tightened dependencies
  const applyTightenChanges = () => {
    let updatedTasks = [...tasks];
    
    tightenChanges.forEach(change => {
      if (tightenExclusions.has(change.taskId)) return; // Skip excluded tasks
      
      updatedTasks = updatedTasks.map(t => {
        if (t.id === change.taskId) {
          return { ...t, ...change.newDates };
        }
        return t;
      });
    });
    
    setTasks(updatedTasks);
    setShowTightenModal(false);
  };
  
  // Recursively update all tasks that depend on the given task
  const cascadeDependencyChanges = (tasksToUpdate, changedTaskId) => {
    const changedTask = tasksToUpdate.find(t => t.id === changedTaskId);
    if (!changedTask) return tasksToUpdate;
    
    // Find all tasks that depend on this task
    const dependentTasks = tasksToUpdate.filter(t => 
      t.dependencies && t.dependencies.includes(changedTaskId)
    );
    
    if (dependentTasks.length === 0) return tasksToUpdate;
    
    let updatedTasks = [...tasksToUpdate];
    
    dependentTasks.forEach(depTask => {
      // Calculate new minimum start date based on all dependencies
      const latestEndDate = depTask.dependencies.reduce((latest, depId) => {
        const dep = updatedTasks.find(t => t.id === depId);
        if (!dep) return latest;
        
        const depEnd = (dep.type === 'milestone' || dep.type === 'event') 
          ? new Date(dep.date) 
          : new Date(dep.end);
        return depEnd > latest ? depEnd : latest;
      }, new Date(0));
      
      // Add one day buffer
      latestEndDate.setDate(latestEndDate.getDate() + 1);
      
      const currentStart = (depTask.type === 'milestone' || depTask.type === 'event')
        ? new Date(depTask.date)
        : new Date(depTask.start);
      
      // If the dependent task needs to be shifted
      if (currentStart < latestEndDate) {
        console.log(`Cascading dependency change: shifting "${depTask.name}" forward`);
        
        updatedTasks = updatedTasks.map(t => {
          if (t.id === depTask.id) {
            if (t.type === 'milestone' || t.type === 'event') {
              return { ...t, date: latestEndDate.toISOString().split('T')[0] };
            } else {
              const duration = getDaysBetween(new Date(t.start), new Date(t.end)) + 1;
              const newEnd = new Date(latestEndDate);
              newEnd.setDate(newEnd.getDate() + duration - 1);
              
              return {
                ...t,
                start: latestEndDate.toISOString().split('T')[0],
                end: newEnd.toISOString().split('T')[0]
              };
            }
          }
          return t;
        });
        
        // Recursively cascade to tasks that depend on this one
        updatedTasks = cascadeDependencyChanges(updatedTasks, depTask.id);
      }
    });
    
    return updatedTasks;
  };

  const deleteTask = (taskId) => {
    if (window.confirm('Delete this task?')) {
      const updatedTasks = tasks.filter(t => t.id !== taskId);
      setTasks(updatedTasks);
      saveTasks(updatedTasks);
      setEditingTask(null);
    }
  };

  const dateColumns = getDateColumns();
  
  // Auto-calculate phase dates and progress from children
  const calculatePhaseMetrics = () => {
    // Deep clone to avoid mutating state during render
    const updatedTasks = tasks.map(t => ({ ...t }));
    
    updatedTasks.forEach(task => {
      if (task.type === 'phase') {
        const children = updatedTasks.filter(t => t.parentId === task.id && t.type !== 'milestone' && t.type !== 'event');
        
        // Include ALL children for date calculations (tasks, milestones, events)
        const allChildren = updatedTasks.filter(t => t.parentId === task.id);
        
        if (allChildren.length > 0) {
          // Calculate start date (earliest child start or date)
          const earliestStart = allChildren.reduce((earliest, child) => {
            const childStart = child.type === 'milestone' || child.type === 'event' 
              ? new Date(child.date) 
              : new Date(child.start);
            return childStart < earliest ? childStart : earliest;
          }, new Date(allChildren[0].start || allChildren[0].date));
          
          // Calculate end date (latest child end or date)
          const latestEnd = allChildren.reduce((latest, child) => {
            const childEnd = child.type === 'milestone' || child.type === 'event'
              ? new Date(child.date)
              : new Date(child.end);
            return childEnd > latest ? childEnd : latest;
          }, new Date(allChildren[0].end || allChildren[0].date));
          
          task.start = earliestStart.toISOString().split('T')[0];
          task.end = latestEnd.toISOString().split('T')[0];
        }
        
        // Calculate progress ONLY from regular tasks (not milestones/events)
        if (children.length > 0) {
          const avgProgress = children.reduce((sum, child) => sum + (child.progress || 0), 0) / children.length;
          task.progress = Math.round(avgProgress);
          console.log(`Phase "${task.name}": ${children.length} tasks, avg progress: ${avgProgress}%`, children.map(c => `${c.name}: ${c.progress}%`));
        } else {
          // No regular tasks, only milestones/events - show 0%
          task.progress = 0;
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

      {/* Filter Bar */}
      {!compact && (
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap'
        }}>
          {uniqueOwners.length > 0 && (
            <>
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
            </>
          )}
          
          {/* Dependencies toggle and tools */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => {
                const changes = calculateTightenChanges();
                setTightenChanges(changes);
                setTightenExclusions(new Set());
                setShowTightenModal(true);
              }}
              style={{
                padding: '6px 12px',
                border: '1px solid #667eea',
                borderRadius: '6px',
                background: 'white',
                color: '#667eea',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500'
              }}
            >
              ⚡ Tighten Dependencies
            </button>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              fontSize: '13px',
              color: '#64748b',
              cursor: 'pointer',
              userSelect: 'none'
            }}>
              <input
                type="checkbox"
                checked={showDependencies}
                onChange={(e) => setShowDependencies(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Show Dependencies</span>
            </label>
          </div>
        </div>
      )}

      <div className="timeline-container">
        {/* Task List Column */}
        <div className="timeline-tasks-column">
          <div className="timeline-header-cell">
            Items
            {!compact && (
              <button 
                onClick={addTask} 
                style={{
                  marginLeft: '8px',
                  background: 'none',
                  border: 'none',
                  color: '#667eea',
                  fontSize: '16px',
                  cursor: 'pointer',
                  padding: '0 4px',
                  lineHeight: '1'
                }}
                title="Add task"
              >
                +
              </button>
            )}
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
                    
                    // Update the task AND reorder the array
                    let newTasks = [...tasks];
                    
                    // Remove the dragged task from its current position
                    const draggedIndex = newTasks.findIndex(t => t.id === draggedTask.id);
                    newTasks.splice(draggedIndex, 1);
                    
                    // Find where to insert it (relative to target in the ORIGINAL tasks array, not displayTasks)
                    const targetIndex = newTasks.findIndex(t => t.id === targetTask.id);
                    
                    // Insert BEFORE the target (so dropping ON a task puts it above that task)
                    newTasks.splice(targetIndex, 0, { ...draggedTask, parentId: newParentId });
                    
                    setTasks(newTasks);
                    saveTasks(newTasks);
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
                        : getDaysBetween(new Date(task.start), new Date(task.end)) + 1}
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
                        ({getDaysBetween(new Date(task.start), new Date(task.end)) + 1} days)
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
          <div className="timeline-grid" ref={gridRef}>
            {/* Column Grid Lines & Weekend Stripes */}
            <div className="grid-overlay">
              {dateColumns.map((date, i) => {
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                
                // Calculate which month this date belongs to for alternating colors
                let monthIndex = 0;
                let currentMonth = new Date(dateColumns[0].getFullYear(), dateColumns[0].getMonth());
                for (let j = 0; j <= i; j++) {
                  const checkDate = dateColumns[j];
                  if (checkDate.getMonth() !== currentMonth.getMonth() || checkDate.getFullYear() !== currentMonth.getFullYear()) {
                    monthIndex++;
                    currentMonth = new Date(checkDate.getFullYear(), checkDate.getMonth());
                  }
                }
                
                const monthBg = monthIndex % 2 === 0 ? 'rgba(0, 0, 0, 0.02)' : 'rgba(0, 0, 0, 0.05)';
                const weekendBg = 'rgba(0, 0, 0, 0.03)';
                
                return (
                  <div
                    key={i}
                    className="grid-column"
                    style={{
                      background: isWeekend ? weekendBg : monthBg
                    }}
                  />
                );
              })}
            </div>

            {/* Month Headers */}
            {/* Date Headers */}
            <div className="timeline-header-row">
              {dateColumns.map((date, i) => {
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                const prevDate = i > 0 ? dateColumns[i - 1] : null;
                
                return (
                  <div 
                    key={i} 
                    className={`timeline-date-header ${isWeekend ? 'weekend' : ''}`}
                  >
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
            {showDependencies && (
              <svg className="dependency-arrows-layer" style={{ 
                position: 'absolute', 
                top: 0, 
                left: 0, 
                width: '100%', 
                height: displayTasks.length * 50 + 40,
                pointerEvents: 'none',
                zIndex: 1
              }}>
                {dependencyArrows.map((arrow, i) => {
                const x1 = (arrow.fromX / 100) * gridWidth;
                const x2 = (arrow.toX / 100) * gridWidth;
                const y1 = arrow.fromY + 40; // offset for header
                const y2 = arrow.toY + 40;
                
                // Always use 90-degree angle path
                const midX = x1 + (x2 - x1) * 0.5;
                const pathData = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
                
                return (
                  <g key={i}>
                    <path
                      d={pathData}
                      stroke="#94a3b8"
                      strokeWidth="2"
                      fill="none"
                      opacity="0.6"
                    />
                  </g>
                );
              })}
              </svg>
            )}

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
                        backgroundColor: isMilestone ? 'transparent' : (isPhase ? 'white' : getTaskColor(task)),
                        border: isPhase ? `2px solid ${getTaskColor(task)}` : 'none',
                        cursor: compact || isPhase ? 'default' : 'grab',
                        borderLeft: hasDependencies && !isPhase ? '3px solid rgba(0, 0, 0, 0.2)' : (isPhase ? `2px solid ${getTaskColor(task)}` : 'none'),
                        display: isMilestone ? 'flex' : 'block',
                        alignItems: isMilestone ? 'center' : 'initial',
                        justifyContent: isMilestone ? 'center' : 'initial'
                      }}
                      onMouseDown={handleMouseDown}
                      onClick={handleBarClick}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Don't allow phases to have dependencies
                        if (task.type === 'phase') return;
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
                          {isPhase ? (
                            // Phase progress bar - light tint fill
                            <>
                              <div 
                                style={{ 
                                  position: 'absolute',
                                  left: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: `${task.progress}%`,
                                  backgroundColor: (() => {
                                    const hex = getTaskColor(task).replace('#', '');
                                    const r = parseInt(hex.substring(0, 2), 16);
                                    const g = parseInt(hex.substring(2, 4), 16);
                                    const b = parseInt(hex.substring(4, 6), 16);
                                    return `rgba(${r}, ${g}, ${b}, 0.15)`;
                                  })(),
                                  borderRadius: '4px 0 0 4px',
                                  zIndex: 0
                                }}
                              />
                              {!compact && position.width > 5 && (
                                <div 
                                  className="timeline-bar-label"
                                  style={{ 
                                    color: '#334155',
                                    fontWeight: '600',
                                    zIndex: 1,
                                    position: 'relative'
                                  }}
                                >
                                  {(() => {
                                    if (isPhase) console.log(`Rendering phase "${task.name}": ${task.progress}%`);
                                    return task.progress;
                                  })()}%
                                </div>
                              )}
                            </>
                          ) : (
                            // Regular task progress bar
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
                            </>
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
                                const duration = getDaysBetween(new Date(task.start), new Date(task.end)) + 1;
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
                            {getDaysBetween(new Date(task.start), new Date(task.end)) + 1}
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
            <input
              type="text"
              value={editingTask.name}
              onChange={(e) => setEditingTask({ ...editingTask, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.target.blur();
                }
              }}
              style={{ 
                width: '100%',
                fontSize: '24px',
                fontWeight: '600',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                outline: 'none',
                marginBottom: '16px'
              }}
              autoFocus={editingTask.isNew}
              onFocus={(e) => {
                if (editingTask.isNew) {
                  e.target.select();
                }
              }}
              placeholder="Task name"
            />

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

            {editingTask.type === 'phase' && (
              <label>
                Color:
                <input
                  type="color"
                  value={editingTask.color || '#667eea'}
                  onChange={(e) => setEditingTask({ ...editingTask, color: e.target.value })}
                  style={{
                    width: '100%',
                    height: '40px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1'
                  }}
                />
              </label>
            )}

            {editingTask.type !== 'event' && editingTask.type !== 'phase' && (
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
                      getDaysBetween(new Date(editingTask.start), new Date(editingTask.end)) + 1 : 1}
                    onChange={(e) => {
                      const days = parseInt(e.target.value) || 1;
                      const newEnd = new Date(editingTask.start);
                      newEnd.setDate(newEnd.getDate() + days - 1);
                      setEditingTask({ ...editingTask, end: newEnd.toISOString().split('T')[0] });
                    }}
                    disabled={editingTask.type === 'phase'}
                    style={{
                      width: '120px',
                      fontSize: '16px',
                      padding: '8px 12px',
                      textAlign: 'center'
                    }}
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

            {editingTask.type !== 'phase' && (
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
            )}

            {editingTask.type !== 'phase' && (
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
                  {tasks.filter(t => t.id !== editingTask.id && t.type !== 'phase').map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <small style={{ display: 'block', marginTop: '4px', color: '#6b7280' }}>
                  Hold Cmd/Ctrl to select multiple
                </small>
              </label>
            )}

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
            {tasks.filter(t => t.id !== contextMenu.taskId && t.type !== 'phase').map(t => {
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

      {/* Tighten Dependencies Modal */}
      {showTightenModal && (
        <div className="modal-overlay" onClick={() => setShowTightenModal(false)}>
          <div 
            className="modal-content wide" 
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '700px' }}
          >
            <div className="modal-header">
              <h2>⚡ Tighten Dependencies</h2>
              <button 
                type="button"
                className="modal-icon-btn"
                onClick={() => setShowTightenModal(false)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {tightenChanges.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
                  <p>All dependencies are already tight!</p>
                  <p style={{ fontSize: '13px', marginTop: '8px' }}>No gaps found between dependent tasks.</p>
                </div>
              ) : (
                <>
                  <p style={{ marginBottom: '16px', color: '#64748b', fontSize: '14px' }}>
                    The following tasks have gaps after their dependencies. Select which ones to tighten:
                  </p>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {tightenChanges.map(change => {
                      const isExcluded = tightenExclusions.has(change.taskId);
                      return (
                        <div
                          key={change.taskId}
                          style={{
                            padding: '12px',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            marginBottom: '8px',
                            backgroundColor: isExcluded ? '#f9fafb' : 'white',
                            opacity: isExcluded ? 0.6 : 1
                          }}
                        >
                          <label style={{ display: 'flex', gap: '12px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={(e) => {
                                const newExclusions = new Set(tightenExclusions);
                                if (e.target.checked) {
                                  newExclusions.delete(change.taskId);
                                } else {
                                  newExclusions.add(change.taskId);
                                }
                                setTightenExclusions(newExclusions);
                              }}
                              style={{ marginTop: '2px' }}
                            />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                                {change.taskName}
                              </div>
                              <div style={{ fontSize: '13px', color: '#64748b' }}>
                                <span style={{ color: '#ef4444', fontWeight: '500' }}>
                                  {change.gapDays} day gap
                                </span>
                                {' • '}
                                {change.taskType === 'milestone' || change.taskType === 'event' ? (
                                  <>
                                    {new Date(change.currentDates.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    {' → '}
                                    {new Date(change.newDates.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </>
                                ) : (
                                  <>
                                    {new Date(change.currentDates.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    {' → '}
                                    {new Date(change.newDates.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </>
                                )}
                              </div>
                            </div>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setShowTightenModal(false)}
                      style={{
                        padding: '8px 16px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        background: 'white',
                        color: '#64748b',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={applyTightenChanges}
                      disabled={tightenExclusions.size === tightenChanges.length}
                      style={{
                        padding: '8px 16px',
                        border: 'none',
                        borderRadius: '6px',
                        background: tightenExclusions.size === tightenChanges.length ? '#cbd5e1' : '#667eea',
                        color: 'white',
                        cursor: tightenExclusions.size === tightenChanges.length ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                    >
                      Apply Changes ({tightenChanges.length - tightenExclusions.size})
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomTimeline;
