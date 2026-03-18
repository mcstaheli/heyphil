import React, { useState, useEffect, useRef } from 'react';
import Gantt from 'frappe-gantt';
import './ProjectGanttEmbed.css';

function ProjectGanttEmbed({ projectId }) {
  const [tasks, setTasks] = useState([]);
  const [viewMode, setViewMode] = useState('Week');
  const ganttRef = useRef(null);
  const ganttInstance = useRef(null);

  useEffect(() => {
    fetchTasks();
  }, [projectId]);

  useEffect(() => {
    if (tasks.length > 0 && ganttRef.current) {
      renderGantt();
    }
  }, [tasks, viewMode]);

  const fetchTasks = async () => {
    // TODO: Fetch from API
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
        custom_popup_html: (task) => {
          return `
            <div class="gantt-popup-embed">
              <h3>${task.name}</h3>
              <p><strong>Owner:</strong> ${task.owner || 'Unassigned'}</p>
              <p><strong>Progress:</strong> ${task.progress}%</p>
              <p><strong>Duration:</strong> ${task._start.toLocaleDateString()} - ${task._end.toLocaleDateString()}</p>
            </div>
          `;
        }
      });
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

  return (
    <div className="gantt-embed-container">
      <div className="gantt-embed-controls">
        <select 
          value={viewMode} 
          onChange={(e) => setViewMode(e.target.value)}
          className="view-mode-select-embed"
        >
          <option value="Day">Day</option>
          <option value="Week">Week</option>
          <option value="Month">Month</option>
        </select>
      </div>
      <div className="gantt-embed-chart">
        <svg ref={ganttRef}></svg>
      </div>
    </div>
  );
}

export default ProjectGanttEmbed;
