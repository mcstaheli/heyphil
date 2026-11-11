import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { modelingApi, sheetUrl, when, who } from './api';
import ActionModal from './ActionModal';
import OperationStatus from './OperationStatus';
import ImportPanel from './ImportPanel';
import LockBadge from './LockBadge';
import './Modeling.css';

// Labs -> Modeling: HeyPhil as the control layer for Philo's financial
// models (the Google Sheets stay the calculation engine). Deals, Templates,
// Import and Activity. Everything here works only inside the HeyPhil
// folder of the Philo 2.0 shared drive.

export function useOverview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      setData(await modelingApi('GET', '/overview'));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}

// ---------------------------------------------------------------- Use Template
export function UseTemplateModal({ templates, deals, presetDealId, onClose, onFinished }) {
  const usable = templates.filter((t) => t.releases.some((r) => r.status === 'active'));
  const preset = deals.find((d) => d.id === presetDealId);
  const [templateId, setTemplateId] = useState(preset ? preset.templateId : (usable[0]?.id || ''));
  const [mode, setMode] = useState(preset ? 'existing' : 'new');
  const [dealName, setDealName] = useState('');
  const [dealId, setDealId] = useState(preset ? preset.id : '');
  const template = usable.find((t) => t.id === Number(templateId));
  const active = template?.releases.find((r) => r.status === 'active');
  const openDeals = deals.filter((d) => d.templateId === Number(templateId) && !d.workingId);

  return (
    <ActionModal
      title="Use Template"
      submitLabel="Create working model"
      canSubmit={!!template && (mode === 'new' ? !!dealName.trim() : !!dealId)}
      onClose={onClose}
      onFinished={onFinished}
      onSubmit={() => modelingApi('POST', '/use-template', mode === 'new'
        ? { templateId: Number(templateId), dealName }
        : { templateId: Number(templateId), dealId: Number(dealId) })}
    >
      {!usable.length && <p className="mdl-error">No template has an Active release yet - release one and Mark Active on the Templates tab.</p>}
      <label>
        Template
        <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setDealId(''); }}>
          {usable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {active && <p className="mdl-muted">Copies the Active release <b>{active.version}</b> as the deal's editable working model.</p>}
      <div className="mdl-radio-row">
        <label><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> New deal</label>
        <label><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={!openDeals.length} /> Existing deal{!openDeals.length ? ' (none without a working model)' : ''}</label>
      </div>
      {mode === 'new' ? (
        <label>
          Deal name
          <input value={dealName} onChange={(e) => setDealName(e.target.value)} placeholder="e.g. Zion Promenade" maxLength={120} autoFocus />
          <span className="mdl-hint">Creates Projects / {dealName.trim() || '[Deal Name]'} / Financial Modeling (with Versions and Exports). If that deal folder already exists, it's used - never duplicated.</span>
        </label>
      ) : (
        <label>
          Deal
          <select value={dealId} onChange={(e) => setDealId(e.target.value)}>
            <option value="">Pick a deal…</option>
            {openDeals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
    </ActionModal>
  );
}

// ---------------------------------------------------------------- Deals
function DealsTab({ data, reload }) {
  const navigate = useNavigate();
  const [useTemplate, setUseTemplate] = useState(false);
  return (
    <div className="mdl-panel">
      <div className="mdl-toolbar">
        <h3>Deals</h3>
        <button type="button" className="mdl-btn mdl-btn-primary" onClick={() => setUseTemplate(true)}>+ Use Template</button>
      </div>
      {!data.deals.length ? (
        <p className="mdl-empty">No deals yet. Use Template starts one; Import registers deals already in the HeyPhil Projects folder.</p>
      ) : (
        <table className="mdl-table">
          <thead><tr><th>Deal</th><th>Template</th><th>Working model</th><th>Locked versions</th><th>Last locked</th></tr></thead>
          <tbody>
            {data.deals.map((d) => (
              <tr key={d.id} className="mdl-row-link" onClick={() => navigate(`/labs/modeling/deals/${d.id}`)}>
                <td><b>{d.name}</b></td>
                <td>{d.templateName}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {d.workingFileId ? <a href={sheetUrl(d.workingFileId)} target="_blank" rel="noreferrer">Open in Sheets ↗</a> : <span className="mdl-muted">None</span>}
                </td>
                <td>{d.lockedCount}</td>
                <td>{when(d.lastLockedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {useTemplate && (
        <UseTemplateModal templates={data.templates} deals={data.deals} onClose={() => { setUseTemplate(false); reload(); }} onFinished={reload} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Templates
function TemplatesTab({ data, reload }) {
  const [releasing, setReleasing] = useState(null);
  const [version, setVersion] = useState('');
  const [note, setNote] = useState('');
  const [action, setAction] = useState(null); // { title, start }
  const [message, setMessage] = useState(null);

  async function markActive(t, r) {
    const current = t.releases.find((x) => x.status === 'active');
    const ok = window.confirm(`Make ${r.version} the Active release of ${t.name}?\n\nNew deals will start from ${r.version}${current ? ` instead of ${current.version}` : ''}. Existing deals aren't changed.`);
    if (!ok) return;
    try {
      const res = await modelingApi('POST', `/releases/${r.id}/activate`);
      setMessage({ ok: true, text: `${res.version} is now the Active release of ${t.name}${res.previous ? ` (was ${res.previous})` : ''}.` });
    } catch (err) {
      setMessage({ ok: false, text: `Couldn't mark ${r.version} Active: ${err.message}` });
    }
    reload();
  }

  if (!data.templates.length) {
    return <div className="mdl-panel"><p className="mdl-empty">No templates registered yet. Open the Import tab and scan to register the templates in the HeyPhil Templates folder.</p></div>;
  }

  return (
    <div className="mdl-panel">
      {message && <p className={message.ok ? 'mdl-ok' : 'mdl-error'}>{message.text}</p>}
      {data.templates.map((t) => (
        <section key={t.id} className="mdl-card">
          <div className="mdl-toolbar">
            <h3>{t.name}</h3>
            <button type="button" className="mdl-btn mdl-btn-primary" onClick={() => { setReleasing(t); setVersion(t.suggestedVersion); setNote(''); }}>Release Template</button>
          </div>
          <p className="mdl-muted">Draft master: <a href={sheetUrl(t.draftFileId)} target="_blank" rel="noreferrer">Open in Sheets ↗</a></p>
          {!t.releases.length ? <p className="mdl-empty">No releases yet.</p> : (
            <table className="mdl-table">
              <thead><tr><th>Release</th><th>Status</th><th>Lock</th><th>Released</th><th>Activated</th><th /></tr></thead>
              <tbody>
                {t.releases.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.version}</b><div className="mdl-filename">{r.fileName}</div></td>
                    <td>{r.status === 'active' ? <span className="mdl-badge mdl-badge-active">Active</span> : <span className="mdl-muted">Draft</span>}</td>
                    <td><LockBadge locked={r.locked} /></td>
                    <td>{r.source === 'imported' ? <span className="mdl-muted">Imported</span> : who(r.releasedByEmail, r.releasedByName)}<div className="mdl-muted">{when(r.releasedAt)}</div></td>
                    <td>{r.activatedAt ? <>{who(r.activatedByEmail, r.activatedByName)}<div className="mdl-muted">{when(r.activatedAt)}</div></> : ''}</td>
                    <td className="mdl-actions">
                      <a href={sheetUrl(r.fileId)} target="_blank" rel="noreferrer">Open ↗</a>
                      {!r.locked && <button type="button" className="mdl-btn" onClick={() => setAction({ title: `Lock ${r.version}`, start: () => modelingApi('POST', '/lock-file', { kind: 'release', id: r.id }) })}>Lock</button>}
                      {r.locked && r.status !== 'active' && <button type="button" className="mdl-btn" onClick={() => markActive(t, r)}>Mark Active</button>}
                      <button type="button" className="mdl-btn" onClick={() => setAction({ title: `Export ${r.version} to Excel`, start: () => modelingApi('POST', '/export', { kind: 'release', id: r.id }) })}>Export</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      {releasing && (
        <ActionModal
          title={`Release ${releasing.name}`}
          submitLabel="Release"
          canSubmit={!!version.trim()}
          onClose={() => { setReleasing(null); reload(); }}
          onFinished={reload}
          onSubmit={() => modelingApi('POST', `/templates/${releasing.id}/release`, { version, note })}
        >
          <p className="mdl-muted">Copies the Draft master into Releases as a new, locked (view-only) release. It isn't Active until you Mark Active.</p>
          <label>Version<input value={version} onChange={(e) => setVersion(e.target.value)} maxLength={40} autoFocus /></label>
          <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What changed in this release" /></label>
        </ActionModal>
      )}
      {action && <StartedAction action={action} onClose={() => { setAction(null); reload(); }} onFinished={reload} />}
    </div>
  );
}

// Starts a one-click action (Lock, Export) and shows its progress.
export function StartedAction({ action, onClose, onFinished }) {
  const [opId, setOpId] = useState(null);
  const [error, setError] = useState(null);
  const [finished, setFinished] = useState(false);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return; // once, even under StrictMode's double effects
    startedRef.current = true;
    action.start().then((r) => setOpId(r.operation.id)).catch((e) => setError(e.message));
  }, [action]);
  const running = !error && !finished;
  return (
    <div className="modal-overlay" onClick={() => { if (!running) onClose(); }}>
      <div className="modal-content mdl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>{action.title}</h2></div>
        <div className="modal-body mdl-form">
          {error && <p className="mdl-error">Couldn't start: {error}</p>}
          {opId && <OperationStatus operationId={opId} onFinished={(op) => { setFinished(true); if (onFinished) onFinished(op); }} />}
          {!opId && !error && <p className="mdl-working">Starting…</p>}
        </div>
        <div className="modal-footer"><div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>{running ? 'Close (it keeps running)' : 'Close'}</button>
        </div></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Activity
const KIND_LABEL = { release: 'Release Template', 'use-template': 'Use Template', 'lock-version': 'Lock Version', 'lock-file': 'Lock file', export: 'Export to Excel' };

function ActivityTab() {
  const [ops, setOps] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => modelingApi('GET', '/operations').then((r) => setOps(r.operations)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (error) return <div className="mdl-panel"><p className="mdl-error">{error}</p></div>;
  if (!ops) return <div className="mdl-panel"><p className="mdl-muted">Loading…</p></div>;
  return (
    <div className="mdl-panel">
      <div className="mdl-toolbar"><h3>Activity</h3><button type="button" className="mdl-btn" onClick={load}>Refresh</button></div>
      {!ops.length ? <p className="mdl-empty">Nothing yet.</p> : (
        <table className="mdl-table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Result</th></tr></thead>
          <tbody>
            {ops.map((op) => (
              <React.Fragment key={op.id}>
                <tr className="mdl-row-link" onClick={() => setOpen(open === op.id ? null : op.id)}>
                  <td>{when(op.startedAt)}</td>
                  <td>{who(op.actorEmail, op.actorName)}{op.retriedByEmail ? <div className="mdl-muted">retried by {who(op.retriedByEmail)}</div> : null}</td>
                  <td>{KIND_LABEL[op.kind] || op.kind}<div className="mdl-muted">{op.params?.label}</div></td>
                  <td><span className={`mdl-badge mdl-status-${op.status}`}>{op.status === 'succeeded' ? 'Done' : op.status === 'failed' ? 'Stopped' : 'Running'}</span></td>
                </tr>
                {open === op.id && <tr><td colSpan={4}><OperationStatus operationId={op.id} onFinished={load} /></td></tr>}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- page
const TABS = [
  { id: 'deals', label: 'Deals' },
  { id: 'templates', label: 'Templates' },
  { id: 'import', label: 'Import' },
  { id: 'activity', label: 'Activity' },
];

export default function Modeling() {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('modeling:tab') || 'deals'; } catch { return 'deals'; }
  });
  const { data, error, reload } = useOverview();
  useEffect(() => { try { localStorage.setItem('modeling:tab', tab); } catch { /* private mode */ } }, [tab]);
  const counts = useMemo(() => data && { deals: data.deals.length, templates: data.templates.length }, [data]);

  return (
    <div className="mdl-page">
      <div className="mdl-header">
        <div>
          <h2>Modeling</h2>
          <p className="mdl-subtitle">Deals, templates and model versions. The models stay in Google Sheets; HeyPhil copies, locks and exports them.</p>
        </div>
      </div>
      <div className="mdl-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`mdl-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{counts && counts[t.id] !== undefined ? ` (${counts[t.id]})` : ''}
          </button>
        ))}
      </div>
      {error && <p className="mdl-error mdl-page-error">{error}</p>}
      {!data && !error && <p className="mdl-muted mdl-page-error">Loading…</p>}
      {data && tab === 'deals' && <DealsTab data={data} reload={reload} />}
      {data && tab === 'templates' && <TemplatesTab data={data} reload={reload} />}
      {tab === 'import' && <ImportPanel onImported={reload} />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  );
}
