import React, { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveSettings, fieldsFor, getAssetType } from './assetTypes';
import { hasSurfaceParking } from './solver';
import { MAX_OPTIONS, buildCombos, countCombos, filterAndSort, runOptions } from './generator';
import { NumberInput, fmtDec, fmtInt, fmtMoney, fmtPct } from './settingsFields';
import { yieldOf } from './results';

// "Generate options": pick up to three settings to sweep, run every
// combination, filter by goals, and turn the one you like into a scheme.

const SUGGESTED = ['floors', 'buildingDepth', 'parkingRatio', 'lotWidth', 'maxBuildingDepth', 'maxBuildingLength', 'stallAngle', 'parkingRotation'];

// Parking orientation is swept as an angle; "Best fit" isn't a number.
const PARKING_ORIENTATION = { key: 'parkingRotation', label: 'Parking orientation', unit: '°', step: 15, group: 'Parking' };

function defaultSweep(field, current) {
  if (field.options) return { key: field.key, values: field.options.map(([v]) => v) };
  if (field.key === 'parkingRotation') return { key: field.key, from: 0, to: 165, step: 15 };
  if (field.key === 'floors') return { key: 'floors', from: Math.max(1, current - 1), to: current + 2, step: 1 };
  const step = field.step || (current >= 100 ? 10 : current >= 20 ? 5 : 1);
  return { key: field.key, from: Math.max(0, current - 2 * step), to: current + 2 * step, step };
}

function GeneratorModal({ boundary, scheme, onClose, onApply }) {
  const type = getAssetType(scheme.assetType);
  const settings = effectiveSettings(scheme);
  const numeric = [
    ...fieldsFor(type).filter((f) => f.group !== 'Pro forma'),
    ...(hasSurfaceParking(type) ? [PARKING_ORIENTATION] : []),
  ];
  const [sweeps, setSweeps] = useState(() => SUGGESTED
    .map((k) => numeric.find((f) => f.key === k))
    .filter(Boolean)
    .slice(0, 2)
    .map((f) => defaultSweep(f, settings[f.key])));
  const [filters, setFilters] = useState({ minYield: 0, meetsParking: true, passesZoning: true, minYieldOnCost: 0 });
  const [sortBy, setSortBy] = useState(type.mode === 'lots' ? 'profit' : 'yieldOnCost');
  const [progress, setProgress] = useState(null);
  const [options, setOptions] = useState(null);
  const cancelRef = useRef(null);

  useEffect(() => () => cancelRef.current?.(), []);

  const total = countCombos(sweeps);
  const tooMany = total > MAX_OPTIONS;
  const yLabel = yieldOf(type, { units: 0, keys: 0, nsf: 0, parkingProvided: 0 }).label;

  function run() {
    cancelRef.current?.();
    setOptions(null);
    setProgress({ done: 0, total });
    cancelRef.current = runOptions(boundary, scheme, buildCombos(sweeps), {
      onProgress: (done, t) => setProgress({ done, total: t }),
      onDone: (out) => {
        setOptions(out);
        setProgress(null);
      },
    });
  }

  const shown = useMemo(() => (options ? filterAndSort(options, filters, sortBy) : []), [options, filters, sortBy]);
  const fieldOf = (key) => numeric.find((f) => f.key === key);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content siteplan-gen-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Generate options · {scheme.name}</h2></div>
        <div className="modal-body siteplan-gen-body">
          <p className="siteplan-muted siteplan-small">
            Tries every combination below on this site, with the scheme&apos;s other settings and spaces as they are
            (laid out automatically, not by hand).
          </p>
          <div className="siteplan-gen-sweeps">
            {sweeps.map((sw, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i} className="siteplan-gen-sweep">
                <select
                  value={sw.key}
                  onChange={(e) => {
                    const f = fieldOf(e.target.value);
                    setSweeps((list) => list.map((x, j) => (j === i ? defaultSweep(f, settings[f.key]) : x)));
                  }}
                >
                  {numeric.map((f) => (
                    <option key={f.key} value={f.key} disabled={sweeps.some((x, j) => j !== i && x.key === f.key)}>
                      {f.label}{f.unit ? ` (${f.unit})` : ''}
                    </option>
                  ))}
                </select>
                {Array.isArray(sw.values) ? (
                  <span className="siteplan-muted">every option: {sw.values.map((v) => fieldOf(sw.key)?.options?.find(([x]) => x === v)?.[1] || v).join(', ')}</span>
                ) : (
                  <>
                    <span>from</span>
                    <NumberInput value={sw.from} step={fieldOf(sw.key)?.step} onChange={(n) => setSweeps((l) => l.map((x, j) => (j === i ? { ...x, from: n } : x)))} />
                    <span>to</span>
                    <NumberInput value={sw.to} step={fieldOf(sw.key)?.step} onChange={(n) => setSweeps((l) => l.map((x, j) => (j === i ? { ...x, to: n } : x)))} />
                    <span>step</span>
                    <NumberInput value={sw.step} min={0.01} step={fieldOf(sw.key)?.step} onChange={(n) => setSweeps((l) => l.map((x, j) => (j === i ? { ...x, step: n } : x)))} />
                  </>
                )}
                <button type="button" className="siteplan-mix-remove" onClick={() => setSweeps((l) => l.filter((_, j) => j !== i))} title="Remove">×</button>
              </div>
            ))}
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
            <label>Min {yLabel} <NumberInput value={filters.minYield} onChange={(n) => setFilters((f) => ({ ...f, minYield: n }))} /></label>
            {type.mode !== 'lots' && (
              <label>
                Min yield on cost %
                <NumberInput value={filters.minYieldOnCost * 100} step={0.25} max={100} onChange={(n) => setFilters((f) => ({ ...f, minYieldOnCost: n / 100 }))} />
              </label>
            )}
            <label className="siteplan-check-label">
              <input type="checkbox" checked={filters.meetsParking} onChange={(e) => setFilters((f) => ({ ...f, meetsParking: e.target.checked }))} />
              Meets parking
            </label>
            <label className="siteplan-check-label">
              <input type="checkbox" checked={filters.passesZoning} onChange={(e) => setFilters((f) => ({ ...f, passesZoning: e.target.checked }))} />
              Passes zoning checks
            </label>
            <label>
              Sort by
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="yield">Most {yLabel}</option>
                {type.mode !== 'lots' && <option value="yieldOnCost">Yield on cost</option>}
                <option value="profit">Profit</option>
              </select>
            </label>
          </div>

          <div className="siteplan-gen-run">
            <button type="button" className="btn-primary" onClick={run} disabled={tooMany || !boundary || !!progress || sweeps.length === 0}>
              {progress ? `Running ${fmtInt(progress.done)} / ${fmtInt(progress.total)}…` : `Run ${fmtInt(total)} option${total === 1 ? '' : 's'}`}
            </button>
            {progress && <button type="button" className="btn-secondary" onClick={() => { cancelRef.current?.(); setProgress(null); }}>Stop</button>}
            {tooMany && <span className="siteplan-warn">That&apos;s more than {fmtInt(MAX_OPTIONS)} - narrow a range or use bigger steps.</span>}
            {!boundary && <span className="siteplan-warn">Draw the site first.</span>}
          </div>

          {options && (
            <div className="siteplan-gen-results">
              <p className="siteplan-muted siteplan-small">
                {fmtInt(shown.length)} of {fmtInt(options.length)} options meet the goals{shown.length > 50 ? ' - showing the best 50' : ''}.
              </p>
              {shown.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      {sweeps.map((sw) => <th key={sw.key}>{fieldOf(sw.key)?.label}</th>)}
                      <th>{yLabel}</th>
                      <th>FAR</th>
                      <th>Parking</th>
                      {type.mode !== 'lots' && <th>YoC</th>}
                      <th>Profit</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, 50).map((o, idx) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={idx}>
                        {sweeps.map((sw) => <td key={sw.key}>{fmtDec(o.combo[sw.key], Array.isArray(sw.values) ? 0 : (String(sw.step).split('.')[1] || '').length)}</td>)}
                        <td><b>{fmtInt(o.yield)}</b></td>
                        <td>{fmtDec(o.far)}</td>
                        <td>{fmtInt(o.parkingProvided)} / {fmtInt(o.parkingRequired)}</td>
                        {type.mode !== 'lots' && <td>{fmtPct(o.yieldOnCost, 2)}</td>}
                        <td className={o.profit < 0 ? 'siteplan-neg' : ''}>{fmtMoney(o.profit)}</td>
                        <td>
                          <button type="button" className="siteplan-link-btn" onClick={() => onApply(o.combo)}>Use as scheme</button>
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
