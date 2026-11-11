import React, { useState } from 'react';
import { modelingApi, sheetUrl, folderUrl } from './api';

// Import: scan the HeyPhil Templates and Projects folders (nothing else),
// show what's there, and register only what's ticked - after a confirm.
// Registering writes to HeyPhil's database only; nothing in Drive changes.
// Versions come from the file names where they have one (v1.1); others get
// the next free number. Unlocked files stay Unlocked until someone locks
// them.
const LockState = ({ locked }) => (locked
  ? <span className="mdl-badge mdl-badge-locked">🔒 Locked</span>
  : <span className="mdl-badge mdl-badge-unlocked">✎ Unlocked</span>);

const preview = (f) => [f.version || 'next number', f.label].filter(Boolean).join(' · ');

export default function ImportPanel({ onImported }) {
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [picked, setPicked] = useState({}); // folderId -> Set of file ids

  async function runScan() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await modelingApi('GET', '/import/scan');
      setScan(result);
      const next = {};
      [...result.templates, ...result.projects].forEach((o) => {
        const ids = (o.files || []).filter((f) => !f.alreadyRegistered).map((f) => f.id);
        if (ids.length || (o.templateId === null && o.files)) next[o.folderId] = new Set(ids);
      });
      setPicked(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (folderId, fileId) => setPicked((p) => {
    const set = new Set(p[folderId] || []);
    if (set.has(fileId)) set.delete(fileId); else set.add(fileId);
    return { ...p, [folderId]: set };
  });

  const selection = scan && {
    templates: scan.templates.filter((t) => picked[t.folderId] && (picked[t.folderId].size || !t.alreadyRegistered))
      .map((t) => ({ folderId: t.folderId, fileIds: [...picked[t.folderId]] })),
    projects: scan.projects.filter((p) => picked[p.folderId]?.size).map((p) => ({ folderId: p.folderId, fileIds: [...picked[p.folderId]] })),
  };
  const count = selection ? [...selection.templates, ...selection.projects].reduce((n, o) => n + o.fileIds.length, 0) : 0;

  async function apply() {
    if (!window.confirm(`Register ${count} file${count === 1 ? '' : 's'} in HeyPhil?\n\nThis only records them in HeyPhil - nothing in Google Drive is changed.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await modelingApi('POST', '/import/apply', selection);
      setDone(result.done);
      setScan(null);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const fileRows = (owner) => owner.files.map((f) => (
    <label key={f.id} className="mdl-check mdl-sub">
      <input type="checkbox" disabled={f.alreadyRegistered} checked={f.alreadyRegistered || !!picked[owner.folderId]?.has(f.id)} onChange={() => toggle(owner.folderId, f.id)} />
      <a href={sheetUrl(f.id)} target="_blank" rel="noreferrer">{f.name}</a>
      <span className="mdl-muted">→ {preview(f)}</span>
      <LockState locked={f.locked} />
      {f.active && <span className="mdl-badge mdl-badge-active">named ACTIVE</span>}
      {f.alreadyRegistered && <span className="mdl-muted">(registered)</span>}
      <span className="mdl-muted">in {f.where}</span>
    </label>
  ));

  return (
    <div className="mdl-panel">
      <div className="mdl-toolbar">
        <h3>Import existing models</h3>
        <button type="button" className="mdl-btn mdl-btn-primary" onClick={runScan} disabled={busy}>{busy && !scan ? 'Scanning…' : scan ? 'Scan again' : 'Scan the HeyPhil folder'}</button>
      </div>
      <p className="mdl-muted">Looks only in the HeyPhil Templates and Projects folders. Nothing is written until you confirm, and then only to HeyPhil - Drive isn't changed.</p>
      {error && <p className="mdl-error">{error}</p>}
      {done && (
        <div className="mdl-result mdl-result-ok">
          <strong>{done.length ? 'Registered:' : 'Nothing new to register.'}</strong>
          {done.length > 0 && <ul>{done.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}

      {scan && (
        <>
          <h4>Templates</h4>
          {!scan.templates.length && <p className="mdl-empty">No template folders found.</p>}
          {scan.templates.map((t) => (
            <div key={t.folderId} className="mdl-import-item">
              <div className="mdl-check">
                <b>{t.name}</b> {t.alreadyRegistered ? <span className="mdl-muted">(registered)</span> : <span className="mdl-badge mdl-badge-new">New template</span>}
                <a href={folderUrl(t.folderId)} target="_blank" rel="noreferrer">Folder ↗</a>
              </div>
              {fileRows(t)}
              {t.problems.map((p) => <div key={p} className="mdl-warn mdl-sub">⚠ {p}</div>)}
            </div>
          ))}

          <h4>Projects</h4>
          {!scan.projects.length && <p className="mdl-empty">The HeyPhil Projects folder has no project folders.</p>}
          {scan.projects.map((p) => (
            <div key={p.folderId} className="mdl-import-item">
              <div className="mdl-check">
                <b>{p.name}</b>
                {p.fmFolderId && <a href={folderUrl(p.fmFolderId)} target="_blank" rel="noreferrer">Financial Modeling ↗</a>}
                {p.skipped && <span className="mdl-muted">skipped: {p.skipped}</span>}
              </div>
              {fileRows(p)}
            </div>
          ))}

          <div className="mdl-toolbar mdl-import-footer">
            <button type="button" className="mdl-btn mdl-btn-primary" onClick={apply} disabled={busy || !count}>{busy ? 'Registering…' : `Register ${count} selected…`}</button>
          </div>
        </>
      )}
    </div>
  );
}
