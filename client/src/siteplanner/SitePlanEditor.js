import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SitePlanMap from './SitePlanMap';
import GeneratorModal from './GeneratorModal';
import { loadProjects, searchAddress, sitePlansApi } from './api';
import { ASSET_TYPES, effectiveSettings, getAssetType } from './assetTypes';
import { makeProjection } from './geometry';
import { solveScheme, supportsManualLayout } from './solver';
import { NumberInput, SchemeSettings, fmtDec } from './settingsFields';
import { CompareView, ResultsCard, planMetrics, yieldOf } from './results';
import './SitePlanner.css';

// Dev Tools -> Site Planner -> a site: the map on the left, the schemes
// and their settings and numbers on the right. A scheme can be laid out
// automatically or placed by hand (Edit layout), carry spaces (no-build
// areas, or areas with their own asset type), be saved as a preset, and
// be explored with the option generator. Every change saves itself a
// moment later; a save based on an older copy than the stored one is
// refused (409) rather than undoing someone else's work.

const SAVE_DELAY_MS = 800;

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
              spaces={active.spaces || []}
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
              {(active.spaces || []).some((sp) => sp.kind === 'no-build') && <span><i className="lg-nobuild" />No-build</span>}
              {(active.spaces || []).some((sp) => sp.kind === 'asset') && <span><i className="lg-space" />Space</span>}
              {activeType.mode === 'lots' && <><span><i className="lg-lot" />Lots</span><span><i className="lg-street" />Streets</span></>}
              {activeType.mode === 'industrial' && <span><i className="lg-truck" />Truck court</span>}
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
              onDraw={(shape) => setDrawRequest({ shape, at: Date.now() })}
              onUpdate={updateSpace}
              onRemove={removeSpace}
            />

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
