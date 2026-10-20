import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SitePlanMap from './SitePlanMap';
import GeneratorModal from './GeneratorModal';
import { loadProjects, searchAddress, sitePlansApi } from './api';
import { ASSET_TYPES, COMMON_FIELDS, effectiveSettings, getAssetType } from './assetTypes';
import { makeProjection } from './geometry';
import { aisleWidthOf, hasSurfaceParking, solveScheme, supportsManualLayout } from './solver';
import { NumberInput, OrientationField, SchemeSettings, fmtDec, fmtInt, withOverride } from './settingsFields';
import { CompareView, ResultsCard, planMetrics, yieldOf } from './results';
import { reportHtml, reportTable, toCsv } from './report';
import './SitePlanner.css';

// Dev Tools -> Site Planner -> a site: the map on the left, the schemes
// and their settings and numbers on the right. A scheme can be laid out
// automatically or placed by hand (Edit layout), carry spaces (no-build
// areas, or areas with their own asset type), be saved as a preset, and
// be explored with the option generator. Every change saves itself a
// moment later; a save based on an older copy than the stored one is
// refused (409) rather than undoing someone else's work.

const SAVE_DELAY_MS = 800;
const NONE = []; // a stable empty list, so the map doesn't redraw for nothing

const newId = () => Math.random().toString(36).slice(2, 10);

function nextSchemeName(schemes, prefix = 'Scheme') {
  for (let i = 0; i < 26; i++) {
    const name = `${prefix} ${String.fromCharCode(65 + i)}`;
    if (!schemes.some((s) => s.name === name)) return name;
  }
  return `${prefix} ${schemes.length + 1}`;
}

// Rounds a placed building so saves stay small and stable.
function tidyBuilding(b) {
  const out = {
    id: b.id,
    center: [Number(b.center[0].toFixed(7)), Number(b.center[1].toFixed(7))],
    length: Math.max(1, Math.round(b.length)),
    depth: Math.max(1, Math.round(b.depth)),
    angle: Math.round((((b.angle % 360) + 540) % 360 - 180) * 10) / 10,
  };
  if (b.floors) out.floors = b.floors;
  return out;
}

function ringCentroid(geometry) {
  const ring = geometry.coordinates[0].slice(0, -1);
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}

function AddressSearch({ onPick }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await searchAddress(query.trim());
      setResults(rows);
      if (!rows.length) setError('No matches - try a fuller address.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="siteplan-search" onSubmit={run}>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search an address or place" />
      <button type="submit" disabled={busy}>{busy ? '…' : 'Search'}</button>
      {(error || (results && results.length > 0)) && (
        <div className="siteplan-search-results">
          {error && <div className="siteplan-search-note">{error}</div>}
          {results && results.map((r) => (
            <button
              type="button"
              key={`${r.lat},${r.lng}`}
              onClick={() => {
                onPick(r);
                setResults(null);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

// Edit layout (#1): hand-placed buildings and the selected one's numbers.
function LayoutSection({ scheme, type, result, selectedId, onSelect, onStart, onReset, onAdd, onUpdate, onRemove, onDuplicate }) {
  if (!supportsManualLayout(type)) return null;
  const placed = scheme.edits?.buildings || [];
  const selected = placed.find((b) => b.id === selectedId);
  const outside = new Set(result?.warnings?.outside || []);
  const overlapping = new Set((result?.warnings?.overlaps || []).flat());
  const defaultFloors = effectiveSettings(scheme).floors;

  if (!placed.length) {
    return (
      <div className="siteplan-section">
        <div className="siteplan-section-head">
          <span className="siteplan-group-title">Layout · automatic</span>
          <button type="button" className="siteplan-small-btn" onClick={onStart} disabled={!result?.metrics}>✋ Edit by hand</button>
        </div>
        <p className="siteplan-muted siteplan-small">
          Turns the generated buildings into ones you can drag, stretch and rotate on the map. Parking re-fills around them.
        </p>
      </div>
    );
  }

  return (
    <div className="siteplan-section siteplan-section-manual">
      <div className="siteplan-section-head">
        <span className="siteplan-group-title">Layout · placed by hand</span>
        <span>
          <button type="button" className="siteplan-small-btn" onClick={onAdd} disabled={!result?.metrics}>+ Building</button>
          <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={onReset}>Back to automatic</button>
        </span>
      </div>
      <p className="siteplan-muted siteplan-small">
        Click a building, then drag it (or ✥) to move, ↔ ↕ to stretch, ⟳ to rotate. Zoning limits are checked, not enforced.
      </p>
      <div className="siteplan-building-list">
        {placed.map((b, i) => (
          <button
            type="button"
            key={b.id}
            className={`siteplan-building-chip ${b.id === selectedId ? 'active' : ''} ${outside.has(b.id) || overlapping.has(b.id) ? 'bad' : ''}`}
            onClick={() => onSelect(b.id)}
            title={outside.has(b.id) ? 'Over the setback line or on a space' : overlapping.has(b.id) ? 'Overlaps another building' : ''}
          >
            {i + 1}
          </button>
        ))}
      </div>
      {selected && (
        <div className="siteplan-building-edit">
          <label className="siteplan-field">
            <span className="siteplan-field-label">Length<span className="siteplan-field-unit"> ft</span></span>
            <span className="siteplan-field-input"><NumberInput value={selected.length} min={1} max={5000} onChange={(n) => onUpdate(selected.id, { length: n })} /></span>
          </label>
          <label className="siteplan-field">
            <span className="siteplan-field-label">Depth<span className="siteplan-field-unit"> ft</span></span>
            <span className="siteplan-field-input"><NumberInput value={selected.depth} min={1} max={5000} onChange={(n) => onUpdate(selected.id, { depth: n })} /></span>
          </label>
          <label className="siteplan-field">
            <span className="siteplan-field-label">Angle<span className="siteplan-field-unit"> °</span></span>
            <span className="siteplan-field-input"><NumberInput value={selected.angle} min={-360} max={360} step={0.5} onChange={(n) => onUpdate(selected.id, { angle: n })} /></span>
          </label>
          {type.mode !== 'industrial' && (
            <label className="siteplan-field">
              <span className="siteplan-field-label">Floors<span className="siteplan-field-unit"> (blank = {defaultFloors})</span></span>
              <span className="siteplan-field-input">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={selected.floors || ''}
                  placeholder={String(defaultFloors)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    onUpdate(selected.id, { floors: e.target.value === '' ? undefined : (Number.isInteger(n) && n >= 1 && n <= 100 ? n : selected.floors) });
                  }}
                />
              </span>
            </label>
          )}
          <div className="siteplan-building-actions">
            <button type="button" className="siteplan-link-btn" onClick={() => onDuplicate(selected.id)}>Duplicate</button>
            <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onRemove(selected.id)}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Spaces (#3): no-build areas, or areas with their own asset type.
function SpacesSection({ scheme, results, selectedId, onSelect, onDraw, onUpdate, onRemove }) {
  const spaces = scheme.spaces || [];
  const selected = spaces.find((sp) => sp.id === selectedId);
  const spaceResult = selected ? (results?.spaces || []).find((r) => r.id === selected.id)?.result : null;
  return (
    <div className="siteplan-section">
      <div className="siteplan-section-head">
        <span className="siteplan-group-title">Spaces</span>
        <span>
          <button type="button" className="siteplan-small-btn" onClick={() => onDraw('Rectangle')} title="Draw a rectangle on the map">+ Rectangle</button>
          <button type="button" className="siteplan-small-btn" onClick={() => onDraw('Polygon')} title="Click corners on the map; click the first to close">+ Shape</button>
        </span>
      </div>
      {spaces.length === 0 && (
        <p className="siteplan-muted siteplan-small">
          Mark an easement, pond or open space as no-build, or give an area its own use (a retail pad beside apartments).
        </p>
      )}
      {spaces.map((sp) => {
        const r = (results?.spaces || []).find((x) => x.id === sp.id)?.result;
        const t = sp.kind === 'asset' ? getAssetType(sp.assetType) : null;
        const y = t && r?.metrics ? yieldOf(t, r.metrics) : null;
        return (
          <button type="button" key={sp.id} className={`siteplan-space-row ${sp.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(sp.id)}>
            <span className={`siteplan-space-swatch ${sp.kind === 'no-build' ? 'nobuild' : 'asset'}`} />
            <span className="siteplan-space-name">{sp.name}</span>
            <span className="siteplan-muted siteplan-small">{t ? `${t.label}${y ? ` · ${y.value} ${y.label}` : ''}` : 'No-build'}</span>
          </button>
        );
      })}
      {selected && (
        <div className="siteplan-space-edit">
          <label className="siteplan-field">
            <span className="siteplan-field-label">Name</span>
            <span className="siteplan-field-input">
              <input value={selected.name} maxLength={100} onChange={(e) => onUpdate(selected.id, { name: e.target.value })} className="siteplan-text-input" />
            </span>
          </label>
          <label className="siteplan-field">
            <span className="siteplan-field-label">Use</span>
            <span className="siteplan-field-input">
              <select
                value={selected.kind === 'no-build' ? 'no-build' : selected.assetType}
                onChange={(e) => (e.target.value === 'no-build'
                  ? onUpdate(selected.id, { kind: 'no-build', assetType: undefined, overrides: undefined })
                  : onUpdate(selected.id, { kind: 'asset', assetType: e.target.value, overrides: { setback: 0 } }))}
              >
                <option value="no-build">No-build</option>
                {ASSET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </span>
          </label>
          <p className="siteplan-muted siteplan-small">Drag, reshape or rotate it with the map&apos;s edit tools (left edge).</p>
          {selected.kind === 'asset' && (
            <SchemeSettings
              key={`${selected.id}-${selected.assetType}`}
              type={getAssetType(selected.assetType)}
              overrides={selected.overrides || {}}
              onChange={(overrides) => onUpdate(selected.id, { overrides })}
              idPrefix={`space-${selected.id}`}
              currentOrientationDeg={spaceResult?.metrics?.orientationDeg}
              groupsOpen={['Program', 'Site']}
            />
          )}
          <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onRemove(selected.id)}>Remove space</button>
        </div>
      )}
    </div>
  );
}

const STALL_ANGLES = COMMON_FIELDS.find((f) => f.key === 'stallAngle').options;

// Parking: what the lot holds by stall type, how it's laid out, the areas
// drawn by hand, and the driveway entries.
function ParkingSection({
  scheme, type, result, selectedAreaId, onSelectArea, onDraw, onUpdateArea, onRemoveArea, onSetOverride, onRemoveEntry, onAddEntry,
  selectedAisleId, onSelectAisle, onDrawAisle, onUpdateAisle, onRemoveAisle, onKeepRouted,
}) {
  if (!hasSurfaceParking(type)) return null;
  const settings = effectiveSettings(scheme);
  const p = result?.parking;
  const t = result?.totals?.stallTypes;
  const areas = scheme.parkingAreas || [];
  const selected = areas.find((a) => a.id === selectedAreaId);
  const areaInfo = Object.fromEntries((p?.areas || []).map((a) => [a.id, a]));
  const entries = p?.entries || [];
  return (
    <div className="siteplan-section">
      <div className="siteplan-section-head">
        <span className="siteplan-group-title">Parking</span>
        {p && <span className="siteplan-muted siteplan-small">{fmtInt(result.totals?.parkingSurface ?? result.metrics.parkingSurface)} surface stalls</span>}
      </div>
      {t && t.total > 0 && (
        <div className="siteplan-stall-types">
          <span><b>{fmtInt(t.standard)}</b> standard</span>
          {t.compact > 0 && <span><b>{fmtInt(t.compact)}</b> compact</span>}
          <span className="siteplan-ada-chip"><b>{fmtInt(t.ada)}</b> accessible ({fmtInt(t.van)} van)</span>
          {t.ev > 0 && <span><b>{fmtInt(t.ev)}</b> EV-ready</span>}
        </div>
      )}
      {p && p.rawStalls > 0 && (
        <p className="siteplan-muted siteplan-small">
          {fmtInt(result.totals?.sfPerStall ?? p.sfPerStall)} sf of paving per stall · {fmtDec(result.totals?.stallsPerAcre ?? p.stallsPerAcre, 0)} stalls per paved acre
          {p.perimeterDrive ? ' · perimeter drive on' : ''}
          {p.disconnected ? ` · ${p.disconnected} bay${p.disconnected === 1 ? '' : 's'} can't reach the drive (red)` : ''}
        </p>
      )}
      <label className="siteplan-field">
        <span className="siteplan-field-label">Stall angle</span>
        <span className="siteplan-field-input">
          <select value={settings.stallAngle} onChange={(e) => onSetOverride('stallAngle', Number(e.target.value))}>
            {STALL_ANGLES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <span className="siteplan-reset-spacer" />
        </span>
      </label>
      <OrientationField
        label="Parking orientation"
        value={settings.parkingRotation}
        currentDeg={result?.metrics?.parkingOrientationDeg}
        onChange={(v) => onSetOverride('parkingRotation', v)}
      />
      <p className="siteplan-muted siteplan-small">
        Best fit tries every 5° for each open piece of ground. Bays between buildings follow the buildings.
      </p>

      <div className="siteplan-section-head">
        <span className="siteplan-small"><b>Parking areas</b></span>
        <span>
          <button type="button" className="siteplan-small-btn" onClick={() => onDraw('Rectangle')}>+ Rectangle</button>
          <button type="button" className="siteplan-small-btn" onClick={() => onDraw('Polygon')}>+ Shape</button>
        </span>
      </div>
      {areas.length === 0 && (
        <p className="siteplan-muted siteplan-small">
          Draw where parking should go. Buildings are re-planned in the ground that&apos;s left, so making an area bigger
          moves the buildings.
        </p>
      )}
      {areas.map((a, i) => (
        <button type="button" key={a.id} className={`siteplan-space-row ${a.id === selectedAreaId ? 'active' : ''}`} onClick={() => onSelectArea(a.id)}>
          <span className="siteplan-space-swatch parking" />
          <span className="siteplan-space-name">Parking area {i + 1}</span>
          <span className="siteplan-muted siteplan-small">
            {fmtInt(areaInfo[a.id]?.stalls || 0)} stalls · {Number.isFinite(a.angle) ? `${fmtDec(a.angle, 0)}°` : `best fit${areaInfo[a.id]?.orientationDeg !== null && areaInfo[a.id]?.orientationDeg !== undefined ? ` (${fmtDec(areaInfo[a.id].orientationDeg, 0)}°)` : ''}`}
          </span>
        </button>
      ))}
      {selected && (
        <div className="siteplan-space-edit">
          <OrientationField
            label="Stall orientation"
            value={Number.isFinite(selected.angle) ? selected.angle : 'auto'}
            currentDeg={areaInfo[selected.id]?.orientationDeg}
            onChange={(v) => onUpdateArea(selected.id, { angle: v === undefined ? 'auto' : v })}
          />
          <label className="siteplan-field">
            <span className="siteplan-field-label">Stall angle</span>
            <span className="siteplan-field-input">
              <select
                value={selected.stallAngle || ''}
                onChange={(e) => onUpdateArea(selected.id, { stallAngle: e.target.value ? Number(e.target.value) : undefined })}
              >
                <option value="">Same as the scheme</option>
                {STALL_ANGLES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              <span className="siteplan-reset-spacer" />
            </span>
          </label>
          <p className="siteplan-muted siteplan-small">Reshape, drag or rotate the area with the map&apos;s edit tools; drag ⟳ to turn its stalls.</p>
          <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onRemoveArea(selected.id)}>Remove parking area</button>
        </div>
      )}

      {(p?.routedAisles || []).length > 0 && (
        <div className="siteplan-routed">
          <span>
            <b>{p.routedAisles.length}</b> aisle{p.routedAisles.length === 1 ? '' : 's'} routed automatically (dashed blue) to connect bays to a drive
            {p.disconnected ? ` - ${p.disconnected} bay${p.disconnected === 1 ? ' still can\'t' : 's still can\'t'} reach one` : ''}.
          </span>
          <button type="button" className="siteplan-small-btn" onClick={onKeepRouted}>Keep as drawn aisles</button>
        </div>
      )}
      {(p?.flowIssues || []).length > 0 && (
        <p className="siteplan-neg siteplan-small">⚠ One-way flow: {p.flowIssues.map((x) => x.text).join('; ')}</p>
      )}

      <div className="siteplan-section-head">
        <span className="siteplan-small"><b>Drive aisles</b></span>
        <button type="button" className="siteplan-small-btn" onClick={onDrawAisle} title="Click points on the map; finish on the last point">+ Drive aisle</button>
      </div>
      {(scheme.driveAisles || []).length === 0 && (
        <p className="siteplan-muted siteplan-small">
          Draw a drive where you want one. Stalls and buildings keep clear of it, rows can open onto it, and its turns are
          checked against a {fmtDec(settings.turnRadius, 0)} ft turning radius.
        </p>
      )}
      {(scheme.driveAisles || []).map((a, i) => {
        const issues = (p?.aisleIssues || []).filter((x) => x.aisleId === a.id);
        return (
          <button type="button" key={a.id} className={`siteplan-space-row ${a.id === selectedAisleId ? 'active' : ''}`} onClick={() => onSelectAisle(a.id)}>
            <span className="siteplan-space-swatch aisle" />
            <span className="siteplan-space-name">Aisle {i + 1}</span>
            <span className={`siteplan-small ${issues.length ? 'siteplan-neg' : 'siteplan-muted'}`}>
              {aisleWidthOf(a, settings)} ft · {a.twoWay === false ? 'one-way' : 'two-way'}
              {issues.length ? ` · ${issues.length} issue${issues.length === 1 ? '' : 's'}` : ''}
            </span>
          </button>
        );
      })}
      {(() => {
        const a = (scheme.driveAisles || []).find((x) => x.id === selectedAisleId);
        if (!a) return null;
        const issues = (p?.aisleIssues || []).filter((x) => x.aisleId === a.id);
        return (
          <div className="siteplan-space-edit">
            <label className="siteplan-field">
              <span className="siteplan-field-label">Traffic</span>
              <span className="siteplan-field-input">
                <select value={a.twoWay === false ? 'one' : 'two'} onChange={(e) => onUpdateAisle(a.id, { twoWay: e.target.value === 'two' })}>
                  <option value="two">Two-way</option>
                  <option value="one">One-way</option>
                </select>
                <span className="siteplan-reset-spacer" />
              </span>
            </label>
            {type.mode === 'industrial' && (
              <label className="siteplan-field">
                <span className="siteplan-field-label">Trucks use it</span>
                <span className="siteplan-field-input">
                  <select value={a.truck ? 'yes' : 'no'} onChange={(e) => onUpdateAisle(a.id, { truck: e.target.value === 'yes' ? true : undefined })}>
                    <option value="no">No</option>
                    <option value="yes">Yes - check for a WB-67</option>
                  </select>
                  <span className="siteplan-reset-spacer" />
                </span>
              </label>
            )}
            <label className="siteplan-field">
              <span className="siteplan-field-label">Width<span className="siteplan-field-unit"> ft</span></span>
              <span className="siteplan-field-input">
                <NumberInput value={aisleWidthOf(a, settings)} min={8} max={80} onChange={(n) => onUpdateAisle(a.id, { width: n })} />
                <span className="siteplan-reset-spacer" />
              </span>
            </label>
            {issues.map((x) => <p key={`${x.kind}-${x.text}`} className="siteplan-neg siteplan-small">⚠ {x.text}</p>)}
            <p className="siteplan-muted siteplan-small">Drag its points with the map&apos;s edit tool to reshape it.</p>
            <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onRemoveAisle(a.id)}>Remove aisle</button>
          </div>
        );
      })()}

      <div className="siteplan-section-head">
        <span className="siteplan-small"><b>Entries</b></span>
        <button type="button" className="siteplan-small-btn" onClick={onAddEntry} disabled={!result?.metrics}>+ Entry</button>
      </div>
      {entries.map((e, i) => (
        <div key={e.id} className="siteplan-preset-row">
          <span className={e.reaches ? '' : 'siteplan-neg'}>
            Entry {i + 1}{e.auto ? ' (automatic - on the longest edge)' : ''}{e.reaches ? '' : ' - doesn\'t reach the drive'}
          </span>
          {!e.auto && <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onRemoveEntry(e.id)}>×</button>}
        </div>
      ))}
      <p className="siteplan-muted siteplan-small">Drag an IN marker along the boundary to move an entry.</p>
    </div>
  );
}

// A parking garage's floor plan: stalls per level, the ramp, and how
// efficient it is.
function GarageSection({ result }) {
  const g = result?.garage;
  if (!g) return null;
  return (
    <div className="siteplan-section">
      <div className="siteplan-group-title">Garage</div>
      <dl className="siteplan-metrics">
        <dt>Stalls per level</dt><dd>{fmtInt(g.perLevel)}</dd>
        <dt>Levels</dt><dd>{fmtInt(g.levels)}</dd>
        <dt>Stalls</dt><dd>{fmtInt(g.types.total)} ({fmtInt(g.types.ada)} accessible, {fmtInt(g.types.van)} van)</dd>
        <dt>Area per stall</dt><dd>{fmtInt(g.gsfPerStall)} sf</dd>
        <dt>Ramp</dt><dd>{g.rampType === 'none' ? 'None (single deck)' : `${{ express: 'Express ramp', helix: 'Helix ramp', sloped: 'Sloped floors' }[g.rampType]} at ${fmtDec(g.slopePct, 1)}%`}</dd>
        <dt>{g.rampType === 'helix' ? 'Length for helix + aisles' : 'Length needed'}</dt><dd className={g.fits ? '' : 'siteplan-neg'}>{fmtInt(g.required)} ft of {fmtInt(g.longSide)} ft</dd>
      </dl>
      {!g.fits && (
        <p className="siteplan-neg siteplan-small">
          The ramp doesn&apos;t fit: {g.note}.
          {g.rampType === 'helix'
            ? ' Widen the helix (inside radius or lane), lower the floor-to-floor, or switch ramp type.'
            : ' Lengthen the garage, change the slope, or switch ramp type.'}
        </p>
      )}
      <p className="siteplan-muted siteplan-small">The map shows a typical level: bays, cores (dark), end aisles and the ramp (orange; the dot is uphill).</p>
    </div>
  );
}

// Presets (#4): save a scheme's asset type and settings, apply them on
// any site.
function PresetsSection({ presets, scheme, onApply, onSave, onDelete }) {
  return (
    <details className="siteplan-section siteplan-presets">
      <summary className="siteplan-group-title">Presets ({presets.length})</summary>
      <button type="button" className="siteplan-small-btn" onClick={onSave}>Save this scheme as a preset</button>
      {presets.length === 0 && <p className="siteplan-muted siteplan-small">None saved yet.</p>}
      {presets.map((p) => (
        <div key={p.id} className="siteplan-preset-row">
          <span>
            <b>{p.name}</b>
            <span className="siteplan-muted siteplan-small"> · {getAssetType(p.assetType).label}{p.createdByName ? ` · ${p.createdByName}` : ''}</span>
          </span>
          <span>
            <button type="button" className="siteplan-link-btn" onClick={() => onApply(p)} disabled={!scheme}>Apply</button>
            <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onDelete(p)}>×</button>
          </span>
        </div>
      ))}
    </details>
  );
}

function SitePlanEditor() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(null); // { name, projectId, boundary, mapView, schemes }
  const [canDelete, setCanDelete] = useState(false);
  const [projects, setProjects] = useState([]);
  const [presets, setPresets] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [compare, setCompare] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [flyTo, setFlyTo] = useState(null);
  const [drawRequest, setDrawRequest] = useState(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [selectedAisleId, setSelectedAisleId] = useState(null);
  const [saveState, setSaveState] = useState('saved'); // saved | pending | saving | error | conflict
  const [saveError, setSaveError] = useState(null);

  const draftRef = useRef(null);
  const dirtyRef = useRef(new Set());
  const updatedAtRef = useRef(null);
  const savingRef = useRef(false);
  const timerRef = useRef(null);
  const conflictRef = useRef(false); // after a 409, nothing more is sent

  useEffect(() => {
    sitePlansApi('GET', `/${planId}`)
      .then(({ plan, canDelete: del }) => {
        const d = {
          name: plan.name,
          projectId: plan.projectId || '',
          boundary: plan.boundary,
          mapView: plan.mapView,
          schemes: plan.schemes,
        };
        draftRef.current = d;
        updatedAtRef.current = plan.updatedAt;
        setDraft(d);
        setActiveId(plan.schemes[0]?.id || null);
        setCanDelete(del);
      })
      .catch((err) => setLoadError(err.status === 404 ? 'This site doesn\'t exist or was deleted.' : err.message));
    loadProjects().then(setProjects).catch(() => {});
    sitePlansApi('GET', '/presets').then((d) => setPresets(d.presets || [])).catch(() => {});
  }, [planId]);

  // Sends whatever changed since the last save. Reads only refs, so the
  // timer and the retry button can call it at any point.
  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    if (savingRef.current || !draftRef.current || conflictRef.current) return;
    const keys = [...dirtyRef.current];
    if (!keys.length) {
      setSaveState('saved');
      return;
    }
    dirtyRef.current = new Set();
    savingRef.current = true;
    setSaveState('saving');
    const body = { expectedUpdatedAt: updatedAtRef.current };
    for (const key of keys) body[key] = draftRef.current[key];
    // A name being retyped can be blank for a moment; send a placeholder
    // rather than have the save refused.
    const tidyMix = (o) => (o && o.mix ? { ...o, mix: o.mix.map((u) => ({ ...u, name: u.name.trim() || 'Unit' })) } : o);
    if (body.name !== undefined && !body.name.trim()) delete body.name;
    if (body.schemes) {
      body.schemes = body.schemes.map((s) => ({
        ...s,
        name: s.name.trim() || 'Scheme',
        overrides: tidyMix(s.overrides),
        spaces: s.spaces?.map((sp) => ({ ...sp, name: sp.name.trim() || 'Space', overrides: tidyMix(sp.overrides) })),
      }));
    }
    let failed = false;
    try {
      const { plan } = await sitePlansApi('PUT', `/${planId}`, body);
      updatedAtRef.current = plan.updatedAt;
      setSaveError(null);
    } catch (err) {
      failed = true;
      keys.forEach((k) => dirtyRef.current.add(k));
      if (err.status === 409) conflictRef.current = true;
      setSaveState(err.status === 409 ? 'conflict' : 'error');
      setSaveError(err.message);
    } finally {
      savingRef.current = false;
    }
    if (failed) return;
    if (dirtyRef.current.size) {
      setSaveState('pending');
      timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
    } else {
      setSaveState('saved');
    }
  }, [planId]);

  // Leaving the page saves anything still waiting.
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (dirtyRef.current.size) flush();
  }, [flush]);

  const change = useCallback((key, value) => {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
    dirtyRef.current.add(key);
    if (conflictRef.current) return; // shown, but can't be saved over the newer copy
    setSaveState('pending');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  // Only the boundary and schemes change a layout; renaming the site or
  // picking a project doesn't re-run the solver.
  const boundary = draft?.boundary;
  const schemes = draft?.schemes;
  const results = useMemo(() => {
    if (!schemes) return {};
    return Object.fromEntries(schemes.map((s) => [s.id, solveScheme(boundary, s)]));
  }, [boundary, schemes]);

  const active = draft?.schemes.find((s) => s.id === activeId) || draft?.schemes[0];
  const activeType = active ? getAssetType(active.assetType) : null;
  const activeResult = active ? results[active.id] : null;
  const placed = active && supportsManualLayout(activeType) && active.edits?.buildings?.length ? active.edits.buildings : null;

  // Changing scheme clears what was selected on the map.
  useEffect(() => {
    setSelectedBuildingId(null);
    setSelectedSpaceId(null);
    setSelectedAreaId(null);
    setSelectedAisleId(null);
  }, [activeId]);

  const buildingLabel = useCallback((i, b) => {
    if (b) {
      const floors = b.floors || effectiveSettings(active).floors;
      return `Building ${i + 1} · ${b.length} × ${b.depth} ft${activeType?.mode === 'industrial' ? '' : ` · ${floors} floors`}`;
    }
    const m = activeResult?.metrics;
    return m ? `Building ${i + 1}${m.floors ? ` · ${m.floors} floor${m.floors === 1 ? '' : 's'}` : ''}` : '';
  }, [activeResult, active, activeType]);

  const updateScheme = useCallback((id, patch) => {
    change('schemes', draftRef.current.schemes.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
      return next;
    }));
  }, [change]);

  const currentScheme = () => draftRef.current.schemes.find((s) => s.id === active.id);

  // ---- Schemes ----
  const addScheme = () => {
    if (draftRef.current.schemes.length >= 12) return;
    const copy = { ...JSON.parse(JSON.stringify(active)), id: newId(), name: nextSchemeName(draftRef.current.schemes) };
    change('schemes', [...draftRef.current.schemes, copy]);
    setActiveId(copy.id);
  };

  const removeScheme = () => {
    if (draftRef.current.schemes.length <= 1) return;
    if (!window.confirm(`Delete ${active.name}?`)) return;
    const rest = draftRef.current.schemes.filter((s) => s.id !== active.id);
    change('schemes', rest);
    setActiveId(rest[0].id);
  };

  const changeType = (assetType) => {
    if ((Object.keys(active.overrides || {}).length > 0 || active.edits)
      && !window.confirm('Switching the asset type starts its settings from that type\'s defaults and goes back to an automatic layout. Continue?')) return;
    updateScheme(active.id, { assetType, overrides: {}, edits: undefined });
  };

  // ---- Edit layout (#1) ----
  const setPlaced = (buildings) => updateScheme(active.id, { edits: buildings.length ? { buildings: buildings.map(tidyBuilding) } : undefined });
  const placedNow = () => currentScheme().edits?.buildings || [];

  const startManual = () => {
    const rects = activeResult?.buildingRects || [];
    const buildings = rects.map((r) => ({ id: newId(), ...r }));
    if (!buildings.length && boundary) {
      const s = effectiveSettings(active);
      buildings.push({ id: newId(), center: ringCentroid(boundary), length: 200, depth: s.buildingDepth || 65, angle: activeResult?.metrics?.orientationDeg || 0 });
    }
    setPlaced(buildings);
    setSelectedBuildingId(buildings[0]?.id || null);
  };

  const resetAuto = () => {
    if (!window.confirm('Go back to the automatic layout? The buildings you placed will be dropped.')) return;
    updateScheme(active.id, { edits: undefined });
    setSelectedBuildingId(null);
  };

  const addBuilding = () => {
    if (!boundary) return;
    const s = effectiveSettings(active);
    const industrial = activeType.mode === 'industrial';
    const b = {
      id: newId(),
      center: ringCentroid(boundary),
      length: industrial ? 400 : 200,
      depth: industrial ? 200 : (s.buildingDepth || 65),
      angle: activeResult?.metrics?.orientationDeg || 0,
    };
    setPlaced([...placedNow(), b]);
    setSelectedBuildingId(b.id);
  };

  const updateBuilding = useCallback((id, patch) => {
    const scheme = draftRef.current.schemes.find((s) => s.id === activeId) || draftRef.current.schemes[0];
    const buildings = (scheme.edits?.buildings || []).map((b) => {
      if (b.id !== id) return b;
      const next = { ...b, ...patch };
      if (patch.floors === undefined && 'floors' in patch) delete next.floors;
      return next;
    });
    updateScheme(scheme.id, { edits: { buildings: buildings.map(tidyBuilding) } });
  }, [activeId, updateScheme]);

  const removeBuilding = (id) => {
    const rest = placedNow().filter((b) => b.id !== id);
    if (!rest.length) {
      resetAuto();
      return;
    }
    setPlaced(rest);
    setSelectedBuildingId(null);
  };

  const duplicateBuilding = (id) => {
    const b = placedNow().find((x) => x.id === id);
    if (!b) return;
    // Next to the original, one building depth plus a drive aisle across.
    const proj = makeProjection([b.center]);
    const a = (b.angle * Math.PI) / 180;
    const shift = b.depth + 30;
    const [lat, lng] = proj.toLatLng([-Math.sin(a) * shift, Math.cos(a) * shift]);
    const copy = { ...b, id: newId(), center: [lng, lat] };
    setPlaced([...placedNow(), copy]);
    setSelectedBuildingId(copy.id);
  };

  // ---- Spaces (#3) ----
  const setSpaces = (spaces) => updateScheme(active.id, { spaces: spaces.length ? spaces : undefined });
  const spacesNow = () => currentScheme().spaces || [];

  const onSpaceDrawn = useCallback((polygon) => {
    const scheme = draftRef.current.schemes.find((s) => s.id === activeId) || draftRef.current.schemes[0];
    const existing = scheme.spaces || [];
    if (existing.length >= 20) return;
    const sp = { id: newId(), name: `Space ${existing.length + 1}`, kind: 'no-build', polygon };
    updateScheme(scheme.id, { spaces: [...existing, sp] });
    setSelectedSpaceId(sp.id);
  }, [activeId, updateScheme]);

  const updateSpace = useCallback((id, patch) => {
    const scheme = draftRef.current.schemes.find((s) => s.id === activeId) || draftRef.current.schemes[0];
    const spaces = (scheme.spaces || []).map((sp) => {
      if (sp.id !== id) return sp;
      const next = { ...sp, ...patch };
      Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
      return next;
    });
    updateScheme(scheme.id, { spaces });
  }, [activeId, updateScheme]);

  const removeSpace = (id) => {
    setSpaces(spacesNow().filter((sp) => sp.id !== id));
    setSelectedSpaceId(null);
  };

  // ---- Parking ----
  const schemeById = () => draftRef.current.schemes.find((s) => s.id === activeId) || draftRef.current.schemes[0];

  const onAreaDrawn = useCallback((polygon) => {
    const scheme = schemeById();
    const existing = scheme.parkingAreas || [];
    if (existing.length >= 30) return;
    const area = { id: newId(), polygon, angle: 'auto' };
    updateScheme(scheme.id, { parkingAreas: [...existing, area] });
    setSelectedAreaId(area.id);
  }, [activeId, updateScheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateArea = useCallback((id, patch) => {
    const scheme = schemeById();
    const parkingAreas = (scheme.parkingAreas || []).map((a) => {
      if (a.id !== id) return a;
      const next = { ...a, ...patch };
      Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
      return next;
    });
    updateScheme(scheme.id, { parkingAreas });
  }, [activeId, updateScheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeArea = (id) => {
    const rest = (currentScheme().parkingAreas || []).filter((a) => a.id !== id);
    updateScheme(active.id, { parkingAreas: rest.length ? rest : undefined });
    setSelectedAreaId(null);
  };

  const setOverrideKey = (key, value) => {
    const scheme = currentScheme();
    updateScheme(scheme.id, { overrides: withOverride(getAssetType(scheme.assetType), scheme.overrides || {}, key, value) });
  };

  // Moving the automatic entry makes it a real one; the list then holds
  // every entry by hand.
  const onEntryMove = useCallback((id, point, auto) => {
    const scheme = schemeById();
    const list = scheme.entries || [];
    const entries = auto ? [{ id: newId(), point }] : list.map((e) => (e.id === id ? { ...e, point } : e));
    updateScheme(scheme.id, { entries });
  }, [activeId, updateScheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const addEntry = () => {
    if (!boundary) return;
    const scheme = currentScheme();
    const list = scheme.entries || [];
    if (list.length >= 10) return;
    // Start the new one on the boundary corner farthest from the others.
    const ring = boundary.coordinates[0].slice(0, -1);
    const existing = list.length ? list.map((e) => e.point) : (activeResult?.geometry?.entries || []).map((e) => e.point);
    const far = ring.reduce((best, p) => {
      const d = Math.min(...existing.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])), Infinity);
      return !best || d > best.d ? { d, p } : best;
    }, null);
    const keep = list.length ? list : existing.map((point) => ({ id: newId(), point }));
    updateScheme(scheme.id, { entries: [...keep, { id: newId(), point: far.p }] });
  };

  const removeEntry = (id) => {
    const rest = (currentScheme().entries || []).filter((e) => e.id !== id);
    updateScheme(active.id, { entries: rest.length ? rest : undefined });
  };

  // ---- Drive aisles ----
  const onAisleDrawn = useCallback((line) => {
    if (!line || line.type !== 'LineString' || line.coordinates.length < 2) return;
    const scheme = schemeById();
    const existing = scheme.driveAisles || [];
    if (existing.length >= 30) {
      window.alert('A scheme can hold 30 drive aisles - remove one first.');
      return;
    }
    const aisle = { id: newId(), line, twoWay: true };
    updateScheme(scheme.id, { driveAisles: [...existing, aisle] });
    setSelectedAisleId(aisle.id);
  }, [activeId, updateScheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateAisle = useCallback((id, patch) => {
    const scheme = schemeById();
    updateScheme(scheme.id, {
      driveAisles: (scheme.driveAisles || []).map((a) => {
        if (a.id !== id) return a;
        const next = { ...a, ...patch };
        Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
        return next;
      }),
    });
  }, [activeId, updateScheme]); // eslint-disable-line react-hooks/exhaustive-deps

  // The routed aisles become drawn ones you can edit; routing then has
  // nothing left to do for them.
  const keepRouted = () => {
    const lines = activeResult?.parking?.routedAisles || [];
    if (!lines.length) return;
    const existing = currentScheme().driveAisles || [];
    const room = Math.max(0, 30 - existing.length);
    const kept = lines.slice(0, room).map((line) => ({ id: newId(), line, twoWay: true, fromBay: true }));
    if (kept.length < lines.length) window.alert(`Only ${kept.length} of ${lines.length} fit - a scheme holds 30 drive aisles.`);
    updateScheme(active.id, { driveAisles: [...existing, ...kept] });
  };

  const removeAisle = (id) => {
    const rest = (currentScheme().driveAisles || []).filter((a) => a.id !== id);
    updateScheme(active.id, { driveAisles: rest.length ? rest : undefined });
    setSelectedAisleId(null);
  };

  const areaInfo = useMemo(
    () => Object.fromEntries((activeResult?.parking?.areas || []).map((a) => [a.id, a.orientationDeg])),
    [activeResult]
  );

  // ---- Presets (#4) ----
  async function savePreset() {
    const name = window.prompt('Name this preset (e.g. "Our standard wrap")', `${active.name} - ${activeType.label}`);
    if (!name || !name.trim()) return;
    try {
      const { preset } = await sitePlansApi('POST', '/presets', { name, assetType: active.assetType, overrides: active.overrides });
      setPresets((list) => [...list, preset].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      window.alert(err.message);
    }
  }

  function applyPreset(p) {
    if ((Object.keys(active.overrides || {}).length || active.assetType !== p.assetType)
      && !window.confirm(`Replace ${active.name}'s asset type and settings with "${p.name}"?`)) return;
    updateScheme(active.id, {
      assetType: p.assetType,
      overrides: { ...p.overrides },
      edits: p.assetType === active.assetType ? active.edits : undefined,
    });
  }

  async function deletePreset(p) {
    if (!window.confirm(`Delete the preset "${p.name}" for everyone?`)) return;
    try {
      await sitePlansApi('DELETE', `/presets/${p.id}`);
      setPresets((list) => list.filter((x) => x.id !== p.id));
    } catch (err) {
      window.alert(err.message);
    }
  }

  // ---- Generator (#5) ----
  function applyOption(combo) {
    if (draftRef.current.schemes.length >= 12) {
      window.alert('A site can hold 12 schemes - delete one first.');
      return;
    }
    const base = JSON.parse(JSON.stringify(active));
    delete base.edits;
    const option = {
      ...base,
      id: newId(),
      name: nextSchemeName(draftRef.current.schemes, 'Option'),
      overrides: { ...base.overrides, ...combo },
    };
    change('schemes', [...draftRef.current.schemes, option]);
    setActiveId(option.id);
    setGenerating(false);
  }

  // ---- Reports ----
  const fileBase = () => (draft.name || 'site').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-') || 'site';
  function downloadCsv() {
    // A byte-order mark so Excel reads it as UTF-8 (°, ✓).
    const blob = new Blob(['\ufeff', toCsv(reportTable(draft.schemes, results))], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase()}-schemes.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function printReport() {
    const win = window.open('', '_blank');
    if (!win) {
      window.alert('Your browser blocked the report window - allow pop-ups for HeyPhil and try again.');
      return;
    }
    const project = projects.find((p) => p.id === draft.projectId);
    win.document.write(reportHtml({
      siteName: draft.name,
      projectTitle: project?.title,
      schemes: draft.schemes,
      results,
      generatedAt: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    }));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  async function deleteSite() {
    if (!window.confirm(`Delete "${draft.name}"? This cannot be undone.`)) return;
    clearTimeout(timerRef.current);
    try {
      await sitePlansApi('DELETE', `/${planId}`);
      dirtyRef.current = new Set();
      navigate('/dev/site-planner');
    } catch (err) {
      window.alert(err.message);
      if (dirtyRef.current.size) flush(); // the edits waiting before Delete still save
    }
  }

  const spaceLayouts = useMemo(
    () => (activeResult?.spaces || []).map((sp) => sp.result?.geometry).filter(Boolean),
    [activeResult]
  );
  const badBuildingIds = useMemo(
    () => [...(activeResult?.warnings?.outside || []), ...(activeResult?.warnings?.overlaps || []).flat()],
    [activeResult]
  );

  if (loadError) {
    return (
      <div className="siteplan-page">
        <div className="siteplan-header"><div><h2>Site Planner</h2></div></div>
        <div className="siteplan-list">
          <p className="siteplan-error">{loadError}</p>
          <Link to="/dev/site-planner">← All sites</Link>
        </div>
      </div>
    );
  }
  if (!draft) return <div className="siteplan-page"><p className="siteplan-muted siteplan-pad">Loading...</p></div>;

  const saveLabel = {
    saved: 'All changes saved',
    pending: 'Saving…',
    saving: 'Saving…',
    error: 'Couldn\'t save',
    conflict: 'Changed elsewhere',
  }[saveState];

  return (
    <div className="siteplan-page">
      <div className="siteplan-editor-header">
        <Link to="/dev/site-planner" className="siteplan-back">← Sites</Link>
        <input
          className="siteplan-name"
          value={draft.name}
          maxLength={200}
          onChange={(e) => change('name', e.target.value)}
          onBlur={(e) => { if (!e.target.value.trim()) change('name', 'Untitled site'); }}
          aria-label="Site name"
        />
        <select className="siteplan-project" value={draft.projectId} onChange={(e) => change('projectId', e.target.value)} aria-label="Project">
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <span className={`siteplan-save siteplan-save-${saveState}`} title={saveError || ''}>{saveLabel}</span>
        {saveState === 'error' && <button className="siteplan-link-btn" onClick={flush}>Retry</button>}
        {saveState === 'conflict' && (
          <button
            className="siteplan-link-btn"
            onClick={() => {
              if (window.confirm('Reload the latest version? Your unsaved changes here will be lost.')) window.location.reload();
            }}
          >
            Reload
          </button>
        )}
        <span className="siteplan-header-spacer" />
        <button className="siteplan-toggle" onClick={downloadCsv} disabled={!draft.boundary} title="Every scheme's numbers as a spreadsheet">⬇ CSV</button>
        <button className="siteplan-toggle" onClick={printReport} disabled={!draft.boundary} title="A printable report of every scheme">🖨 Report</button>
        <button className="siteplan-toggle" onClick={() => setGenerating(true)} disabled={!draft.boundary} title="Try many combinations and keep the best">
          ✨ Generate options
        </button>
        <button
          className={`siteplan-toggle ${compare ? 'on' : ''}`}
          onClick={() => {
            setFlyTo(null); // the map remounts; it should open on the site, not an old search
            setCompare((c) => !c);
          }}
        >
          {compare ? 'Back to plan' : `Compare schemes (${draft.schemes.length})`}
        </button>
        {canDelete && <button className="btn-danger siteplan-delete" onClick={deleteSite}>Delete site</button>}
      </div>
      {saveState === 'conflict' && <div className="siteplan-banner">{saveError}</div>}

      {compare ? (
        <CompareView
          schemes={draft.schemes}
          results={results}
          onOpen={(id) => {
            setFlyTo(null);
            setActiveId(id);
            setCompare(false);
          }}
        />
      ) : (
        <div className="siteplan-workspace">
          <div className="siteplan-map-wrap">
            <AddressSearch
              onPick={(r) => {
                const view = { lat: r.lat, lng: r.lng, zoom: 18 };
                setFlyTo({ ...view, at: Date.now() });
                change('mapView', view);
              }}
            />
            <SitePlanMap
              boundary={draft.boundary}
              initialView={draft.mapView}
              layout={activeResult?.geometry}
              spaceLayouts={spaceLayouts}
              flyTo={flyTo}
              onBoundaryChange={(geometry) => change('boundary', geometry)}
              buildingLabel={buildingLabel}
              spaces={active.spaces || NONE}
              selectedSpaceId={selectedSpaceId}
              onSelectSpace={setSelectedSpaceId}
              onSpaceChange={(id, polygon) => updateSpace(id, { polygon })}
              onSpaceDrawn={onSpaceDrawn}
              drawRequest={drawRequest}
              placed={placed}
              badBuildingIds={badBuildingIds}
              selectedBuildingId={selectedBuildingId}
              onSelectBuilding={setSelectedBuildingId}
              onBuildingChange={updateBuilding}
              parkingAreas={hasSurfaceParking(activeType) ? (active.parkingAreas || NONE) : NONE}
              areaInfo={areaInfo}
              selectedAreaId={selectedAreaId}
              onSelectArea={setSelectedAreaId}
              onAreaChange={(id, polygon) => updateArea(id, { polygon })}
              onAreaDrawn={onAreaDrawn}
              onAreaAngle={(id, angle) => updateArea(id, { angle })}
              onEntryMove={onEntryMove}
              driveAisles={hasSurfaceParking(activeType) ? (active.driveAisles || NONE) : NONE}
              selectedAisleId={selectedAisleId}
              onSelectAisle={setSelectedAisleId}
              onAisleChange={(id, line) => updateAisle(id, { line })}
              onAisleDrawn={onAisleDrawn}
              truckMode={activeType.mode === 'industrial'}
            />
            {!draft.boundary && (
              <div className="siteplan-map-hint">
                Search an address, then trace the site with the polygon or rectangle tool on the map&apos;s left edge.
              </div>
            )}
            <div className="siteplan-legend">
              <span><i className="lg-boundary" />Site</span>
              <span><i className="lg-setback" />Setback</span>
              <span><i className="lg-building" />Building</span>
              <span><i className="lg-parking" />Parking</span>
              {hasSurfaceParking(activeType) && <><span><i className="lg-drive" />Drive</span><span><i className="lg-ada" />Accessible</span></>}
              {(active.parkingAreas || NONE).length > 0 && <span><i className="lg-parkarea" />Parking area</span>}
              {(active.spaces || NONE).some((sp) => sp.kind === 'no-build') && <span><i className="lg-nobuild" />No-build</span>}
              {(active.spaces || NONE).some((sp) => sp.kind === 'asset') && <span><i className="lg-space" />Space</span>}
              {activeType.mode === 'lots' && <><span><i className="lg-lot" />Lots</span><span><i className="lg-street" />Streets</span></>}
              {activeType.mode === 'industrial' && <><span><i className="lg-truck" />Truck court</span><span><i className="lg-trailer" />Trailers</span></>}
            </div>
          </div>

          <aside className="siteplan-panel">
            <div className="siteplan-tabs">
              {draft.schemes.map((s) => {
                const y = yieldOf(getAssetType(s.assetType), planMetrics(results[s.id]));
                return (
                  <button key={s.id} className={`siteplan-tab ${s.id === active.id ? 'active' : ''}`} onClick={() => setActiveId(s.id)}>
                    <span className="siteplan-tab-name">{s.name}{s.edits ? ' ✋' : ''}</span>
                    <span className="siteplan-tab-yield">{y.value} {y.label}</span>
                  </button>
                );
              })}
              <button
                className="siteplan-tab siteplan-tab-add"
                onClick={addScheme}
                disabled={draft.schemes.length >= 12}
                title="Copy this scheme to try a variation"
              >
                + Scheme
              </button>
            </div>

            <div className="siteplan-scheme-head">
              <input
                className="siteplan-scheme-name"
                value={active.name}
                maxLength={100}
                onChange={(e) => updateScheme(active.id, { name: e.target.value })}
                onBlur={(e) => { if (!e.target.value.trim()) updateScheme(active.id, { name: 'Scheme' }); }}
                aria-label="Scheme name"
              />
              {draft.schemes.length > 1 && (
                <button className="siteplan-link-btn siteplan-danger-link" onClick={removeScheme}>Delete scheme</button>
              )}
            </div>

            <label className="siteplan-type">
              Asset type
              <select value={active.assetType} onChange={(e) => changeType(e.target.value)}>
                {ASSET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>

            <ResultsCard type={activeType} result={activeResult} />

            <LayoutSection
              scheme={active}
              type={activeType}
              result={activeResult}
              selectedId={selectedBuildingId}
              onSelect={setSelectedBuildingId}
              onStart={startManual}
              onReset={resetAuto}
              onAdd={addBuilding}
              onUpdate={updateBuilding}
              onRemove={removeBuilding}
              onDuplicate={duplicateBuilding}
            />

            <SpacesSection
              scheme={active}
              results={activeResult}
              selectedId={selectedSpaceId}
              onSelect={setSelectedSpaceId}
              onDraw={(shape) => setDrawRequest({ target: 'space', shape, at: Date.now() })}
              onUpdate={updateSpace}
              onRemove={removeSpace}
            />

            <ParkingSection
              scheme={active}
              type={activeType}
              result={activeResult}
              selectedAreaId={selectedAreaId}
              onSelectArea={setSelectedAreaId}
              onDraw={(shape) => setDrawRequest({ target: 'parking', shape, at: Date.now() })}
              onUpdateArea={updateArea}
              onRemoveArea={removeArea}
              onSetOverride={setOverrideKey}
              onAddEntry={addEntry}
              onRemoveEntry={removeEntry}
              selectedAisleId={selectedAisleId}
              onSelectAisle={setSelectedAisleId}
              onDrawAisle={() => setDrawRequest({ target: 'aisle', shape: 'Line', at: Date.now() })}
              onUpdateAisle={updateAisle}
              onRemoveAisle={removeAisle}
              onKeepRouted={keepRouted}
            />

            <GarageSection result={activeResult} />

            <PresetsSection presets={presets} scheme={active} onApply={applyPreset} onSave={savePreset} onDelete={deletePreset} />

            <div className="siteplan-section">
              <div className="siteplan-group-title">Settings · {activeType.label}</div>
              <p className="siteplan-muted siteplan-small">Starting from standard defaults. Change any number; ↺ puts it back.</p>
              <SchemeSettings
                key={`${active.id}-${active.assetType}`}
                type={activeType}
                overrides={active.overrides}
                onChange={(overrides) => updateScheme(active.id, { overrides })}
                idPrefix={active.id}
                currentOrientationDeg={activeResult?.metrics?.orientationDeg}
                currentParkingDeg={activeResult?.metrics?.parkingOrientationDeg}
              />
            </div>

            {draft.boundary && (
              <button
                className="siteplan-link-btn siteplan-danger-link"
                onClick={() => { if (window.confirm('Clear the site boundary so you can draw it again?')) change('boundary', null); }}
              >
                Clear site boundary
              </button>
            )}
            <p className="siteplan-muted siteplan-small">
              A rules-based test fit: buildings and double-loaded parking bays lined up with the site&apos;s main edges.
              Drive connections and grading aren&apos;t modelled. Flood and wetland layers are in the map&apos;s layer menu (top right).
              {' '}Orientation {fmtDec(activeResult?.metrics?.orientationDeg || 0, 1)}°.
            </p>
          </aside>
        </div>
      )}

      {generating && (
        <GeneratorModal boundary={draft.boundary} scheme={active} onClose={() => setGenerating(false)} onApply={applyOption} />
      )}
    </div>
  );
}

export default SitePlanEditor;
