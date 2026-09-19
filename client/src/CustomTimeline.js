import React, { useState, useEffect, useRef } from 'react';
import './CustomTimeline.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function CustomTimeline({ projectId, compact = false, people = {}, activeLock = null }) {
  const [tasks, setTasks] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [timelineRange, setTimelineRange] = useState({ start: null, end: null });
  const [draggingTask, setDraggingTask] = useState(null);
  const [dragStartX, setDragStartX] = useState(null);
  const [dragStartDate, setDragStartDate] = useState(null);
  const [hasDragged, setHasDragged] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [reorderingTask, setReorderingTask] = useState(null);
  const [reorderTargetIndex, setReorderTargetIndex] = useState(null);
  const [reorderDropPosition, setReorderDropPosition] = useState('before'); // 'before' or 'after'
  const [phasePopover, setPhasePopover] = useState(null);
  const [collapsedPhases, setCollapsedPhases] = useState(new Set());
  const [ownerFilter, setOwnerFilter] = useState(null);
  const [showDependencies, setShowDependencies] = useState(true);
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const [showTightenModal, setShowTightenModal] = useState(false);
  const [tightenChanges, setTightenChanges] = useState([]);
  const [tightenExclusions, setTightenExclusions] = useState(new Set());
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [gridWidth, setGridWidth] = useState(1000);
  const [editingDaysTaskId, setEditingDaysTaskId] = useState(null);
  // Pixels per day column - the zoom level. Day columns used to just
  // divide whatever width was available equally (no fixed size, so more
  // days always meant thinner columns and the grid never scrolled); this
  // gives day columns a real pixel width instead, so zooming in actually
  // makes each day bigger (with horizontal scroll) rather than everything
  // just getting more cramped as a plan grows.
  const [dayWidth, setDayWidth] = useState(36);
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
    
    // Update on task changes (dragging)
    const timeout = setTimeout(updateGridWidth, 100);

    return () => {
      window.removeEventListener('resize', updateGridWidth);
      clearTimeout(timeout);
    };
  }, [tasks, draggingTask, dayWidth]);

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
          
          const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? parseLocalDate(depTask.date) : parseLocalDate(depTask.end);
          return depEnd > latest ? depEnd : latest;
        }, new Date(0));
        
        // Start the day after the dependency ends (no gap, no overlap)
        minStartDate = new Date(latestDepEndDate);
        minStartDate.setDate(minStartDate.getDate() + 1);
      }

      // Check successor constraints (latest we can end)
      const successors = tasks.filter(t => t.dependencies && t.dependencies.includes(task.id));
      if (successors.length > 0) {
        const earliestSuccessorStart = successors.reduce((earliest, successor) => {
          const succStart = (successor.type === 'milestone' || successor.type === 'event')
            ? parseLocalDate(successor.date)
            : parseLocalDate(successor.start);
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
              ? parseLocalDate(successor.date)
              : parseLocalDate(successor.start);
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
    const validatedTasks = tasksToValidate.map(task => {
      // Phases can't have dependencies
      if (task.type === 'phase' && task.dependencies && task.dependencies.length > 0) {
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
        console.warn(`Removing phase dependencies from task "${task.name}"`);
        task = { ...task, dependencies: nonPhaseDeps };
      }
      
      if (nonPhaseDeps.length === 0) return task;
      
      const latestEndDate = nonPhaseDeps.reduce((latest, depId) => {
        const depTask = tasksToValidate.find(t => t.id === depId);
        if (!depTask) return latest;
        
        const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? parseLocalDate(depTask.date) : parseLocalDate(depTask.end);
        return depEnd > latest ? depEnd : latest;
      }, new Date(0));

      latestEndDate.setDate(latestEndDate.getDate() + 1);

      const taskStart = (task.type === 'milestone' || task.type === 'event') ? parseLocalDate(task.date) : parseLocalDate(task.start);

      if (taskStart < latestEndDate) {
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
    
    return validatedTasks;
  };

  const loadTasks = async () => {
    if (!projectId) {
      console.warn('⚠️ loadTasks called with no projectId');
      setTasks([]);
      return;
    }

    try {
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

    // Captured before the request, same as LedgerModule's saveItems -
    // callers always setTasks(updatedTasks) immediately
    // before calling this, so `tasks` here (read before the first await)
    // is still this render's pre-update closure value, giving us
    // something to revert to if the save fails. Previously a failed save
    // just logged an error - the Gantt kept showing the unsaved change
    // with nothing telling the user it never actually landed.
    const previousTasks = tasks;

    try {
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

      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    } catch (error) {
      console.error('❌ Error saving timeline:', error);
      setTasks(previousTasks);
      window.alert('Could not save that timeline change - please try again.');
    }
  };

  const calculateTimelineRange = () => {
    const dates = tasks.flatMap(task => {
      if (task.type === 'milestone' || task.type === 'event') {
        return [parseLocalDate(task.date)];
      }
      return [parseLocalDate(task.start), parseLocalDate(task.end)];
    });

    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    // Add buffer
    minDate.setDate(minDate.getDate() - 3);
    maxDate.setDate(maxDate.getDate() + 7);

    setTimelineRange({ start: minDate, end: maxDate });
  };

  // Parses a "yyyy-mm-dd" date-only string as a LOCAL calendar date, not
  // UTC midnight. `new Date("2026-10-04")` is parsed as UTC midnight,
  // which in any timezone west of UTC (all of the US) is already the
  // previous calendar day locally - so a later .setHours(0,0,0,0) or
  // .getDate()/.setDate() on that object silently locks onto the wrong
  // day. Used anywhere a dependency's date needs +1 day added and then
  // gets turned back into a stored date string - getDaysBetween itself
  // doesn't need this, since it only computes a difference and the same
  // UTC-parse shift on both ends cancels out.
  const parseLocalDate = (dateOnlyString) => {
    const [year, month, day] = dateOnlyString.split('-').map(Number);
    return new Date(year, month - 1, day);
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
      startDate = parseLocalDate(task.date);
      endDate = parseLocalDate(task.date);
    } else {
      startDate = parseLocalDate(task.start);
      endDate = parseLocalDate(task.end);
    }
    
    // Normalize to start of day
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);

    const startOffset = getDaysBetween(timelineRange.start, startDate);
    const duration = (task.type === 'milestone' || task.type === 'event') ? 1 : getDaysBetween(startDate, endDate) + 1;

    // Every entity anchors to the MIDPOINT of the day(s) it occupies,
    // rather than the day's raw edges - milestones already worked this way
    // (a point centered on its day, not the day's boundary); bars now do
    // too, so a bar's left edge sits at the middle of its start day and its
    // right edge sits at the middle of its end day (a 1-day bar therefore
    // has zero width here - rendered as a small centered marker instead,
    // same idea as a milestone; see the bar JSX). Two things this fixes:
    // it puts bars and milestones on one consistent coordinate system, and
    // it guarantees real horizontal room between a predecessor's end-anchor
    // and a successor's start-anchor for the dependency line's elbow to
    // actually bend in, instead of both landing on the same pixel when the
    // successor starts the very next day (the tightest, and most common,
    // case).
    const isPoint = task.type === 'milestone' || task.type === 'event';
    const leftPercent = ((startOffset + 0.5) / totalDays) * 100;
    const widthPercent = isPoint ? 0 : ((duration - 1) / totalDays) * 100;

    return { left: leftPercent, width: widthPercent };
  };

  const formatDate = (date, prevDate = null, format = 'short') => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const weekdayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const isMonthStart = !prevDate || date.getMonth() !== prevDate.getMonth();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isToday = date.getTime() === today.getTime();

    if (format === 'short') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
          {isMonthStart ? (
            <div style={{ fontSize: '10px', color: '#667eea', fontWeight: '700', marginBottom: '2px' }}>
              {monthNames[date.getMonth()]}
            </div>
          ) : (
            <div style={{ fontSize: '9px', color: '#adb5bd', fontWeight: '600', marginBottom: '2px' }}>
              {weekdayLetters[date.getDay()]}
            </div>
          )}
          <div style={{
            fontSize: '13px',
            fontWeight: isToday ? '700' : '600',
            color: isToday ? '#667eea' : 'inherit',
            ...(isToday ? { background: '#e0e7ff', borderRadius: '9px', padding: '0 6px' } : {})
          }}>
            {date.getDate()}
          </div>
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

  const addTask = (parentPhaseId = null) => {
    const newTask = {
      id: String(Date.now()),
      name: 'New Name',
      type: 'task',
      start: new Date().toISOString().split('T')[0],
      end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      progress: 0,
      owner: '',
      dependencies: [],
      parentId: parentPhaseId
    };
    const updatedTasks = [...tasks, newTask];
    setTasks(updatedTasks);
    saveTasks(updatedTasks);
    setEditingTask({ ...newTask, isNew: true });
  };

  const addMilestone = () => {
    const newMilestone = {
      id: String(Date.now()),
      name: 'New Milestone',
      type: 'milestone',
      date: new Date().toISOString().split('T')[0],
      dependencies: [],
      parentId: null
    };
    const updatedTasks = [...tasks, newMilestone];
    setTasks(updatedTasks);
    saveTasks(updatedTasks);
    setEditingTask({ ...newMilestone, isNew: true });
  };

  const addPhase = (event) => {
    const newPhase = {
      id: String(Date.now()),
      name: 'New Section',
      type: 'phase',
      color: '#48bb78',
      start: new Date().toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0], // 0 days duration
      progress: 0
    };
    const updatedTasks = [...tasks, newPhase];
    setTasks(updatedTasks);
    saveTasks(updatedTasks);
    
    // Position modal near the button
    const buttonRect = event?.target?.getBoundingClientRect();
    setPhasePopover({
      taskId: newPhase.id,
      x: buttonRect ? buttonRect.right + 10 : 400,
      y: buttonRect ? buttonRect.top : 100
    });
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
        
        const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? parseLocalDate(depTask.date) : parseLocalDate(depTask.end);
        return depEnd > latest ? depEnd : latest;
      }, new Date(0));

      // Add one day buffer
      latestEndDate.setDate(latestEndDate.getDate() + 1);

      const taskStart = (task.type === 'milestone' || task.type === 'event') ? parseLocalDate(task.date) : parseLocalDate(task.start);

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

  // +1/-1 day from the stepper halves on the days badge. Won't shrink a
  // task past 1 day (end before start) - updateTask's own dependency
  // enforcement handles pushing the end date back out if this ever
  // shortened a task into violating a successor's constraint, same as any
  // other edit.
  const adjustTaskDuration = (task, delta) => {
    const newEnd = parseLocalDate(task.end);
    newEnd.setDate(newEnd.getDate() + delta);
    if (newEnd < parseLocalDate(task.start)) return;
    updateTask(task.id, { end: newEnd.toISOString().split('T')[0] });
  };

  // Calculate what would change if we tighten all dependencies (1 day gap,
  // same "day after" rule enforced everywhere else - getMinStartDate is the
  // single source of truth for it, reused here instead of recomputing it
  // with a separate, stale copy of the logic that previously allowed a
  // 0-day gap and let a tightened item land ON its dependency's last day).
  const calculateTightenChanges = () => {
    const changes = [];

    tasks.forEach(task => {
      if (!task.dependencies || task.dependencies.length === 0) return;
      if (task.type === 'phase') return; // Skip phases

      const minDateStr = getMinStartDate(task);
      if (!minDateStr) return;
      const minDate = parseLocalDate(minDateStr);

      const currentStart = (task.type === 'milestone' || task.type === 'event')
        ? parseLocalDate(task.date)
        : parseLocalDate(task.start);

      // If there's a gap, this task can be tightened
      if (currentStart > minDate) {
        const gapDays = getDaysBetween(minDate, currentStart);

        const newDates = {};
        if (task.type === 'milestone' || task.type === 'event') {
          newDates.date = minDateStr;
        } else {
          const duration = getDaysBetween(parseLocalDate(task.start), parseLocalDate(task.end)) + 1;
          const newEnd = new Date(minDate);
          newEnd.setDate(newEnd.getDate() + duration - 1);

          newDates.start = minDateStr;
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
    const appliedIds = [];

    tightenChanges.forEach(change => {
      if (tightenExclusions.has(change.taskId)) return; // Skip excluded tasks

      updatedTasks = updatedTasks.map(t => {
        if (t.id === change.taskId) {
          return { ...t, ...change.newDates };
        }
        return t;
      });
      appliedIds.push(change.taskId);
    });

    // Cascade each applied change in case tightening one task now pushes
    // it later than something that depends on it - same as any individual
    // edit via updateTask. Then persist: this used to only call
    // setTasks(), which updated the screen but never saved, so the
    // "tightened" dates silently reverted on the next load.
    appliedIds.forEach(id => {
      updatedTasks = cascadeDependencyChanges(updatedTasks, id);
    });

    setTasks(updatedTasks);
    saveTasks(updatedTasks);
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
      // Calculate new minimum start date based on all dependencies. Uses
      // parseLocalDate (not raw new Date()) for consistency with the rest
      // of the file - this specific spot happened to still produce the
      // right answer with raw parsing (never calling .setHours(0,0,0,0)
      // meant the UTC-midnight parse's day-early shift and toISOString's
      // day-late reconversion canceled out), but that's a fragile
      // coincidence one added .setHours() away from reproducing the exact
      // bug parseLocalDate exists to prevent.
      const latestEndDate = depTask.dependencies.reduce((latest, depId) => {
        const dep = updatedTasks.find(t => t.id === depId);
        if (!dep) return latest;

        const depEnd = (dep.type === 'milestone' || dep.type === 'event')
          ? parseLocalDate(dep.date)
          : parseLocalDate(dep.end);
        return depEnd > latest ? depEnd : latest;
      }, new Date(0));

      // Add one day buffer
      latestEndDate.setDate(latestEndDate.getDate() + 1);

      const currentStart = (depTask.type === 'milestone' || depTask.type === 'event')
        ? parseLocalDate(depTask.date)
        : parseLocalDate(depTask.start);

      // If the dependent task needs to be shifted
      if (currentStart < latestEndDate) {

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

  // Sections don't have their own dates/progress - they're only ever a
  // grouping over their children - so deleting one takes its children
  // with it, same as the budget-heading delete pattern elsewhere in this
  // app. The confirm message names the count so it's never a surprise.
  const deletePhase = (phaseId) => {
    const phase = tasks.find(t => t.id === phaseId);
    if (!phase) return;
    const childCount = tasks.filter(t => t.parentId === phaseId).length;
    const message = childCount > 0
      ? `Delete "${phase.name}" and its ${childCount} item${childCount === 1 ? '' : 's'}?`
      : `Delete "${phase.name}"?`;
    if (window.confirm(message)) {
      const updatedTasks = tasks.filter(t => t.id !== phaseId && t.parentId !== phaseId);
      setTasks(updatedTasks);
      saveTasks(updatedTasks);
      setPhasePopover(null);
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
    // Build hierarchy respecting array order
    // Sections appear where they are in the array, followed immediately by their children
    const hierarchy = [];
    const processed = new Set();
    
    calculatedTasks.forEach(task => {
      if (processed.has(task.id)) return;
      
      if (task.type === 'phase') {
        // Add section
        hierarchy.push(task);
        processed.add(task.id);
        
        // Immediately add all its children in array order - unless the
        // section is collapsed, in which case they're still marked
        // processed (so they don't get picked up as orphans below) but
        // left out of the row list entirely, which also naturally drops
        // any dependency arrows pointing at a now-hidden row.
        const isCollapsed = collapsedPhases.has(task.id);
        calculatedTasks.forEach(child => {
          if (child.parentId === task.id && !processed.has(child.id)) {
            processed.add(child.id);
            if (!isCollapsed) hierarchy.push(child);
          }
        });
      } else if (!task.parentId) {
        // Orphan task - add at current position
        hierarchy.push(task);
        processed.add(task.id);
      }
      // Child tasks already added under their parent
    });
    
    return hierarchy;
  };
  
  const displayTasks = organizeHierarchy();
  
  // A milestone/event always renders orange regardless of which section
  // it belongs to (getTaskColor), so coloring an arrow by its raw source
  // task made every dependency chained off a milestone look identical -
  // usually the majority of cross-section arrows, since a section's final
  // milestone is what the next section typically depends on. Coloring by
  // the source's OWNING SECTION instead keeps that distinction visible.
  const getArrowColor = (sourceTask) => {
    if (sourceTask.parentId) {
      const parent = tasks.find((t) => t.id === sourceTask.parentId);
      if (parent && parent.type === 'phase' && parent.color) return parent.color;
    }
    return getTaskColor(sourceTask);
  };

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
        // A milestone/event's `left` is the CENTER of its day column (it's
        // rendered as a diamond centered on a point, not a bar spanning a
        // range - see getTaskPosition), unlike a task/phase bar's `left`,
        // which is its actual left edge. Anchoring an arrow to a point
        // task needs a fixed pixel nudge off that center to reach the
        // diamond's actual rendered edge (applied in pixel space below,
        // after the percent->pixel conversion, since the diamond's size is
        // fixed regardless of zoom); anchoring to a bar just uses its edge
        // directly, same as before.
        const fromIsPoint = depTask.type === 'milestone' || depTask.type === 'event';
        const toIsPoint = task.type === 'milestone' || task.type === 'event';

        // Calculate row positions (50px per row)
        const fromY = depIndex * 50 + 25;
        const toY = taskIndex * 50 + 25;

        arrows.push({
          fromId: depTask.id,
          toId: task.id,
          fromX: fromIsPoint ? fromPos.left : fromPos.left + fromPos.width,
          fromY: fromY,
          toX: toPos.left,
          toY: toY,
          fromTask: depTask.name,
          toTask: task.name,
          color: getArrowColor(depTask),
          fromIsPoint,
          toIsPoint
        });
      });
    });
    
    return arrows;
  };
  
  const dependencyArrows = getDependencyArrows();

  // Critical Path Method, applied to the schedule's actual (already-dated)
  // tasks rather than computing dates from scratch: the target is the
  // furthest-out live milestone (same node "Days Remaining"/"Slippage"
  // anchor to elsewhere in the app), and a task is "critical" if it has
  // zero slack toward that target - i.e. delaying it by even one day
  // would push the target's date back too. Tasks that don't feed into
  // the target at all (a parallel section that doesn't block it) are
  // never critical, no matter how tight their own internal dependencies
  // are, since they don't determine when the target actually lands.
  const getCriticalPathIds = () => {
    const milestones = tasks.filter((t) => t.type === 'milestone' && t.date);
    if (!milestones.length) return new Set();
    const target = [...milestones].sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    const byId = new Map(tasks.map((t) => [t.id, t]));
    const taskDuration = (t) => {
      if (t.type === 'milestone' || t.type === 'event') return 1;
      return getDaysBetween(parseLocalDate(t.start), parseLocalDate(t.end)) + 1;
    };
    const taskStart = (t) => (t.type === 'milestone' || t.type === 'event' ? parseLocalDate(t.date) : parseLocalDate(t.start));
    const taskEnd = (t) => (t.type === 'milestone' || t.type === 'event' ? parseLocalDate(t.date) : parseLocalDate(t.end));

    // 1. Ancestor set R: everything the target transitively depends on,
    // plus the target itself. Only these can possibly be on its critical
    // path.
    const relevant = new Set([target.id]);
    const queue = [target.id];
    while (queue.length) {
      const t = byId.get(queue.shift());
      for (const depId of (t?.dependencies || [])) {
        if (byId.has(depId) && !relevant.has(depId)) {
          relevant.add(depId);
          queue.push(depId);
        }
      }
    }

    // 2. Topological sort of R (Kahn's algorithm, predecessor-before-
    // successor), then walk it in reverse so every task's successors
    // within R have their late-start already computed before this task's
    // late-finish is derived from them.
    const successorsWithin = new Map([...relevant].map((id) => [id, []]));
    const inDegree = new Map([...relevant].map((id) => [id, 0]));
    for (const id of relevant) {
      for (const depId of (byId.get(id).dependencies || [])) {
        if (relevant.has(depId)) {
          successorsWithin.get(depId).push(id);
          inDegree.set(id, inDegree.get(id) + 1);
        }
      }
    }
    const topo = [];
    const ready = [...relevant].filter((id) => inDegree.get(id) === 0);
    while (ready.length) {
      const id = ready.shift();
      topo.push(id);
      for (const succId of successorsWithin.get(id)) {
        inDegree.set(succId, inDegree.get(succId) - 1);
        if (inDegree.get(succId) === 0) ready.push(succId);
      }
    }

    // 3. Backward pass: late-finish/late-start per task, starting at the
    // target (whose late-finish is pinned to its own actual date - no
    // slack is "allowed" past the real target) and working back through
    // predecessors.
    const lateFinish = new Map();
    const lateStart = new Map();
    for (const id of [...topo].reverse()) {
      const t = byId.get(id);
      const successors = successorsWithin.get(id);
      let lf;
      if (id === target.id || successors.length === 0) {
        lf = taskEnd(t);
      } else {
        lf = successors.reduce((min, succId) => {
          const candidate = new Date(lateStart.get(succId));
          candidate.setDate(candidate.getDate() - 1);
          return min === null || candidate < min ? candidate : min;
        }, null);
      }
      lateFinish.set(id, lf);
      const isPoint = t.type === 'milestone' || t.type === 'event';
      const ls = new Date(lf);
      if (!isPoint) ls.setDate(ls.getDate() - taskDuration(t) + 1);
      lateStart.set(id, ls);
    }

    // 4. Zero slack (late start === actual/early start) means critical.
    const criticalIds = new Set();
    for (const id of relevant) {
      const t = byId.get(id);
      const slackDays = Math.round((lateStart.get(id) - taskStart(t)) / (1000 * 60 * 60 * 24));
      if (slackDays <= 0) criticalIds.add(id);
    }
    return criticalIds;
  };

  const criticalPathIds = showCriticalPath ? getCriticalPathIds() : new Set();

  // Routes a dependency line with a short fixed-length stub off each
  // endpoint (instead of bending at the midpoint between them) so the
  // vertical run sits close to whichever bar it's attached to. Bending at
  // the midpoint made every line's vertical segment land wherever its own
  // from/to X happened to average out - lines with similar time ranges but
  // totally unrelated rows would converge on nearly the same X and run
  // parallel through several rows, unreadable. Corners are rounded and the
  // path stops a few px short of the target for the arrowhead marker.
  const buildDependencyPath = (x1, y1, x2, y2) => {
    const targetX = x2 - 6;
    if (Math.abs(y2 - y1) < 1) return `M ${x1} ${y1} L ${targetX} ${y1}`;

    const gap = Math.max(targetX - x1, 2);
    const stub = Math.min(14, gap * 0.4);
    const corner = Math.min(8, gap * 0.3, Math.abs(y2 - y1) / 2);
    const turnX = x1 + stub;
    const dir = y2 > y1 ? 1 : -1;

    return [
      `M ${x1} ${y1}`,
      `L ${Math.max(x1, turnX - corner)} ${y1}`,
      `Q ${turnX} ${y1} ${turnX} ${y1 + corner * dir}`,
      `L ${turnX} ${y2 - corner * dir}`,
      `Q ${turnX} ${y2} ${Math.min(targetX, turnX + corner)} ${y2}`,
      `L ${targetX} ${y2}`
    ].join(' ');
  };

  // Get minimum allowed start date for a task based on dependencies
  const getMinStartDate = (task) => {
    if (!task.dependencies || task.dependencies.length === 0) return null;
    
    const latestDepEndDate = task.dependencies.reduce((latest, depId) => {
      const depTask = tasks.find(t => t.id === depId);
      if (!depTask) return latest;
      
      const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? parseLocalDate(depTask.date) : parseLocalDate(depTask.end);
      return depEnd > latest ? depEnd : latest;
    }, new Date(0));

    // Add one day buffer
    const minDate = new Date(latestDepEndDate);
    minDate.setDate(minDate.getDate() + 1);
    
    return minDate.toISOString().split('T')[0];
  };

  // Get unique owners for filter
  const uniqueOwners = [...new Set(tasks.filter(t => t.owner).map(t => t.owner))].sort();

  // --- Per-row slippage (vs. whichever lock TimelineModule's picker has
  // active) ---------------------------------------------------------------
  // Older locks only have `.milestones`, not a full `.tasks` snapshot, so
  // this quietly renders nothing for those rather than erroring.
  const lockedTasksById = new Map((activeLock?.tasks || []).map((t) => [t.id, t]));

  // Signed day difference between two date-only strings - positive means
  // `toIso` is later than `fromIso`. getDaysBetween (used for durations and
  // bar positioning elsewhere in this file) always returns an unsigned
  // value, since direction doesn't matter there; slippage needs the sign
  // to tell an extension (red) from a pull-in (green).
  const signedDaysBetween = (fromIso, toIso) => {
    const ms = parseLocalDate(toIso) - parseLocalDate(fromIso);
    return Math.round(ms / (1000 * 60 * 60 * 24));
  };

  // A section has no date of its own - live, it's derived from its
  // children by calculatePhaseMetrics above. Its locked baseline needs the
  // same aggregation run against the locked children instead.
  const getLockedPhaseEnd = (phaseId) => {
    const lockedChildren = (activeLock?.tasks || []).filter((t) => t.parentId === phaseId);
    if (!lockedChildren.length) return null;
    return lockedChildren.reduce((latest, c) => {
      const d = (c.type === 'milestone' || c.type === 'event') ? c.date : c.end;
      return (!latest || d > latest) ? d : latest;
    }, null);
  };

  // Small red/green numbered badge next to a task/section's duration
  // showing how many days it slipped or pulled in versus the active lock -
  // null (nothing rendered) if there's no lock, the row didn't exist at
  // lock time, or it's unchanged.
  const renderSlippageBadge = (task) => {
    if (!activeLock) return null;

    let liveEnd, lockedEnd;
    if (task.type === 'phase') {
      liveEnd = task.end;
      lockedEnd = getLockedPhaseEnd(task.id);
    } else {
      const lockedTask = lockedTasksById.get(task.id);
      if (!lockedTask) return null;
      liveEnd = (task.type === 'milestone' || task.type === 'event') ? task.date : task.end;
      lockedEnd = (lockedTask.type === 'milestone' || lockedTask.type === 'event') ? lockedTask.date : lockedTask.end;
    }
    if (!liveEnd || !lockedEnd) return null;

    const delta = signedDaysBetween(lockedEnd, liveEnd);
    if (delta === 0) return null;

    const isOver = delta > 0;
    const lockName = activeLock.name || `locked ${new Date(activeLock.lockedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const label = `${isOver ? '+' : ''}${delta} day${Math.abs(delta) === 1 ? '' : 's'} vs "${lockName}"`;
    return (
      <span
        title={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '1px 6px',
          borderRadius: '10px',
          backgroundColor: isOver ? '#fee2e2' : '#dcfce7',
          color: isOver ? '#dc2626' : '#16a34a',
          fontSize: '10px',
          fontWeight: '700',
          flexShrink: 0
        }}
      >
        {isOver ? '+' : ''}{delta}d
      </span>
    );
  };

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
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: '#64748b',
              userSelect: 'none'
            }}>
              <span title="Zoom">🔍</span>
              <input
                type="range"
                min="24"
                max="80"
                step="2"
                value={dayWidth}
                onChange={(e) => setDayWidth(Number(e.target.value))}
                style={{ width: '90px', cursor: 'pointer' }}
                title={`${dayWidth}px per day`}
              />
            </label>
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
                checked={showCriticalPath}
                onChange={(e) => setShowCriticalPath(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span title="The chain of tasks with zero slack toward the final milestone - delaying any of them pushes the end date back too">🔥 Critical Path</span>
            </label>
          </div>
        </div>
      )}

      {!compact && tasks.length === 0 && (
        <div style={{ padding: '8px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic', background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
          Start with the milestone you're working toward, then add tasks that lead up to it
        </div>
      )}

      <div className="timeline-container">
        {/* Task List Column */}
        <div className="timeline-tasks-column">
          <div className="timeline-header-cell">
            {!compact && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => addMilestone()}
                  style={{
                    padding: '4px 10px',
                    background: '#f59e0b',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                  title="Add new milestone"
                >
                  🏁 New Milestone
                </button>
                <button
                  onClick={(e) => addPhase(e)}
                  style={{
                    padding: '4px 10px',
                    background: '#667eea',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                  title="Add new section"
                >
                  New Section
                </button>
                <button
                  onClick={() => addTask()}
                  style={{
                    padding: '4px 10px',
                    background: 'white',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    color: '#475569',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                  title="Add new item"
                >
                  New Item
                </button>
              </div>
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

            return (
              <div 
                key={task.id} 
                className={`timeline-task-row ${task.type} ${task.parentId ? 'child-task' : ''} ${reorderingTask === task.id ? 'reordering' : ''} ${reorderTargetIndex === taskIndex ? `drop-target-${reorderDropPosition}` : ''}`}
                style={(() => {
                  // If owner filter is active and this task doesn't match, make it light gray
                  if (ownerFilter && task.owner !== ownerFilter) {
                    return { backgroundColor: '#f9fafb' };
                  }
                  
                  // Milestone rows get a light orange tint to set them apart -
                  // checked before the phase/child-task CSS classes below,
                  // since a milestone nested in a section is also a
                  // "child-task" and that class's background would otherwise
                  // win the cascade and silently hide this highlight.
                  if (task.type === 'milestone') {
                    return { backgroundColor: '#ffedd5' };
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
                  
                  // Determine if we're in the top or bottom half of the row
                  const rect = e.currentTarget.getBoundingClientRect();
                  const mouseY = e.clientY - rect.top;
                  const isTopHalf = mouseY < rect.height / 2;
                  
                  setReorderTargetIndex(taskIndex);
                  setReorderDropPosition(isTopHalf ? 'before' : 'after');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (reorderingTask && reorderTargetIndex !== null) {
                    const draggedTask = tasks.find(t => t.id === reorderingTask);
                    const targetTask = displayTasks[reorderTargetIndex];
                    
                    if (!draggedTask || !targetTask || draggedTask.id === targetTask.id) {
                      setReorderingTask(null);
                      setReorderTargetIndex(null);
                      setReorderDropPosition('before');
                      return;
                    }
                    
                    // Can't drag a phase into its own children
                    if (draggedTask.type === 'phase' && targetTask.parentId === draggedTask.id) {
                      setReorderingTask(null);
                      setReorderTargetIndex(null);
                      setReorderDropPosition('before');
                      return;
                    }
                    
                    // Determine new parent based on target and drop position
                    let newParentId = null;
                    
                    if (targetTask.type === 'phase') {
                      // Dropping on a section
                      if (reorderDropPosition === 'after') {
                        // Bottom half of section → make it a child of the section
                        newParentId = targetTask.id;
                      } else {
                        // Top half of section → keep at top level (no parent)
                        newParentId = null;
                      }
                    } else {
                      // Dropping on a regular task → inherit its parent
                      newParentId = targetTask.parentId || null;
                    }
                    
                    // Update the task AND reorder the array
                    let newTasks = [...tasks];
                    
                    // Remove the dragged task from its current position
                    const draggedIndex = newTasks.findIndex(t => t.id === draggedTask.id);
                    newTasks.splice(draggedIndex, 1);
                    
                    // Find where to insert it (relative to target in the ORIGINAL tasks array, not displayTasks)
                    const targetIndex = newTasks.findIndex(t => t.id === targetTask.id);
                    
                    // Insert based on drop position (before or after the target)
                    const insertIndex = reorderDropPosition === 'after' ? targetIndex + 1 : targetIndex;
                    newTasks.splice(insertIndex, 0, { ...draggedTask, parentId: newParentId });
                    
                    setTasks(newTasks);
                    saveTasks(newTasks);
                  }
                  setReorderingTask(null);
                  setReorderTargetIndex(null);
                  setReorderDropPosition('before');
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
                      setReorderDropPosition('before');
                    }}
                    title="Drag to reorder"
                  >
                    ⋮⋮
                  </div>
                )}
                
                <div className="task-row-content" style={{
                  opacity: ownerFilter && task.owner !== ownerFilter ? 0.4 : 1
                }}>
                  {/* Days Badge - Inline Editable */}
                  {task.type !== 'phase' && (task.start || task.date) && (() => {
                    const days = task.type === 'milestone' || task.type === 'event' 
                      ? 1
                      : getDaysBetween(new Date(task.start), new Date(task.end)) + 1;
                    
                    const isEditing = editingDaysTaskId === task.id;
                    const canEdit = !compact && task.type !== 'milestone' && task.type !== 'event';
                    
                    return (
                      <div style={{ marginRight: '8px' }}>
                        {isEditing ? (
                          <input
                            type="number"
                            min="1"
                            defaultValue={days}
                            autoFocus
                            onFocus={(e) => e.target.select()}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const newDays = Math.max(1, parseInt(e.target.value) || 1);
                                const newEndDate = new Date(task.start);
                                newEndDate.setDate(newEndDate.getDate() + newDays - 1);
                                updateTask(task.id, {
                                  end: newEndDate.toISOString().split('T')[0]
                                });
                                setEditingDaysTaskId(null);
                              } else if (e.key === 'Escape') {
                                setEditingDaysTaskId(null);
                              }
                            }}
                            onBlur={(e) => {
                              const newDays = Math.max(1, parseInt(e.target.value) || days);
                              if (newDays !== days) {
                                const newEndDate = new Date(task.start);
                                newEndDate.setDate(newEndDate.getDate() + newDays - 1);
                                updateTask(task.id, {
                                  end: newEndDate.toISOString().split('T')[0]
                                });
                              }
                              setEditingDaysTaskId(null);
                            }}
                            style={{
                              width: '50px',
                              padding: '4px 8px',
                              borderRadius: '10px',
                              border: '1px solid #cbd5e1',
                              fontSize: '10px',
                              fontWeight: '600',
                              textAlign: 'center'
                            }}
                          />
                        ) : (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (canEdit) {
                                setEditingDaysTaskId(task.id);
                              }
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              cursor: canEdit ? 'pointer' : 'default',
                              minWidth: '70px'
                            }}
                            title={canEdit ? 'Click to edit duration' : undefined}
                          >
                            <div className="task-days-badge" style={{ minWidth: '32px' }}>
                              {days}
                              {canEdit && (
                                <>
                                  <button
                                    type="button"
                                    className="days-stepper-half days-stepper-up"
                                    onClick={(e) => { e.stopPropagation(); adjustTaskDuration(task, 1); }}
                                    title="Add a day"
                                  >
                                    <span className="days-stepper-caret">▲</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="days-stepper-half days-stepper-down"
                                    onClick={(e) => { e.stopPropagation(); adjustTaskDuration(task, -1); }}
                                    title="Remove a day"
                                  >
                                    <span className="days-stepper-caret">▼</span>
                                  </button>
                                </>
                              )}
                            </div>
                            <span style={{
                              fontSize: '11px',
                              color: '#9ca3af',
                              fontWeight: '500'
                            }}>
                              {days === 1 ? 'Day' : 'Days'}
                            </span>
                            {renderSlippageBadge(task)}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  
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
                    {criticalPathIds.has(task.id) && (
                      <span
                        title="On the critical path - delaying this pushes back the final milestone"
                        style={{ marginLeft: '6px', fontSize: '11px' }}
                      >
                        🔥
                      </span>
                    )}
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
                    {task.type === 'phase' && (
                      <span style={{ marginLeft: '6px' }}>{renderSlippageBadge(task)}</span>
                    )}
                    {task.type === 'phase' && collapsedPhases.has(task.id) && (
                      <span style={{ marginLeft: '8px', color: '#9ca3af', fontSize: '11px', fontStyle: 'italic' }}>
                        {calculatedTasks.filter(t => t.parentId === task.id).length} item{calculatedTasks.filter(t => t.parentId === task.id).length === 1 ? '' : 's'} hidden
                      </span>
                    )}
                    {task.type === 'phase' && !compact && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addTask(task.id);
                        }}
                        style={{
                          marginLeft: '12px',
                          background: '#667eea',
                          border: 'none',
                          borderRadius: '6px',
                          color: 'white',
                          fontSize: '16px',
                          cursor: 'pointer',
                          padding: '2px 10px',
                          fontWeight: '600',
                          lineHeight: '1',
                          boxShadow: '0 1px 3px rgba(102, 126, 234, 0.3)'
                        }}
                        title="Add item to this section"
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
                {task.type === 'phase' && !compact && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsedPhases(prev => {
                        const next = new Set(prev);
                        if (next.has(task.id)) next.delete(task.id); else next.add(task.id);
                        return next;
                      });
                    }}
                    style={{
                      marginLeft: 'auto',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#6c757d',
                      fontSize: '18px',
                      padding: '0 8px',
                      lineHeight: '1',
                      flexShrink: 0
                    }}
                    title={collapsedPhases.has(task.id) ? 'Expand section' : 'Collapse section'}
                  >
                    {collapsedPhases.has(task.id) ? '▸' : '▾'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Timeline Grid */}
        <div className="timeline-grid-wrapper">
          <div className="timeline-grid" ref={gridRef} style={{ minWidth: '100%', width: `${dateColumns.length * dayWidth}px` }}>
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
                      flex: `0 0 ${dayWidth}px`,
                      width: `${dayWidth}px`,
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
                    style={{ flex: `0 0 ${dayWidth}px`, width: `${dayWidth}px` }}
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
                // Fixed pixel half-width of the 26px rotated-square diamond
                // (26 * sqrt(2) / 2 ~= 18.4px), independent of zoom - the
                // percent-based from/to X only gets us to the diamond's
                // CENTER, so a point endpoint needs this nudged onto its
                // actual rendered edge before building the path.
                const DIAMOND_EDGE = 18;
                let x1 = (arrow.fromX / 100) * gridWidth;
                let x2 = (arrow.toX / 100) * gridWidth;
                if (arrow.fromIsPoint) x1 += DIAMOND_EDGE;
                if (arrow.toIsPoint) x2 -= DIAMOND_EDGE;
                const y1 = arrow.fromY + 40; // offset for header
                const y2 = arrow.toY + 40;
                const pathData = buildDependencyPath(x1, y1, x2, y2);

                return (
                  <g key={i}>
                    <path
                      d={pathData}
                      stroke={arrow.color}
                      strokeWidth="2"
                      fill="none"
                      opacity="0.6"
                    />
                  </g>
                );
              })}
              {/* Critical-path edges redrawn bold on top, same geometry -
                  a second pass instead of branching the loop above so a
                  critical edge is never visually buried under a merely
                  adjacent one. */}
              {showCriticalPath && dependencyArrows.map((arrow, i) => {
                if (!criticalPathIds.has(arrow.fromId) || !criticalPathIds.has(arrow.toId)) return null;
                const DIAMOND_EDGE = 18;
                let x1 = (arrow.fromX / 100) * gridWidth;
                let x2 = (arrow.toX / 100) * gridWidth;
                if (arrow.fromIsPoint) x1 += DIAMOND_EDGE;
                if (arrow.toIsPoint) x2 -= DIAMOND_EDGE;
                const y1 = arrow.fromY + 40;
                const y2 = arrow.toY + 40;
                const pathData = buildDependencyPath(x1, y1, x2, y2);

                return (
                  <path
                    key={`critical-${i}`}
                    d={pathData}
                    stroke="#dc2626"
                    strokeWidth="3"
                    fill="none"
                    opacity="0.85"
                  />
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
              const isCritical = criticalPathIds.has(task.id);

              const handleMouseDown = (e) => {
                if (compact) return;
                if (isPhase) return; // Phases are read-only, no dragging
                e.preventDefault();
                e.stopPropagation();
                
                setHasDragged(false); // Reset drag flag at start of new drag
                setDraggingTask(task.id);
                setDragStartX(e.clientX);
                setDragStartDate((task.type === 'milestone' || task.type === 'event') ? parseLocalDate(task.date) : parseLocalDate(task.start));
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
                  {/* Percentage indicator - positioned to the right of the bar */}
                  {!isMilestone && !isEvent && !compact && (
                    <div
                      style={{
                        position: 'absolute',
                        left: `calc(${position.left}% + ${position.width}% + 8px)`,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '11px',
                        fontWeight: '600',
                        color: isPhase ? '#6b7280' : '#9ca3af',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        zIndex: 5
                      }}
                    >
                      {task.progress || 0}%
                    </div>
                  )}
                  
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
                        // A 1-day task/phase bar now computes to 0% width
                        // (its start and end midpoints are the same point -
                        // see getTaskPosition), so it needs the same
                        // "small centered marker" treatment milestones
                        // already get, rather than rendering invisibly thin.
                        left: isMilestone
                          ? `calc(${position.left}% - 20px)`
                          : (position.width > 0 ? `${position.left}%` : `calc(${position.left}% - 5px)`),
                        width: isMilestone ? '40px' : (position.width > 0 ? `${position.width}%` : '10px'),
                        backgroundColor: isMilestone ? 'transparent' : (isPhase ? (() => {
                          const hex = getTaskColor(task).replace('#', '');
                          const r = parseInt(hex.substring(0, 2), 16);
                          const g = parseInt(hex.substring(2, 4), 16);
                          const b = parseInt(hex.substring(4, 6), 16);
                          return `rgba(${r}, ${g}, ${b}, 0.08)`;
                        })() : getTaskColor(task)),
                        border: isCritical && !isMilestone
                          ? '2px solid #dc2626'
                          : (isPhase ? `1px solid ${getTaskColor(task)}` : 'none'),
                        borderLeftColor: isPhase ? getTaskColor(task) : (hasDependencies && !isPhase ? 'rgba(0, 0, 0, 0.2)' : 'transparent'),
                        cursor: compact || isPhase ? 'default' : 'grab',
                        display: isMilestone ? 'flex' : 'block',
                        alignItems: isMilestone ? 'center' : 'initial',
                        justifyContent: isMilestone ? 'center' : 'initial',
                        // The default 30px row height + overflow:hidden (below)
                        // would clip a rotated-square diamond's corners, which
                        // extend past its own 26px width/height once rotated.
                        overflow: isMilestone ? 'visible' : 'hidden',
                        boxShadow: isCritical && !isMilestone ? '0 0 0 1px rgba(220, 38, 38, 0.3)' : (isMilestone ? 'none' : undefined)
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
                          className="event-diamond"
                          style={{
                            width: '26px',
                            height: '26px',
                            backgroundColor: getTaskColor(task),
                            border: isCritical ? '3px solid #dc2626' : undefined,
                            boxShadow: isCritical ? '0 0 0 2px rgba(220, 38, 38, 0.3), 0 3px 6px rgba(0, 0, 0, 0.15)' : undefined
                          }}
                        />
                      )}
                      {!isMilestone && !isEvent && (
                        <>
                          {isPhase ? (
                            // Phase progress bar - darker accent fill
                            <div 
                              style={{ 
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: `${task.progress || 0}%`,
                                backgroundColor: (() => {
                                  const hex = getTaskColor(task).replace('#', '');
                                  const r = parseInt(hex.substring(0, 2), 16);
                                  const g = parseInt(hex.substring(2, 4), 16);
                                  const b = parseInt(hex.substring(4, 6), 16);
                                  return `rgba(${r}, ${g}, ${b}, 0.25)`;
                                })(),
                                borderRadius: '4px 0 0 4px',
                                zIndex: 0
                              }}
                            />
                          ) : (
                            // Regular task progress bar
                            <div 
                              className="timeline-bar-progress"
                              style={{ 
                                width: `${task.progress || 0}%`,
                                backgroundColor: `color-mix(in srgb, ${getTaskColor(task)} 80%, black)`
                              }}
                            />
                          )}
                        </>
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
                <option value="milestone">Milestone</option>
                <option value="event">Event</option>
              </select>
            </label>

            <label>
              Parent Section:
              <select
                value={editingTask.parentId || ''}
                onChange={(e) => setEditingTask({ ...editingTask, parentId: e.target.value || null })}
              >
                <option value="">None (top-level)</option>
                {tasks.filter(t => t.type === 'phase').map(phase => (
                  <option key={phase.id} value={phase.id}>
                    {phase.name}
                  </option>
                ))}
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

            {editingTask.type !== 'event' && editingTask.type !== 'phase' && editingTask.type !== 'milestone' && (
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
                  {editingTask.dependencies && editingTask.dependencies.length > 0 && editingTask.type !== 'phase' && editingTask.start < getMinStartDate(editingTask) && (
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
                {editingTask.dependencies && editingTask.dependencies.length > 0 && editingTask.date < getMinStartDate(editingTask) && (
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
                    const updated = { ...editingTask, dependencies: selected };

                    // Nudge (don't force) the date forward the moment a
                    // dependency would put it in the past - to the day
                    // after that dependency's last day - rather than
                    // leaving an invalid date sitting there until Save.
                    const minDate = getMinStartDate(updated);
                    if (minDate) {
                      const isPoint = updated.type === 'milestone' || updated.type === 'event';
                      const currentDate = isPoint ? updated.date : updated.start;
                      if (!currentDate || currentDate < minDate) {
                        if (isPoint) {
                          updated.date = minDate;
                        } else {
                          const duration = getDaysBetween(new Date(updated.start), new Date(updated.end));
                          updated.start = minDate;
                          const newEnd = new Date(minDate);
                          newEnd.setDate(newEnd.getDate() + duration);
                          updated.end = newEnd.toISOString().split('T')[0];
                        }
                      }
                    }

                    setEditingTask(updated);
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
                    
                    const depEnd = (depTask.type === 'milestone' || depTask.type === 'event') ? parseLocalDate(depTask.date) : parseLocalDate(depTask.end);
                    return depEnd > latest ? depEnd : latest;
                  }, new Date(0));

                  const taskStart = (editingTask.type === 'milestone' || editingTask.type === 'event') ? parseLocalDate(editingTask.date) : parseLocalDate(editingTask.start);
                  
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

      {/* Section Settings Popover */}
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
                    Edit Section
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
                    onClick={() => deletePhase(phase.id)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      background: 'white',
                      color: '#ef4444',
                      border: '1px solid #ef4444',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '500',
                      marginBottom: '8px'
                    }}
                  >
                    Delete Section
                  </button>

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
                                    {parseLocalDate(change.currentDates.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    {' → '}
                                    {parseLocalDate(change.newDates.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </>
                                ) : (
                                  <>
                                    {parseLocalDate(change.currentDates.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    {' → '}
                                    {parseLocalDate(change.newDates.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
