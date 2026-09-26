import React from 'react';
import Sidebar from './Sidebar';
import SnapshotReporter from './SnapshotReporter';
import './Layout.css';

function Layout({ user, onLogout, children }) {
  return (
    <div className="app-shell">
      <Sidebar user={user} onLogout={onLogout} />
      <div className="app-main">{children}</div>
      <SnapshotReporter />
    </div>
  );
}

export default Layout;
