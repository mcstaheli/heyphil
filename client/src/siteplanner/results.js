import React from 'react';
import { getAssetType } from './assetTypes';
import { LIMIT_LABELS } from './solver';
import { fmtDec, fmtInt, fmtMoney, fmtPct } from './settingsFields';

// How a scheme's results read: the headline yield, the metric rows, the
// zoning checks and the pro forma. Used by the panel and by Compare.

// The plan's numbers: the main layout's, with the totals (main + spaces)
// over the top where they add up.
export function planMetrics(result) {
  if (!result?.metrics) return null;
  return { ...result.metrics, ...(result.totals || {}) };
}

export function yieldOf(type, m) {
  if (!m) return { value: '-', label: '', raw: 0 };
  switch (type.yieldKind) {
    case 'units': return { value: fmtInt(m.units), label: type.mode === 'lots' ? 'homes' : 'units', raw: m.units };
    case 'keys': return { value: fmtInt(m.keys), label: 'keys', raw: m.keys };
    case 'stalls': return { value: fmtInt(m.parkingProvided), label: 'stalls', raw: m.parkingProvided };
    case 'mw': return { value: fmtDec(m.itMw, 1), label: 'MW of IT load', raw: m.itMw };
    default: return { value: fmtInt(m.nsf), label: type.mode === 'industrial' ? 'sf building' : 'sf leasable', raw: m.nsf };
  }
}

export function metricRows(type, m) {
  if (!m) return [];
  const rows = [
    ['Site area', `${fmtDec(m.siteAcres)} ac (${fmtInt(m.siteSf)} sf)`],
    ['Buildable after setback', `${fmtInt(m.buildableSf)} sf`],
  ];
  if (type.mode !== 'parking' || m.gsf > 0) {
    rows.push(
      [type.mode === 'lots' ? 'Homes' : 'Buildings', fmtInt(m.buildingCount)],
      ['Footprint', `${fmtInt(m.footprintSf)} sf`],
      ['Floors / height', m.heightFt ? `${m.floors || '-'} / ${fmtDec(m.heightFt, 0)} ft` : '-'],
      ['Gross area', `${fmtInt(m.gsf)} sf`],
    );
    if (m.nsf && type.mode !== 'lots') rows.push(['Net / leasable', `${fmtInt(m.nsf)} sf`]);
    if (m.units) rows.push(['Units', fmtInt(m.units)]);
    if (m.keys) rows.push(['Keys', fmtInt(m.keys)]);
    if (m.units || m.keys) rows.push(['Density', `${fmtDec(m.density, 1)} per acre`]);
    rows.push(['FAR', fmtDec(m.far)], ['Lot coverage', fmtPct(m.coverage)]);
    if (m.docks) rows.push(['Dock doors', fmtInt(m.docks)]);
    if (m.itMw) rows.push(['IT load', `${fmtDec(m.itMw, 1)} MW`], ['Generators', fmtInt(m.generators)]);
    rows.push(['Parking required', fmtInt(m.parkingRequired)]);
  }
  const parts = [];
  if (m.parkingSurface) parts.push(`${fmtInt(m.parkingSurface)} surface`);
  if (m.parkingStructured) parts.push(`${fmtInt(m.parkingStructured)} structured`);
  if (m.parkingGarage) parts.push(`${fmtInt(m.parkingGarage)} garage`);
  rows.push(['Parking provided', `${fmtInt(m.parkingProvided)}${parts.length > 1 ? ` (${parts.join(' + ')})` : ''}`]);
  const count = (m.units || 0) + (m.keys || 0);
  if (count) rows.push(['Parking ratio', `${fmtDec(m.parkingProvided / count)} per ${m.keys && !m.units ? 'key' : 'unit'}`]);
  else if (m.gsf) rows.push(['Parking ratio', `${fmtDec((m.parkingProvided / m.gsf) * 1000)} per 1,000 sf`]);
  if (m.orientationDeg !== undefined) rows.push(['Orientation', `${fmtDec(m.orientationDeg, 1)}°`]);
  return rows;
}

export function proformaRows(pf) {
  if (!pf) return [];
  const rows = [
    ['Land', fmtMoney(pf.landCost)],
    ['Hard costs', fmtMoney(pf.hardCost)],
    ['Soft costs', fmtMoney(pf.softCost)],
    ['Total cost', fmtMoney(pf.totalCost)],
  ];
  if (pf.kind !== 'sale') {
    rows.push(['Gross income / yr', fmtMoney(pf.gpr)], ['NOI / yr', fmtMoney(pf.noi)], ['Yield on cost', fmtPct(pf.yieldOnCost, 2)]);
  }
  if (pf.revenue) rows.push(['Sales revenue', fmtMoney(pf.revenue)]);
  rows.push([pf.kind === 'sale' ? 'Net sales' : 'Value', fmtMoney(pf.value)], ['Profit', fmtMoney(pf.profit)], ['Margin on cost', fmtPct(pf.margin)]);
  return rows;
}

const STATUS_ICON = { pass: '✅', fail: '❌', none: '—' };

export function ChecksPanel({ checks }) {
  if (!checks || !checks.length) return null;
  const failing = checks.filter((c) => c.status === 'fail').length;
  return (
    <div className="siteplan-checks">
      <div className="siteplan-group-title">
        Zoning check {failing ? <span className="siteplan-check-bad">{failing} failing</span> : <span className="siteplan-check-ok">all clear</span>}
      </div>
      <table>
        <tbody>
          {checks.map((c) => (
            <tr key={c.label} className={`siteplan-check-${c.status}`}>
              <td>{STATUS_ICON[c.status]}</td>
              <td>{c.label}</td>
              <td className="siteplan-muted">{c.limit === null ? 'No limit' : c.limit}</td>
              <td>{c.actual}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The pinned scoreboard: the headline yield, the return, and whether the
// zoning check passes - so every step's change shows straight away.
export function Scoreboard({ type, result, onOpenChecks }) {
  if (!result) return null;
  if (result.error && !result.metrics) return <div className="siteplan-scoreboard siteplan-muted siteplan-small">{result.error}</div>;
  const m = planMetrics(result);
  const y = yieldOf(type, m);
  const pf = result.proforma;
  const fails = (result.checks || []).filter((c) => c.status === 'fail');
  const hasSpaces = (result.spaces || []).some((sp) => sp.result?.metrics);
  return (
    <div className="siteplan-scoreboard">
      <div className="siteplan-yield">
        <span className="siteplan-yield-value">{y.value}</span>
        <span className="siteplan-yield-label">{y.label}{hasSpaces ? ' (with spaces)' : ''}</span>
        {pf && pf.kind !== 'sale' && pf.yieldOnCost > 0 && (
          <span className="siteplan-yoc" title="Yield on cost: NOI / total cost">{fmtPct(pf.yieldOnCost, 2)} YoC</span>
        )}
        {pf && pf.kind === 'sale' && pf.totalCost > 0 && (
          <span className="siteplan-yoc" title="Profit / total cost">{fmtPct(pf.margin)} margin</span>
        )}
      </div>
      <div className="siteplan-scoreboard-row">
        <button type="button" className={`siteplan-zoning-pill ${fails.length ? 'bad' : 'ok'}`} onClick={onOpenChecks} title={fails.map((c) => c.label).join(', ')}>
          {fails.length ? `❌ ${fails.length} check${fails.length === 1 ? '' : 's'} failing` : '✅ All checks pass'}
        </button>
        <span className="siteplan-limits">
          {result.limits.includes('manual') ? 'Placed by hand' : 'Limited by'}
          {!result.limits.includes('manual') && result.limits.map((l) => <span key={l} className={`siteplan-limit siteplan-limit-${l}`}>{LIMIT_LABELS[l]}</span>)}
        </span>
      </div>
      {result.error && <p className="siteplan-warn siteplan-small">{result.error}</p>}
    </div>
  );
}

// Quantities: unit mix, every measure, and the split by part.
export function QuantitiesPanel({ type, result }) {
  if (!result?.metrics) return <p className="siteplan-muted siteplan-small">Nothing laid out yet.</p>;
  const m = planMetrics(result);
  const hasSpaces = (result.spaces || []).some((sp) => sp.result?.metrics);
  return (
    <div className="siteplan-results">
      {m.unitsByType && m.unitsByType.length > 0 && (
        <div className="siteplan-mix-result">
          {m.unitsByType.map((u) => <span key={u.name}><b>{fmtInt(u.count)}</b> {u.name}</span>)}
        </div>
      )}
      <dl className="siteplan-metrics">
        {metricRows(type, m).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
      </dl>
      {hasSpaces && (
        <details className="siteplan-details" open>
          <summary>By part</summary>
          <dl className="siteplan-metrics">
            <dt>Main ({type.label})</dt><dd>{yieldOf(type, result.metrics).value} {yieldOf(type, result.metrics).label}</dd>
            {result.spaces.filter((sp) => sp.result?.metrics).map((sp) => {
              const t = getAssetType(sp.result.type?.id);
              const yy = yieldOf(t, sp.result.metrics);
              return <React.Fragment key={sp.id}><dt>{sp.name} ({t.label})</dt><dd>{yy.value} {yy.label}</dd></React.Fragment>;
            })}
          </dl>
        </details>
      )}
    </div>
  );
}

export function ProformaPanel({ result }) {
  const pf = result?.proforma;
  if (!pf) return null;
  return (
    <div className="siteplan-results">
      <dl className="siteplan-metrics">
        {proformaRows(pf).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd className={k === 'Profit' && pf.profit < 0 ? 'siteplan-neg' : ''}>{v}</dd></React.Fragment>)}
      </dl>
    </div>
  );
}

// Each scheme's rows (quantities then pro forma), plus the union of their
// labels in first-seen order, so mixed asset types line up where they
// share a measure. Used by Compare and the report export.
export function compareColumns(schemes, results, extraRows = () => []) {
  const columns = schemes.map((s) => {
    const type = getAssetType(s.assetType);
    const r = results[s.id];
    const m = planMetrics(r);
    return {
      scheme: s,
      type,
      result: r,
      rows: Object.fromEntries([...extraRows(s, type, r, m), ...metricRows(type, m), ...proformaRows(r?.proforma)]),
    };
  });
  const keys = [];
  columns.forEach((c) => Object.keys(c.rows).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
  return { columns, keys };
}

export function CompareView({ schemes, results, onOpen }) {
  const { columns, keys } = compareColumns(schemes, results);
  return (
    <div className="siteplan-compare">
      <table>
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c.scheme.id}>
                <button className="siteplan-link-btn" onClick={() => onOpen(c.scheme.id)}>{c.scheme.name}</button>
                <div className="siteplan-muted siteplan-small">
                  {c.type.label}
                  {c.scheme.edits?.buildings?.length ? ' · by hand' : ''}
                  {c.scheme.spaces?.length ? ` · ${c.scheme.spaces.length} space${c.scheme.spaces.length === 1 ? '' : 's'}` : ''}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="siteplan-compare-yield">
            <td>Yield</td>
            {columns.map((c) => {
              const y = yieldOf(c.type, planMetrics(c.result));
              return <td key={c.scheme.id}><b>{y.value}</b> {y.label}</td>;
            })}
          </tr>
          <tr>
            <td>Zoning check</td>
            {columns.map((c) => {
              const fails = (c.result?.checks || []).filter((x) => x.status === 'fail').map((x) => x.label);
              return <td key={c.scheme.id}>{c.result?.checks ? (fails.length ? `❌ ${fails.join(', ')}` : '✅ Pass') : '-'}</td>;
            })}
          </tr>
          <tr>
            <td>Limited by</td>
            {columns.map((c) => (
              <td key={c.scheme.id}>{(c.result?.limits || []).map((l) => LIMIT_LABELS[l]).join(', ') || c.result?.error || '-'}</td>
            ))}
          </tr>
          {keys.map((k) => (
            <tr key={k}>
              <td>{k}</td>
              {columns.map((c) => <td key={c.scheme.id}>{c.rows[k] ?? '-'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
