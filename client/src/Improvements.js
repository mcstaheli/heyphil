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
const HINT_LABEL = { broken: 'Something is broken', idea: 'Idea or request', unsure: 'Not sure' };
const PRIORITY_LABEL = { high: 'High priority', normal: 'Normal priority', low: 'Low priority' };
const REPO_URL = 'https://github.com/mcstaheli/heyphil';

// Screenshots aren't in the list payload (just hasScreenshot) - each image
// is fetched from GET /api/improvements/:id/screenshot, with the auth
// header (a plain <img src> can't send it), as a blob URL. Thumbnails wait
// until the card scrolls into view; fetched images are cached for the
// session since a card's screenshot never changes.
const screenshotCache = new Map(); // id -> Promise<objectURL>

function loadScreenshot(id) {
  if (!screenshotCache.has(id)) {
    const p = fetch(`${API_BASE_URL}/api/improvements/${id}/screenshot`, { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => URL.createObjectURL(blob));
    p.catch(() => screenshotCache.delete(id)); // let a later view retry
    screenshotCache.set(id, p);
  }
  return screenshotCache.get(id);
}

function ScreenshotImage({ id, lazy = false, alt = '' }) {
  const ref = useRef(null);
  const [src, setSrc] = useState(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (visible || !ref.current) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        obs.disconnect();
      }
    }, { rootMargin: '200px' });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    loadScreenshot(id).then((url) => { if (!cancelled) setSrc(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, visible]);

  return src
    ? <img ref={ref} src={src} alt={alt} />
    : <div ref={ref} className="imp-screenshot-placeholder" aria-label="Loading screenshot" />;
}

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
  // Moving, editing and deleting cards is admin-only (the server enforces
  // it; this just hides controls that would be refused).
  const [canManage, setCanManage] = useState(false);

  const load = useCallback(() => {
    fetch(`${API_BASE_URL}/api/improvements`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        setItems(data.improvements || []);
        setCanManage(!!data.canManage);
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
    if (draggedId && canManage) {
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
          {!canManage && ' Only admins can move or edit cards.'}
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
                  className={`imp-card ${canManage ? '' : 'imp-card-readonly'}`}
                  draggable={canManage}
                  onDragStart={() => handleDragStart(item.id)}
                  onClick={() => setSelected(item)}
                >
                  {item.hasScreenshot && !RESOLVED_COLUMNS.includes(item.status) && (
                    <div className="imp-card-thumb">
                      <ScreenshotImage id={item.id} lazy />
                    </div>
                  )}
                  {!RESOLVED_COLUMNS.includes(item.status) && (
                    <ReporterAvatar item={item} photoByEmail={photoByEmail} />
                  )}
                  <div className="imp-card-body">
                    <div className="imp-card-kind">
                      <span>
                        <span className={`imp-priority-dot priority-${item.priority || 'normal'}`} title={PRIORITY_LABEL[item.priority || 'normal']} />
                        {item.seqNum != null && `#${item.seqNum} `}{item.kind ? KIND_LABEL[item.kind] : '❔ Unclassified'}
                      </span>
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
                    {!item.kind && item.reporterHint && (
                      <div className="imp-card-hint">Reporter says: {HINT_LABEL[item.reporterHint]}</div>
                    )}
                    {item.duplicateOf && <div className="imp-card-duplicate">Duplicate of #{item.duplicateOf}</div>}
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
          canManage={canManage}
          onClose={() => setSelected(null)}
          onSave={(updates) => patch(selected.id, updates).catch((err) => window.alert(err.message))}
          onDelete={() => remove(selected.id)}
        />
      )}
    </div>
  );
}

function ImprovementModal({ item, canManage, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note);
  const [duplicateOf, setDuplicateOf] = useState(item.duplicateOf ?? '');

  useEffect(() => {
    setTitle(item.title);
    setNote(item.note);
    setDuplicateOf(item.duplicateOf ?? '');
  }, [item]);

  const ctx = item.context;
  const errors = (ctx && ctx.errors) || [];
  const saveDuplicate = () => {
    const next = String(duplicateOf).trim().replace(/^#/, '');
    if (next === String(item.duplicateOf ?? '')) return;
    onSave({ duplicateOf: next === '' ? null : next });
  };

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
            {item.hasScreenshot && (
              <div className="imp-modal-screenshot">
                <ScreenshotImage id={item.id} alt="Screenshot" />
              </div>
            )}
            <div className="imp-modal-fields">
              <label>
                Title
                <input value={title} disabled={!canManage} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== item.title && onSave({ title })} />
              </label>
              <label>
                Note
                <textarea rows={4} value={note} disabled={!canManage} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== item.note && onSave({ note })} />
              </label>
              <label>
                Kind
                <select value={item.kind || ''} disabled={!canManage} onChange={(e) => onSave({ kind: e.target.value || null })}>
                  <option value="">Unclassified</option>
                  <option value="bug">🐛 Bug</option>
                  <option value="feature">✨ Feature</option>
                </select>
              </label>
              <label>
                Status
                <select value={item.status} disabled={!canManage} onChange={(e) => onSave({ status: e.target.value })}>
                  {COLUMNS.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </label>
              <div className="imp-modal-row">
                <label>
                  Priority
                  <select value={item.priority || 'normal'} disabled={!canManage} onChange={(e) => onSave({ priority: e.target.value })}>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label>
                  Duplicate of #
                  <input
                    inputMode="numeric"
                    placeholder="—"
                    value={duplicateOf}
                    disabled={!canManage}
                    onChange={(e) => setDuplicateOf(e.target.value)}
                    onBlur={saveDuplicate}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  />
                </label>
              </div>
              {item.reporterHint && (
                <div className="imp-modal-meta">Reporter&apos;s hint: {HINT_LABEL[item.reporterHint]}</div>
              )}
              {item.resolvedAt && (
                <div className="imp-modal-meta">Resolved {new Date(item.resolvedAt).toLocaleString()}</div>
              )}
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
              {(ctx || item.commitSha) && (
                <div className="imp-context">
                  <div className="imp-context-title">Context when reported</div>
                  {ctx && ctx.viewport && <div>Window: {ctx.viewport.width} × {ctx.viewport.height}</div>}
                  {ctx && ctx.userAgent && <div className="imp-context-ua">{ctx.userAgent}</div>}
                  {ctx && ctx.clientCommit && (
                    <div>
                      Page build: <a href={`${REPO_URL}/commit/${ctx.clientCommit}`} target="_blank" rel="noreferrer"><code>{ctx.clientCommit.slice(0, 7)}</code></a>
                    </div>
                  )}
                  {item.commitSha && (
                    <div>
                      API build: <a href={`${REPO_URL}/commit/${item.commitSha}`} target="_blank" rel="noreferrer"><code>{item.commitSha.slice(0, 7)}</code></a>
                    </div>
                  )}
                  {ctx && (
                    errors.length === 0 ? (
                      <div>No JavaScript errors before reporting</div>
                    ) : (
                      <details className="imp-context-errors">
                        <summary>{errors.length} JavaScript error{errors.length === 1 ? '' : 's'} before reporting</summary>
                        <ol>
                          {errors.map((e, i) => (
                            // eslint-disable-next-line react/no-array-index-key
                            <li key={i}>
                              <div className="imp-error-head">{e.time ? new Date(e.time).toLocaleTimeString() : ''} · {e.source}</div>
                              <div className="imp-error-message">{e.message}</div>
                              {e.stack && <pre>{e.stack}</pre>}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <div className="imp-modal-actions">
            {canManage && <button className="btn-danger" onClick={onDelete}>Delete</button>}
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Improvements;
