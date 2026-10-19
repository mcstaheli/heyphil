import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { designDaysBadge } from './designDays';
import { PRIORITIES, compareRequests } from './designOptions';
import RequestModal from './DesignRequestModal';
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

const LIST_LABELS = { deliverableTypes: 'Deliverable types', outputTypes: 'Output file types' };

// The board's settings gear: the dropdown lists, one option per line.
function OptionsModal({ options, onClose, onSaved }) {
  const [text, setText] = useState(() => Object.fromEntries(Object.entries(options).map(([k, v]) => [k, v.join('\n')])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(text).map(([k, v]) => [k, v.split('\n')]));
      const { options: saved } = await send('PUT', '/settings/options', body);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content design-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSave}>
        <div className="modal-header"><h2>Design board settings</h2></div>
        <div className="modal-body design-form">
          <p className="design-muted">One option per line. Removing one doesn&apos;t change requests that already use it.</p>
          {Object.keys(text).map((key) => (
            <label key={key}>
              {LIST_LABELS[key] || key}
              <textarea rows={8} value={text[key]} onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))} />
            </label>
          ))}
          {error && <p className="design-error">{error}</p>}
        </div>
        <div className="modal-footer design-modal-footer">
          <span />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.label]));

function DesignBoard({ user }) {
  const [requests, setRequests] = useState([]);
  const [projects, setProjects] = useState([]);
  const [people, setPeople] = useState([]);
  const [options, setOptions] = useState({ deliverableTypes: [], outputTypes: [] });
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | request
  const [editingOptions, setEditingOptions] = useState(false);
  const [detailsVersion, setDetailsVersion] = useState(0);
  const [draggedId, setDraggedId] = useState(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedId = searchParams.get('request');

  const load = useCallback(() => {
    send('GET', '')
      .then((data) => {
        setRequests(data.requests || []);
        setCanDelete(!!data.canDelete);
        if (data.options) setOptions(data.options);
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
    fetch(`${API_BASE_URL}/api/people`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => setPeople((data.people || []).map((p) => ({ name: p.name, email: p.email }))))
      .catch(() => {});
  }, []);

  // A link from the "draft ready" email (?request=<id>) opens that card.
  useEffect(() => {
    if (!linkedId || loading) return;
    const match = requests.find((r) => r.id === linkedId);
    if (match) setEditing((prev) => prev || match);
  }, [linkedId, loading, requests]);

  const closeModal = () => {
    setEditing(null);
    if (linkedId) setSearchParams({}, { replace: true });
  };

  const upsert = useCallback((request) => {
    setRequests((prev) => (prev.some((r) => r.id === request.id)
      ? prev.map((r) => (r.id === request.id ? request : r))
      : [...prev, request]));
  }, []);

  // Live updates, so a request added or moved anywhere shows up here.
  const socketRef = useRef(null);
  const editingIdRef = useRef(null);
  editingIdRef.current = editing && editing !== 'new' ? editing.id : null;
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
    socketRef.current.on('design:details', ({ requestId }) => {
      if (requestId === editingIdRef.current) setDetailsVersion((v) => v + 1);
    });
    socketRef.current.on('design:options', ({ options: next }) => setOptions(next));
    return () => socketRef.current.disconnect();
  }, [upsert]);

  // Most urgent first in each column, then the longest wait.
  const byColumn = useMemo(() => {
    const grouped = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
    for (const r of requests) {
      if (projectFilter && r.projectId !== projectFilter) continue;
      (grouped[r.status] || grouped.requested).push(r);
    }
    for (const list of Object.values(grouped)) list.sort(compareRequests);
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
      closeModal();
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
          <button className="design-gear-btn" onClick={() => setEditingOptions(true)} title="Board settings: deliverable and output types" aria-label="Board settings">⚙️</button>
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
                const priority = r.priority || 'normal';
                return (
                  <div
                    key={r.id}
                    className={`design-card design-card-priority-${priority}`}
                    draggable
                    onDragStart={() => setDraggedId(r.id)}
                    onDragEnd={() => setDraggedId(null)}
                    onClick={() => setEditing(r)}
                  >
                    <div className="design-card-top">
                      <span className="design-seq">#{r.seqNum}</span>
                      {priority !== 'normal' && (
                        <span className={`design-priority-badge design-priority-${priority}`}>{PRIORITY_LABEL[priority]}</span>
                      )}
                      {badge && <span className={`design-days design-days-${badge.level}`} title={badge.title}>{badge.text}</span>}
                    </div>
                    <div className="design-deliverable">{r.deliverable}</div>
                    {(r.deliverableType || r.outputType || r.dimensions) && (
                      <div className="design-card-tags">
                        {r.deliverableType && <span className="design-tag">{r.deliverableType}</span>}
                        {(r.outputType || r.dimensions) && (
                          <span className="design-tag design-tag-output">{[r.outputType, r.dimensions].filter(Boolean).join(' · ')}</span>
                        )}
                      </div>
                    )}
                    <div className={`design-project ${r.projectTitle ? '' : 'design-project-none'}`}>
                      {r.projectTitle || 'No project'}
                    </div>
                    {(r.designer || r.dueDate || r.journalCount > 0 || r.attachmentCount > 0) && (
                      <div className="design-card-foot">
                        {r.designer && <span>🎨 {r.designer}</span>}
                        {r.dueDate && <span>Due {formatDate(r.dueDate)}</span>}
                        {r.journalCount > 0 && <span title="Comments, drafts and finals">💬 {r.journalCount}</span>}
                        {r.attachmentCount > 0 && <span title="Files">📎 {r.attachmentCount}</span>}
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
          people={people}
          options={options}
          user={user}
          canDelete={canDelete}
          detailsVersion={detailsVersion}
          onClose={closeModal}
          onSave={save}
          onDelete={remove}
        />
      )}
      {editingOptions && (
        <OptionsModal options={options} onClose={() => setEditingOptions(false)} onSaved={setOptions} />
      )}
    </div>
  );
}

export default DesignBoard;
