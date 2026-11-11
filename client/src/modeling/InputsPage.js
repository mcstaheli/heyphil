import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { modelingApi, sheetUrl } from './api';
import OperationStatus from './OperationStatus';
import { outputDelta } from './resultsFormat';
import { LEVELS, visibleFields, isShown, toEditValue, answerFor, sheetValues, cellIsFormula, parseGridSpec, displayOf } from './inputsForm';
import './Modeling.css';

// Labs -> Modeling -> a model's inputs, step by step (TurboTax-style): the
// questions come from the template's HeyPhil Map. Quick shows the napkin
// questions; Standard and Everything add detail. Saving writes only what
// changed into the Google Sheet and shows how the headline results moved.
// Locked models are read-only.

function Field({ f, value, onChange, readOnly, overridden, onOverride }) {
  const calc = f.kind === 'input' && f.formula === true;
  const tableCalc = (f.kind === 'list' || f.kind === 'grid') && Array.isArray(f.formula) && f.formula.some((row) => row.some((x) => x === true));
  const disabled = readOnly || (calc && !overridden);
  const common = { disabled, className: 'mdl-input' };
  let control;
  if (f.kind === 'list') {
    const labels = String(f.options || '').split('|');
    control = (
      <table className="mdl-input-table"><tbody>
        {(value || []).map((row, r) => (
          <tr key={r}>
            <th>{labels[r] || `Row ${r + 1}`}</th>
            <td>{cellInput(f.type, row[0], (v) => onChange(value.map((x, i) => (i === r ? [v] : x))), disabled || (cellIsFormula(f, r, 0) && !overridden))}</td>
          </tr>
        ))}
      </tbody></table>
    );
  } else if (f.kind === 'grid') {
    const cols = parseGridSpec(f.options);
    control = (
      <div className="mdl-grid-scroll"><table className="mdl-input-table">
        <thead><tr>{cols.map((c) => <th key={c.col}>{c.label}</th>)}</tr></thead>
        <tbody>
          {(value || []).map((row, r) => (
            <tr key={r}>
              {cols.map((c, ci) => (
                <td key={c.col}>
                  {c.type === 'label'
                    ? <span className="mdl-grid-label">{row[ci] ?? ''}</span>
                    : cellInput(c.type, row[ci], (v) => onChange(value.map((x, i) => (i === r ? x.map((y, j) => (j === ci ? v : y)) : x))), disabled || (cellIsFormula(f, r, ci) && !overridden), c.choices)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table></div>
    );
  } else {
    control = cellInput(f.type, value, onChange, disabled, f.type === 'choice' ? String(f.options || '').split('|') : null, common.className);
  }
  return (
    <div className={`mdl-field mdl-field-${f.kind}`}>
      <label className="mdl-field-q">
        {f.question}
        {f.level === 'quick' && <span className="mdl-field-tag quick">Quick</span>}
        {calc && <span className="mdl-field-tag calc">Calculated</span>}
      </label>
      {f.help && <p className="mdl-field-help">{f.help}</p>}
      {f.kind === 'target' && <p className="mdl-field-help">Now {f.display ?? '-'} - HeyPhil adjusts the monthly curve so the year averages your answer.</p>}
      {control}
      {tableCalc && <p className="mdl-field-help">Greyed cells are calculated by the model.</p>}
      {(calc || tableCalc) && !readOnly && (
        <label className="mdl-check mdl-override">
          <input type="checkbox" checked={!!overridden} onChange={(e) => onOverride(e.target.checked)} /> Override the model's calculation
        </label>
      )}
    </div>
  );
}

function cellInput(type, value, onChange, disabled, choices = null, className = 'mdl-input mdl-input-cell') {
  if (type === 'choice') {
    return (
      <select className={className} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">-</option>
        {(choices || []).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  if (type === 'month') {
    return <input className={className} type="month" value={value ? String(value).slice(0, 7) : ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
  const suffix = type === 'percent' ? '%' : type === 'multiple' ? 'x' : null;
  const prefix = type === 'currency' ? '$' : null;
  return (
    <span className="mdl-input-wrap">
      {prefix && <span className="mdl-input-affix">{prefix}</span>}
      <input className={className} inputMode={type === 'text' ? 'text' : 'decimal'} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {suffix && <span className="mdl-input-affix">{suffix}</span>}
    </span>
  );
}

export default function InputsPage() {
  const { modelId } = useParams();
  const navigate = useNavigate();
  // guided: a new deal just made by Use Template - Quick questions, step by
  // step, ending in "Finish and see results"
  const guided = new URLSearchParams(useLocation().search).get('guided') === '1';
  const [finishing, setFinishing] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [level, setLevel] = useState(() => {
    if (new URLSearchParams(window.location.search).get('guided') === '1') return 'quick';
    try { return localStorage.getItem('modeling:level') || 'quick'; } catch { return 'quick'; }
  });
  const [stepKey, setStepKey] = useState(null);
  const [edits, setEdits] = useState({}); // key -> edit value (display units)
  const [overrides, setOverrides] = useState({});
  const [saving, setSaving] = useState(null); // operation id
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await modelingApi('GET', `/models/${modelId}/inputs`));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [modelId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { localStorage.setItem('modeling:level', level); } catch { /* private mode */ } }, [level]);

  const fields = useMemo(() => data?.inputs.fields || [], [data]);
  // current value of every field in edit units, with edits applied
  const current = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.key in edits ? edits[f.key] : toEditValue(f)])), [fields, edits]);
  const sheetNow = useMemo(() => sheetValues(fields, edits), [fields, edits]);
  const shown = useMemo(() => visibleFields(fields, level).filter((f) => isShown(f, sheetNow, fields)), [fields, level, sheetNow]);
  const steps = useMemo(() => (data?.inputs.steps || []).filter((s) => shown.some((f) => f.step === s.key)), [data, shown]);
  const active = steps.find((s) => s.key === stepKey) || steps[0];
  // only fields still on screen count (and get saved) - an answer on a
  // question the person has since hidden (e.g. by changing the loan sizing
  // method) is dropped, not written behind their back
  const changedKeys = Object.keys(edits).filter((k) => {
    const f = shown.find((x) => x.key === k);
    if (!f) return false;
    if (f.kind === 'list' || f.kind === 'grid') return answerFor(f, edits[k]) !== null;
    return JSON.stringify(edits[k]) !== JSON.stringify(toEditValue(f));
  });

  if (error) return <div className="mdl-page"><p className="mdl-error mdl-page-error">{error}</p></div>;
  if (!data) return <div className="mdl-page"><p className="mdl-working mdl-page-error">Reading the model's inputs from Google Sheets…</p></div>;

  const readOnly = data.model.locked;
  const idx = steps.indexOf(active);

  // guided finish: save what was answered, then the project page's results
  async function finish() {
    const goToProject = () => navigate(data.model.projectId ? `/labs/modeling/projects/${data.model.projectId}` : '/labs/modeling');
    if (!changedKeys.length) { goToProject(); return; }
    setFinishing(true);
    const answers = {};
    for (const k of changedKeys) answers[k] = answerFor(fields.find((f) => f.key === k), edits[k]);
    try {
      const r = await modelingApi('POST', `/models/${modelId}/inputs`, { answers, overrides });
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { operation } = await modelingApi('GET', `/operations/${r.operation.id}`);
        if (operation.status === 'succeeded') { goToProject(); return; }
        if (operation.status === 'failed') { setResult({ error: operation.error }); setFinishing(false); return; }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, 1200));
      }
    } catch (err) {
      setResult({ error: err.message });
      setFinishing(false);
    }
  }

  async function save() {
    setResult(null);
    const answers = {};
    for (const k of changedKeys) answers[k] = answerFor(fields.find((f) => f.key === k), edits[k]);
    try {
      const r = await modelingApi('POST', `/models/${modelId}/inputs`, { answers, overrides });
      setSaving(r.operation.id);
    } catch (err) {
      setResult({ error: err.message });
    }
  }

  return (
    <div className="mdl-page">
      <div className="mdl-header">
        <div>
          <button type="button" className="mdl-back" onClick={() => navigate(-1)}>← Back</button>
          <h2>Inputs · {data.model.version}{data.model.label ? ` · ${data.model.label}` : ''}</h2>
          <p className="mdl-subtitle">
            {readOnly ? '🔒 Locked - read only. Make a copy to change it.' : 'Changes are written into the Google Sheet when you save.'}
            {' · '}<a href={sheetUrl(data.model.fileId)} target="_blank" rel="noreferrer">Open in Sheets ↗</a>
          </p>
        </div>
      </div>
      <div className="mdl-tabs" role="tablist">
        {LEVELS.map((l) => (
          <button key={l.id} type="button" role="tab" aria-selected={level === l.id} className={`mdl-tab ${level === l.id ? 'active' : ''}`} onClick={() => setLevel(l.id)} title={l.help}>{l.label}</button>
        ))}
      </div>
      {guided && (
        <div className="mdl-guided">
          <strong>New deal: answer the Quick questions.</strong> Everything else starts from the template's defaults - you can add detail any time from Standard or Everything.
          {' '}Step {Math.max(idx, 0) + 1} of {steps.length}.
        </div>
      )}
      {data.inputs.problems?.length > 0 && <p className="mdl-warn mdl-page-error">⚠ {data.inputs.problems.join(' ')}</p>}
      {!fields.length ? <p className="mdl-empty mdl-page-error">This model has no input map yet.</p> : (
        <div className="mdl-wizard">
          <nav className="mdl-steps-nav">
            {steps.map((s, i) => {
              const n = shown.filter((f) => f.step === s.key && changedKeys.includes(f.key)).length;
              return (
                <button key={s.key} type="button" className={`mdl-step-link ${s === active ? 'active' : ''}`} onClick={() => setStepKey(s.key)}>
                  <span className="mdl-step-num">{i + 1}</span>{s.title}{n ? <span className="mdl-step-changed">{n}</span> : null}
                </button>
              );
            })}
          </nav>
          <div className="mdl-step-body">
            {active && (
              <>
                <h3>{active.title}</h3>
                {active.intro && <p className="mdl-muted">{active.intro}</p>}
                {shown.filter((f) => f.step === active.key).map((f) => (
                  <Field
                    key={f.key}
                    f={f}
                    value={current[f.key]}
                    readOnly={readOnly}
                    overridden={overrides[f.key]}
                    onOverride={(on) => setOverrides((o) => ({ ...o, [f.key]: on }))}
                    onChange={(v) => setEdits((e) => ({ ...e, [f.key]: v }))}
                  />
                ))}
                <div className="mdl-step-nav">
                  <button type="button" className="mdl-btn" disabled={idx <= 0} onClick={() => setStepKey(steps[idx - 1].key)}>← Back</button>
                  {guided && idx >= steps.length - 1 ? (
                    <button type="button" className="mdl-btn mdl-btn-primary" disabled={finishing || !!saving} onClick={finish}>
                      {finishing ? 'Saving…' : 'Finish and see results →'}
                    </button>
                  ) : (
                    <button type="button" className={`mdl-btn ${guided ? 'mdl-btn-primary' : ''}`} disabled={idx >= steps.length - 1} onClick={() => setStepKey(steps[idx + 1].key)}>Next →</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!readOnly && (changedKeys.length > 0 || saving || result) && (
        <div className="mdl-savebar">
          {saving ? (
            <OperationStatus
              operationId={saving}
              onFinished={(op) => {
                setSaving(null);
                if (op.status === 'succeeded') {
                  setResult({ changes: op.state.changes || [], before: op.state.before || [], after: op.state.after || [] });
                  setEdits({});
                  setOverrides({});
                  load();
                } else {
                  setResult({ error: op.error });
                }
              }}
            />
          ) : result ? (
            <div className="mdl-save-result">
              {result.error ? <p className="mdl-error">Not saved: {result.error}</p> : (
                <>
                  <strong>Saved {result.changes.length} change{result.changes.length === 1 ? '' : 's'}.</strong>
                  <div className="mdl-moved">
                    {result.after.map((a) => {
                      const b = result.before.find((x) => x.key === a.key);
                      const d = b ? outputDelta(a.type, b.raw, a.raw) : null;
                      if (!d || d.label === '-') return null;
                      return <span key={a.key} className="mdl-moved-item">{a.label}: {displayOf(b)} → <b>{displayOf(a)}</b> <span className="mdl-delta">{d.label}</span></span>;
                    })}
                  </div>
                </>
              )}
              <button type="button" className="mdl-btn" onClick={() => setResult(null)}>OK</button>
            </div>
          ) : (
            <>
              <span>{changedKeys.length} change{changedKeys.length === 1 ? '' : 's'} not saved</span>
              <button type="button" className="mdl-btn" onClick={() => { setEdits({}); setOverrides({}); }}>Discard</button>
              <button type="button" className="mdl-btn mdl-btn-primary" onClick={save}>Save to the model</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
