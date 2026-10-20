import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SitePlanMap, { UNIT_COLORS } from './SitePlanMap';
import GeneratorModal from './GeneratorModal';
import { asType } from './generator';
import { loadProjects, searchAddress, sitePlansApi } from './api';
import { ASSET_TYPES, effectiveSettings, getAssetType } from './assetTypes';
import { makeProjection } from './geometry';
import { aisleWidthOf, hasSurfaceParking, solveScheme, supportsManualLayout } from './solver';
import { OrientationField, SchemeSettings, fmtDec, fmtInt, fmtMoney, fmtPct, withOverride } from './settingsFields';
import { ChecksPanel, CompareView, ProformaPanel, QuantitiesPanel, Scoreboard, planMetrics, yieldOf } from './results';
import { Step } from './Steps';
import { modelSteps } from './stepPlan';
import {
  AisleEditor, AreaEditor, BayDetails, BuildingEditor, GeneratedBuilding, STALL_ANGLES, SelectionBar, SpaceEditor, parseSelection, selectionKey,
} from './SelectionBar';
import { reportHtml, reportTable, toCsv } from './report';
import { parcelAt } from './parcels';
import { analyzeTerrain, fetchElevations, samplePoints, STEEP_PAD_PCT } from './terrain';
import Massing3D from './Massing3D';
import HelpModal from './HelpModal';
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
function LayoutSection({ scheme, type, result, selectedId, onSelect, onStart, onReset, onAdd, shaped }) {
  if (!supportsManualLayout(type)) return null;
  const placed = scheme.edits?.buildings || [];
  const outside = new Set(result?.warnings?.outside || []);
  const overlapping = new Set((result?.warnings?.overlaps || []).flat());

  if (!placed.length) {
    return (
      <div className="siteplan-section">
        <div className="siteplan-section-head">
          <span className="siteplan-group-title">Layout · automatic</span>
          {!shaped && <button type="button" className="siteplan-small-btn" onClick={onStart} disabled={!result?.metrics}>✋ Edit by hand</button>}
        </div>
        <p className="siteplan-muted siteplan-small">
          {shaped
            ? 'Shaped buildings are laid out automatically - click one on the map to see it. Set the shape to Bars to place buildings by hand.'
            : 'Click any building on the map to see it, or drag one to move it - that switches to placing by hand. Parking re-fills around them.'}
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
        Click a building - its size, angle and floors are at the top of this panel. Drag it (or ✥) to move, ↔ ↕ to stretch, ⟳ to rotate. Zoning limits are checked, not enforced.
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
    </div>
  );
}

// Spaces (#3): no-build areas, or areas with their own asset type.
function SpacesSection({ scheme, results, selectedId, onSelect, onDraw }) {
  const spaces = scheme.spaces || [];
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
    </div>
  );
}

// Parking: what the lot holds by stall type, how it's laid out, the areas
// drawn by hand, and the driveway entries.
function ParkingSection({
  scheme, type, result, selectedAreaId, onSelectArea, onDraw, onSetOverride, onRemoveEntry, onAddEntry,
  selectedAisleId, onSelectAisle, onDrawAisle, onKeepRouted,
}) {
  if (!hasSurfaceParking(type)) return null;
  const settings = effectiveSettings(scheme);
  const p = result?.parking;
  const t = result?.totals?.stallTypes;
  const areas = scheme.parkingAreas || [];
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

// Terrain: sample the ground on demand, then slope, relief and earthwork.
function TerrainSection({ hasBoundary, terrain, terrainStats, boundaryKey, onCheck }) {
  return (
    <div className="siteplan-section">
      <div className="siteplan-section-head">
        <span className="siteplan-group-title">Terrain</span>
        <button type="button" className="siteplan-small-btn" onClick={onCheck} disabled={!hasBoundary || terrain?.loading}>
          {terrain?.loading ? 'Sampling…' : terrainStats ? '↻ Resample' : '⛰ Check terrain'}
        </button>
      </div>
      {!terrainStats && !terrain?.error && (
        <p className="siteplan-muted siteplan-small">Samples ground elevation across the site (USGS) for slope and a rough earthwork estimate.</p>
      )}
      {terrain?.error && terrain.key === boundaryKey && <p className="siteplan-neg siteplan-small">{terrain.error}</p>}
      {terrainStats && (
        <>
          <dl className="siteplan-metrics">
            <dt>Elevation</dt><dd>{fmtInt(terrainStats.lowFt)}-{fmtInt(terrainStats.highFt)} ft</dd>
            <dt>Relief</dt><dd>{fmtDec(terrainStats.reliefFt, 1)} ft</dd>
            <dt>Overall slope</dt><dd>{fmtDec(terrainStats.gradePct, 1)}%</dd>
            <dt>Earth moved (pads)</dt><dd>{fmtInt(terrainStats.cutCy + terrainStats.fillCy)} cy</dd>
          </dl>
          {terrainStats.steepPads > 0 && (
            <p className="siteplan-neg siteplan-small">
              {terrainStats.steepPads} building{terrainStats.steepPads === 1 ? ' sits' : 's sit'} on ground steeper than {STEEP_PAD_PCT}% - expect retaining walls or stepped floors.
            </p>
          )}
          <p className="siteplan-muted siteplan-small">
            From {terrainStats.samples} USGS 3DEP elevation points. Each building sits on one flat pad at its average ground level, so its cut and fill balance ({fmtInt(terrainStats.cutCy)} cy each way). A rough check, not a grading plan.
          </p>
        </>
      )}
    </div>
  );
}

// Setbacks by edge: which edge is the front (and a corner lot's second
// front), and what each edge ends up with.
function EdgePicker({ edges, settings, onFront, onSecond }) {
  const label = (e) => `Edge ${e.index} · faces ${e.facing} · ${fmtInt(e.lengthFt)} ft`;
  return (
    <div className="siteplan-section">
      <label className="siteplan-field">
        <span className="siteplan-field-label">Front edge</span>
        <span className="siteplan-field-input">
          <select value={settings.frontEdge || 0} onChange={(e) => onFront(Number(e.target.value) || undefined)}>
            <option value={0}>Longest edge</option>
            {edges.map((e) => <option key={e.index} value={e.index}>{label(e)}</option>)}
          </select>
          <span className="siteplan-reset-spacer" />
        </span>
      </label>
      <label className="siteplan-field">
        <span className="siteplan-field-label">Second front<span className="siteplan-field-unit"> (corner lot)</span></span>
        <span className="siteplan-field-input">
          <select value={settings.frontEdge2 || 0} onChange={(e) => onSecond(Number(e.target.value))}>
            <option value={0}>None</option>
            {edges.map((e) => <option key={e.index} value={e.index}>{label(e)}</option>)}
          </select>
          <span className="siteplan-reset-spacer" />
        </span>
      </label>
      <p className="siteplan-muted siteplan-small">
        {edges.map((e) => `${e.index}: ${e.role} ${fmtInt(e.setback)} ft`).join(' · ')}. Or click an edge&apos;s label on the map (shift-click for a second front).
      </p>
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
  // One thing is selected at a time ("kind:id", see SelectionBar).
  const [selection, setSelection] = useState(null);
  const sel = parseSelection(selection);
  const selectedOf = (kind) => (sel && sel.kind === kind ? sel.id : null);
  const selectedBuildingId = selectedOf('building');
  const selectedSpaceId = selectedOf('space');
  const selectedAreaId = selectedOf('area');
  const selectedAisleId = selectedOf('aisle');
  const setSelectedBuildingId = useCallback((id) => setSelection(id ? selectionKey('building', id) : null), []);
  const setSelectedSpaceId = useCallback((id) => setSelection(id ? selectionKey('space', id) : null), []);
  const setSelectedAreaId = useCallback((id) => setSelection(id ? selectionKey('area', id) : null), []);
  const setSelectedAisleId = useCallback((id) => setSelection(id ? selectionKey('aisle', id) : null), []);
  const [parcelPicking, setParcelPicking] = useState(false);
  const [parcel, setParcel] = useState(null); // { loading } | { parcel } | { reason } | { error }
  const [show3d, setShow3d] = useState(false);
  // The open step; null until the plan loads, then the first useful one.
  const [openStep, setOpenStep] = useState(null);
  const toggleStep = (id) => setOpenStep((cur) => (cur === id ? null : id));
  const [showHelp, setShowHelp] = useState(false);
  const [terrain, setTerrain] = useState(null); // { key, samples } | { key, loading } | { key, error }
  const [saveState, setSaveState] = useState('saved'); // saved | pending | saving | error | conflict
  const [saveError, setSaveError] = useState(null);

  const draftRef = useRef(null);
  const dirtyRef = useRef(new Set());
  const updatedAtRef = useRef(null);
  const savingRef = useRef(false);
  const timerRef = useRef(null);
  const conflictRef = useRef(false); // after a 409, nothing more is sent
  const hadBoundaryRef = useRef(null); // whether the plan had a boundary last time we looked

  useEffect(() => {
    // Another site: start its steps afresh.
    setDraft(null);
    draftRef.current = null;
    hadBoundaryRef.current = null;
    setOpenStep(null);
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
  useEffect(() => { setSelection(null); }, [activeId]);

  // A step that went away with a type change gives way to its counterpart
  // (a garage's Decks & ramps for Buildings, and back).
  useEffect(() => {
    if (!activeType) return;
    const ids = modelSteps(activeType).map((st) => st.id);
    setOpenStep((cur) => {
      if (!cur || ids.includes(cur)) return cur;
      if (cur === 'buildings' || cur === 'garage' || cur === 'trucks') return ids.find((id) => id === 'buildings' || id === 'garage') || 'parking';
      return null;
    });
  }, [activeType]);

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

  // Takes over the generated buildings. pick: the one to select; moveTo:
  // where it was dragged to ([lng, lat] center).
  const startManual = (pick = 0, moveTo = null) => {
    const rects = activeResult?.buildingRects || [];
    const buildings = rects.map((r, i) => ({ id: newId(), ...r, ...(i === pick && moveTo ? { center: moveTo } : {}) }));
    if (!buildings.length && boundary) {
      const s = effectiveSettings(active);
      buildings.push({ id: newId(), center: ringCentroid(boundary), length: 200, depth: s.buildingDepth || 65, angle: activeResult?.metrics?.orientationDeg || 0 });
    }
    setPlaced(buildings);
    setSelectedBuildingId((buildings[pick] || buildings[0])?.id || null);
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
  // An option from the generator, possibly of another asset type (which
  // keeps the settings it shares with this scheme's).
  function applyOption(combo, assetType = active.assetType) {
    if (draftRef.current.schemes.length >= 12) {
      window.alert('A site can hold 12 schemes - delete one first.');
      return;
    }
    const base = asType(JSON.parse(JSON.stringify(active)), assetType);
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

  // ---- Terrain: sampled once per boundary, analysed against the active
  // scheme's buildings ----
  const boundaryKey = boundary ? JSON.stringify(boundary.coordinates[0]) : null;
  async function checkTerrain() {
    if (!boundary) return;
    const key = boundaryKey;
    setTerrain({ key, loading: true });
    try {
      const samples = await fetchElevations(samplePoints(boundary, 30));
      setTerrain(samples.length ? { key, samples } : { key, error: 'No elevations came back - the USGS service may be busy; try again.' });
    } catch (err) {
      setTerrain({ key, error: err.message });
    }
  }
  const terrainStats = useMemo(() => {
    if (!terrain?.samples || terrain.key !== boundaryKey) return null;
    // Slope and relief need only the samples; pads need the buildings
    // (garage footprints included), when the scheme has them.
    const footprintsOf = (g) => [...(g?.buildings || []), ...(g?.garage ? g.garage.outline : [])];
    const buildings = [
      ...footprintsOf(activeResult?.geometry),
      ...(activeResult?.spaces || []).flatMap((sp) => footprintsOf(sp.result?.geometry)),
    ];
    return analyzeTerrain(boundary, terrain.samples, buildings);
  }, [terrain, boundaryKey, boundary, activeResult]);

  // ---- Parcels ----
  // Only the latest lookup's answer is shown; closing the card or picking
  // again makes an earlier, slower one stale.
  const parcelRequestRef = useRef(0);
  const closeParcel = () => {
    parcelRequestRef.current++;
    setParcel(null);
  };
  const onParcelPick = useCallback(async (lat, lng) => {
    const id = ++parcelRequestRef.current;
    setParcelPicking(false);
    setParcel({ loading: true });
    try {
      const found = await parcelAt(lat, lng);
      if (id === parcelRequestRef.current) setParcel(found);
    } catch (err) {
      if (id === parcelRequestRef.current) setParcel({ error: err.message });
    }
  }, []);

  const useParcelAsSite = () => {
    const boundary = parcel?.parcel?.boundary;
    if (!boundary) return;
    if (draftRef.current.boundary && !window.confirm('Replace the site boundary with this parcel?')) return;
    change('boundary', boundary);
    closeParcel();
  };

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
      boundary: draft.boundary,
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


  // Open the first useful step once the plan loads (Site until there's a
  // boundary, then Use), and move on to Use when a boundary first appears.
  const loaded = !!draft;
  useEffect(() => {
    if (!loaded) return;
    const has = !!boundary;
    if (hadBoundaryRef.current === null) setOpenStep(has ? 'use' : 'site');
    else if (has && hadBoundaryRef.current === false) setOpenStep('use');
    hadBoundaryRef.current = has;
  }, [loaded, boundary]);

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

  // What each step's one-line summary needs.
  // The steps for this type, in model-building order (see stepPlan).
  const steps = modelSteps(activeType);
  const stepIds = steps.map((st) => st.id);
  const useKeys = new Set(steps.find((st) => st.id === 'use').keys);
  const programChanged = Object.keys(active.overrides || {}).filter((k) => useKeys.has(k)).length;
  const failing = (activeResult?.checks || []).filter((c) => c.status === 'fail');
  // Each check says whether the Zoning or the Parking step owns it.
  const zoningChecks = (activeResult?.checks || []).filter((c) => c.category === 'zoning');
  const zoningFails = failing.filter((c) => c.category === 'zoning');
  const siteSettings = activeResult?.settings || effectiveSettings(active);
  const siteSetbackLabel = siteSettings.setbackMode === 1
    ? `${fmtInt(siteSettings.frontSetback)} / ${fmtInt(siteSettings.setback)} / ${fmtInt(siteSettings.rearSetback)} ft setbacks`
    : `${fmtInt(siteSettings.setback)} ft setback`;
  // One place for a step's share of the settings.
  const settingsFor = (id, keys, extra = {}) => (keys.length ? (
    <SchemeSettings
      key={`${active.id}-${active.assetType}-${id}`}
      type={activeType}
      overrides={active.overrides}
      onChange={(overrides) => updateScheme(active.id, { overrides })}
      idPrefix={`${active.id}-${id}`}
      keys={keys}
      noOrientation
      {...extra}
    />
  ) : null);

  const nextOf = (id) => {
    const i = stepIds.indexOf(id);
    return i >= 0 && i < stepIds.length - 1 ? () => setOpenStep(stepIds[i + 1]) : null;
  };
  const m = activeResult?.metrics;
  const unitLayout = m?.unitLayout;
  // Shaped buildings (L, U, courtyard, wrap) stay automatic.
  const shaped = (unitLayout?.shapes || []).some((x) => x !== 'bars' && x !== 'garden');
  // Truck and trailer checks belong to the truck court step, when there is one.
  const isTruckCheck = (c) => stepIds.includes('trucks') && /^(Truck|Trailer)/.test(c.label);
  const truckChecks = (activeResult?.checks || []).filter(isTruckCheck);
  const parkingChecks = (activeResult?.checks || []).filter((c) => c.category === 'parking' && !isTruckCheck(c));
  const checkStep = (c) => (c.category === 'zoning' ? 'zoning' : isTruckCheck(c) ? 'trucks' : 'parking');
  const parkingFailsHere = parkingChecks.filter((c) => c.status === 'fail');
  const truckFails = truckChecks.filter((c) => c.status === 'fail');
  const PARKING_PROGRAM = ['parkingRatio', 'garageStalls', 'sfPerStructuredStall'];

  function stepMeta(st) {
    const plural = (n, word) => `${fmtInt(n)} ${word}${n === 1 ? '' : 's'}`;
    switch (st.id) {
      case 'site':
        return {
          status: !draft.boundary ? 'todo' : (activeResult?.error || terrainStats?.steepPads) ? 'warn' : 'done',
          summary: !draft.boundary ? 'Find the site and draw or pick its boundary'
            : activeResult?.error && !m ? activeResult.error
              : `${fmtDec(m?.siteAcres || 0)} ac · ${siteSetbackLabel}${terrainStats ? ` · ${fmtDec(terrainStats.gradePct, 1)}% slope` : ''}`,
          noNext: !draft.boundary,
        };
      case 'use':
        return {
          status: draft.boundary ? 'done' : 'todo',
          summary: `${activeType.label}${programChanged ? ` · ${plural(programChanged, 'setting')} changed` : ' · standard defaults'}`,
        };
      case 'zoning':
        return {
          status: !zoningChecks.length ? 'todo' : zoningFails.length ? 'bad' : 'done',
          summary: !zoningChecks.length ? 'Height, FAR and coverage limits'
            : zoningFails.length ? `Failing: ${zoningFails.map((c) => c.label).join(', ')}`
              : `Zoning checks pass${zoningChecks.some((c) => c.status === 'none') ? ' (some limits not set)' : ''}`,
        };
      case 'spaces': {
        const spaces = active.spaces || [];
        return {
          status: draft.boundary ? 'done' : 'todo',
          summary: spaces.length
            ? `${plural(spaces.filter((sp) => sp.kind === 'no-build').length, 'no-build area')} · ${plural(spaces.filter((sp) => sp.kind === 'asset').length, 'other use')}`
            : 'Optional: easements, open space, a second use',
        };
      }
      case 'buildings':
        return {
          status: !m ? 'todo' : (activeResult.warnings?.outside?.length || activeResult.warnings?.overlaps?.length) ? 'bad' : 'done',
          summary: !m ? st.title
            : activeType.mode === 'lots' ? `${plural(m.buildingCount, 'home')} · ${m.floors || '-'} floors`
              : `${active.edits?.buildings?.length ? 'Placed by hand' : 'Automatic'} · ${plural(m.buildingCount, 'building')}${m.floors ? ` · ${m.floors} floors` : ''}${unitLayout ? ` · ${fmtPct(unitLayout.efficiency)} efficient` : ''}`,
        };
      case 'garage':
        return {
          status: !activeResult?.garage ? 'todo' : activeResult.garage.fits ? 'done' : 'bad',
          summary: activeResult?.garage ? `${plural(activeResult.garage.levels, 'level')} · ${fmtInt(activeResult.garage.perLevel)} stalls a level${activeResult.garage.fits ? '' : ' · ramp doesn\'t fit'}` : 'Levels, ramps and cores',
        };
      case 'trucks':
        return {
          status: !truckChecks.length ? 'todo' : truckFails.length ? 'bad' : 'done',
          summary: m ? `${plural(m.docks || 0, 'dock door')} · ${plural(m.trailerStalls || 0, 'trailer stall')}${truckFails.length ? ` · ${truckFails.map((c) => c.label).join(', ')}` : ''}` : 'Truck court, docks and trailer parking',
        };
      case 'parking':
        return {
          status: !activeResult?.totals ? 'todo' : parkingFailsHere.length ? 'bad' : 'done',
          summary: !activeResult?.totals ? 'Stalls, aisles and entries'
            : `${fmtInt(activeResult.totals.parkingProvided)} of ${fmtInt(activeResult.totals.parkingRequired)} stalls${parkingFailsHere.length ? ` · ${parkingFailsHere.map((c) => c.label).join(', ')}` : ''}`,
        };
      case 'proforma':
        return {
          status: activeResult?.proforma ? (activeResult.proforma.profit < 0 ? 'warn' : 'done') : 'todo',
          summary: activeResult?.proforma
            ? `${fmtMoney(activeResult.proforma.totalCost)} cost · ${activeResult.proforma.kind === 'sale' ? `${fmtPct(activeResult.proforma.margin)} margin` : `${fmtPct(activeResult.proforma.yieldOnCost, 2)} yield on cost`}`
            : 'Costs, rents and returns',
        };
      default:
        return { status: m ? 'done' : 'todo', summary: m ? 'Quantities, compare, generate and report' : 'Every measure for this scheme', noNext: true };
    }
  }

  function stepBody(st) {
    switch (st.id) {
      case 'site':
        return (
          <>
            {!draft.boundary && (
              <div className="siteplan-step-hint">
                Three ways to set the site:
                <ol>
                  <li>Search an address in the box over the map.</li>
                  <li>Turn on <b>Parcels</b> in the layer menu (top right), then <b>▦ Pick a parcel</b>.</li>
                  <li>Trace it with the polygon or rectangle tool on the map&apos;s left edge.</li>
                </ol>
              </div>
            )}
            {settingsFor(st.id, st.keys)}
            {byEdge && (activeResult?.edges || []).length > 0 && (
              <EdgePicker
                edges={activeResult.edges}
                settings={effectiveSettings(active)}
                onFront={(i) => pickEdge(i, false)}
                onSecond={(i) => setOverrideKey('frontEdge2', i || undefined)}
              />
            )}
            <TerrainSection hasBoundary={!!draft.boundary} terrain={terrain} terrainStats={terrainStats} boundaryKey={boundaryKey} onCheck={checkTerrain} />
            <p className="siteplan-muted siteplan-small">Flood zones, wetlands, contours, relief, soils and lot lines are in the map&apos;s layer menu (top right).</p>
            {draft.boundary && (
              <button
                className="siteplan-link-btn siteplan-danger-link"
                onClick={() => { if (window.confirm('Clear the site boundary so you can draw it again?')) change('boundary', null); }}
              >
                Clear site boundary
              </button>
            )}
          </>
        );
      case 'use':
        return (
          <>
            <label className="siteplan-type">
              Asset type
              <select value={active.assetType} onChange={(e) => changeType(e.target.value)}>
                {ASSET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <PresetsSection presets={presets} scheme={active} onApply={applyPreset} onSave={savePreset} onDelete={deletePreset} />
            <p className="siteplan-muted siteplan-small">
              Starting from standard defaults; change any number and ↺ puts it back. The next steps follow this type
              {stepIds.includes('trucks') ? ' (industrial adds a truck court step)' : activeType.mode === 'garage' ? ' (a garage has decks and ramps instead of buildings)' : ''}.
            </p>
            {settingsFor(st.id, st.keys)}
          </>
        );
      case 'zoning':
        return (
          <>
            <p className="siteplan-muted siteplan-small">Set the limits that apply (0 = no limit). The check below covers the whole plan, including parking and circulation.</p>
            {settingsFor(st.id, st.keys)}
            <ChecksPanel checks={zoningChecks} />
          </>
        );
      case 'spaces':
        return (
          <>
            <p className="siteplan-muted siteplan-small">Set aside ground before the buildings go in: buildings and parking are planned around what you mark here.</p>
            <SpacesSection
              scheme={active}
              results={activeResult}
              selectedId={selectedSpaceId}
              onSelect={setSelectedSpaceId}
              onDraw={(shape) => setDrawRequest({ target: 'space', shape, at: Date.now() })}
            />
          </>
        );
      case 'buildings':
        return (
          <>
            <OrientationField
              label="Building orientation"
              value={effectiveSettings(active).rotation}
              currentDeg={m?.orientationDeg}
              onChange={(v) => setOverrideKey('rotation', v)}
            />
            {settingsFor(st.id, st.keys)}
            {unitLayout && (
              <p className="siteplan-muted siteplan-small">
                Laid out unit by unit: {fmtInt(m.units)} units, {fmtInt(unitLayout.beds)} beds, {fmtInt(unitLayout.avgUnitSf)} sf average,
                {' '}{fmtPct(unitLayout.efficiency)} net to gross, {fmtInt(unitLayout.stairs)} stairs and {fmtInt(unitLayout.elevators)} elevators.
                {effectiveSettings(active).buildingShape >= 2 && !shaped ? ' The shape you picked didn\'t fit, so these are bars.' : ''}
              </p>
            )}
            <LayoutSection
              scheme={active}
              type={activeType}
              result={activeResult}
              selectedId={selectedBuildingId}
              onSelect={setSelectedBuildingId}
              onStart={() => startManual()}
              onReset={resetAuto}
              onAdd={addBuilding}
              shaped={shaped}
            />
          </>
        );
      case 'garage':
        return (
          <>
            {settingsFor(st.id, st.keys)}
            <GarageSection result={activeResult} />
          </>
        );
      case 'trucks':
        return (
          <>
            {settingsFor(st.id, st.keys)}
            <ChecksPanel checks={truckChecks} />
          </>
        );
      case 'parking': {
        const program = st.keys.filter((k) => PARKING_PROGRAM.includes(k));
        const rest = st.keys.filter((k) => !PARKING_PROGRAM.includes(k));
        return (
          <>
            {settingsFor(`${st.id}-need`, program)}
            <ParkingSection
              scheme={active}
              type={activeType}
              result={activeResult}
              selectedAreaId={selectedAreaId}
              onSelectArea={setSelectedAreaId}
              onDraw={(shape) => setDrawRequest({ target: 'parking', shape, at: Date.now() })}
              onSetOverride={setOverrideKey}
              onAddEntry={addEntry}
              onRemoveEntry={removeEntry}
              selectedAisleId={selectedAisleId}
              onSelectAisle={setSelectedAisleId}
              onDrawAisle={() => setDrawRequest({ target: 'aisle', shape: 'Line', at: Date.now() })}
              onKeepRouted={keepRouted}
            />
            {activeType.mode === 'lots' && m && (
              <p className="siteplan-muted siteplan-small">
                Homes park in their own garages: {fmtInt(m.parkingGarage)} garage stalls for {fmtInt(m.parkingRequired)} required.
              </p>
            )}
            {m?.parkingGarage > 0 && activeType.mode === 'bars' && (
              <p className="siteplan-muted siteplan-small">{fmtInt(m.parkingGarage)} stalls are in the garage the building wraps.</p>
            )}
            {activeType.mode !== 'lots' && <ChecksPanel checks={parkingChecks} />}
            {rest.length > 0 && (
              <details className="siteplan-details">
                <summary>All {activeType.mode === 'garage' ? 'stall' : 'parking'} settings</summary>
                {settingsFor(st.id, rest)}
              </details>
            )}
          </>
        );
      }
      case 'proforma':
        return (
          <>
            <ProformaPanel result={activeResult} />
            <p className="siteplan-muted siteplan-small">Rough starting points to override - not market data.</p>
            {settingsFor(st.id, st.keys)}
          </>
        );
      default:
        return (
          <>
            <QuantitiesPanel type={activeType} result={activeResult} />
            <div className="siteplan-results-actions">
              <button type="button" className="siteplan-small-btn" onClick={() => setCompare(true)}>Compare schemes</button>
              <button type="button" className="siteplan-small-btn" onClick={() => setGenerating(true)} disabled={!draft.boundary}>✨ Generate options</button>
              <button type="button" className="siteplan-small-btn" onClick={() => setShow3d(true)} disabled={!activeResult?.geometry}>◆ 3D</button>
              <button type="button" className="siteplan-small-btn" onClick={downloadCsv} disabled={!draft.boundary}>⬇ CSV</button>
              <button type="button" className="siteplan-small-btn" onClick={printReport} disabled={!draft.boundary}>🖨 Report</button>
            </div>
            <p className="siteplan-muted siteplan-small">
              A rules-based test fit: buildings and parking bays lined up with the site&apos;s main edges, checked against your limits.
            </p>
          </>
        );
    }
  }

  // ---- The selection bar ----
  const generatedBuildings = activeType.mode !== 'lots' && !placed ? (activeResult?.geometry?.buildings || []) : [];
  const bays = activeResult?.geometry?.parking || [];
  const canTakeOver = supportsManualLayout(activeType) && !shaped;
  const selectionItems = [
    ...(placed || []).map((b, i) => ({ key: selectionKey('building', b.id), label: `Building ${i + 1}`, group: 'Buildings' })),
    ...generatedBuildings.map((_, i) => ({ key: selectionKey('auto', i), label: `Building ${i + 1}`, group: 'Buildings' })),
    ...(active.spaces || []).map((sp) => ({ key: selectionKey('space', sp.id), label: sp.name, group: 'Spaces' })),
    ...(hasSurfaceParking(activeType) ? (active.parkingAreas || []) : []).map((a, i) => ({ key: selectionKey('area', a.id), label: `Parking area ${i + 1}`, group: 'Parking areas' })),
    ...(hasSurfaceParking(activeType) ? (active.driveAisles || []) : []).map((a, i) => ({ key: selectionKey('aisle', a.id), label: `Aisle ${i + 1}`, group: 'Drive aisles' })),
    ...bays.map((bay, i) => ({ key: selectionKey('bay', i), label: `Bay ${i + 1} · ${fmtInt(bay.stallCount)} stalls`, group: 'Parking bays' })),
  ];
  // Setbacks by edge: the front edge (and a corner lot's second front).
  const byEdge = effectiveSettings(active).setbackMode === 1;
  const pickEdge = (index, second) => {
    const cur = effectiveSettings(currentScheme());
    if (second) {
      setOverrideKey('frontEdge2', cur.frontEdge2 === index || cur.frontEdge === index ? undefined : index);
      return;
    }
    const patch = withOverride(activeType, currentScheme().overrides || {}, 'frontEdge', index);
    updateScheme(active.id, { overrides: cur.frontEdge2 === index ? withOverride(activeType, patch, 'frontEdge2', undefined) : patch });
  };
  const onSelectGenerated = (kind, i) => setSelection(selectionKey(kind, i));
  // Dragging a generated building takes the layout over by hand, with
  // that building where it was dropped.
  const onGeneratedDrag = (i, center) => startManual(i, center);
  // A selection that's gone (a bay re-laid out, a building removed) shows as none.
  const selectedKey = selectionItems.some((x) => x.key === selection) ? selection : null;

  function selectionBody() {
    const s = parseSelection(selectedKey);
    if (!s) return null;
    const settings = effectiveSettings(active);
    if (s.kind === 'building') {
      const i = placed.findIndex((b) => b.id === s.id);
      const b = placed[i];
      const out = (activeResult?.warnings?.outside || []).includes(b.id);
      const over = (activeResult?.warnings?.overlaps || []).some((pair) => pair.includes(b.id));
      return (
        <BuildingEditor
          building={b}
          label={buildingLabel(i, b)}
          type={activeType}
          defaultFloors={settings.floors}
          onUpdate={updateBuilding}
          onDuplicate={duplicateBuilding}
          onRemove={removeBuilding}
          problem={out ? 'Over the setback line or on a space' : over ? 'Overlaps another building' : null}
        />
      );
    }
    if (s.kind === 'auto') {
      const i = Number(s.id);
      return <GeneratedBuilding label={buildingLabel(i)} rect={activeResult?.buildingRects?.[i]} canEdit={canTakeOver} onEdit={() => startManual(i)} />;
    }
    if (s.kind === 'bay') {
      const i = Number(s.id);
      return <BayDetails bay={bays[i]} index={i} settings={settings} currentDeg={m?.parkingOrientationDeg} onSetOverride={setOverrideKey} />;
    }
    if (s.kind === 'space') {
      const sp = active.spaces.find((x) => x.id === s.id);
      return <SpaceEditor space={sp} result={(activeResult?.spaces || []).find((r) => r.id === sp.id)?.result} onUpdate={updateSpace} onRemove={removeSpace} />;
    }
    if (s.kind === 'area') {
      const i = active.parkingAreas.findIndex((a) => a.id === s.id);
      return (
        <AreaEditor
          area={active.parkingAreas[i]}
          label={`Parking area ${i + 1}`}
          info={(activeResult?.parking?.areas || []).find((a) => a.id === s.id)}
          onUpdate={updateArea}
          onRemove={removeArea}
        />
      );
    }
    if (s.kind === 'aisle') {
      const i = active.driveAisles.findIndex((a) => a.id === s.id);
      return (
        <AisleEditor
          aisle={active.driveAisles[i]}
          label={`Aisle ${i + 1}`}
          settings={settings}
          issues={(activeResult?.parking?.aisleIssues || []).filter((x) => x.aisleId === s.id)}
          truckMode={activeType.mode === 'industrial'}
          onUpdate={updateAisle}
          onRemove={removeAisle}
        />
      );
    }
    return null;
  }

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
        <button className="siteplan-toggle" onClick={() => setShowHelp(true)} title="How the Site Planner works">?</button>
        <button className="siteplan-toggle" onClick={() => setShow3d(true)} disabled={!draft.boundary || !activeResult?.geometry} title="See the scheme in 3D">◆ 3D</button>
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
            <button
              type="button"
              className={`siteplan-parcel-btn ${parcelPicking ? 'on' : ''}`}
              onClick={() => { closeParcel(); setParcelPicking((p) => !p); }}
              title="Click a parcel on the map to see its details and use it as the site"
            >
              {parcelPicking ? 'Click a parcel…' : '▦ Pick a parcel'}
            </button>
            {parcel && (
              <div className="siteplan-parcel-card">
                <button type="button" className="siteplan-parcel-close" onClick={closeParcel} aria-label="Close">×</button>
                {parcel.loading && <p className="siteplan-muted">Looking up the parcel…</p>}
                {parcel.error && <p className="siteplan-neg">{parcel.error}</p>}
                {parcel.reason && <p className="siteplan-muted">{parcel.reason}</p>}
                {parcel.parcel && (
                  <>
                    <div className="siteplan-parcel-title">{parcel.parcel.address || 'Parcel'}{parcel.parcel.city ? `, ${parcel.parcel.city}` : ''}</div>
                    <dl className="siteplan-metrics">
                      <dt>Parcel ID</dt><dd>{parcel.parcel.id || '-'}</dd>
                      <dt>Area</dt><dd>{parcel.parcel.acres ? `${fmtDec(parcel.parcel.acres)} ac` : '-'}</dd>
                      <dt>County</dt><dd>{parcel.parcel.county || '-'}</dd>
                      <dt>Ownership</dt><dd>{parcel.parcel.ownership || '-'}</dd>
                      {parcel.parcel.asOf && <><dt>Data as of</dt><dd>{parcel.parcel.asOf}</dd></>}
                    </dl>
                    {parcel.parcel.countyUrl && /^https?:\/\//.test(parcel.parcel.countyUrl) && (
                      <a className="siteplan-small" href={parcel.parcel.countyUrl} target="_blank" rel="noopener noreferrer">County assessor records</a>
                    )}
                    <button type="button" className="btn-primary siteplan-parcel-use" onClick={useParcelAsSite} disabled={!parcel.parcel.boundary}>
                      Use as site boundary
                    </button>
                    <p className="siteplan-muted siteplan-small">Utah statewide parcels (UGRC) - general purpose, not the legal record.</p>
                  </>
                )}
              </div>
            )}
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
              parcelPicking={parcelPicking}
              onParcelPick={onParcelPick}
              parcelHighlight={parcel?.parcel?.boundary || null}
              terrainPoints={terrain?.key === boundaryKey ? terrain?.samples : null}
              selectedGenerated={sel && (sel.kind === 'auto' || sel.kind === 'bay') ? selection : null}
              onSelectGenerated={onSelectGenerated}
              onGeneratedDrag={canTakeOver ? onGeneratedDrag : null}
              edges={byEdge ? (activeResult?.edges || NONE) : NONE}
              onPickEdge={pickEdge}
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
              {(activeResult?.geometry?.unitPlans || NONE).length > 0 && <>
                {activeResult.geometry.unitTypes.map((name, i) => <span key={name}><i style={{ background: UNIT_COLORS[i % UNIT_COLORS.length] }} />{name}</span>)}
                <span><i className="lg-core" />Stair / elevator</span>
              </>}
              {(activeResult?.geometry?.courtyards || NONE).length > 0 && <span><i className="lg-courtyard" />Courtyard</span>}
              {(activeResult?.geometry?.wrapGarages || NONE).length > 0 && <span><i className="lg-wrapgarage" />Garage</span>}
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

            {/* Pinned: the scoreboard and what's selected, whichever step is open. */}
            <div className="siteplan-pinned">
              <Scoreboard
                type={activeType}
                result={activeResult}
                onOpenChecks={() => setOpenStep(failing.length ? checkStep(failing[0]) : 'zoning')}
              />

              <SelectionBar items={selectionItems} selected={selectedKey} onSelect={setSelection} onClose={() => setSelection(null)}>
                {selectionBody()}
              </SelectionBar>
            </div>

            {steps.map((st) => {
              const meta = stepMeta(st);
              return (
                <Step
                  key={st.id}
                  index={st.index}
                  id={st.id}
                  title={st.title}
                  status={meta.status}
                  summary={meta.summary}
                  open={openStep === st.id}
                  onToggle={toggleStep}
                  onNext={meta.noNext ? null : nextOf(st.id)}
                >
                  {stepBody(st)}
                </Step>
              );
            })}
          </aside>
        </div>
      )}

      {show3d && activeResult?.geometry && <Massing3D boundary={draft.boundary} result={activeResult} onClose={() => setShow3d(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {generating && (
        <GeneratorModal boundary={draft.boundary} scheme={active} onClose={() => setGenerating(false)} onApply={applyOption} />
      )}
    </div>
  );
}

export default SitePlanEditor;
