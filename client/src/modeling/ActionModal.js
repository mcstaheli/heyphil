import React, { useState } from 'react';
import OperationStatus from './OperationStatus';

// A dialog for one long action: the form, then (once started) its live
// progress and result. While it's running the dialog can't be dismissed by
// clicking outside - closing never stops the action, which carries on and
// shows in Activity.
export default function ActionModal({ title, submitLabel, onSubmit, onClose, onFinished, children, canSubmit = true, startedOperationId = null }) {
  const [operationId, setOperationId] = useState(startedOperationId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [finished, setFinished] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit();
      if (result && result.operation) setOperationId(result.operation.id);
      else { setFinished(true); if (onFinished) onFinished(result); }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const running = operationId && !finished;
  return (
    <div className="modal-overlay" onClick={() => { if (!busy && !running) onClose(); }}>
      <form className="modal-content mdl-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header"><h2>{title}</h2></div>
        <div className="modal-body mdl-form">
          {!operationId && children}
          {operationId && (
            <OperationStatus
              operationId={operationId}
              onFinished={(op) => { setFinished(true); if (onFinished) onFinished(op); }}
            />
          )}
          {error && <p className="mdl-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <div className="modal-actions">
            {!operationId ? (
              <>
                <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>{busy ? 'Starting…' : submitLabel}</button>
              </>
            ) : (
              <button type="button" className="btn-primary" onClick={onClose}>
                {running ? 'Close (it keeps running)' : 'Close'}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
