import React from 'react';
import './Landing.css';

function Landing({ onSignIn }) {
  return (
    <div className="landing-container">
      <div className="scanlines"></div>
      <div className="landing-content">
        <div className="robot-icon">🤖</div>
        <h1 className="landing-logo">HeyPhil</h1>
        <p className="landing-tagline">Project Intelligence System</p>
        <button className="landing-signin" onClick={onSignIn}>
          <span>🔐 Initialize Access</span>
        </button>
      </div>
    </div>
  );
}

export default Landing;
