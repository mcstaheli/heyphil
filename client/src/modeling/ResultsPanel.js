import React, { useCallback, useEffect, useRef, useState } from 'react';
import { modelingApi } from './api';
import { title } from './ModelTree';
import { outputDelta, readAtLabel } from './resultsFormat';

// A project's results: the Active model's headline numbers as cards, and -
// once anything is starred - a side-by-side comparison with the starred
// models (each value with its difference from the Active one). "Show all
// results" opens every group from the template's HeyPhil Map.
export default function ResultsPanel({ project }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(false);

  const shown = project.models.filter((m) => m.isActive || (m.starredAt && !m.hiddenAt));
  const ids = shown.map((m) => m.id).join(',');

  // only the latest request may set the data (an older, slower response
  // must not overwrite a newer one); data remembers which models it's for
  const seq = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const mine = ++seq.current;
    if (!ids) { setData({ ids, results: [] }); return; }
    setLoading(true);
    setError(null);
    try {
      const d = await modelingApi('GET', `/projects/${project.id}/results?models=${ids}${refresh ? '&refresh=1' : ''}`);
      if (mine === seq.current) setData({ ...d, ids });
    } catch (err) {
      if (mine === seq.current) setError(err.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [project.id, ids]);
  useEffect(() => { load(); }, [load]);

  if (!shown.length) {
    return <p className="mdl-empty">Results show here once the project has an Active model (or you star one to look at).</p>;
  }
  if (error) return <p className="mdl-error">Couldn't read the results: {error} <button type="button" className="mdl-linkbtn" onClick={() => load(true)}>Try again</button></p>;
  if (!data || data.ids !== ids) return <p className="mdl-working">Reading the results from Google Sheets…</p>;

  const byId = new Map(data.results.map((r) => [r.modelId, r]));
  // compared against the Active model - or, with none, the first shown
  // (labelled as the base so the differences read right)
  const active = shown.find((m) => m.isActive) || shown[0];
  const hasActive = !!shown.find((m) => m.isActive);
  const base = byId.get(active.id);
  const cols = [active, ...shown.filter((m) => m.id !== active.id)];
  const problems = data.results.flatMap((r) => (r.error ? [`${title(project.models.find((m) => m.id === r.modelId) || { version: '?' })}: ${r.error}`] : r.problems || []));

  // rows: headline outputs, or every output when "Show all"
  const rowsFrom = (r) => (r ? r.groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.name }))) : []);
  // every output any shown model has, in the fullest model's order
  const fullest = [...data.results].sort((a, b) => rowsFrom(b).length - rowsFrom(a).length)[0];
  const baseRows = rowsFrom(fullest);
  const rows = all ? baseRows : baseRows.filter((i) => i.level === 'headline');
  const valueOf = (modelId, key) => rowsFrom(byId.get(modelId)).find((i) => i.key === key);

  return (
    <div className="mdl-results">
      <div className="mdl-results-meta">
        <span className="mdl-muted">{readAtLabel(base)}{base?.mapSource === 'template' ? ` · using the ${base.mapTemplateVersion} template's map` : ''}</span>
        <button type="button" className="mdl-btn" onClick={() => load(true)} disabled={loading}>{loading ? 'Reading…' : 'Refresh'}</button>
      </div>
      {problems.length > 0 && <p className="mdl-warn">⚠ {problems.join(' ')}</p>}

      {cols.length === 1 ? (
        <div className="mdl-kpis">
          {(base?.headline || []).map((h) => (
            <div key={h.key} className="mdl-kpi">
              <div className="mdl-kpi-label">{h.label}</div>
              <div className="mdl-kpi-value">{h.display ?? '-'}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mdl-compare-scroll">
          <table className="mdl-table mdl-compare">
            <thead>
              <tr>
                <th>Result</th>
                {cols.map((m) => (
                  <th key={m.id} className={m.isActive ? 'mdl-compare-active' : 'mdl-compare-starred'}>
                    {m.isActive ? '★ ' : '☆ '}{title(m)}
                    {!hasActive && m.id === active.id && <div className="mdl-compare-sub">base - others compared to this</div>}
                    {byId.get(m.id)?.source === 'live' && !m.locked && <div className="mdl-compare-sub">editable · live</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <React.Fragment key={row.key}>
                  {all && (i === 0 || rows[i - 1].group !== row.group) && (
                    <tr className="mdl-compare-group"><td colSpan={cols.length + 1}>{row.group}</td></tr>
                  )}
                  <tr className={row.level === 'headline' ? 'mdl-compare-headline' : ''}>
                    <td>{row.label}</td>
                    {cols.map((m) => {
                      const v = valueOf(m.id, row.key);
                      const d = m.id === active.id || !v ? null : outputDelta(row.type, row.raw, v.raw);
                      return (
                        <td key={m.id} className="mdl-compare-cell">
                          <span>{v?.display ?? '-'}</span>
                          {d && d.label !== '-' && <span className={`mdl-delta ${d.value > 0 ? 'up' : 'down'}`}>{d.label}</span>}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {baseRows.length > 0 && (
        <button type="button" className="mdl-linkbtn mdl-results-all" onClick={() => setAll((a) => !a)}>
          {all ? 'Show headline results only' : `Show all ${baseRows.length} results`}
        </button>
      )}
      {all && cols.length === 1 && base && (
        <div className="mdl-results-groups">
          {base.groups.map((g) => (
            <div key={g.name} className="mdl-results-group">
              <h4>{g.name}</h4>
              <dl>
                {g.items.map((i) => (
                  <div key={i.key} className={i.level === 'headline' ? 'mdl-results-headline' : ''}>
                    <dt>{i.label}</dt><dd>{i.display ?? '-'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
