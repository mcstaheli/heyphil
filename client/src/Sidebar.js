import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

const LABS_APPS = [
  { path: '/labs/board', label: 'Project Board' },
  { path: '/labs/portfolio', label: 'Portfolio' },
  { path: '/labs/studio', label: 'Studio Board' },
  { path: '/labs/orgcharts', label: 'Org Charts' },
  { path: '/labs/cashflow', label: 'Cashflow', accessKey: 'cashflow' },
];

function Sidebar({ user, onLogout }) {
  const [labsOpen, setLabsOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [access, setAccess] = useState({});

  useEffect(() => {
    const gatedKeys = [...new Set(LABS_APPS.map((a) => a.accessKey).filter(Boolean))];
    const token = localStorage.getItem('authToken');
    gatedKeys.forEach((key) => {
      fetch(`${API_BASE_URL}/api/access/${key}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => setAccess((prev) => ({ ...prev, [key]: !!data.hasAccess })))
        .catch(() => setAccess((prev) => ({ ...prev, [key]: false })));
    });
  }, []);

  const visibleLabsApps = LABS_APPS.filter((app) => !app.accessKey || access[app.accessKey]);

  // Subcategories (the Labs links) only ever show as text, so they're
  // meaningless in the icon-only collapsed rail - clicking the Labs
  // heading while collapsed expands the sidebar back out instead of just
  // toggling the accordion in place.
  const handleLabsToggle = () => {
    if (collapsed) {
      setCollapsed(false);
      setLabsOpen(true);
    } else {
      setLabsOpen((open) => !open);
    }
  };

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-logo">
        {collapsed ? <span>🤖</span> : <span>✨ 🤖 HeyPhil</span>}
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="sidebar-nav">
        <button
          className="sidebar-group-toggle"
          onClick={handleLabsToggle}
          aria-expanded={labsOpen}
          title="Labs"
        >
          <span className="sidebar-link-icon">🧪</span>
          {!collapsed && (
            <>
              Labs
              <span className={`sidebar-chevron ${labsOpen ? 'open' : ''}`}>▸</span>
            </>
          )}
        </button>
        {!collapsed && labsOpen && (
          <div className="sidebar-group-items">
            {visibleLabsApps.map((app) => (
              <NavLink
                key={app.path}
                to={app.path}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              >
                {app.label}
              </NavLink>
            ))}
          </div>
        )}

        <NavLink
          to="/settings"
          className={({ isActive }) => `sidebar-link sidebar-top-link${isActive ? ' active' : ''}`}
          title="Settings"
        >
          <span className="sidebar-link-icon">⚙️</span>
          {!collapsed && 'Settings'}
        </NavLink>
      </nav>

      <div className="sidebar-user">
        {user?.picture && <img src={user.picture} alt={user.name} />}
        {!collapsed && (
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user?.name}</span>
          </div>
        )}
        <button className="sidebar-logout" onClick={onLogout} title="Logout">
          ⎋
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
