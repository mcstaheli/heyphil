import React, { useState } from 'react';
import './Settings.css';

function Settings({ people, ownerColors, projectTypeColors, onClose, onSave }) {
  const [activeTab, setActiveTab] = useState('users');
  
  // Users state
  const [users, setUsers] = useState(
    Object.keys(people).map(name => ({
      name,
      photoUrl: people[name] || '',
      borderColor: ownerColors[name] || '#cccccc'
    }))
  );
  
  // Project types state
  const [projectTypes, setProjectTypes] = useState(
    Object.entries(projectTypeColors).map(([name, color]) => ({ name, color }))
  );
  
  const [newUser, setNewUser] = useState({ name: '', photoUrl: '', borderColor: '#4caf50' });
  const [newProjectType, setNewProjectType] = useState({ name: '', color: '#2196f3' });

  const handleAddUser = () => {
    if (!newUser.name.trim()) return;
    setUsers([...users, newUser]);
    setNewUser({ name: '', photoUrl: '', borderColor: '#4caf50' });
  };

  const handleRemoveUser = (index) => {
    setUsers(users.filter((_, i) => i !== index));
  };

  const handleUpdateUser = (index, field, value) => {
    setUsers(users.map((user, i) => i === index ? { ...user, [field]: value } : user));
  };

  const handleAddProjectType = () => {
    if (!newProjectType.name.trim()) return;
    setProjectTypes([...projectTypes, newProjectType]);
    setNewProjectType({ name: '', color: '#2196f3' });
  };

  const handleRemoveProjectType = (index) => {
    setProjectTypes(projectTypes.filter((_, i) => i !== index));
  };

  const handleUpdateProjectType = (index, field, value) => {
    setProjectTypes(projectTypes.map((pt, i) => i === index ? { ...pt, [field]: value } : pt));
  };

  const handleSave = () => {
    const updatedPeople = {};
    const updatedOwnerColors = {};
    users.forEach(user => {
      if (user.photoUrl) updatedPeople[user.name] = user.photoUrl;
      if (user.borderColor) updatedOwnerColors[user.name] = user.borderColor;
    });

    const updatedProjectTypeColors = {};
    projectTypes.forEach(pt => {
      updatedProjectTypeColors[pt.name] = pt.color;
    });

    onSave({
      people: updatedPeople,
      ownerColors: updatedOwnerColors,
      projectTypeColors: updatedProjectTypeColors
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>⚙️ Settings</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="settings-tabs">
          <button 
            className={activeTab === 'users' ? 'active' : ''} 
            onClick={() => setActiveTab('users')}
          >
            👥 Users
          </button>
          <button 
            className={activeTab === 'projectTypes' ? 'active' : ''} 
            onClick={() => setActiveTab('projectTypes')}
          >
            🏷️ Project Types
          </button>
        </div>

        <div className="settings-content">
          {activeTab === 'users' && (
            <div className="settings-section">
              <h3>Team Members</h3>
              <div className="settings-list">
                {users.map((user, index) => (
                  <div key={index} className="settings-item">
                    <input
                      type="text"
                      value={user.name}
                      onChange={(e) => handleUpdateUser(index, 'name', e.target.value)}
                      placeholder="Name"
                      className="settings-input"
                    />
                    <input
                      type="text"
                      value={user.photoUrl}
                      onChange={(e) => handleUpdateUser(index, 'photoUrl', e.target.value)}
                      placeholder="Photo URL"
                      className="settings-input"
                    />
                    <input
                      type="color"
                      value={user.borderColor}
                      onChange={(e) => handleUpdateUser(index, 'borderColor', e.target.value)}
                      className="settings-color-input"
                      title="Border color"
                    />
                    <button 
                      className="btn-danger-small" 
                      onClick={() => handleRemoveUser(index)}
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>

              <div className="settings-add-section">
                <h4>Add New User</h4>
                <div className="settings-item">
                  <input
                    type="text"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    placeholder="Name"
                    className="settings-input"
                  />
                  <input
                    type="text"
                    value={newUser.photoUrl}
                    onChange={(e) => setNewUser({ ...newUser, photoUrl: e.target.value })}
                    placeholder="Photo URL (optional)"
                    className="settings-input"
                  />
                  <input
                    type="color"
                    value={newUser.borderColor}
                    onChange={(e) => setNewUser({ ...newUser, borderColor: e.target.value })}
                    className="settings-color-input"
                    title="Border color"
                  />
                  <button className="btn-primary-small" onClick={handleAddUser}>
                    ➕ Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'projectTypes' && (
            <div className="settings-section">
              <h3>Project Types</h3>
              <div className="settings-list">
                {projectTypes.map((pt, index) => (
                  <div key={index} className="settings-item">
                    <input
                      type="text"
                      value={pt.name}
                      onChange={(e) => handleUpdateProjectType(index, 'name', e.target.value)}
                      placeholder="Project Type Name"
                      className="settings-input"
                    />
                    <input
                      type="color"
                      value={pt.color}
                      onChange={(e) => handleUpdateProjectType(index, 'color', e.target.value)}
                      className="settings-color-input"
                      title="Project type color"
                    />
                    <div 
                      className="color-preview" 
                      style={{ backgroundColor: pt.color }}
                    />
                    <button 
                      className="btn-danger-small" 
                      onClick={() => handleRemoveProjectType(index)}
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>

              <div className="settings-add-section">
                <h4>Add New Project Type</h4>
                <div className="settings-item">
                  <input
                    type="text"
                    value={newProjectType.name}
                    onChange={(e) => setNewProjectType({ ...newProjectType, name: e.target.value })}
                    placeholder="Project Type Name"
                    className="settings-input"
                  />
                  <input
                    type="color"
                    value={newProjectType.color}
                    onChange={(e) => setNewProjectType({ ...newProjectType, color: e.target.value })}
                    className="settings-color-input"
                    title="Project type color"
                  />
                  <div 
                    className="color-preview" 
                    style={{ backgroundColor: newProjectType.color }}
                  />
                  <button className="btn-primary-small" onClick={handleAddProjectType}>
                    ➕ Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>💾 Save Changes</button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
