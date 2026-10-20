import React from 'react';
import { ASSET_TYPES, COMMON_FIELDS, getAssetType } from './assetTypes';
import { pointInShape } from './geometry';
import { aisleWidthOf } from './solver';
import { PLACED_SHAPES, placedWings } from './buildings';
import { NumberInput, OrientationField, SchemeSettings, fmtDec, fmtInt } from './settingsFields';
import { yieldOf } from './results';

// The panel's pinned top: what's selected on the map (or picked from the
// list), what it is, and its controls - whichever step is open. A
// selection is "kind:id": building (placed by hand), auto (a generated
// building, by index), bay (a generated parking bay, by index), space,
// area (a parking area) or aisle (a drawn drive aisle).

export const STALL_ANGLES = COMMON_FIELDS.find((f) => f.key === 'stallAngle').options;

export const selectionKey = (kind, id) => `${kind}:${id}`;

// The stall of the main layout's bays under a point ([lat, lng]): its
// bay's index and the slot ({ ring, center, kind, byHand }), or null.
export function findStall(bays, latlng) {
  for (let b = 0; b < (bays || []).length; b++) {
    const slot = (bays[b].slots || []).find((x) => pointInShape([x.ring], latlng));
    if (slot) return { bayIndex: b, slot };
  }
  return null;
}
// A stall selection is keyed by its middle ("lat,lng").
export const stallKey = (slot) => selectionKey('stall', `${slot.center[0]},${slot.center[1]}`);
export const stallPoint = (id) => id.split(',').map(Number);
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
export function BuildingEditor({ building: b, label, type, defaultFloors, wingDefault = 65, onUpdate, onDuplicate, onRemove, problem }) {
  return (
    <>
      <div className="siteplan-selection-title">{label}</div>
      {problem && <p className="siteplan-neg siteplan-small">⚠ {problem}</p>}
      <div className="siteplan-selection-grid">
        {type.mode !== 'industrial' && (
          <Field label="Shape">
            <select
              value={b.shape || 'rect'}
              onChange={(e) => onUpdate(b.id, e.target.value === 'rect' ? { shape: undefined, wing: undefined } : { shape: e.target.value, wing: b.wing || wingDefault })}
            >
              {PLACED_SHAPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </Field>
        )}
        {b.shape && b.shape !== 'rect' && (
          <Field label="Wing depth" unit="ft"><NumberInput value={b.wing} min={10} max={500} onChange={(n) => onUpdate(b.id, { wing: n })} /></Field>
        )}
        {b.shape && b.shape !== 'rect' && placedWings(b).length === 1 && (
          <p className="siteplan-warn siteplan-small">Too small for that shape at this wing depth - drawn as a rectangle. Make it bigger or the wings shallower.</p>
        )}
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

// A building the solver generated: what it is, and its size to change
// right here - which takes the layout over by hand with that change.
export function GeneratedBuilding({ label, rect, floors, onEdit, canEdit }) {
  return (
    <>
      <div className="siteplan-selection-title">{label}</div>
      {rect && !canEdit && (
        <p className="siteplan-small">{fmtInt(rect.length)} × {fmtInt(rect.depth)} ft · {fmtInt(rect.length * rect.depth)} sf footprint · {fmtDec(rect.angle, 1)}°</p>
      )}
      {canEdit ? (
        <>
          {rect && (
            <div className="siteplan-selection-grid">
              <Field label="Length" unit="ft"><NumberInput value={Math.round(rect.length)} min={1} max={5000} onChange={(n) => onEdit({ length: n })} /></Field>
              <Field label="Depth" unit="ft"><NumberInput value={Math.round(rect.depth)} min={1} max={5000} onChange={(n) => onEdit({ depth: n })} /></Field>
              <Field label="Angle" unit="°"><NumberInput value={Math.round(rect.angle * 10) / 10} min={-360} max={360} step={0.5} onChange={(n) => onEdit({ angle: n })} /></Field>
              {floors > 0 && <Field label="Floors"><NumberInput value={floors} min={1} max={100} onChange={(n) => onEdit({ floors: Math.round(n) })} /></Field>}
            </div>
          )}
          <button type="button" className="siteplan-small-btn" onClick={() => onEdit(null)}>✋ Move, resize or reshape</button>
          <p className="siteplan-muted siteplan-small">Changing a number, dragging it on the map or ✋ switches the layout to placed by hand (the other buildings stay put); then pick an L, U or courtyard shape.</p>
        </>
      ) : (
        <p className="siteplan-muted siteplan-small">Shaped buildings (L, U, courtyard, wrap) are laid out automatically. Set the shape to Bars to place buildings by hand.</p>
      )}
    </>
  );
}

// A generated parking bay: its stalls, and the scheme-wide parking controls.
export function BayDetails({ bay, index, settings, currentDeg, onSetOverride, onEditBay }) {
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
      {onEditBay && <button type="button" className="siteplan-small-btn" onClick={onEditBay}>✋ Edit this bay by hand</button>}
      <p className="siteplan-muted siteplan-small">Click a stall to change just that stall. ✋ turns the bay into a parking area you can drag, reshape and turn.</p>
    </>
  );
}

const STALL_KINDS = [
  ['standard', 'Standard'], ['compact', 'Compact'], ['ev', 'EV charging'], ['ada', 'Accessible'], ['van', 'Van accessible'], ['removed', 'Removed (landscape)'],
];

// One stall: what it is, changed right here; and its bay, which can be
// taken over as a parking area to move, reshape or turn.
export function StallEditor({ slot, bay, bayIndex, onSetKind, onReset, onEditBay }) {
  return (
    <>
      <div className="siteplan-selection-title">Stall in bay {bayIndex + 1}{slot.byHand ? ' · changed by hand' : ''}</div>
      <div className="siteplan-stall-kinds" role="radiogroup" aria-label="Stall type">
        {STALL_KINDS.map(([k, label]) => (
          <button
            type="button"
            key={k}
            role="radio"
            aria-checked={slot.kind === k}
            className={`siteplan-stall-kind siteplan-stall-${k} ${slot.kind === k ? 'on' : ''}`}
            onClick={() => onSetKind(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {slot.byHand && <button type="button" className="siteplan-link-btn" onClick={onReset}>↺ Back to automatic</button>}
      <p className="siteplan-muted siteplan-small">
        Accessible stalls you mark count toward the required number; the rest are placed for you near the entry. A change stays with this spot if the layout shifts.
      </p>
      <div className="siteplan-selection-sub">
        Bay {bayIndex + 1}: {fmtInt(bay.stallCount)} stalls · {bay.stallAngle}° · runs {fmtDec(bay.angleDeg, 1)}°
      </div>
      <button type="button" className="siteplan-small-btn" onClick={onEditBay}>✋ Edit this bay by hand</button>
      <p className="siteplan-muted siteplan-small">Turns the bay into a parking area you can drag, reshape and turn on the map, with its own stall angle.</p>
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
