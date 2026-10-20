import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ASSET_TYPES, effectiveSettings, fieldsFor, getAssetType } from './assetTypes';
import { hasSurfaceParking } from './solver';
import {
  MAX_OPTIONS, MEASURES, buildRuns, countRuns, filterAndSort, measureOf, meetsGoals, regenerateSweeps, runOptions, settingKeys,
} from './generator';
import { NumberInput, fmtDec, fmtInt, fmtMoney, fmtPct } from './settingsFields';

// "Generate options": pick asset types and up to three settings to sweep,
// run every combination, keep the ones that meet your goals (any
// measure), see them on a chart, and turn one into a scheme - or
// regenerate around it with finer steps.

const SUGGESTED = ['floors', 'buildingDepth', 'parkingRatio', 'lotWidth', 'maxBuildingDepth', 'maxBuildingLength', 'stallAngle', 'parkingRotation'];
// One fixed hue per asset type in the run, in the order picked.
const TYPE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const MAX_TYPES = TYPE_COLORS.length;

// Parking orientation is swept as an angle; "Best fit" isn't a number.
const PARKING_ORIENTATION = { key: 'parkingRotation', label: 'Parking orientation', unit: '°', step: 15, group: 'Parking' };

function defaultSweep(field, current) {
  if (field.options) return { key: field.key, values: field.options.map(([v]) => v) };
  if (field.key === 'parkingRotation') return { key: field.key, from: 0, to: 165, step: 15 };
  const cur = Number.isFinite(current) ? current : (field.default || 0);
  if (field.key === 'floors') return { key: 'floors', from: Math.max(1, cur - 1), to: cur + 2, step: 1 };
  const step = field.step || (cur >= 100 ? 10 : cur >= 20 ? 5 : 1);
  return { key: field.key, from: Math.max(0, cur - 2 * step), to: cur + 2 * step, step };
}

const fmtMeasure = (key, v) => {
  const kind = measureOf(key).kind;
  if (kind === 'money') return fmtMoney(v);
  if (kind === 'pct') return fmtPct(v, key === 'yieldOnCost' ? 2 : 1);
  if (kind === 'dec') return fmtDec(v, 2);
  // Yield can be MW of IT load: keep its decimal.
  if (key === 'yield' && Math.abs(v) < 100 && !Number.isInteger(v)) return fmtDec(v, 1);
  return fmtInt(v);
};
const isPct = (key) => measureOf(key).kind === 'pct';

// Every option on two measures: kept ones in their type's color, the rest
// hollow and grey. Hover for its numbers; click to pick it in the table.
function OptionsChart({ options, filters, x, y, colorOf, picked, onPick }) {
  const W = 640;
  const H = 260;
  const pad = { l: 64, r: 12, t: 10, b: 34 };
  const [hover, setHover] = useState(null);
  // Worked out once per run and set of goals, not on every hover.
  const pts = useMemo(() => options.map((o, i) => ({ o, i, kept: meetsGoals(o, filters) })).filter((p) => !p.o.error), [options, filters]);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.o.measures[x]);
  const ys = pts.map((p) => p.o.measures[y]);
  const span = (vs) => {
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return hi - lo > 1e-9 ? [lo, hi] : [lo - 1, hi + 1];
  };
  const [x0, x1] = span(xs);
  const [y0, y1] = span(ys);
  const sx = (v) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const sy = (v) => H - pad.b - ((v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const ticks = (lo, hi) => [0, 0.5, 1].map((t) => lo + t * (hi - lo));
  return (
    <div className="siteplan-gen-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Options by ${measureOf(x).label} and ${measureOf(y).label}`}>
        {ticks(y0, y1).map((v) => (
          <g key={`y${v}`}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} className="siteplan-gen-grid" />
            <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end" className="siteplan-gen-tick">{fmtMeasure(y, v)}</text>
          </g>
        ))}
        {ticks(x0, x1).map((v, i) => (
          <text key={`x${v}`} x={sx(v)} y={H - pad.b + 16} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="siteplan-gen-tick">{fmtMeasure(x, v)}</text>
        ))}
        <text x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle" className="siteplan-gen-axis">{measureOf(x).label}</text>
        {/* Misses first, so the kept ones sit on top. */}
        {[false, true].map((keptLayer) => pts.map(({ o, i, kept }) => {
          if (kept !== keptLayer) return null;
          const on = picked === o;
          return (
            <circle
              key={i}
              cx={sx(o.measures[x])}
              cy={sy(o.measures[y])}
              r={on ? 7 : 5}
              fill={kept ? colorOf(o.assetType) : 'none'}
              stroke={on ? '#111827' : kept ? '#ffffff' : '#9ca3af'}
              strokeWidth={on ? 2.5 : kept ? 2 : 1.25}
              className="siteplan-gen-dot"
              onMouseEnter={() => setHover(o)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(o)}
            />
          );
        }))}
      </svg>
      <div className="siteplan-gen-ylabel">{measureOf(y).label}</div>
      {hover && (
        <div className="siteplan-gen-tip">
          <b>{getAssetType(hover.assetType).label}</b>
          {Object.entries(hover.combo).map(([k, v]) => <span key={k}> · {k} {v}</span>)}
          <br />
          {measureOf(x).label}: {fmtMeasure(x, hover.measures[x])} · {measureOf(y).label}: {fmtMeasure(y, hover.measures[y])}
          {!pts.find((p) => p.o === hover)?.kept && <span className="siteplan-muted"> · misses a goal</span>}
        </div>
      )}
    </div>
  );
}

function GeneratorModal({ boundary, scheme, onClose, onApply }) {
  const settings = effectiveSettings(scheme);
  const [types, setTypes] = useState([scheme.assetType]);
  // The settings any picked type takes; a sweep skips the types without it.
  const numeric = useMemo(() => {
    const seen = new Map();
    for (const id of types) {
      const t = getAssetType(id);
      for (const f of fieldsFor(t).filter((x) => x.group !== 'Pro forma')) if (!seen.has(f.key)) seen.set(f.key, f);
      if (hasSurfaceParking(t) && !seen.has('parkingRotation')) seen.set('parkingRotation', PARKING_ORIENTATION);
    }
    return [...seen.values()];
  }, [types]);
  const [sweeps, setSweeps] = useState(() => SUGGESTED
    .map((k) => numeric.find((f) => f.key === k))
    .filter(Boolean)
    .slice(0, 2)
    .map((f) => defaultSweep(f, settings[f.key])));
  const mainType = getAssetType(scheme.assetType);
  const [filters, setFilters] = useState({ meetsParking: true, passesZoning: true, rules: [] });
  const [sortBy, setSortBy] = useState(mainType.mode === 'lots' ? 'profit' : 'yieldOnCost');
  const [chartX, setChartX] = useState('totalCost');
  const [chartY, setChartY] = useState('yield');
  const [progress, setProgress] = useState(null);
  const [options, setOptions] = useState(null);
  const [runTypes, setRunTypes] = useState(types);
  // The sweeps that made the results: their columns, and what Regenerate narrows.
  const [runSweeps, setRunSweeps] = useState(sweeps);
  const [picked, setPicked] = useState(null);
  const cancelRef = useRef(null);
  const rowRefs = useRef(new Map());

  useEffect(() => () => cancelRef.current?.(), []);

  const total = countRuns(sweeps, types);
  const tooMany = total > MAX_OPTIONS;
  const colorOf = (id) => TYPE_COLORS[Math.max(0, runTypes.indexOf(id)) % TYPE_COLORS.length];

  function run(withSweeps = sweeps, withTypes = types) {
    cancelRef.current?.();
    setOptions(null);
    setPicked(null);
    setRunTypes(withTypes);
    setRunSweeps(withSweeps);
    const runs = buildRuns(withSweeps, withTypes);
    setProgress({ done: 0, total: runs.length });
    cancelRef.current = runOptions(boundary, scheme, runs, {
      onProgress: (done, t) => setProgress({ done, total: t }),
      onDone: (out) => {
        // Yields of different types count different things; chart profit.
        if (withTypes.length > 1 && chartY === 'yield') setChartY('profit');
        setOptions(out);
        setProgress(null);
      },
    });
  }

  // A finer look around an option, for its type alone.
  function regenerate(o) {
    const next = regenerateSweeps(runSweeps, o);
    setSweeps(next);
    setTypes([o.assetType]);
    run(next, [o.assetType]);
  }

  const shown = useMemo(() => (options ? filterAndSort(options, filters, sortBy) : []), [options, filters, sortBy]);
  const fieldOf = (key) => numeric.find((f) => f.key === key);
  const multi = runTypes.length > 1;
  const toggleType = (id) => setTypes((list) => {
    if (list.includes(id)) return list.length > 1 ? list.filter((x) => x !== id) : list;
    return list.length >= MAX_TYPES ? list : [...list, id];
  });
  const setRule = (i, patch) => setFilters((f) => ({ ...f, rules: f.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const pick = (o) => {
    setPicked(o);
    rowRefs.current.get(o)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const valueCell = (sw, o) => {
    if (!(sw.key in o.combo)) return '-';
    const f = fieldOf(sw.key);
    const label = f?.options?.find(([v]) => v === o.combo[sw.key])?.[1];
    return label || fmtDec(o.combo[sw.key], Array.isArray(sw.values) ? 0 : (String(sw.step).split('.')[1] || '').length);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content siteplan-gen-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Generate options · {scheme.name}</h2></div>
        <div className="modal-body siteplan-gen-body">
          <p className="siteplan-muted siteplan-small">
            Tries every combination below on this site, with the scheme&apos;s other settings and spaces as they are
            (laid out automatically, not by hand). Other asset types keep the zoning, setbacks and parking settings they share.
          </p>

          <div className="siteplan-gen-types">
            <span className="siteplan-small"><b>Asset types</b></span>
            {ASSET_TYPES.map((t) => (
              <label key={t.id} className={`siteplan-gen-type ${types.includes(t.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={types.includes(t.id)} onChange={() => toggleType(t.id)} />
                {t.label}
              </label>
            ))}
          </div>

          <div className="siteplan-gen-sweeps">
            {sweeps.map((sw, i) => {
              const f = fieldOf(sw.key);
              const skipped = types.filter((id) => !settingKeys(getAssetType(id)).has(sw.key));
              return (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i} className="siteplan-gen-sweep">
                  <select
                    value={sw.key}
                    onChange={(e) => {
                      const nf = fieldOf(e.target.value);
                      setSweeps((list) => list.map((x, j) => (j === i ? defaultSweep(nf, settings[nf.key]) : x)));
                    }}
                  >
                    {!f && <option value={sw.key}>{sw.key}</option>}
                    {numeric.map((x) => (
                      <option key={x.key} value={x.key} disabled={sweeps.some((y, j) => j !== i && y.key === x.key)}>
                        {x.label}{x.unit ? ` (${x.unit})` : ''}
                      </option>
                    ))}
                  </select>
                  {Array.isArray(sw.values) ? (
                    <span className="siteplan-muted">every option: {sw.values.map((v) => f?.options?.find(([x]) => x === v)?.[1] || v).join(', ')}</span>
                  ) : (
                    <>
                      <span>from</span>
                      <NumberInput value={sw.from} step={f?.step} onChange={(n) => setSweeps((l) => l.map((x, j) => (j === i ? { ...x, from: n } : x)))} />
                      <span>to</span>
                      <NumberInput value={sw.to} step={f?.step} onChange={(n) => setSweeps((l) => l.map((x, j) => (j === i ? { ...x, to: n } : x)))} />
                      <span>step</span>
                      <NumberInput value={sw.step} min={0.01} step={f?.step} onChange={(n) => setSweeps((l) => l.map((x, j) => (j === i ? { ...x, step: n } : x)))} />
                    </>
                  )}
                  <button type="button" className="siteplan-mix-remove" onClick={() => setSweeps((l) => l.filter((_, j) => j !== i))} title="Remove">×</button>
                  {skipped.length > 0 && types.length > 1 && (
                    <span className="siteplan-muted siteplan-small">not for {skipped.map((id) => getAssetType(id).label).join(', ')}</span>
                  )}
                </div>
              );
            })}
            {sweeps.length < 3 && (
              <button
                type="button"
                className="siteplan-link-btn"
                onClick={() => {
                  const f = numeric.find((x) => !sweeps.some((sw) => sw.key === x.key));
                  if (f) setSweeps((l) => [...l, defaultSweep(f, settings[f.key])]);
                }}
              >
                + Another setting
              </button>
            )}
          </div>

          <div className="siteplan-gen-filters">
            <label className="siteplan-check-label">
              <input type="checkbox" checked={filters.meetsParking} onChange={(e) => setFilters((f) => ({ ...f, meetsParking: e.target.checked }))} />
              Meets parking
            </label>
            <label className="siteplan-check-label">
              <input type="checkbox" checked={filters.passesZoning} onChange={(e) => setFilters((f) => ({ ...f, passesZoning: e.target.checked }))} />
              Passes zoning checks
            </label>
            {filters.rules.map((r, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <span key={i} className="siteplan-gen-rule">
                <select value={r.measure} onChange={(e) => setRule(i, { measure: e.target.value })}>
                  {MEASURES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value })}>
                  <option value="min">at least</option>
                  <option value="max">at most</option>
                </select>
                <NumberInput
                  value={isPct(r.measure) ? r.value * 100 : r.value}
                  step={isPct(r.measure) ? 0.25 : 1}
                  onChange={(n) => setRule(i, { value: isPct(r.measure) ? n / 100 : n })}
                />
                {isPct(r.measure) && <span>%</span>}
                <button type="button" className="siteplan-mix-remove" onClick={() => setFilters((f) => ({ ...f, rules: f.rules.filter((_, j) => j !== i) }))} title="Remove">×</button>
              </span>
            ))}
            {filters.rules.length < 6 && (
              <button
                type="button"
                className="siteplan-link-btn"
                onClick={() => setFilters((f) => ({ ...f, rules: [...f.rules, { measure: 'yield', op: 'min', value: 0 }] }))}
              >
                + Goal
              </button>
            )}
            <label>
              Sort by
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                {MEASURES.map((x) => <option key={x.key} value={x.key}>{x.label} ({x.better === 'low' ? 'lowest' : 'highest'} first)</option>)}
              </select>
            </label>
          </div>

          <div className="siteplan-gen-run">
            <button type="button" className="btn-primary" onClick={() => run()} disabled={tooMany || !boundary || !!progress || sweeps.length === 0 || total === 0}>
              {progress ? `Running ${fmtInt(progress.done)} / ${fmtInt(progress.total)}…` : `Run ${fmtInt(total)} option${total === 1 ? '' : 's'}`}
            </button>
            {progress && <button type="button" className="btn-secondary" onClick={() => { cancelRef.current?.(); setProgress(null); }}>Stop</button>}
            {tooMany && <span className="siteplan-warn">That&apos;s more than {fmtInt(MAX_OPTIONS)} - narrow a range, use bigger steps or fewer types.</span>}
            {!boundary && <span className="siteplan-warn">Draw the site first.</span>}
          </div>

          {options && (
            <div className="siteplan-gen-results">
              <div className="siteplan-gen-chart-head">
                <label>Across <select value={chartX} onChange={(e) => setChartX(e.target.value)}>{MEASURES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
                <label>Up <select value={chartY} onChange={(e) => setChartY(e.target.value)}>{MEASURES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
                <span className="siteplan-gen-legend">
                  {runTypes.map((id) => <span key={id}><i style={{ background: colorOf(id) }} />{getAssetType(id).label}</span>)}
                  <span><i className="siteplan-gen-miss" />Misses a goal</span>
                </span>
              </div>
              <OptionsChart options={options} filters={filters} x={chartX} y={chartY} colorOf={colorOf} picked={picked} onPick={pick} />
              <p className="siteplan-muted siteplan-small">
                {fmtInt(shown.length)} of {fmtInt(options.length)} options meet the goals{shown.length > 50 ? ' - showing the best 50' : ''}.
                Click a dot to find it below; ↻ Regenerate looks again around one with finer steps.
              </p>
              {shown.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      {multi && <th>Type</th>}
                      {runSweeps.map((sw) => <th key={sw.key}>{fieldOf(sw.key)?.label || sw.key}</th>)}
                      <th>Yield</th>
                      {!['yield', 'far', 'yieldOnCost', 'profit'].includes(sortBy) && <th>{measureOf(sortBy).label}</th>}
                      <th>FAR</th>
                      <th>Parking</th>
                      <th>YoC</th>
                      <th>Profit</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, 50).map((o, idx) => (
                      <tr
                        // eslint-disable-next-line react/no-array-index-key
                        key={idx}
                        ref={(el) => { if (el) rowRefs.current.set(o, el); else rowRefs.current.delete(o); }}
                        className={picked === o ? 'siteplan-gen-picked' : ''}
                        onClick={() => setPicked(o)}
                      >
                        {multi && <td><i className="siteplan-gen-swatch" style={{ background: colorOf(o.assetType) }} />{getAssetType(o.assetType).label}</td>}
                        {runSweeps.map((sw) => <td key={sw.key}>{valueCell(sw, o)}</td>)}
                        <td><b>{fmtMeasure('yield', o.yield)}</b></td>
                        {!['yield', 'far', 'yieldOnCost', 'profit'].includes(sortBy) && <td>{fmtMeasure(sortBy, o.measures[sortBy])}</td>}
                        <td>{fmtDec(o.far)}</td>
                        <td>{fmtInt(o.parkingProvided)} / {fmtInt(o.parkingRequired)}</td>
                        <td>{getAssetType(o.assetType).mode === 'lots' ? '-' : fmtPct(o.yieldOnCost, 2)}</td>
                        <td className={o.profit < 0 ? 'siteplan-neg' : ''}>{fmtMoney(o.profit)}</td>
                        <td className="siteplan-gen-actions">
                          <button type="button" className="siteplan-link-btn" onClick={() => onApply(o.combo, o.assetType)}>Use as scheme</button>
                          <button type="button" className="siteplan-link-btn" onClick={() => regenerate(o)} disabled={!!progress} title="Run again around this one with finer steps">↻ Regenerate</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer siteplan-modal-footer">
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GeneratorModal;
