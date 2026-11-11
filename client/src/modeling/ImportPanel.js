import React, { useState } from 'react';
import { modelingApi, sheetUrl, folderUrl } from './api';
import LockBadge from './LockBadge';

// Import: scan the HeyPhil Templates and Projects folders (nothing else),
// show what's there, and register only what's ticked - after a confirm.
// Registering writes to HeyPhil's database only; nothing in Drive changes.
// Anything found unlocked shows "Not locked" and gets a Lock button
// afterwards (Templates tab / deal page).
export default function ImportPanel({ onImported }) {
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [pick, setPick] = useState({ templates: {}, deals: {} });

  async function runScan() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await modelingApi('GET', '/import/scan');
      setScan(result);
      // pre-tick everything new
      const templates = {};
      result.templates.forEach((t) => {
        const releaseIds = t.releases.filter((r) => !r.alreadyRegistered).map((r) => r.id);
        if ((!t.alreadyRegistered && t.draft) || releaseIds.length) templates[t.folderId] = { on: true, releaseIds };
      });
      const deals = {};
      result.deals.filter((d) => !d.skipped).forEach((d) => {
        const working = d.working.filter((w) => !w.alreadyRegistered);
        const versions = d.versions.filter((v) => !v.alreadyRegistered).map((v) => v.id);
        if (working.length || versions.length) {
          deals[d.folderId] = { on: true, templateChoice: d.templateGuess || '', workingFileId: working.length === 1 ? working[0].id : '', versionFileIds: versions };
        }
      });
      setPick({ templates, deals });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const setT = (id, patch) => setPick((p) => ({ ...p, templates: { ...p.templates, [id]: { ...p.templates[id], ...patch } } }));
  const setD = (id, patch) => setPick((p) => ({ ...p, deals: { ...p.deals, [id]: { ...p.deals[id], ...patch } } }));
  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const selection = {
    templates: Object.entries(pick.templates).filter(([, v]) => v.on).map(([folderId, v]) => ({ folderId, releaseIds: v.releaseIds })),
    deals: Object.entries(pick.deals).filter(([, v]) => v.on).map(([folderId, v]) => ({ folderId, templateChoice: v.templateChoice, workingFileId: v.workingFileId || null, versionFileIds: v.versionFileIds })),
  };
  const nothing = !selection.templates.length && !selection.deals.length;
  const missingTemplate = selection.deals.some((d) => !d.templateChoice);

  async function apply() {
    const n = selection.templates.length + selection.deals.length;
    if (!window.confirm(`Register ${n} item${n === 1 ? '' : 's'} in HeyPhil?\n\nThis only records them in HeyPhil - nothing in Google Drive is changed.`)) return;
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
          {scan.templates.map((t) => {
            const sel = pick.templates[t.folderId];
            const newReleases = t.releases.filter((r) => !r.alreadyRegistered);
            const nothingNew = t.alreadyRegistered && !newReleases.length;
            return (
              <div key={t.folderId} className="mdl-import-item">
                <label className="mdl-check">
                  <input type="checkbox" disabled={nothingNew || (!t.alreadyRegistered && !t.draft)} checked={!!sel?.on} onChange={(e) => setT(t.folderId, { on: e.target.checked, releaseIds: sel?.releaseIds || newReleases.map((r) => r.id) })} />
                  <b>{t.name}</b> {t.alreadyRegistered ? <span className="mdl-muted">(registered)</span> : <span className="mdl-badge mdl-badge-new">New</span>}
                  <a href={folderUrl(t.folderId)} target="_blank" rel="noreferrer">Folder ↗</a>
                </label>
                {t.draft && <div className="mdl-sub">Draft master: <a href={sheetUrl(t.draft.id)} target="_blank" rel="noreferrer">{t.draft.name}</a></div>}
                {t.releases.map((r) => (
                  <label key={r.id} className="mdl-check mdl-sub">
                    <input type="checkbox" disabled={r.alreadyRegistered || !sel?.on} checked={r.alreadyRegistered || !!sel?.releaseIds?.includes(r.id)} onChange={() => setT(t.folderId, { releaseIds: toggle(sel.releaseIds, r.id) })} />
                    {r.version} {r.active && <span className="mdl-badge mdl-badge-active">named ACTIVE</span>} <LockBadge locked={r.locked} />
                    {r.alreadyRegistered && <span className="mdl-muted">(registered)</span>}
                  </label>
                ))}
                {t.problems.map((p) => <div key={p} className="mdl-warn mdl-sub">⚠ {p}</div>)}
              </div>
            );
          })}

          <h4>Deals</h4>
          {!scan.deals.length && <p className="mdl-empty">The HeyPhil Projects folder has no deal folders.</p>}
          {scan.deals.map((d) => {
            const sel = pick.deals[d.folderId];
            if (d.skipped) return <div key={d.folderId} className="mdl-import-item mdl-muted"><b>{d.name}</b> - skipped: {d.skipped}</div>;
            const newWorking = d.working.filter((w) => !w.alreadyRegistered);
            const newVersions = d.versions.filter((v) => !v.alreadyRegistered);
            const nothingNew = !newWorking.length && !newVersions.length;
            return (
              <div key={d.folderId} className="mdl-import-item">
                <label className="mdl-check">
                  <input type="checkbox" disabled={nothingNew} checked={!!sel?.on} onChange={(e) => setD(d.folderId, { on: e.target.checked })} />
                  <b>{d.name}</b> {nothingNew && <span className="mdl-muted">(all registered)</span>}
                  <a href={folderUrl(d.fmFolderId)} target="_blank" rel="noreferrer">Financial Modeling ↗</a>
                </label>
                {sel && !nothingNew && (
                  <>
                    <label className="mdl-sub">Template{' '}
                      <select value={sel.templateChoice} onChange={(e) => setD(d.folderId, { templateChoice: e.target.value })}>
                        <option value="">Pick…</option>
                        {scan.templateChoices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    {newWorking.length > 0 && (
                      <div className="mdl-sub">Working model:{' '}
                        <select value={sel.workingFileId} onChange={(e) => setD(d.folderId, { workingFileId: e.target.value })}>
                          <option value="">Don't register one</option>
                          {newWorking.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </div>
                    )}
                    {newVersions.map((v) => (
                      <label key={v.id} className="mdl-check mdl-sub">
                        <input type="checkbox" checked={sel.versionFileIds.includes(v.id)} onChange={() => setD(d.folderId, { versionFileIds: toggle(sel.versionFileIds, v.id) })} />
                        Version: {v.name} <LockBadge locked={v.locked} />
                      </label>
                    ))}
                  </>
                )}
                {d.problems.map((p) => <div key={p} className="mdl-warn mdl-sub">⚠ {p}</div>)}
              </div>
            );
          })}

          <div className="mdl-toolbar mdl-import-footer">
            {missingTemplate && <span className="mdl-warn">Pick a template for every ticked deal.</span>}
            <button type="button" className="mdl-btn mdl-btn-primary" onClick={apply} disabled={busy || nothing || missingTemplate}>{busy ? 'Registering…' : 'Register selected…'}</button>
          </div>
        </>
      )}
    </div>
  );
}
