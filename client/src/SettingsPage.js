import React, { useEffect, useState } from 'react';
import './SettingsPage.css';
import './Settings.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function authHeaders() {
  const token = localStorage.getItem('authToken');
  return { Authorization: `Bearer ${token}` };
}

// Team management moved here from the per-board "Board Settings" modal
// (Settings.js, still used for the board-scoped Project Types tab) per
// request - one shared team list governed centrally ("across Apps")
// instead of each board keeping its own copy. The underlying `people`
// table was already global; this is just its first dedicated page.
function TeamSection() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPerson, setNewPerson] = useState({ name: '', email: '', photoUrl: '', borderColor: '#4caf50' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetch(`${API_BASE_URL}/api/people`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        setPeople(data.people || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  async function savePerson(person) {
    await fetch(`${API_BASE_URL}/api/people`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(person)
    });
  }

  // Saves on blur, one field at a time - there's no page-level Save
  // button here, matching how the rest of this app's standalone pages
  // (ProjectDetail's own fields, Improvements' card modal) already work.
  function handleFieldBlur(person) {
    savePerson(person).catch((err) => window.alert(`Failed to save: ${err.message}`));
  }

  function updateLocal(name, field, value) {
    setPeople((prev) => prev.map((p) => (p.name === name ? { ...p, [field]: value } : p)));
  }

  async function handleDelete(name) {
    if (!window.confirm(`Remove ${name} from the team?`)) return;
    const res = await fetch(`${API_BASE_URL}/api/people/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (res.ok) {
      setPeople((prev) => prev.filter((p) => p.name !== name));
    } else {
      window.alert('Failed to remove team member');
    }
  }

  async function handleAdd() {
    if (!newPerson.name.trim()) return;
    setSaving(true);
    try {
      await savePerson(newPerson);
      setNewPerson({ name: '', email: '', photoUrl: '', borderColor: '#4caf50' });
      load();
    } catch (err) {
      window.alert(`Failed to add: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading team...</p>;

  return (
    <div className="settings-section">
      <div className="settings-list">
        {people.map((person) => (
          <div key={person.name} className="settings-item">
            <input
              type="text"
              value={person.name}
              disabled
              className="settings-input"
              title="Rename by removing and re-adding - names are the identifier used elsewhere on the board"
            />
            <input
              type="email"
              defaultValue={person.email || ''}
              onBlur={(e) => handleFieldBlur({ ...person, email: e.target.value })}
              placeholder="Email"
              className="settings-input"
            />
            <input
              type="text"
              defaultValue={person.photoUrl || ''}
              onBlur={(e) => handleFieldBlur({ ...person, photoUrl: e.target.value })}
              placeholder="Photo URL"
              className="settings-input"
            />
            <input
              type="color"
              value={person.borderColor || '#cccccc'}
              onChange={(e) => {
                updateLocal(person.name, 'borderColor', e.target.value);
                handleFieldBlur({ ...person, borderColor: e.target.value });
              }}
              className="settings-color-input"
              title="Border color"
            />
            <button className="btn-danger-small" onClick={() => handleDelete(person.name)}>🗑️</button>
          </div>
        ))}
      </div>

      <div className="settings-add-section">
        <h4>Add Team Member</h4>
        <div className="settings-item">
          <input
            type="text"
            value={newPerson.name}
            onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })}
            placeholder="Name"
            className="settings-input"
          />
          <input
            type="email"
            value={newPerson.email}
            onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })}
            placeholder="Email"
            className="settings-input"
          />
          <input
            type="text"
            value={newPerson.photoUrl}
            onChange={(e) => setNewPerson({ ...newPerson, photoUrl: e.target.value })}
            placeholder="Photo URL (optional)"
            className="settings-input"
          />
          <input
            type="color"
            value={newPerson.borderColor}
            onChange={(e) => setNewPerson({ ...newPerson, borderColor: e.target.value })}
            className="settings-color-input"
            title="Border color"
          />
          <button className="btn-primary-small" onClick={handleAdd} disabled={saving}>➕ Add</button>
        </div>
      </div>
    </div>
  );
}

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
          <h2>Team</h2>
          <TeamSection />
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
