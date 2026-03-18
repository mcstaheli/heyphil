import React, { useState, useEffect, useRef } from 'react';
import Gantt from 'frappe-gantt';
import './ProjectGantt.css';

function ProjectGantt({ projectId, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [viewMode, setViewMode] = useState('Day');
  const [editingTask, setEditingTask] = useState(null);
  const ganttRef = useRef(null);
  const ganttInstance = useRef(null);

  useEffect(() => {
    // Load tasks from API
    fetchTasks();
  }, [projectId]);

  useEffect(() => {
    if (tasks.length > 0 && ganttRef.current) {
      renderGantt();
    }
  }, [tasks, viewMode]);

  const fetchTasks = async () => {
    // TODO: Fetch from API
    // Mock data for now
    const mockTasks = [
      {
        id: '1',
        name: 'Phase 1: Diligence',
        start: '2026-03-01',
        end: '2026-03-15',
        progress: 80,
        dependencies: '',
        custom_class: 'phase'
      },
      {
        id: '2',
        name: 'Site Visit',
        start: '2026-03-01',
        end: '2026-03-03',
        progress: 100,
        dependencies: '',
        owner: 'Chad'
      },
      {
        id: '3',
        name: 'Document Review',
        start: '2026-03-04',
        end: '2026-03-08',
        progress: 100,
        dependencies: '2',
        owner: 'Tracy'
      },
      {
        id: '4',
        name: 'Financial Analysis',
        start: '2026-03-06',
        end: '2026-03-15',
        progress: 75,
        dependencies: '3',
        owner: 'Greg'
      },
      {
        id: '5',
        name: 'Phase 2: Financing',
        start: '2026-03-16',
        end: '2026-04-10',
        progress: 30,
        dependencies: '1',
        custom_class: 'phase'
      },
      {
        id: '6',
        name: 'Loan Application',
        start: '2026-03-16',
        end: '2026-03-20',
        progress: 100,
        dependencies: '5',
        owner: 'Tracy'
      },
      {
        id: '7',
        name: 'Underwriting',
        start: '2026-03-21',
        end: '2026-04-05',
        progress: 40,
        dependencies: '6',
        owner: 'Bank'
      },
      {
        id: '8',
        name: 'Approval',
        start: '2026-04-06',
        end: '2026-04-10',
        progress: 0,
        dependencies: '7',
        owner: 'Bank'
      }
    ];
    setTasks(mockTasks);
  };

  const renderGantt = () => {
    if (ganttInstance.current) {
      ganttInstance.current.refresh(tasks);
      ganttInstance.current.change_view_mode(viewMode);
    } else {
      ganttInstance.current = new Gantt(ganttRef.current, tasks, {
        view_mode: viewMode,
        on_click: (task) => {
          console.log('Clicked task:', task);
        },
        on_date_change: (task, start, end) => {
          console.log('Date changed:', task, start, end);
          updateTask(task.id, { start, end });
        },
        on_progress_change: (task, progress) => {
          console.log('Progress changed:', task, progress);
          updateTask(task.id, { progress });
        },
        on_view_change: (mode) => {
          console.log('View changed:', mode);
        },
        custom_popup_html: (task) => {
          return `
            <div class="gantt-popup">
              <h3>${task.name}</h3>
              <p><strong>Owner:</strong> ${task.owner || 'Unassigned'}</p>
              <p><strong>Progress:</strong> ${task.progress}%</p>
              <p><strong>Duration:</strong> ${task._start.toLocaleDateString()} - ${task._end.toLocaleDateString()}</p>
              ${task.dependencies ? `<p><strong>Depends on:</strong> Task #${task.dependencies}</p>` : ''}
              <button onclick="window.editTask('${task.id}')">Edit Task</button>
            </div>
          `;
        }
      });
    }
  };

  // Make editTask available globally for the custom popup
  window.editTask = (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      setEditingTask(task);
    }
  };

  const updateTask = (taskId, updates) => {
    setTasks(prevTasks =>
      prevTasks.map(task =>
        task.id === taskId ? { ...task, ...updates } : task
      )
    );
    // TODO: Save to API
  };

  const addTask = () => {
    const newTask = {
      id: String(tasks.length + 1),
      name: 'New Task',
      start: new Date().toISOString().split('T')[0],
      end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      progress: 0,
      dependencies: '',
      owner: ''
    };
    setTasks([...tasks, newTask]);
    setEditingTask(newTask);
  };

  const saveEditingTask = () => {
    if (editingTask) {
      updateTask(editingTask.id, editingTask);
      setEditingTask(null);
    }
  };

  const deleteTask = (taskId) => {
    if (window.confirm('Delete this task?')) {
      setTasks(tasks.filter(t => t.id !== taskId));
      setEditingTask(null);
    }
  };

  return (
    <div className="project-modal-overlay" onClick={onClose}>
      <div className="project-modal gantt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📅 Project Timeline</h2>
          <div className="gantt-controls">
            <select 
              value={viewMode} 
              onChange={(e) => setViewMode(e.target.value)}
              className="view-mode-select"
            >
              <option value="Day">Day</option>
              <option value="Week">Week</option>
              <option value="Month">Month</option>
            </select>
            <button onClick={addTask} className="add-task-btn">+ Add Task</button>
            <button onClick={onClose} className="close-btn">×</button>
          </div>
        </div>

        <div className="modal-body gantt-body">
          <div className="gantt-container">
            <svg ref={ganttRef}></svg>
          </div>

          {/* Task Edit Panel */}
          {editingTask && (
            <div className="task-edit-panel">
              <h3>Edit Task</h3>
              <div className="task-form">
                <label>
                  Task Name:
                  <input
                    type="text"
                    value={editingTask.name}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, name: e.target.value })
                    }
                  />
                </label>

                <label>
                  Owner:
                  <select
                    value={editingTask.owner || ''}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, owner: e.target.value })
                    }
                  >
                    <option value="">Unassigned</option>
                    <option value="Chad">Chad</option>
                    <option value="Tracy">Tracy</option>
                    <option value="Greg">Greg</option>
                    <option value="Scott">Scott</option>
                  </select>
                </label>

                <label>
                  Start Date:
                  <input
                    type="date"
                    value={editingTask.start}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, start: e.target.value })
                    }
                  />
                </label>

                <label>
                  End Date:
                  <input
                    type="date"
                    value={editingTask.end}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, end: e.target.value })
                    }
                  />
                </label>

                <label>
                  Progress:
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={editingTask.progress}
                    onChange={(e) =>
                      setEditingTask({
                        ...editingTask,
                        progress: parseInt(e.target.value)
                      })
                    }
                  />
                  <span>{editingTask.progress}%</span>
                </label>

                <label>
                  Dependencies (Task IDs, comma-separated):
                  <input
                    type="text"
                    value={editingTask.dependencies}
                    onChange={(e) =>
                      setEditingTask({
                        ...editingTask,
                        dependencies: e.target.value
                      })
                    }
                    placeholder="e.g. 1, 2, 3"
                  />
                </label>

                <div className="task-form-actions">
                  <button onClick={saveEditingTask} className="save-btn">
                    Save
                  </button>
                  <button
                    onClick={() => deleteTask(editingTask.id)}
                    className="delete-btn"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setEditingTask(null)}
                    className="cancel-btn"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProjectGantt;
