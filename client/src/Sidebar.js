import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

const LABS_APPS = [
  { path: '/labs/board', label: 'Project Board' },
  { path: '/labs/portfolio', label: 'Portfolio' },
  { path: '/labs/strategy-grid', label: 'Strategy Grid' },
  { path: '/labs/studio', label: 'Studio Board' },
  { path: '/labs/orgcharts', label: 'Org Charts' },
  { path: '/labs/cashflow', label: 'Cashflow', accessKey: 'cashflow' },
  { path: '/labs/improvements', label: 'Improvements' },
];

// Each sidebar group: a heading that opens and closes its list of apps.
// An app with an accessKey shows only to people granted it (Settings).
const GROUPS = [
  { id: 'labs', label: 'Labs', icon: '🧪', apps: LABS_APPS },
  {
    id: 'shared',
    label: 'Shared Service Tools',
    icon: '🤝',
    apps: [{ path: '/shared/design', label: 'Design' }],
  },
];

function Sidebar({ user, onLogout }) {
  const [openGroups, setOpenGroups] = useState(() => Object.fromEntries(GROUPS.map((g) => [g.id, true])));
  const [collapsed, setCollapsed] = useState(false);
  const [access, setAccess] = useState({});

  useEffect(() => {
    const gatedKeys = [...new Set(GROUPS.flatMap((g) => g.apps).map((a) => a.accessKey).filter(Boolean))];
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

  const visibleApps = (group) => group.apps.filter((app) => !app.accessKey || access[app.accessKey]);

  // Subcategories (a group's links) only ever show as text, so they're
  // meaningless in the icon-only collapsed rail - clicking a group
  // heading while collapsed expands the sidebar back out instead of just
  // toggling the accordion in place.
  const handleGroupToggle = (id) => {
    if (collapsed) {
      setCollapsed(false);
      setOpenGroups((prev) => ({ ...prev, [id]: true }));
    } else {
      setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
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
        {GROUPS.map((group) => {
          const apps = visibleApps(group);
          if (apps.length === 0) return null;
          const open = openGroups[group.id];
          return (
            <React.Fragment key={group.id}>
              <button
                className="sidebar-group-toggle"
                onClick={() => handleGroupToggle(group.id)}
                aria-expanded={open}
                title={group.label}
              >
                <span className="sidebar-link-icon">{group.icon}</span>
                {!collapsed && (
                  <>
                    {group.label}
                    <span className={`sidebar-chevron ${open ? 'open' : ''}`}>▸</span>
                  </>
                )}
              </button>
              {!collapsed && open && (
                <div className="sidebar-group-items">
                  {apps.map((app) => (
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
            </React.Fragment>
          );
        })}

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
