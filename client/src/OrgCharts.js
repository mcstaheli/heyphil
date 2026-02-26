import React from 'react';

function OrgCharts({ user, onBack }) {
  return (
    <div className="app-container">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn-secondary" onClick={onBack}>← Back</button>
          <h1>📊 Org Charts</h1>
        </div>
        <div className="user-info">
          {user?.picture && <img src={user.picture} alt={user.name} />}
          <span>{user?.name}</span>
        </div>
      </header>
      
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>Interactive Org Charts</h2>
        <p>Interactive organizational diagrams - Coming soon!</p>
      </div>
    </div>
  );
}

export default OrgCharts;
