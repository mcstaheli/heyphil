import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { designDaysBadge } from './designDays';
import './DesignBoard.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';
const WS_URL = process.env.REACT_APP_WS_URL || API_BASE_URL;

// Mirrors server/design-rules.js's DESIGN_COLUMNS - keep in sync. Cards
// can move to any column in either direction.
const COLUMNS = [
  { id: 'requested', title: 'Requested' },
  { id: 'scoping', title: 'Scoping' },
  { id: 'in-design', title: 'In Design' },
  { id: 'in-review', title: 'In Review' },
  { id: 'revisions', title: 'Revisions' },
  { id: 'delivered', title: 'Delivered' },
  { id: 'on-hold', title: 'On Hold' },
];

function authHeaders(json = false) {
  const token = localStorage.getItem('authToken');
  return json
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${token}` };
}

async function send(method, path, body) {
  const res = await fetch(`${API_BASE_URL}/api/design${path}`, {
    method,
    headers: authHeaders(!!body),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const EMPTY_FORM = { deliverable: '', projectId: '', designer: '', dueDate: '', link: '', notes: '', status: 'requested' };

function RequestModal({ request, projects, canDelete, onClose, onSave, onDelete }) {
  const isNew = !request;
  const [initial] = useState(() => (request
    ? {
      deliverable: request.deliverable || '',
      projectId: request.projectId || '',
      designer: request.designer || '',
      dueDate: request.dueDate || '',
      link: request.link || '',
      notes: request.notes || '',
      status: request.status,
    }
    : EMPTY_FORM));
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSave(e) {
    e.preventDefault();
    if (!form.deliverable.trim()) {
      setError('Add the deliverable.');
      return;
    }
    setSaving(true);
    setError(null);
    // An edit sends only what changed here, so saving can't undo a move
    // or edit someone else made while this was open.
    const changes = isNew
      ? form
      : Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== initial[key]));
    try {
      if (Object.keys(changes).length > 0) await onSave(changes);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content design-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSave}>
        <div className="modal-header">
          <h2>{isNew ? 'New design request' : `Design #${request.seqNum}`}</h2>
        </div>
        <div className="modal-body design-form">
          <label>
            Deliverable
            <input value={form.deliverable} onChange={set('deliverable')} placeholder="e.g. Lobby signage package" maxLength={300} autoFocus={isNew} />
          </label>
          <label>
            Project
            <select value={form.projectId} onChange={set('projectId')}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <div className="design-form-row">
            <label>
              Designer
              <input value={form.designer} onChange={set('designer')} placeholder="Who's on it" maxLength={255} />
            </label>
            <label>
              Due
              <input type="date" value={form.dueDate} onChange={set('dueDate')} />
            </label>
          </div>
          {!isNew && (
            <label>
              Stage
              <select value={form.status} onChange={set('status')}>
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
          )}
          <label>
            Files link
            <input value={form.link} onChange={set('link')} placeholder="https://drive.google.com/..." />
          </label>
          <label>
            Notes
            <textarea rows={4} value={form.notes} onChange={set('notes')} placeholder="Brief, sizes, references, feedback..." />
          </label>
          {!isNew && (
            <p className="design-meta">
              Requested {request.requesterName ? `by ${request.requesterName} ` : ''}on {formatDate(request.requestedAt)}
              {request.deliveredAt ? ` · delivered ${formatDate(request.deliveredAt)}` : ''}
            </p>
          )}
          {error && <p className="design-error">{error}</p>}
        </div>
        <div className="modal-footer design-modal-footer">
          {!isNew && canDelete
            ? <button type="button" className="design-delete" onClick={() => onDelete(request)}>Delete</button>
            : <span />}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Add request' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function DesignBoard() {
  const [requests, setRequests] = useState([]);
  const [projects, setProjects] = useState([]);
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | request
  const [draggedId, setDraggedId] = useState(null);
  const [projectFilter, setProjectFilter] = useState('');

  const load = useCallback(() => {
    send('GET', '')
      .then((data) => {
        setRequests(data.requests || []);
        setCanDelete(!!data.canDelete);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/projects`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        const live = (data.projects || []).filter((p) => !p.deleted_at);
        live.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        setProjects(live);
      })
      .catch(() => {});
  }, []);

  const upsert = useCallback((request) => {
    setRequests((prev) => (prev.some((r) => r.id === request.id)
      ? prev.map((r) => (r.id === request.id ? request : r))
      : [...prev, request]));
  }, []);

  // Live updates, so a request added or moved anywhere shows up here.
  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = io(WS_URL, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 10 });
    socketRef.current.on('design:created', ({ request }) => upsert(request));
    socketRef.current.on('design:updated', ({ request }) => {
      upsert(request);
      setEditing((prev) => (prev && prev !== 'new' && prev.id === request.id ? request : prev));
    });
    socketRef.current.on('design:deleted', ({ requestId }) => {
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      setEditing((prev) => (prev && prev !== 'new' && prev.id === requestId ? null : prev));
    });
    return () => socketRef.current.disconnect();
  }, [upsert]);

  // Oldest request first in each column, so the longest wait is on top.
  const byColumn = useMemo(() => {
    const grouped = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
    for (const r of requests) {
      if (projectFilter && r.projectId !== projectFilter) continue;
      (grouped[r.status] || grouped.requested).push(r);
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
    }
    return grouped;
  }, [requests, projectFilter]);

  const projectsWithRequests = useMemo(() => {
    const ids = new Set(requests.map((r) => r.projectId).filter(Boolean));
    return projects.filter((p) => ids.has(p.id));
  }, [requests, projects]);

  async function save(form) {
    if (editing === 'new') {
      const { request } = await send('POST', '', form);
      upsert(request);
    } else {
      const { request } = await send('PUT', `/${editing.id}`, form);
      upsert(request);
    }
  }

  async function remove(request) {
    if (!window.confirm(`Delete "${request.deliverable}"? This cannot be undone.`)) return;
    try {
      await send('DELETE', `/${request.id}`);
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
      setEditing(null);
    } catch (err) {
      window.alert(err.message);
    }
  }

  function handleDrop(columnId) {
    const request = requests.find((r) => r.id === draggedId);
    setDraggedId(null);
    if (!request || request.status === columnId) return;
    upsert({ ...request, status: columnId }); // move now; the server's answer replaces it
    send('PUT', `/${request.id}`, { status: columnId })
      .then(({ request: saved }) => upsert(saved))
      .catch((err) => {
        load(); // put the board back to what the server has
        window.alert(err.message);
      });
  }

  if (loading) return <div className="design-page"><p className="design-loading">Loading...</p></div>;
  if (error) return <div className="design-page"><p className="design-loading">Failed to load: {error}</p></div>;

  return (
    <div className="design-page">
      <div className="design-header">
        <div>
          <h2>Design</h2>
          <p className="design-subtitle">Design requests from ask to delivery. The day count is how long since each was requested.</p>
        </div>
        <div className="design-header-actions">
          {(projectsWithRequests.length > 0 || projectFilter) && (
            <select className="design-filter" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">All projects</option>
              {projectsWithRequests.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          )}
          <button className="design-new-btn" onClick={() => setEditing('new')}>+ New request</button>
        </div>
      </div>

      <div className="design-board">
        {COLUMNS.map((col) => (
          <div
            key={col.id}
            className={`design-column ${col.id === 'on-hold' ? 'design-column-hold' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(col.id)}
          >
            <div className="design-column-header">
              <h3>{col.title}</h3>
              <span className="design-count">{byColumn[col.id].length}</span>
            </div>
            <div className="design-column-cards">
              {byColumn[col.id].map((r) => {
                const badge = designDaysBadge(r);
                return (
                  <div
                    key={r.id}
                    className="design-card"
                    draggable
                    onDragStart={() => setDraggedId(r.id)}
                    onDragEnd={() => setDraggedId(null)}
                    onClick={() => setEditing(r)}
                  >
                    <div className="design-card-top">
                      <span className="design-seq">#{r.seqNum}</span>
                      {badge && <span className={`design-days design-days-${badge.level}`} title={badge.title}>{badge.text}</span>}
                    </div>
                    <div className="design-deliverable">{r.deliverable}</div>
                    <div className={`design-project ${r.projectTitle ? '' : 'design-project-none'}`}>
                      {r.projectTitle || 'No project'}
                    </div>
                    {(r.designer || r.dueDate) && (
                      <div className="design-card-foot">
                        {r.designer && <span>🎨 {r.designer}</span>}
                        {r.dueDate && <span>Due {formatDate(r.dueDate)}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <RequestModal
          key={editing === 'new' ? 'new' : editing.id}
          request={editing === 'new' ? null : editing}
          projects={projects}
          canDelete={canDelete}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </div>
  );
}

export default DesignBoard;
