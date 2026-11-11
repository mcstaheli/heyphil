import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { modelingApi, sheetUrl, when } from './api';
import ActionModal from './ActionModal';
import OperationStatus from './OperationStatus';
import ImportPanel from './ImportPanel';
import ModelTree, { title } from './ModelTree';
import './Modeling.css';

// Labs -> Modeling: HeyPhil as the control layer for Philo's financial
// models (the Google Sheets stay the calculation engine).
//   Templates stand on their own; Projects may use a template; every
//   spreadsheet is a Model with a version number, Unlocked or Locked, at
//   most one Active per template/project (always Locked), ☆ starred when
//   it's being worked with, and a parent - the family tree.
// Everything works only inside the HeyPhil folder of the Philo 2.0 drive.

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
export function UseTemplateModal({ templates, projects, presetProjectId, onClose, onFinished }) {
  const usable = templates.filter((t) => t.models.some((m) => m.isActive));
  const [templateId, setTemplateId] = useState(usable[0]?.id || '');
  const [mode, setMode] = useState(presetProjectId ? 'existing' : 'new');
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState(presetProjectId || '');
  const [label, setLabel] = useState('');
  const [nextVersion, setNextVersion] = useState('v1');
  const template = usable.find((t) => t.id === Number(templateId));
  const active = template?.models.find((m) => m.isActive);

  useEffect(() => {
    if (mode === 'existing' && projectId) {
      modelingApi('GET', `/projects/${projectId}/next-version`).then((r) => setNextVersion(r.version)).catch(() => setNextVersion('?'));
    } else {
      setNextVersion('v1');
    }
  }, [mode, projectId]);

  return (
    <ActionModal
      title="Use Template"
      submitLabel={`Create ${nextVersion}`}
      canSubmit={!!template && (mode === 'new' ? !!projectName.trim() : !!projectId)}
      onClose={onClose}
      onFinished={onFinished}
      onSubmit={() => modelingApi('POST', '/use-template', mode === 'new'
        ? { templateId: Number(templateId), projectName, label }
        : { templateId: Number(templateId), projectId: Number(projectId), label })}
    >
      {!usable.length && <p className="mdl-error">No template has an Active model yet - Make Active on the Templates tab.</p>}
      <label>
        Template
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {usable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {active && <p className="mdl-muted">Copies the template's Active model <b>{title(active)}</b> into the project as an editable model, <b>{nextVersion}</b>.</p>}
      <div className="mdl-radio-row">
        <label><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> New project</label>
        <label><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={!projects.length} /> Existing project</label>
      </div>
      {mode === 'new' ? (
        <label>
          Project name
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g. Zion Promenade" maxLength={120} autoFocus />
          <span className="mdl-hint">Creates Projects / {projectName.trim() || '[Project]'} / Financial Modeling / Models (and Exports). If the project folder already exists, it's used - never duplicated.</span>
        </label>
      ) : (
        <label>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Pick a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <label>Label (optional)<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. Base case" /></label>
    </ActionModal>
  );
}

// ---------------------------------------------------------------- Projects
function ProjectsTab({ data, reload }) {
  const navigate = useNavigate();
  const [useTemplate, setUseTemplate] = useState(false);
  return (
    <div className="mdl-panel">
      <div className="mdl-toolbar">
        <h3>Projects</h3>
        <button type="button" className="mdl-btn mdl-btn-primary" onClick={() => setUseTemplate(true)}>+ Use Template</button>
      </div>
      {!data.projects.length ? (
        <p className="mdl-empty">No projects yet. Use Template starts one; Import registers projects already in the HeyPhil Projects folder.</p>
      ) : (
        <table className="mdl-table">
          <thead><tr><th>Project</th><th>★ Active model</th><th>☆ Starred</th><th>Models</th><th>Template</th></tr></thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.id} className="mdl-row-link" onClick={() => navigate(`/labs/modeling/projects/${p.id}`)}>
                <td><b>{p.name}</b></td>
                <td onClick={(e) => e.stopPropagation()}>
                  {p.activeId
                    ? <><a href={sheetUrl(p.activeFileId)} target="_blank" rel="noreferrer">{p.activeLabel ? `${p.activeVersion} · ${p.activeLabel}` : p.activeVersion} ↗</a><div className="mdl-muted">since {when(p.activatedAt)}</div></>
                    : <span className="mdl-muted">None yet</span>}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {(p.starred || []).length
                    ? (p.starred || []).map((s) => <a key={s.id} className="mdl-chip" href={sheetUrl(s.fileId)} target="_blank" rel="noreferrer">{s.label ? `${s.version} · ${s.label}` : s.version}</a>)
                    : <span className="mdl-muted">-</span>}
                </td>
                <td>{p.modelCount}{p.unlockedCount ? <span className="mdl-muted"> ({p.unlockedCount} unlocked)</span> : null}</td>
                <td>{p.templateNames || <span className="mdl-muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {useTemplate && (
        <UseTemplateModal templates={data.templates} projects={data.projects} onClose={() => { setUseTemplate(false); reload(); }} onFinished={reload} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Templates
function TemplatesTab({ data, reload }) {
  const [action, setAction] = useState(null);
  if (!data.templates.length) {
    return <div className="mdl-panel"><p className="mdl-empty">No templates registered yet. Open the Import tab and scan to register the templates in the HeyPhil Templates folder.</p></div>;
  }
  return (
    <div className="mdl-panel">
      {data.templates.map((t) => (
        <section key={t.id} className="mdl-card">
          <div className="mdl-toolbar"><h3>{t.name}</h3></div>
          <p className="mdl-muted">To change it: <b>Copy</b> the Active model, edit the copy in Sheets, then <b>Make Active</b> (it locks it first). New projects start from the Active model.</p>
          <ModelTree models={t.models} ownerName={t.name} historyKey={`template:${t.id}`} onAction={setAction} onChanged={reload} emptyText="No models yet." />
        </section>
      ))}
      {action && <StartedAction action={action} onClose={() => { setAction(null); reload(); }} onFinished={reload} />}
    </div>
  );
}

// Starts a one-click action (Lock, Make Active, Export) and shows its progress.
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
const KIND_LABEL = {
  copy: 'Copy', 'use-template': 'Use Template', lock: 'Lock', export: 'Export to Excel',
  // from the first version of Modeling
  release: 'Release Template', 'lock-version': 'Lock Version', 'lock-file': 'Lock file', promote: 'Make working model',
};

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
                  <td>{op.actorName || op.actorEmail}{op.retriedByEmail ? <div className="mdl-muted">retried by {op.retriedByEmail}</div> : null}</td>
                  <td>{op.kind === 'lock' && op.params?.activate ? 'Make Active' : (KIND_LABEL[op.kind] || op.kind)}<div className="mdl-muted">{op.params?.label}</div></td>
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
  { id: 'projects', label: 'Projects' },
  { id: 'templates', label: 'Templates' },
  { id: 'import', label: 'Import' },
  { id: 'activity', label: 'Activity' },
];

export default function Modeling() {
  const [tab, setTab] = useState(() => {
    try {
      const t = localStorage.getItem('modeling:tab');
      return TABS.some((x) => x.id === t) ? t : 'projects';
    } catch { return 'projects'; }
  });
  const { data, error, reload } = useOverview();
  useEffect(() => { try { localStorage.setItem('modeling:tab', tab); } catch { /* private mode */ } }, [tab]);
  const counts = useMemo(() => data && { projects: data.projects.length, templates: data.templates.length }, [data]);

  return (
    <div className="mdl-page">
      <div className="mdl-header">
        <div>
          <h2>Modeling</h2>
          <p className="mdl-subtitle">Projects, templates and their models. The models stay in Google Sheets; HeyPhil copies, locks, versions and exports them.</p>
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
      {data && tab === 'projects' && <ProjectsTab data={data} reload={reload} />}
      {data && tab === 'templates' && <TemplatesTab data={data} reload={reload} />}
      {tab === 'import' && <ImportPanel onImported={reload} />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  );
}
