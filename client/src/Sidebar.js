import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import './Sidebar.css';
import { APP_GROUPS } from './appCatalog';
import { useAccess } from './access';

// Each person sees only the apps they're granted (Settings -> App access);
// admins see everything. A heading with none of your apps isn't shown.
const GROUPS = APP_GROUPS;

function Sidebar({ user, onLogout }) {
  const [openGroups, setOpenGroups] = useState(() => Object.fromEntries(GROUPS.map((g) => [g.id, true])));
  const [collapsed, setCollapsed] = useState(false);
  const { apps: myApps } = useAccess();

  const visibleApps = (group) => group.apps.filter((app) => myApps.includes(app.key));

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
