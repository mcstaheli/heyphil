import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_ATTACHMENT_BYTES,
  PRIORITIES,
  defaultDesigner,
  defaultRequester,
  formatBytes,
  stageAfterPosting,
  withCurrent,
} from './designOptions';

// One design request: its fields, its files (#37) and its journal (#43) -
// comments, drafts and finals, stage moves and emails sent. Opened from a
// card on the Design board (DesignBoard.js).

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('authToken')}` });

export async function designSend(method, path, body) {
  const res = await fetch(`${API_BASE_URL}/api/design${path}`, {
    method,
    headers: body ? { ...authHeader(), 'Content-Type': 'application/json' } : authHeader(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

async function uploadFile(requestId, file) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is over the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit.`);
  const res = await fetch(`${API_BASE_URL}/api/design/${requestId}/attachments`, {
    method: 'POST',
    headers: {
      ...authHeader(),
      'Content-Type': 'application/octet-stream',
      'X-Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Couldn't add ${file.name}`);
  return data.attachment;
}

// Files need the sign-in token, so they're fetched and handed to the
// browser as a blob: saved, or (images and PDFs only) opened in a tab.
async function openFile(requestId, attachment, preview) {
  const res = await fetch(
    `${API_BASE_URL}/api/design/${requestId}/attachments/${attachment.id}${preview ? '?inline=1' : ''}`,
    { headers: authHeader() }
  );
  if (!res.ok) throw new Error('Couldn\'t load that file.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (preview) {
    window.open(url, '_blank', 'noopener');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.filename || attachment.attachmentName || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const PREVIEWABLE = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i;

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatWhen(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

const KIND_META = {
  comment: { icon: '💬', label: 'Comment' },
  draft: { icon: '📝', label: 'Draft' },
  final: { icon: '✅', label: 'Final' },
  status: { icon: '➡️', label: 'Stage' },
  email: { icon: '✉️', label: 'Email' },
};

function FilesSection({ request, attachments, user, isAdmin, onChanged }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleFiles(files) {
    setBusy(true);
    setError(null);
    try {
      for (const file of files) await uploadFile(request.id, file);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
      onChanged();
    }
  }

  async function remove(att) {
    if (!window.confirm(`Remove ${att.filename}?`)) return;
    try {
      await designSend('DELETE', `/${request.id}/attachments/${att.id}`);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  const mine = (att) => att.uploadedByEmail && user?.email && att.uploadedByEmail.toLowerCase() === user.email.toLowerCase();

  return (
    <section className="design-section">
      <div className="design-section-head">
        <h3>Files</h3>
        <button type="button" className="design-small-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Uploading…' : '+ Add files'}
        </button>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => handleFiles([...e.target.files])} />
      </div>
      {error && <p className="design-error">{error}</p>}
      {attachments.length === 0
        ? <p className="design-muted">No files yet. Up to {formatBytes(MAX_ATTACHMENT_BYTES)} each.</p>
        : (
          <ul className="design-files">
            {attachments.map((att) => (
              <li key={att.id}>
                <span className="design-file-name" title={att.filename}>📎 {att.filename}</span>
                <span className="design-muted">{formatBytes(att.sizeBytes)} · {att.uploadedByName || 'someone'} · {formatDate(att.createdAt)}</span>
                <span className="design-file-actions">
                  {PREVIEWABLE.test(att.contentType || '') && (
                    <button type="button" onClick={() => openFile(request.id, att, true).catch((e) => setError(e.message))}>View</button>
                  )}
                  <button type="button" onClick={() => openFile(request.id, att, false).catch((e) => setError(e.message))}>Download</button>
                  {(mine(att) || isAdmin) && <button type="button" className="design-danger-link" onClick={() => remove(att)}>Remove</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function Composer({ request, onPosted }) {
  const [kind, setKind] = useState('comment');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [file, setFile] = useState(null);
  const [notify, setNotify] = useState(true);
  const [move, setMove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const fileRef = useRef(null);
  // A file already uploaded for a post that then failed, so a retry
  // reuses it rather than uploading it again.
  const uploadedRef = useRef(null);

  const nextStage = stageAfterPosting(kind, request.status);
  const nextLabel = nextStage === 'in-review' ? 'In Review' : nextStage === 'delivered' ? 'Delivered' : null;
  const requesterName = request.requesterName || 'the requester';

  async function post(e) {
    e.preventDefault();
    if (!body.trim() && !link.trim() && !file) {
      setError('Add a note, a link or a file.');
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      let attachment = null;
      if (file) {
        attachment = uploadedRef.current?.file === file ? uploadedRef.current.attachment : await uploadFile(request.id, file);
        uploadedRef.current = { file, attachment };
      }
      const { email } = await designSend('POST', `/${request.id}/journal`, {
        kind,
        body,
        link: kind === 'comment' ? '' : link, // the link box is hidden for comments
        attachmentId: attachment?.id,
        notifyRequester: kind === 'draft' && notify && !!request.requesterEmail,
        moveStage: move,
      });
      uploadedRef.current = null;
      if (email && !email.sent) setNote(`Posted, but couldn't email ${requesterName}: ${email.reason}.`);
      else if (email?.sent) setNote(`Emailed ${requesterName} that the draft is ready.`);
      setBody('');
      setLink('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setKind('comment');
      onPosted();
    } catch (err) {
      setError(err.message);
      onPosted(); // a file may have gone up even if the post didn't
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="design-composer" onSubmit={post}>
      <div className="design-composer-kinds">
        {['comment', 'draft', 'final'].map((k) => (
          <button type="button" key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {KIND_META[k].icon} {KIND_META[k].label}
          </button>
        ))}
      </div>
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={kind === 'comment' ? 'Feedback, a question, a decision...' : kind === 'draft' ? 'What changed in this draft, what to look at...' : 'Notes on the final files...'}
      />
      {kind !== 'comment' && (
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder={`Link to the ${kind} (https://...)`} />
      )}
      <div className="design-composer-row">
        <label className="design-file-pick">
          <input ref={fileRef} type="file" onChange={(e) => setFile(e.target.files[0] || null)} />
        </label>
      </div>
      {kind === 'draft' && (
        <label className="design-check">
          <input type="checkbox" checked={notify && !!request.requesterEmail} disabled={!request.requesterEmail} onChange={(e) => setNotify(e.target.checked)} />
          {request.requesterEmail
            ? `Email ${requesterName} that it's waiting for their comments`
            : `Can't email ${requesterName} - no email in People (Settings)`}
        </label>
      )}
      {nextLabel && (
        <label className="design-check">
          <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
          Move the card to {nextLabel}
        </label>
      )}
      {error && <p className="design-error">{error}</p>}
      {note && <p className="design-muted">{note}</p>}
      <div className="design-composer-actions">
        <button type="submit" className="btn-primary design-post-btn" disabled={busy}>
          {busy ? 'Posting…' : `Post ${KIND_META[kind].label.toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}

function ActivitySection({ request, journal, user, isAdmin, onChanged }) {
  const [error, setError] = useState(null);
  const mine = (j) => j.authorEmail && user?.email && j.authorEmail.toLowerCase() === user.email.toLowerCase();

  async function remove(entry) {
    if (!window.confirm('Remove this entry?')) return;
    try {
      await designSend('DELETE', `/${request.id}/journal/${entry.id}`);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="design-section">
      <div className="design-section-head"><h3>Activity</h3></div>
      {error && <p className="design-error">{error}</p>}
      <ol className="design-journal">
        <li className="design-journal-entry design-journal-system">
          <span className="design-journal-icon">🆕</span>
          <div>
            <div className="design-journal-meta">Requested{request.requesterName ? ` for ${request.requesterName}` : ''} · {formatWhen(request.requestedAt)}</div>
          </div>
        </li>
        {journal.map((j) => {
          const meta = KIND_META[j.kind] || KIND_META.comment;
          const system = j.kind === 'status' || j.kind === 'email';
          return (
            <li key={j.id} className={`design-journal-entry design-journal-${j.kind} ${system ? 'design-journal-system' : ''}`}>
              <span className="design-journal-icon" title={meta.label}>{meta.icon}</span>
              <div className="design-journal-content">
                <div className="design-journal-meta">
                  {system ? j.body : <><b>{j.authorName || 'Someone'}</b> {j.kind === 'comment' ? 'commented' : `posted the ${j.kind}`}</>}
                  {' · '}{formatWhen(j.createdAt)}
                  {system && j.kind === 'status' && j.authorName ? ` · ${j.authorName}` : ''}
                  {!system && (mine(j) || isAdmin) && (
                    <button type="button" className="design-danger-link design-journal-remove" onClick={() => remove(j)}>Remove</button>
                  )}
                </div>
                {!system && j.body && <div className="design-journal-body">{j.body}</div>}
                {j.link && (
                  <a className="design-journal-link" href={j.link} target="_blank" rel="noopener noreferrer">{j.link}</a>
                )}
                {j.attachmentId && (
                  <button
                    type="button"
                    className="design-journal-file"
                    onClick={() => openFile(request.id, { id: j.attachmentId, attachmentName: j.attachmentName }, false).catch((e) => setError(e.message))}
                  >
                    📎 {j.attachmentName}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <Composer request={request} onPosted={onChanged} />
    </section>
  );
}

function RequestModal({ request, projects, people, options, user, canDelete, detailsVersion, onClose, onSave, onDelete }) {
  const isNew = !request;
  const [initial] = useState(() => (request
    ? {
      deliverable: request.deliverable || '',
      deliverableType: request.deliverableType || '',
      outputType: request.outputType || '',
      dimensions: request.dimensions || '',
      priority: request.priority || 'normal',
      projectId: request.projectId || '',
      requesterName: request.requesterName || '',
      designer: request.designer || '',
      dueDate: request.dueDate || '',
      link: request.link || '',
      notes: request.notes || '',
      status: request.status,
    }
    : {
      deliverable: '',
      deliverableType: '',
      outputType: '',
      dimensions: '',
      priority: 'normal',
      projectId: '',
      requesterName: defaultRequester(people, user),
      designer: defaultDesigner(people),
      dueDate: '',
      link: '',
      notes: '',
      status: 'requested',
    }));
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [details, setDetails] = useState({ journal: [], attachments: [], isAdmin: false, loaded: false });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // People may load after the modal opens; fill the new-request defaults
  // once they arrive, unless they've already been changed.
  useEffect(() => {
    if (!isNew || !people.length) return;
    setForm((f) => ({
      ...f,
      requesterName: f.requesterName || defaultRequester(people, user),
      designer: f.designer && f.designer !== defaultDesigner([]) ? f.designer : defaultDesigner(people),
    }));
  }, [isNew, people, user]);

  const loadDetails = useCallback(() => {
    if (isNew) return;
    designSend('GET', `/${request.id}/details`)
      .then((d) => setDetails({ ...d, loaded: true }))
      .catch(() => setDetails((prev) => ({ ...prev, loaded: true })));
  }, [isNew, request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadDetails(); }, [loadDetails, detailsVersion]);

  async function handleSave(e) {
    e.preventDefault();
    if (!form.deliverable.trim()) {
      setError('Add the deliverable description.');
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

  const COLUMNS = [
    ['requested', 'Requested'], ['scoping', 'Scoping'], ['in-design', 'In Design'], ['in-review', 'In Review'],
    ['revisions', 'Revisions'], ['delivered', 'Delivered'], ['on-hold', 'On Hold'],
  ];
  const peopleNames = people.map((p) => p.name);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-content design-modal ${isNew ? '' : 'design-modal-wide'}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isNew ? 'New design request' : `Design #${request.seqNum}`}</h2>
        </div>
        <div className="design-modal-columns">
          <form id="design-request-form" className="modal-body design-form" onSubmit={handleSave}>
            <label>
              Deliverable description
              <input value={form.deliverable} onChange={set('deliverable')} placeholder="e.g. Lobby signage package for the grand opening" maxLength={300} autoFocus={isNew} />
            </label>
            <div className="design-form-row">
              <label>
                Deliverable type
                <select value={form.deliverableType} onChange={set('deliverableType')}>
                  <option value="">Choose…</option>
                  {withCurrent(options.deliverableTypes, form.deliverableType).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label>
                Priority
                <select value={form.priority} onChange={set('priority')} className={`design-priority-select design-priority-${form.priority}`}>
                  {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            </div>
            <div className="design-form-row">
              <label>
                Output file type
                <select value={form.outputType} onChange={set('outputType')}>
                  <option value="">Choose…</option>
                  {withCurrent(options.outputTypes, form.outputType).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label>
                Dimensions
                <input value={form.dimensions} onChange={set('dimensions')} placeholder="e.g. 24 × 36 in, 1920 × 1080 px" maxLength={100} />
              </label>
            </div>
            <label>
              Project
              <select value={form.projectId} onChange={set('projectId')}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </label>
            <div className="design-form-row">
              <label>
                Requester
                <select value={form.requesterName} onChange={set('requesterName')}>
                  {isNew && <option value="">Me</option>}
                  {!isNew && !form.requesterName && <option value="">Nobody</option>}
                  {withCurrent(peopleNames, form.requesterName).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>
                Designer
                <select value={form.designer} onChange={set('designer')}>
                  <option value="">Unassigned</option>
                  {withCurrent(peopleNames, form.designer).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className="design-form-row">
              <label>
                Due
                <input type="date" value={form.dueDate} onChange={set('dueDate')} />
              </label>
              {!isNew ? (
                <label>
                  Stage
                  <select value={form.status} onChange={set('status')}>
                    {COLUMNS.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
                  </select>
                </label>
              ) : <span />}
            </div>
            <label>
              Files link
              <input value={form.link} onChange={set('link')} placeholder="https://drive.google.com/..." />
            </label>
            <label>
              Notes
              <textarea rows={4} value={form.notes} onChange={set('notes')} placeholder="Brief, sizes, references, feedback..." />
            </label>
            {isNew && <p className="design-muted">Files and comments can be added once the request is created.</p>}
            {!isNew && (
              <p className="design-meta">
                Requested {request.requesterName ? `by ${request.requesterName} ` : ''}on {formatDate(request.requestedAt)}
                {request.deliveredAt ? ` · delivered ${formatDate(request.deliveredAt)}` : ''}
              </p>
            )}
            {error && <p className="design-error">{error}</p>}
          </form>

          {!isNew && (
            <div className="design-modal-side">
              <FilesSection request={request} attachments={details.attachments} user={user} isAdmin={details.isAdmin} onChanged={loadDetails} />
              <ActivitySection request={request} journal={details.journal} user={user} isAdmin={details.isAdmin} onChanged={loadDetails} />
            </div>
          )}
        </div>
        <div className="modal-footer design-modal-footer">
          {!isNew && canDelete
            ? <button type="button" className="btn-danger design-delete" onClick={() => onDelete(request)}>Delete</button>
            : <span />}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>{isNew ? 'Cancel' : 'Close'}</button>
            <button type="submit" form="design-request-form" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Add request' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RequestModal;
