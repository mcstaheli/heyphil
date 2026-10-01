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
//
// "Can log in" (added per a follow-up request) is a genuinely separate
// concept from being a team member - it used to be a hardcoded
// ALLOWED_EMAILS array in server code, requiring a real code change and
// redeploy to add anyone. Login is checked by email, so the toggle here
// only makes sense once a person has one on file; someone who needs
// access but isn't (or isn't yet) a team member can still be granted it
// directly in the standalone list below.
//
// Only admins can change who can log in or who's an admin - the server
// enforces that (requireAdmin + the lockout guards in access-rules.js);
// this page just disables/hides those controls for everyone else so nobody
// is surprised by a refusal. Whether *you* are an admin is read from the
// same access list the page shows, so it updates the moment it changes.
function TeamSection({ currentUser }) {
  const [people, setPeople] = useState([]);
  const [access, setAccess] = useState([]); // [{ email, isAdmin }]
  const [loading, setLoading] = useState(true);
  const [newPerson, setNewPerson] = useState({ name: '', email: '', photoUrl: '', borderColor: '#4caf50' });
  const [newAccessEmail, setNewAccessEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    Promise.all([
      fetch(`${API_BASE_URL}/api/people`, { headers: authHeaders() }).then((res) => res.json()),
      fetch(`${API_BASE_URL}/api/allowed-emails`, { headers: authHeaders() }).then((res) => res.json())
    ])
      .then(([peopleData, accessData]) => {
        setPeople(peopleData.people || []);
        setAccess(accessData.access || (accessData.emails || []).map((email) => ({ email, isAdmin: false })));
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

  // Server error message, or a generic one - surfaced as-is (e.g. "Only
  // admins can change who has access", "You can't revoke your own login").
  async function failure(res, fallback) {
    const data = await res.json().catch(() => ({}));
    window.alert(data.error || fallback);
  }

  async function grantAccess(email) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/allowed-emails`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized })
      });
      if (!res.ok) return failure(res, 'Failed to grant access');
      setAccess((prev) => (prev.some((a) => a.email === normalized) ? prev : [...prev, { email: normalized, isAdmin: false }]));
    } catch (err) {
      window.alert(`Failed to grant access: ${err.message}`);
    }
  }

  async function revokeAccess(email) {
    const normalized = email.trim().toLowerCase();
    try {
      const res = await fetch(`${API_BASE_URL}/api/allowed-emails/${encodeURIComponent(normalized)}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (!res.ok) return failure(res, 'Failed to revoke access');
      setAccess((prev) => prev.filter((a) => a.email !== normalized));
    } catch (err) {
      window.alert(`Failed to revoke access: ${err.message}`);
    }
  }

  async function changeAdmin(email, makeAdmin) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/allowed-emails/${encodeURIComponent(email)}/admin`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAdmin: makeAdmin })
      });
      if (!res.ok) return failure(res, 'Failed to change admin status');
      setAccess((prev) => prev.map((a) => (a.email === email ? { ...a, isAdmin: makeAdmin } : a)));
    } catch (err) {
      window.alert(`Failed to change admin status: ${err.message}`);
    }
  }

  if (loading) return <p>Loading team...</p>;

  const me = (currentUser?.email || '').toLowerCase();
  const accessByEmail = new Map(access.map((a) => [a.email, a]));
  const amAdmin = !!accessByEmail.get(me)?.isAdmin;
  const adminCount = access.filter((a) => a.isAdmin).length;
  const teamEmails = new Set(people.filter((p) => p.email).map((p) => p.email.toLowerCase()));
  const otherAccessEmails = access.map((a) => a.email).filter((e) => !teamEmails.has(e));

  // Login + admin checkboxes for one email - shared by team rows and the
  // "other people with access" list.
  const accessControls = (email) => {
    const entry = accessByEmail.get(email);
    const canLogIn = !!entry;
    const isAdmin = !!entry?.isAdmin;
    const isMe = email === me;
    const lastAdmin = isAdmin && adminCount <= 1;
    const loginTitle = !email ? 'Add an email first - login access is granted by email'
      : !amAdmin ? 'Only admins can change who can log in'
        : isMe ? "You can't revoke your own login" : '';
    const adminTitle = !amAdmin ? 'Only admins can change who is an admin'
      : lastAdmin ? "The last admin can't be removed - make someone else an admin first" : '';
    return (
      <>
        <label className="settings-can-login" title={loginTitle}>
          <input
            type="checkbox"
            disabled={!email || !amAdmin || (isMe && canLogIn)}
            checked={canLogIn}
            onChange={(e) => (e.target.checked ? grantAccess(email) : revokeAccess(email))}
          />
          Can log in
        </label>
        {canLogIn && (
          <label className="settings-can-login settings-admin" title={adminTitle}>
            <input
              type="checkbox"
              disabled={!amAdmin || lastAdmin}
              checked={isAdmin}
              onChange={(e) => changeAdmin(email, e.target.checked)}
            />
            Admin
          </label>
        )}
      </>
    );
  };

  return (
    <div className="settings-section">
      <div className="settings-list">
        {people.map((person) => {
          const email = (person.email || '').toLowerCase();
          return (
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
                onBlur={(e) => {
                  updateLocal(person.name, 'email', e.target.value);
                  handleFieldBlur({ ...person, email: e.target.value });
                }}
                placeholder="Email"
                className="settings-input"
              />
              <input
                type="text"
                defaultValue={person.photoUrl || ''}
                onBlur={(e) => {
                  updateLocal(person.name, 'photoUrl', e.target.value);
                  handleFieldBlur({ ...person, photoUrl: e.target.value });
                }}
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
              {accessControls(email)}
              <button className="btn-danger-small" onClick={() => handleDelete(person.name)}>🗑️</button>
            </div>
          );
        })}
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

      <div className="settings-add-section settings-other-access">
        <h4>Other people with access</h4>
        <p className="settings-hint">
          For login access that isn't tied to a team member above - e.g. someone who doesn't need a board avatar.
        </p>
        {otherAccessEmails.map((email) => (
          <div key={email} className="settings-item">
            <input type="text" value={email} disabled className="settings-input" />
            {accessControls(email)}
            {amAdmin && email !== me && (
              <button className="btn-danger-small" title="Revoke login" onClick={() => revokeAccess(email)}>🗑️</button>
            )}
          </div>
        ))}
        {!amAdmin && (
          <p className="settings-hint settings-admin-note">
            Only admins can change who can log in or who's an admin.
          </p>
        )}
        {amAdmin && (
        <div className="settings-item">
          <input
            type="email"
            value={newAccessEmail}
            onChange={(e) => setNewAccessEmail(e.target.value)}
            placeholder="Email"
            className="settings-input"
          />
          <button
            className="btn-primary-small"
            onClick={() => { grantAccess(newAccessEmail); setNewAccessEmail(''); }}
          >
            ➕ Grant access
          </button>
        </div>
        )}
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
          <TeamSection currentUser={user} />
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
