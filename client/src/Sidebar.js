import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const LABS_APPS = [
  { path: '/labs/board', icon: '📋', label: 'Project Board' },
  { path: '/labs/studio', icon: '🎬', label: 'Studio Board' },
  { path: '/labs/orgcharts', icon: '📊', label: 'Org Charts' },
];

function Sidebar({ user, onLogout }) {
  const [labsOpen, setLabsOpen] = useState(true);

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <span>✨ 🤖 HeyPhil</span>
      </div>

      <nav className="sidebar-nav">
        <button
          className="sidebar-group-toggle"
          onClick={() => setLabsOpen((open) => !open)}
          aria-expanded={labsOpen}
        >
          <span className={`sidebar-chevron ${labsOpen ? 'open' : ''}`}>▸</span>
          Labs
        </button>
        {labsOpen && (
          <div className="sidebar-group-items">
            {LABS_APPS.map((app) => (
              <NavLink
                key={app.path}
                to={app.path}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              >
                <span className="sidebar-link-icon">{app.icon}</span>
                {app.label}
              </NavLink>
            ))}
          </div>
        )}

        <NavLink
          to="/settings"
          className={({ isActive }) => `sidebar-link sidebar-top-link${isActive ? ' active' : ''}`}
        >
          <span className="sidebar-link-icon">⚙️</span>
          Settings
        </NavLink>
      </nav>

      <div className="sidebar-user">
        {user?.picture && <img src={user.picture} alt={user.name} />}
        <div className="sidebar-user-info">
          <span className="sidebar-user-name">{user?.name}</span>
        </div>
        <button className="sidebar-logout" onClick={onLogout} title="Logout">
          ⎋
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
