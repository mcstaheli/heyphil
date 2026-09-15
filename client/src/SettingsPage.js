import React from 'react';
import './SettingsPage.css';

function SettingsPage({ user, onLogout }) {
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>⚙️ Settings</h1>
      </header>

      <div className="settings-content">
        <div className="settings-card">
          <h2>Profile</h2>
          <div className="settings-profile">
            {user?.picture && <img src={user.picture} alt={user.name} />}
            <div>
              <div className="settings-profile-name">{user?.name}</div>
              <div className="settings-profile-email">{user?.email}</div>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <h2>Account</h2>
          <button className="btn-secondary" onClick={onLogout}>Logout</button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
