import React from 'react';
import { ASSET_TYPES, COMMON_FIELDS, getAssetType } from './assetTypes';
import { aisleWidthOf } from './solver';
import { NumberInput, OrientationField, SchemeSettings, fmtDec, fmtInt } from './settingsFields';
import { yieldOf } from './results';

// The panel's pinned top: what's selected on the map (or picked from the
// list), what it is, and its controls - whichever step is open. A
// selection is "kind:id": building (placed by hand), auto (a generated
// building, by index), bay (a generated parking bay, by index), space,
// area (a parking area) or aisle (a drawn drive aisle).

export const STALL_ANGLES = COMMON_FIELDS.find((f) => f.key === 'stallAngle').options;

export const selectionKey = (kind, id) => `${kind}:${id}`;
export function parseSelection(key) {
  if (!key) return null;
  const at = key.indexOf(':');
  return { kind: key.slice(0, at), id: key.slice(at + 1) };
}

export function SelectionBar({ items, selected, onSelect, onClose, children }) {
  const groups = [...new Set(items.map((x) => x.group))];
  return (
    <div className={`siteplan-selection ${selected ? 'active' : ''}`}>
      <div className="siteplan-selection-head">
        <select
          value={selected || ''}
          onChange={(e) => onSelect(e.target.value || null)}
          aria-label="Selected item"
          disabled={!items.length}
        >
          <option value="">{items.length ? 'Nothing selected - pick one or click the map' : 'Nothing to select yet'}</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {items.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </optgroup>
          ))}
        </select>
        {selected && <button type="button" className="siteplan-selection-close" onClick={onClose} aria-label="Clear the selection">×</button>}
      </div>
      {selected && children && <div className="siteplan-selection-body">{children}</div>}
    </div>
  );
}

const Field = ({ label, unit, children }) => (
  <label className="siteplan-field">
    <span className="siteplan-field-label">{label}{unit && <span className="siteplan-field-unit"> {unit}</span>}</span>
    <span className="siteplan-field-input">{children}<span className="siteplan-reset-spacer" /></span>
  </label>
);

// A building placed by hand.
export function BuildingEditor({ building: b, label, type, defaultFloors, onUpdate, onDuplicate, onRemove, problem }) {
  return (
    <>
      <div className="siteplan-selection-title">{label}</div>
      {problem && <p className="siteplan-neg siteplan-small">⚠ {problem}</p>}
      <div className="siteplan-selection-grid">
        <Field label="Length" unit="ft"><NumberInput value={b.length} min={1} max={5000} onChange={(n) => onUpdate(b.id, { length: n })} /></Field>
        <Field label="Depth" unit="ft"><NumberInput value={b.depth} min={1} max={5000} onChange={(n) => onUpdate(b.id, { depth: n })} /></Field>
        <Field label="Angle" unit="°"><NumberInput value={b.angle} min={-360} max={360} step={0.5} onChange={(n) => onUpdate(b.id, { angle: n })} /></Field>
        {type.mode !== 'industrial' && (
          <Field label="Floors" unit={`(blank = ${defaultFloors})`}>
            <input
              type="number"
              min={1}
              max={100}
              value={b.floors || ''}
              placeholder={String(defaultFloors)}
              onChange={(e) => {
                const n = Number(e.target.value);
                onUpdate(b.id, { floors: e.target.value === '' ? undefined : (Number.isInteger(n) && n >= 1 && n <= 100 ? n : b.floors) });
              }}
            />
          </Field>
        )}
      </div>
      <p className="siteplan-muted siteplan-small">On the map: drag it (or ✥) to move, ↔ ↕ to stretch, ⟳ to rotate.</p>
      <div className="siteplan-building-actions">
        <button type="button" className="siteplan-link-btn" onClick={() => onDuplicate(b.id)}>Duplicate</button>
        <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onRemove(b.id)}>Remove</button>
      </div>
    </>
  );
}

// A building the solver generated: what it is, and a way to take it over.
export function GeneratedBuilding({ label, rect, onEdit, canEdit }) {
  return (
    <>
      <div className="siteplan-selection-title">{label}</div>
      {rect && (
        <p className="siteplan-small">{fmtInt(rect.length)} × {fmtInt(rect.depth)} ft · {fmtInt(rect.length * rect.depth)} sf footprint · {fmtDec(rect.angle, 1)}°</p>
      )}
      {canEdit ? (
        <>
          <button type="button" className="siteplan-small-btn" onClick={onEdit}>✋ Move or resize</button>
          <p className="siteplan-muted siteplan-small">Or just drag it on the map. Either one switches the layout to placed by hand; the other buildings stay where they are.</p>
        </>
      ) : (
        <p className="siteplan-muted siteplan-small">Shaped buildings (L, U, courtyard, wrap) are laid out automatically. Set the shape to Bars to place buildings by hand.</p>
      )}
    </>
  );
}

// A generated parking bay: its stalls, and the scheme-wide parking controls.
export function BayDetails({ bay, index, settings, currentDeg, onSetOverride }) {
  return (
    <>
      <div className="siteplan-selection-title">Parking bay {index + 1}</div>
      <p className="siteplan-small">
        {fmtInt(bay.stallCount)} stalls · {bay.stallAngle}° stalls · {bay.oneWay ? 'one-way' : 'two-way'} aisle · runs {fmtDec(bay.angleDeg, 1)}°
        {bay.connected ? '' : ' · ⚠ can\'t reach a drive'}
      </p>
      <Field label="Stall angle (all bays)">
        <select value={settings.stallAngle} onChange={(e) => onSetOverride('stallAngle', Number(e.target.value))}>
          {STALL_ANGLES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </Field>
      <OrientationField label="Parking orientation" value={settings.parkingRotation} currentDeg={currentDeg} onChange={(v) => onSetOverride('parkingRotation', v)} />
      <p className="siteplan-muted siteplan-small">To lay out this ground differently, draw a parking area over it (Parking step) and set its own orientation.</p>
    </>
  );
}

// A space: no-build, or its own use with its own settings.
export function SpaceEditor({ space, result, onUpdate, onRemove }) {
  const t = space.kind === 'asset' ? getAssetType(space.assetType) : null;
  const y = t && result?.metrics ? yieldOf(t, result.metrics) : null;
  return (
    <>
      <div className="siteplan-selection-title">{space.name}{y ? ` · ${y.value} ${y.label}` : ''}</div>
      <Field label="Name">
        <input value={space.name} maxLength={100} onChange={(e) => onUpdate(space.id, { name: e.target.value })} className="siteplan-text-input" />
      </Field>
      <Field label="Use">
        <select
          value={space.kind === 'no-build' ? 'no-build' : space.assetType}
          onChange={(e) => (e.target.value === 'no-build'
            ? onUpdate(space.id, { kind: 'no-build', assetType: undefined, overrides: undefined })
            : onUpdate(space.id, { kind: 'asset', assetType: e.target.value, overrides: { setback: 0 } }))}
        >
          <option value="no-build">No-build</option>
          {ASSET_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </Field>
      {t && (
        <details className="siteplan-details">
          <summary>{t.label} settings for this space</summary>
          <SchemeSettings
            key={`${space.id}-${space.assetType}`}
            type={t}
            overrides={space.overrides || {}}
            onChange={(overrides) => onUpdate(space.id, { overrides })}
            idPrefix={`space-${space.id}`}
            currentOrientationDeg={result?.metrics?.orientationDeg}
            groupsOpen={['Program', 'Site']}
          />
        </details>
      )}
      <p className="siteplan-muted siteplan-small">Drag, reshape or rotate it with the map&apos;s edit tools (left edge).</p>
      <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onRemove(space.id)}>Remove space</button>
    </>
  );
}

// A parking area drawn by hand.
export function AreaEditor({ area, label, info, onUpdate, onRemove }) {
  return (
    <>
      <div className="siteplan-selection-title">{label}{info ? ` · ${fmtInt(info.stalls || 0)} stalls` : ''}</div>
      <OrientationField
        label="Stall orientation"
        value={Number.isFinite(area.angle) ? area.angle : 'auto'}
        currentDeg={info?.orientationDeg}
        onChange={(v) => onUpdate(area.id, { angle: v === undefined ? 'auto' : v })}
      />
      <Field label="Stall angle">
        <select value={area.stallAngle || ''} onChange={(e) => onUpdate(area.id, { stallAngle: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">Same as the scheme</option>
          {STALL_ANGLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <p className="siteplan-muted siteplan-small">Reshape, drag or rotate the area with the map&apos;s edit tools; drag ⟳ to turn its stalls.</p>
      <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onRemove(area.id)}>Remove parking area</button>
    </>
  );
}

// A drive aisle drawn by hand.
export function AisleEditor({ aisle: a, label, settings, issues, truckMode, onUpdate, onRemove }) {
  return (
    <>
      <div className="siteplan-selection-title">{label}</div>
      <Field label="Traffic">
        <select value={a.twoWay === false ? 'one' : 'two'} onChange={(e) => onUpdate(a.id, { twoWay: e.target.value === 'two' })}>
          <option value="two">Two-way</option>
          <option value="one">One-way</option>
        </select>
      </Field>
      {truckMode && (
        <Field label="Trucks use it">
          <select value={a.truck ? 'yes' : 'no'} onChange={(e) => onUpdate(a.id, { truck: e.target.value === 'yes' ? true : undefined })}>
            <option value="no">No</option>
            <option value="yes">Yes - check for a WB-67</option>
          </select>
        </Field>
      )}
      <Field label="Width" unit="ft">
        <NumberInput value={aisleWidthOf(a, settings)} min={8} max={80} onChange={(n) => onUpdate(a.id, { width: n })} />
      </Field>
      {issues.map((x) => <p key={`${x.kind}-${x.text}`} className="siteplan-neg siteplan-small">⚠ {x.text}</p>)}
      <p className="siteplan-muted siteplan-small">Drag its points with the map&apos;s edit tool to reshape it.</p>
      <button type="button" className="siteplan-link-btn siteplan-danger-link" onClick={() => onRemove(a.id)}>Remove aisle</button>
    </>
  );
}
