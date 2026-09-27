import React, { useEffect, useMemo, useState, useCallback } from 'react';
import './Improvements.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

// Mirrors server/improvements-db.js's IMPROVEMENT_COLUMNS - keep in sync.
// No forward-only restriction (same house style as the origination board -
// see boardStages.js): a card can move to any column in either direction.
// Sorting Intake into the two Triaged columns, and fixing/implementing
// from there, is something a person asks an interactive Claude Code
// session to do ("triage", "fix bugs 1-4") - see CLAUDE.md - not anything
// automated in this codebase.
const COLUMNS = [
  { id: 'intake', title: 'Intake' },
  { id: 'triaged-bugs', title: 'Triaged - Bugs' },
  { id: 'triaged-features', title: 'Triaged - Features' },
  { id: 'shipped', title: 'Shipped' },
  { id: 'abandoned', title: 'Abandoned' },
];

const KIND_LABEL = { bug: '🐛 Bug', feature: '✨ Feature' };

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

  if (loading) return <div className="imp-page"><p>Loading...</p></div>;
  if (error) return <div className="imp-page"><p>Failed to load: {error}</p></div>;

  return (
    <div className="imp-page">
      <div className="imp-header">
        <h2>Improvements</h2>
        <p className="imp-subtitle">
          Bug reports and feature requests captured with the snapshot button, anywhere in the app.
          Ask a Claude Code session to "triage" to sort Intake, then "fix bugs 1-4" or "implement feature 2".
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
                  {item.screenshot && (
                    <div className="imp-card-thumb">
                      <img src={item.screenshot} alt="" />
                    </div>
                  )}
                  <div className="imp-card-body">
                    <div className="imp-card-kind">
                      {item.kind ? KIND_LABEL[item.kind] : '❔ Unclassified'}
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
            <button className="btn-remove-action" onClick={onDelete}>Delete</button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Improvements;
