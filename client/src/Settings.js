import React, { useState } from 'react';
import './Settings.css';

// Team management (formerly the "Users" tab here) moved to the global
// Settings page (SettingsPage.js) per request - one shared team list
// governed centrally instead of each board keeping its own copy. This
// modal now only handles what's genuinely board-scoped: Project Types.
function Settings({ projectTypeColors, onClose, onSave }) {
  const [projectTypes, setProjectTypes] = useState(
    Object.entries(projectTypeColors).map(([name, color]) => ({ name, color }))
  );

  const [newProjectType, setNewProjectType] = useState({ name: '', color: '#2196f3' });

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
    const updatedProjectTypeColors = {};
    projectTypes.forEach(pt => {
      if (!pt.name.trim()) return; // Skip empty names
      updatedProjectTypeColors[pt.name] = pt.color;
    });

    onSave({
      projectTypeColors: updatedProjectTypeColors
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>⚙️ Board Settings</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="settings-content">
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
