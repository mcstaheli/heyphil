import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SitePlanMap from './SitePlanMap';
import { loadProjects, searchAddress, sitePlansApi } from './api';
import { ASSET_TYPES, DEFAULT_MIX, defaultsFor, fieldsFor, getAssetType } from './assetTypes';
import { LIMIT_LABELS, solveScheme } from './solver';
import './SitePlanner.css';

// Dev Tools -> Site Planner -> a site: the map on the left, the schemes
// and their settings and numbers on the right. Every change saves itself
// a moment later; a save based on an older copy than the stored one is
// refused (409) rather than undoing someone else's work.

const SAVE_DELAY_MS = 800;

const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-US');
const fmtDec = (n, d = 2) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => `${fmtDec((n || 0) * 100, 1)}%`;

function yieldOf(type, m) {
  if (!m) return { value: '-', label: '' };
  switch (type.yieldKind) {
    case 'units': return { value: fmtInt(m.units), label: type.mode === 'lots' ? 'homes' : 'units' };
    case 'keys': return { value: fmtInt(m.keys), label: 'keys' };
    case 'stalls': return { value: fmtInt(m.parkingProvided), label: 'stalls' };
    default: return { value: fmtInt(m.nsf), label: type.mode === 'industrial' ? 'sf building' : 'sf leasable' };
  }
}

// The rows shown for a scheme's results, also used side by side in Compare.
function metricRows(type, m) {
  if (!m) return [];
  const rows = [
    ['Site area', `${fmtDec(m.siteAcres)} ac (${fmtInt(m.siteSf)} sf)`],
    ['Buildable after setback', `${fmtInt(m.buildableSf)} sf`],
  ];
  if (type.mode !== 'parking') {
    rows.push(
      [type.mode === 'lots' ? 'Homes' : 'Buildings', fmtInt(m.buildingCount)],
      ['Footprint', `${fmtInt(m.footprintSf)} sf`],
      ['Floors / height', m.floors ? `${m.floors} / ${fmtDec(m.heightFt, 0)} ft` : '-'],
      ['Gross area', `${fmtInt(m.gsf)} sf`],
    );
    if (type.yieldKind === 'units' && type.mode !== 'lots') rows.push(['Net rentable', `${fmtInt(m.nsf)} sf`]);
    if (type.id === 'retail') rows.push(['Leasable (GLA)', `${fmtInt(m.nsf)} sf`]);
    if (type.yieldKind === 'units') rows.push(['Units', fmtInt(m.units)]);
    if (type.yieldKind === 'keys') rows.push(['Keys', fmtInt(m.keys)]);
    if (type.yieldKind === 'units' || type.yieldKind === 'keys') rows.push(['Density', `${fmtDec(m.density, 1)} per acre`]);
    rows.push(['FAR', fmtDec(m.far)], ['Lot coverage', fmtPct(m.coverage)]);
    if (type.mode === 'industrial') rows.push(['Dock doors', fmtInt(m.docks)]);
    rows.push(['Parking required', fmtInt(m.parkingRequired)]);
  }
  const parts = [];
  if (m.parkingSurface) parts.push(`${fmtInt(m.parkingSurface)} surface`);
  if (m.parkingStructured) parts.push(`${fmtInt(m.parkingStructured)} structured`);
  if (m.parkingGarage) parts.push(`${fmtInt(m.parkingGarage)} garage`);
  rows.push(['Parking provided', `${fmtInt(m.parkingProvided)}${parts.length > 1 ? ` (${parts.join(' + ')})` : ''}`]);
  if (type.mode !== 'parking') {
    const ratioUnit = type.yieldKind === 'keys' ? 'key' : type.yieldKind === 'units' ? (type.mode === 'lots' ? 'home' : 'unit') : null;
    const count = m.units || m.keys;
    if (ratioUnit && count) rows.push(['Parking ratio', `${fmtDec(m.parkingProvided / count)} per ${ratioUnit}`]);
    if (!ratioUnit && m.gsf) rows.push(['Parking ratio', `${fmtDec((m.parkingProvided / m.gsf) * 1000)} per 1,000 sf`]);
  }
  rows.push(['Orientation', `${fmtDec(m.orientationDeg, 1)}°`]);
  return rows;
}

function newSchemeId() {
  return Math.random().toString(36).slice(2, 10);
}

function nextSchemeName(schemes) {
  for (let i = 0; i < 26; i++) {
    const name = `Scheme ${String.fromCharCode(65 + i)}`;
    if (!schemes.some((s) => s.name === name)) return name;
  }
  return `Scheme ${schemes.length + 1}`;
}

// A number input that lets you type freely ("1." on the way to "1.5")
// and reports only valid numbers.
function NumberInput({ value, onChange, step, min = 0, max = 1000000, ...rest }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value && t.trim() !== '' ? t : String(value)));
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step || 1}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => setText(String(value))}
      {...rest}
    />
  );
}

function SettingField({ field, value, overridden, onChange, onReset }) {
  return (
    <label className={`siteplan-field ${overridden ? 'siteplan-field-changed' : ''}`}>
      <span className="siteplan-field-label">
        {field.label}
        {field.unit && <span className="siteplan-field-unit"> {field.unit}</span>}
      </span>
      <span className="siteplan-field-input">
        <NumberInput value={value} step={field.step} max={field.max} onChange={onChange} title={field.hint || ''} />
        {overridden
          ? <button type="button" className="siteplan-reset" onClick={onReset} title={`Back to the default (${field.default})`}>↺</button>
          : <span className="siteplan-reset-spacer" />}
      </span>
    </label>
  );
}

function MixEditor({ mix, overridden, onChange, onReset }) {
  const update = (i, key, value) => onChange(mix.map((u, j) => (j === i ? { ...u, [key]: value } : u)));
  const total = mix.reduce((s, u) => s + (u.pct || 0), 0);
  return (
    <div className={`siteplan-mix ${overridden ? 'siteplan-field-changed' : ''}`}>
      <div className="siteplan-group-title">
        Unit mix
        {overridden && <button type="button" className="siteplan-reset" onClick={onReset} title="Back to the default mix">↺</button>}
      </div>
      <div className="siteplan-mix-row siteplan-mix-head"><span>Type</span><span>Size sf</span><span>Mix %</span><span /></div>
      {mix.map((u, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div className="siteplan-mix-row" key={i}>
          <input value={u.name} maxLength={40} onChange={(e) => update(i, 'name', e.target.value)} />
          <NumberInput value={u.size} min={1} max={100000} onChange={(n) => update(i, 'size', n)} />
          <NumberInput value={u.pct} max={100} onChange={(n) => update(i, 'pct', n)} />
          <button
            type="button"
            className="siteplan-mix-remove"
            onClick={() => onChange(mix.filter((_, j) => j !== i))}
            disabled={mix.length <= 1}
            title="Remove this unit type"
          >
            ×
          </button>
        </div>
      ))}
      <div className="siteplan-mix-foot">
        <button
          type="button"
          className="siteplan-link-btn"
          onClick={() => onChange([...mix, { name: 'New', size: 900, pct: 0 }])}
          disabled={mix.length >= 12}
        >
          + Unit type
        </button>
        <span className={Math.abs(total - 100) > 0.01 ? 'siteplan-warn' : 'siteplan-muted'}>
          {fmtDec(total, 0)}%{Math.abs(total - 100) > 0.01 ? ' (scaled to 100%)' : ''}
        </span>
      </div>
    </div>
  );
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

function SitePlanEditor() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(null); // { name, projectId, boundary, mapView, schemes }
  const [canDelete, setCanDelete] = useState(false);
  const [projects, setProjects] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [compare, setCompare] = useState(false);
  const [flyTo, setFlyTo] = useState(null);
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
    if (body.name !== undefined && !body.name.trim()) delete body.name;
    if (body.schemes) {
      body.schemes = body.schemes.map((s) => ({
        ...s,
        name: s.name.trim() || 'Scheme',
        overrides: s.overrides.mix
          ? { ...s.overrides, mix: s.overrides.mix.map((u) => ({ ...u, name: u.name.trim() || 'Unit' })) }
          : s.overrides,
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

  const buildingLabel = useCallback((i) => {
    if (!activeResult?.metrics) return '';
    const m = activeResult.metrics;
    return `Building ${i + 1}${m.floors ? ` · ${m.floors} floor${m.floors === 1 ? '' : 's'}` : ''}`;
  }, [activeResult]);

  const updateScheme = (id, patch) => {
    change('schemes', draftRef.current.schemes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const setOverride = (key, value) => {
    const defaults = defaultsFor(activeType);
    const overrides = { ...active.overrides };
    if (value === undefined || JSON.stringify(value) === JSON.stringify(defaults[key])) delete overrides[key];
    else overrides[key] = value;
    updateScheme(active.id, { overrides });
  };

  const addScheme = () => {
    if (draftRef.current.schemes.length >= 12) return;
    const copy = { ...active, id: newSchemeId(), name: nextSchemeName(draftRef.current.schemes), overrides: { ...active.overrides } };
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
    if (Object.keys(active.overrides || {}).length > 0
      && !window.confirm('Switching the asset type starts its settings from that type\'s defaults. Continue?')) return;
    updateScheme(active.id, { assetType, overrides: {} });
  };

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

  const settings = { ...defaultsFor(activeType), ...active.overrides };
  const fields = fieldsFor(activeType);
  const groups = [...new Set(fields.map((f) => f.group))];
  const rotationAuto = settings.rotation === 'auto';

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
              flyTo={flyTo}
              onBoundaryChange={(geometry) => change('boundary', geometry)}
              buildingLabel={buildingLabel}
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
              {activeType.mode === 'lots' && <><span><i className="lg-lot" />Lots</span><span><i className="lg-street" />Streets</span></>}
              {activeType.mode === 'industrial' && <span><i className="lg-truck" />Truck court</span>}
            </div>
          </div>

          <aside className="siteplan-panel">
            <div className="siteplan-tabs">
              {draft.schemes.map((s) => {
                const y = yieldOf(getAssetType(s.assetType), results[s.id]?.metrics);
                return (
                  <button key={s.id} className={`siteplan-tab ${s.id === active.id ? 'active' : ''}`} onClick={() => setActiveId(s.id)}>
                    <span className="siteplan-tab-name">{s.name}</span>
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

            <div className="siteplan-settings">
              <p className="siteplan-muted siteplan-small">
                Starting from standard {activeType.label.toLowerCase()} defaults. Change any number; ↺ puts it back.
              </p>
              {activeType.hasMix && (
                <MixEditor
                  mix={settings.mix || DEFAULT_MIX}
                  overridden={'mix' in active.overrides}
                  onChange={(mix) => setOverride('mix', mix)}
                  onReset={() => setOverride('mix', undefined)}
                />
              )}
              {groups.map((g) => (
                <div key={g} className="siteplan-group">
                  <div className="siteplan-group-title">{g}</div>
                  {fields.filter((f) => f.group === g).map((f) => (
                    <SettingField
                      key={`${active.id}-${f.key}`}
                      field={f}
                      value={settings[f.key]}
                      overridden={f.key in active.overrides}
                      onChange={(n) => setOverride(f.key, n)}
                      onReset={() => setOverride(f.key, undefined)}
                    />
                  ))}
                  {g === 'Site' && (
                    <label className={`siteplan-field ${rotationAuto ? '' : 'siteplan-field-changed'}`}>
                      <span className="siteplan-field-label">Orientation</span>
                      <span className="siteplan-field-input">
                        <select
                          value={rotationAuto ? 'auto' : 'fixed'}
                          onChange={(e) => setOverride('rotation', e.target.value === 'auto'
                            ? undefined
                            : Math.round(activeResult?.metrics?.orientationDeg || 0))}
                        >
                          <option value="auto">Best fit</option>
                          <option value="fixed">Fixed angle</option>
                        </select>
                        <span className="siteplan-reset-spacer" />
                      </span>
                    </label>
                  )}
                  {g === 'Site' && !rotationAuto && (
                    <label className="siteplan-field siteplan-field-changed">
                      <span className="siteplan-field-label">Angle<span className="siteplan-field-unit"> ° from east</span></span>
                      <span className="siteplan-field-input">
                        <NumberInput
                          value={settings.rotation}
                          max={360}
                          onChange={(n) => setOverride('rotation', n)}
                        />
                        <span className="siteplan-reset-spacer" />
                      </span>
                    </label>
                  )}
                </div>
              ))}
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
                Drive connections and grading aren&apos;t modelled.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function ResultsCard({ type, result }) {
  if (!result) return null;
  if (result.error && !result.metrics) return <div className="siteplan-results siteplan-muted">{result.error}</div>;
  const m = result.metrics;
  const y = yieldOf(type, m);
  return (
    <div className="siteplan-results">
      {result.error && <p className="siteplan-warn">{result.error}</p>}
      <div className="siteplan-yield">
        <span className="siteplan-yield-value">{y.value}</span>
        <span className="siteplan-yield-label">{y.label}</span>
      </div>
      <div className="siteplan-limits">
        Limited by {result.limits.map((l) => <span key={l} className={`siteplan-limit siteplan-limit-${l}`}>{LIMIT_LABELS[l]}</span>)}
      </div>
      {m.unitsByType && m.unitsByType.length > 0 && (
        <div className="siteplan-mix-result">
          {m.unitsByType.map((u) => <span key={u.name}><b>{fmtInt(u.count)}</b> {u.name}</span>)}
        </div>
      )}
      <dl className="siteplan-metrics">
        {metricRows(type, m).map(([k, v]) => (
          <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
        ))}
      </dl>
    </div>
  );
}

function CompareView({ schemes, results, onOpen }) {
  // Union of every scheme's rows, in first-seen order, so mixed asset
  // types line up where they share a measure.
  const columns = schemes.map((s) => {
    const type = getAssetType(s.assetType);
    const r = results[s.id];
    return { scheme: s, type, result: r, rows: Object.fromEntries(metricRows(type, r?.metrics)) };
  });
  const keys = [];
  columns.forEach((c) => Object.keys(c.rows).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
  return (
    <div className="siteplan-compare">
      <table>
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c.scheme.id}>
                <button className="siteplan-link-btn" onClick={() => onOpen(c.scheme.id)}>{c.scheme.name}</button>
                <div className="siteplan-muted siteplan-small">{c.type.label}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="siteplan-compare-yield">
            <td>Yield</td>
            {columns.map((c) => {
              const y = yieldOf(c.type, c.result?.metrics);
              return <td key={c.scheme.id}><b>{y.value}</b> {y.label}</td>;
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

export default SitePlanEditor;
