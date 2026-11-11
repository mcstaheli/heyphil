import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { modelingApi, sheetUrl, folderUrl, fileUrl, when, who, downloadExport } from './api';
import ActionModal from './ActionModal';
import LockBadge from './LockBadge';
import { StartedAction, UseTemplateModal, useOverview } from './Modeling';
import './Modeling.css';

// Labs -> Modeling -> a deal: its working model and every locked version
// (name, who locked it, when, Open in Sheets), plus Lock Version and
// Export to Excel, and the exports made so far.
export default function DealDetail() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const [deal, setDeal] = useState(null);
  const [error, setError] = useState(null);
  const [locking, setLocking] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [note, setNote] = useState('');
  const [action, setAction] = useState(null);
  const [useTemplate, setUseTemplate] = useState(false);
  const overview = useOverview();

  const load = useCallback(async () => {
    try {
      const r = await modelingApi('GET', `/deals/${dealId}`);
      setDeal(r.deal);
      setError(null);
    } catch (err) {
      setError(err.status === 404 ? 'This deal was not found.' : err.message);
    }
  }, [dealId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="mdl-page"><p className="mdl-error mdl-page-error">{error}</p></div>;
  if (!deal) return <div className="mdl-page"><p className="mdl-muted mdl-page-error">Loading…</p></div>;

  const working = deal.versions.find((v) => v.status === 'working');
  const locked = deal.versions.filter((v) => v.status === 'locked');
  const nextName = `v${locked.length + 1}`;
  const exportAction = (v) => setAction({ title: `Export ${v.status === 'working' ? 'the working model' : v.name} to Excel`, start: () => modelingApi('POST', '/export', { kind: 'version', id: v.id }) });

  return (
    <div className="mdl-page">
      <div className="mdl-header">
        <div>
          <button type="button" className="mdl-back" onClick={() => navigate('/labs/modeling')}>← Modeling</button>
          <h2>{deal.name}</h2>
          <p className="mdl-subtitle">
            {deal.templateName} template
            {deal.fmFolderId && <> · <a href={folderUrl(deal.fmFolderId)} target="_blank" rel="noreferrer">Financial Modeling folder ↗</a></>}
          </p>
        </div>
      </div>

      <div className="mdl-panel">
        <section className="mdl-card">
          <div className="mdl-toolbar"><h3>Working model</h3></div>
          {working ? (
            <>
              <p><b>{working.fileName}</b></p>
              <p className="mdl-muted">
                {working.fromReleaseVersion ? `Started from template ${working.fromReleaseVersion}` : 'Imported'}
                {' · '}{working.source === 'imported' ? 'registered' : 'created'} by {who(working.createdByEmail, working.createdByName)} {when(working.createdAt)}
              </p>
              <div className="mdl-actions">
                <a className="mdl-btn" href={sheetUrl(working.fileId)} target="_blank" rel="noreferrer">Open in Sheets ↗</a>
                <button type="button" className="mdl-btn mdl-btn-primary" onClick={() => { setVersionName(nextName); setNote(''); setLocking(true); }}>Lock Version</button>
                <button type="button" className="mdl-btn" onClick={() => exportAction(working)}>Export to Excel</button>
              </div>
            </>
          ) : (
            <>
              <p className="mdl-empty">No working model yet.</p>
              <button type="button" className="mdl-btn mdl-btn-primary" onClick={() => setUseTemplate(true)} disabled={!overview.data}>Use Template</button>
            </>
          )}
        </section>

        <section className="mdl-card">
          <div className="mdl-toolbar"><h3>Locked versions ({locked.length})</h3></div>
          {!locked.length ? <p className="mdl-empty">None yet. Lock Version saves a view-only copy of the working model.</p> : (
            <table className="mdl-table">
              <thead><tr><th>Version</th><th>Locked by</th><th>When</th><th>Lock</th><th /></tr></thead>
              <tbody>
                {locked.map((v) => (
                  <tr key={v.id}>
                    <td><b>{v.name}</b>{v.note && <div className="mdl-muted">{v.note}</div>}<div className="mdl-filename">{v.fileName}</div></td>
                    <td>{v.lockedByEmail ? who(v.lockedByEmail, v.lockedByName) : <span className="mdl-muted">Imported</span>}</td>
                    <td>{when(v.lockedAt)}</td>
                    <td><LockBadge locked={v.locked} /></td>
                    <td className="mdl-actions">
                      <a href={sheetUrl(v.fileId)} target="_blank" rel="noreferrer">Open in Sheets ↗</a>
                      {!v.locked && <button type="button" className="mdl-btn" onClick={() => setAction({ title: `Lock ${v.name}`, start: () => modelingApi('POST', '/lock-file', { kind: 'version', id: v.id }) })}>Lock</button>}
                      <button type="button" className="mdl-btn" onClick={() => exportAction(v)}>Export</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="mdl-card">
          <div className="mdl-toolbar"><h3>Exports</h3></div>
          {!deal.exports.length ? <p className="mdl-empty">No exports yet.</p> : (
            <table className="mdl-table">
              <thead><tr><th>File</th><th>By</th><th>When</th><th /></tr></thead>
              <tbody>
                {deal.exports.map((e) => (
                  <tr key={e.id}>
                    <td>{e.fileName}</td>
                    <td>{who(e.exportedByEmail, e.exportedByName)}</td>
                    <td>{when(e.exportedAt)}</td>
                    <td className="mdl-actions">
                      <button type="button" className="mdl-btn" onClick={() => downloadExport(e.id, e.fileName).catch((err) => window.alert(err.message))}>Download</button>
                      <a href={fileUrl(e.fileId)} target="_blank" rel="noreferrer">In Drive ↗</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {locking && (
        <ActionModal
          title={`Lock a version of ${deal.name}`}
          submitLabel="Lock Version"
          canSubmit={!!versionName.trim()}
          onClose={() => { setLocking(false); load(); }}
          onFinished={load}
          onSubmit={() => modelingApi('POST', `/deals/${deal.id}/lock`, { name: versionName, note })}
        >
          <p className="mdl-muted">Copies the working model into Versions and locks the copy: view-only for everyone, only a drive Manager can unlock it. The working model stays editable.</p>
          <label>Version name<input value={versionName} onChange={(e) => setVersionName(e.target.value)} maxLength={60} autoFocus /></label>
          <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. IC draft" /></label>
        </ActionModal>
      )}
      {action && <StartedAction action={action} onClose={() => { setAction(null); load(); }} onFinished={load} />}
      {useTemplate && overview.data && (
        <UseTemplateModal templates={overview.data.templates} deals={overview.data.deals} presetDealId={deal.id} onClose={() => { setUseTemplate(false); load(); }} onFinished={load} />
      )}
    </div>
  );
}
