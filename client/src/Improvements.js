import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import './Improvements.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';
const WS_URL = process.env.REACT_APP_WS_URL || API_BASE_URL;

// Mirrors server/improvements-db.js's IMPROVEMENT_COLUMNS - keep in sync.
// No forward-only restriction (same house style as the origination board -
// see boardStages.js): a card can move to any column in either direction.
// Sorting Intake, auto-fixing bugs, and implementing features is something
// a person asks an interactive Claude Code session to do ("triage",
// "implement feature N") - see CLAUDE.md - not anything automated in this
// codebase.
const COLUMNS = [
  { id: 'intake', title: 'Intake' },
  { id: 'triaged-bugs', title: 'Triaged - Bugs' },
  { id: 'triaged-features', title: 'Triaged - Features' },
  { id: 'shipped', title: 'Shipped' },
  { id: 'abandoned', title: 'Abandoned' },
];

// Once a card lands here, nobody needs the screenshot for visual
// reference anymore - showing the full thumbnail just makes an
// already-resolved card take up as much space as an active one.
const RESOLVED_COLUMNS = ['shipped', 'abandoned'];

const KIND_LABEL = { bug: '🐛 Bug', feature: '✨ Feature' };

const AVATAR_COLORS = ['#4285F4', '#34A853', '#FBBC04', '#EA4335', '#9C27B0', '#00ACC1', '#FF6F00', '#7CB342'];

function getInitialsColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Matches by email, not name - a reporter's name here is their Google
// account display name ("Greg Whitehead"), which won't match the short
// name people are filed under in Settings -> Team ("Greg"), but their
// login email always matches exactly.
function ReporterAvatar({ item, photoByEmail }) {
  const name = item.reporterName || item.reporterEmail;
  if (!name) return null;
  const photo = item.reporterEmail && photoByEmail.get(item.reporterEmail.toLowerCase());
  if (photo) {
    return <img className="imp-reporter-avatar" src={photo} alt={name} title={name} />;
  }
  return (
    <div className="imp-reporter-avatar imp-reporter-avatar-initials" style={{ backgroundColor: getInitialsColor(name) }} title={name}>
      {name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
    </div>
  );
}

// Only bugs and features sitting in a Triaged column are things you'd
// actually say "fix bug 3" / "implement feature 5" about - Intake hasn't
// been sorted yet, and Shipped/Abandoned are already done.
const PROMPTABLE_COLUMNS = ['triaged-bugs', 'triaged-features'];

function claudePrompt(item) {
  return item.kind === 'bug' ? `fix bug ${item.seqNum}` : `implement feature ${item.seqNum}`;
}

function authHeaders() {
  const token = localStorage.getItem('authToken');
  return { Authorization: `Bearer ${token}` };
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Improvements() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [people, setPeople] = useState([]);

  const load = useCallback(() => {
    fetch(`${API_BASE_URL}/api/improvements`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        setItems(data.improvements || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/people`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => setPeople(data.people || []))
      .catch(() => {});
  }, []);

  const photoByEmail = useMemo(() => {
    const map = new Map();
    for (const person of people) {
      if (person.email && person.photoUrl) map.set(person.email.toLowerCase(), person.photoUrl);
    }
    return map;
  }, [people]);

  // Live updates so a report submitted (or triaged/fixed) anywhere shows
  // up here without a manual refresh - same pattern App.js already uses
  // for the origination board, just its own connection since this page
  // isn't part of that component tree.
  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    socketRef.current.on('improvement:created', ({ improvement }) => {
      setItems((prev) => (prev.some((it) => it.id === improvement.id) ? prev : [improvement, ...prev]));
    });

    socketRef.current.on('improvement:updated', ({ improvement }) => {
      setItems((prev) => prev.map((it) => (it.id === improvement.id ? improvement : it)));
      setSelected((prev) => (prev && prev.id === improvement.id ? improvement : prev));
    });

    socketRef.current.on('improvement:deleted', ({ improvementId }) => {
      setItems((prev) => prev.filter((it) => it.id !== improvementId));
      setSelected((prev) => (prev && prev.id === improvementId ? null : prev));
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  const byColumn = useMemo(() => {
    const grouped = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
    for (const item of items) {
      (grouped[item.status] || grouped.intake).push(item);
    }
    return grouped;
  }, [items]);

  async function patch(id, updates) {
    const res = await fetch(`${API_BASE_URL}/api/improvements/${id}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Update failed');
    }
    const { improvement } = await res.json();
    setItems((prev) => prev.map((it) => (it.id === improvement.id ? improvement : it)));
    setSelected((prev) => (prev && prev.id === improvement.id ? improvement : prev));
    return improvement;
  }

  async function remove(id) {
    if (!window.confirm('Delete this report? This cannot be undone.')) return;
    const res = await fetch(`${API_BASE_URL}/api/improvements/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) {
      setItems((prev) => prev.filter((it) => it.id !== id));
      setSelected(null);
    }
  }

  function handleDragStart(id) {
    setDraggedId(id);
  }

  function handleDrop(columnId) {
    if (draggedId) {
      const item = items.find((it) => it.id === draggedId);
      if (item && item.status !== columnId) {
        patch(draggedId, { status: columnId }).catch((err) => window.alert(err.message));
      }
    }
    setDraggedId(null);
  }

  // Copies just the prompt text ("fix bug 3"), not a full shell command -
  // browsers can't open a Terminal window or run anything for you (no web
  // API crosses that boundary), and a full `cd ~/path && claude ...`
  // command would be wrong for anyone whose clone lives somewhere else.
  // Paste this into an already-running Claude Code session.
  function copyPrompt(item, e) {
    e.stopPropagation();
    navigator.clipboard.writeText(claudePrompt(item)).then(() => {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1500);
    });
  }

  if (loading) return <div className="imp-page"><p>Loading...</p></div>;
  if (error) return <div className="imp-page"><p>Failed to load: {error}</p></div>;

  return (
    <div className="imp-page">
      <div className="imp-header">
        <h2>Improvements</h2>
        <p className="imp-subtitle">Bug reports and feature requests captured with the snapshot button, anywhere in the app.</p>
        <p className="imp-hint">
          Tell a Claude Code session <strong>&quot;triage&quot;</strong> to sort Intake and auto-fix any bugs, or <strong>&quot;implement feature 2&quot;</strong> to build a specific feature.
        </p>
      </div>

      <div className="imp-board">
        {COLUMNS.map((col) => (
          <div
            key={col.id}
            className="imp-column"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(col.id)}
          >
            <div className="imp-column-header">
              <h3>{col.title}</h3>
              <span className="imp-count">{byColumn[col.id]?.length || 0}</span>
            </div>
            <div className="imp-column-cards">
              {(byColumn[col.id] || []).map((item) => (
                <div
                  key={item.id}
                  className="imp-card"
                  draggable
                  onDragStart={() => handleDragStart(item.id)}
                  onClick={() => setSelected(item)}
                >
                  {item.screenshot && !RESOLVED_COLUMNS.includes(item.status) && (
                    <div className="imp-card-thumb">
                      <img src={item.screenshot} alt="" />
                    </div>
                  )}
                  {!RESOLVED_COLUMNS.includes(item.status) && (
                    <ReporterAvatar item={item} photoByEmail={photoByEmail} />
                  )}
                  <div className="imp-card-body">
                    <div className="imp-card-kind">
                      <span>{item.seqNum != null && `#${item.seqNum} `}{item.kind ? KIND_LABEL[item.kind] : '❔ Unclassified'}</span>
                      {PROMPTABLE_COLUMNS.includes(item.status) && (
                        <button
                          className="imp-copy-btn"
                          onClick={(e) => copyPrompt(item, e)}
                          title={`Copy: ${claudePrompt(item)}`}
                          type="button"
                        >
                          {copiedId === item.id ? 'Copied!' : '📋'}
                        </button>
                      )}
                    </div>
                    <div className="imp-card-title">{item.title}</div>
                    <div className="imp-card-meta">
                      {item.reporterName || item.reporterEmail || 'Unknown'} · {timeAgo(item.createdAt)}
                    </div>
                    {item.pageUrl && <div className="imp-card-page">{item.pageUrl}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <ImprovementModal
          item={selected}
          onClose={() => setSelected(null)}
          onSave={(updates) => patch(selected.id, updates).catch((err) => window.alert(err.message))}
          onDelete={() => remove(selected.id)}
        />
      )}
    </div>
  );
}

function ImprovementModal({ item, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note);

  useEffect(() => {
    setTitle(item.title);
    setNote(item.note);
  }, [item]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{item.seqNum != null && `#${item.seqNum} `}{item.kind ? KIND_LABEL[item.kind] : '❔ Unclassified'}</h3>
          {PROMPTABLE_COLUMNS.includes(item.status) && (
            <button
              className="btn-secondary"
              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(claudePrompt(item)); }}
              type="button"
            >
              📋 Copy: {claudePrompt(item)}
            </button>
          )}
        </div>
        <div className="modal-body">
          <div className="imp-modal-body">
            {item.screenshot && (
              <div className="imp-modal-screenshot">
                <img src={item.screenshot} alt="Screenshot" />
              </div>
            )}
            <div className="imp-modal-fields">
              <label>
                Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== item.title && onSave({ title })} />
              </label>
              <label>
                Note
                <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== item.note && onSave({ note })} />
              </label>
              <label>
                Kind
                <select value={item.kind || ''} onChange={(e) => onSave({ kind: e.target.value || null })}>
                  <option value="">Unclassified</option>
                  <option value="bug">🐛 Bug</option>
                  <option value="feature">✨ Feature</option>
                </select>
              </label>
              <label>
                Status
                <select value={item.status} onChange={(e) => onSave({ status: e.target.value })}>
                  {COLUMNS.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </label>
              {item.classificationNote && (
                <div className="imp-classification-note">
                  <strong>Triage notes:</strong> {item.classificationNote}
                </div>
              )}
              {item.prUrl && (
                <div className="imp-classification-note">
                  <strong>Fix pushed:</strong> <a href={item.prUrl} target="_blank" rel="noreferrer">{item.prUrl}</a>
                </div>
              )}
              <div className="imp-modal-meta">
                Reported by {item.reporterName || item.reporterEmail || 'Unknown'} on {new Date(item.createdAt).toLocaleString()}
                {item.pageUrl && <> · from <code>{item.pageUrl}</code></>}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <div className="imp-modal-actions">
            <button className="btn-danger" onClick={onDelete}>Delete</button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Improvements;
