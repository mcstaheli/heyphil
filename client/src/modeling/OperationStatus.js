import React, { useEffect, useRef, useState } from 'react';
import { modelingApi, sheetUrl, folderUrl, fileUrl, downloadExport } from './api';

// Live progress for one long action (copy, lock, export...): each step
// with its state, then a clear success or failure. On failure it lists
// what was and wasn't done, links anything already created, and offers
// Retry (which resumes from the failed step - nothing is redone or
// deleted).
const ICON = { pending: '○', running: '⏳', done: '✓', failed: '✗' };

export function createdLinks(state = {}) {
  const links = [];
  if (state.dealFolderId) links.push({ label: 'Deal folder', href: folderUrl(state.dealFolderId) });
  if (state.fileId) links.push({ label: state.fileName || 'New file', href: sheetUrl(state.fileId) });
  if (state.exportFileId) links.push({ label: state.exportFileName || 'Export', href: fileUrl(state.exportFileId) });
  return links;
}

export default function OperationStatus({ operationId, onFinished }) {
  const [op, setOp] = useState(null);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const finishedRef = useRef(false);
  const downloadedRef = useRef(false);

  useEffect(() => {
    let stop = false;
    let timer;
    finishedRef.current = false;
    async function poll() {
      try {
        const { operation } = await modelingApi('GET', `/operations/${operationId}`);
        if (stop) return;
        setOp(operation);
        setError(null);
        if (operation.status === 'running') {
          timer = setTimeout(poll, 1000);
        } else if (!finishedRef.current) {
          finishedRef.current = true;
          if (onFinished) onFinished(operation);
        }
      } catch (err) {
        if (stop) return;
        setError(`Couldn't check progress (${err.message}) - still trying.`);
        timer = setTimeout(poll, 3000);
      }
    }
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [operationId, retrying]); // eslint-disable-line react-hooks/exhaustive-deps

  // A finished export downloads by itself, once.
  useEffect(() => {
    if (op && op.kind === 'export' && op.status === 'succeeded' && op.state?.exportId && !downloadedRef.current) {
      downloadedRef.current = true;
      downloadExport(op.state.exportId, op.state.exportFileName).catch((e) => setError(e.message));
    }
  }, [op]);

  async function retry() {
    setError(null);
    try {
      await modelingApi('POST', `/operations/${operationId}/retry`);
      setRetrying((r) => !r);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!op) return <div className="mdl-op"><p className="mdl-muted">Starting…</p>{error && <p className="mdl-error">{error}</p>}</div>;

  const done = op.steps.filter((s) => s.status === 'done');
  const notDone = op.steps.filter((s) => s.status !== 'done');
  const links = createdLinks(op.state);

  return (
    <div className={`mdl-op mdl-op-${op.status}`} aria-live="polite">
      <ol className="mdl-steps">
        {op.steps.map((s) => (
          <li key={s.key} className={`mdl-step mdl-step-${s.status}`}>
            <span className="mdl-step-icon">{ICON[s.status] || '○'}</span>
            <span>
              {s.label}
              {s.detail && <span className="mdl-step-detail"> - {s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>

      {op.status === 'running' && <p className="mdl-working">Working… this can take several seconds.</p>}

      {op.status === 'succeeded' && (
        <div className="mdl-result mdl-result-ok">
          <strong>Done.</strong>
          {op.kind === 'export' && op.state?.exportId && (
            <> The download should start on its own - {' '}
              <button type="button" className="mdl-linkbtn" onClick={() => downloadExport(op.state.exportId, op.state.exportFileName).catch((e) => setError(e.message))}>download again</button>.
            </>
          )}
          {links.length > 0 && <div className="mdl-links">{links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer">{l.label} ↗</a>)}</div>}
        </div>
      )}

      {op.status === 'failed' && (
        <div className="mdl-result mdl-result-failed">
          <strong>It stopped: {op.error}</strong>
          <p><b>Done:</b> {done.length ? done.map((s) => s.label).join('; ') : 'nothing'}.</p>
          <p><b>Not done:</b> {notDone.map((s) => s.label).join('; ')}.</p>
          {links.length > 0 && (
            <p>Already created (nothing was deleted): {links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer">{l.label} ↗</a>)}</p>
          )}
          <button type="button" className="mdl-btn mdl-btn-primary" onClick={retry}>Retry the remaining steps</button>
        </div>
      )}
      {error && <p className="mdl-error">{error}</p>}
    </div>
  );
}
