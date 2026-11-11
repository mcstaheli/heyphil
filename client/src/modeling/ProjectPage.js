import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { modelingApi, folderUrl, fileUrl, when, who, downloadExport } from './api';
import ModelTree from './ModelTree';
import ResultsPanel from './ResultsPanel';
import { StartedAction, UseTemplateModal, useOverview } from './Modeling';
import './Modeling.css';

// Labs -> Modeling -> a project: its ★ Active model, the ☆ starred ones
// being worked with, the full family tree of its models, and its exports.
export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [action, setAction] = useState(null);
  const [useTemplate, setUseTemplate] = useState(false);
  const overview = useOverview();

  const load = useCallback(async () => {
    try {
      const r = await modelingApi('GET', `/projects/${projectId}`);
      setProject(r.project);
      setError(null);
    } catch (err) {
      setError(err.status === 404 ? 'This project was not found.' : err.message);
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="mdl-page"><p className="mdl-error mdl-page-error">{error}</p></div>;
  if (!project) return <div className="mdl-page"><p className="mdl-muted mdl-page-error">Loading…</p></div>;

  return (
    <div className="mdl-page">
      <div className="mdl-header">
        <div>
          <button type="button" className="mdl-back" onClick={() => navigate('/labs/modeling')}>← Modeling</button>
          <h2>{project.name}</h2>
          <p className="mdl-subtitle">
            {project.models.length} model{project.models.length === 1 ? '' : 's'}
            {project.fmFolderId && <> · <a href={folderUrl(project.fmFolderId)} target="_blank" rel="noreferrer">Financial Modeling folder ↗</a></>}
          </p>
        </div>
      </div>

      <div className="mdl-panel">
        <section className="mdl-card">
          <div className="mdl-toolbar"><h3>Results</h3></div>
          <ResultsPanel project={project} />
        </section>

        <section className="mdl-card">
          <div className="mdl-toolbar">
            <h3>Models</h3>
            <button type="button" className="mdl-btn" onClick={() => setUseTemplate(true)} disabled={!overview.data}>+ New model from a template</button>
          </div>
          <p className="mdl-muted">To change a locked model: <b>Copy</b> it, edit the copy in Sheets, then <b>Make Active</b> when it's the one. ☆ Star the copies you're working with so the team can see them.</p>
          <ModelTree models={project.models} ownerName={project.name} historyKey={`project:${project.id}`} onAction={setAction} onChanged={load} emptyText="No models yet - start one from a template." />
        </section>

        <section className="mdl-card">
          <div className="mdl-toolbar"><h3>Exports</h3></div>
          {!project.exports.length ? <p className="mdl-empty">No exports yet.</p> : (
            <table className="mdl-table">
              <thead><tr><th>File</th><th>Model</th><th>By</th><th>When</th><th /></tr></thead>
              <tbody>
                {project.exports.map((e) => (
                  <tr key={e.id}>
                    <td>{e.fileName}</td>
                    <td>{e.modelVersion}</td>
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

      {action && <StartedAction action={action} onClose={() => { setAction(null); load(); }} onFinished={load} />}
      {useTemplate && overview.data && (
        <UseTemplateModal templates={overview.data.templates} projects={overview.data.projects} presetProjectId={project.id} onClose={() => { setUseTemplate(false); load(); }} onFinished={load} />
      )}
    </div>
  );
}
