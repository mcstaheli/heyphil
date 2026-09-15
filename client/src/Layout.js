import React from 'react';
import Sidebar from './Sidebar';
import './Layout.css';

function Layout({ user, onLogout, children }) {
  return (
    <div className="app-shell">
      <Sidebar user={user} onLogout={onLogout} />
      <div className="app-main">{children}</div>
    </div>
  );
}

export default Layout;
