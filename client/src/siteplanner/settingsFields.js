import React, { useEffect, useState } from 'react';
import { DEFAULT_MIX, bedsBaths, defaultsFor, fieldsFor } from './assetTypes';

// The settings form for a scheme or a space: every field of its asset
// type, starting from the type's defaults, with changed ones highlighted
// and ↺ to put one back.

export const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-US');
export const fmtDec = (n, d = 2) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPct = (n, d = 1) => `${fmtDec((n || 0) * 100, d)}%`;
export const fmtMoney = (n) => {
  const v = n || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${fmtDec(abs / 1e9, 2)}B`;
  if (abs >= 1e6) return `${sign}$${fmtDec(abs / 1e6, 2)}M`;
  if (abs >= 1e3) return `${sign}$${fmtDec(abs / 1e3, 0)}K`;
  return `${sign}$${fmtDec(abs, 0)}`;
};

// A number input that lets you type freely ("1." on the way to "1.5")
// and reports only valid numbers.
// commitOnBlur: report the number only on Enter or leaving the box, not
// on every keystroke (for a change that's big to make, like taking a
// layout over by hand).
export function NumberInput({ value, onChange, step, min = 0, max = 1e10, commitOnBlur = false, ...rest }) {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => {
    setText((t) => (Number(t) === value && t.trim() !== '' ? t : String(value ?? '')));
  }, [value]);
  const valid = (t) => t.trim() !== '' && Number.isFinite(Number(t)) && Number(t) >= min && Number(t) <= max;
  const commit = () => {
    if (valid(text) && Number(text) !== value) onChange(Number(text));
    else setText(String(value ?? ''));
  };
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
        if (!commitOnBlur && valid(e.target.value)) onChange(Number(e.target.value));
      }}
      onBlur={() => (commitOnBlur ? commit() : setText(String(value ?? '')))}
      onKeyDown={commitOnBlur ? (e) => { if (e.key === 'Enter') commit(); } : undefined}
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
        {field.options
          ? (
            <select className="siteplan-field-select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
              {field.options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          )
          : <NumberInput value={value} step={field.step} max={field.max} onChange={onChange} title={field.hint || ''} />}
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
      <div className="siteplan-mix-row siteplan-mix-head"><span>Type</span><span>Size sf</span><span>Mix %</span><span title="Bedrooms">Bd</span><span title="Bathrooms">Ba</span><span /></div>
      {mix.map((u, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div className="siteplan-mix-row" key={i}>
          <input value={u.name} maxLength={40} onChange={(e) => update(i, 'name', e.target.value)} />
          <NumberInput value={u.size} min={1} max={100000} onChange={(n) => update(i, 'size', n)} />
          <NumberInput value={u.pct} max={100} onChange={(n) => update(i, 'pct', n)} />
          <NumberInput value={bedsBaths(u).beds} max={10} onChange={(n) => update(i, 'beds', n)} />
          <NumberInput value={bedsBaths(u).baths} max={10} onChange={(n) => update(i, 'baths', n)} />
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
          onClick={() => onChange([...mix, { name: 'New', size: 900, pct: 0, beds: 1, baths: 1 }])}
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

// Sets one override, dropping it when it equals the default.
export function withOverride(type, overrides, key, value) {
  const defaults = defaultsFor(type);
  const next = { ...overrides };
  if (value === undefined || JSON.stringify(value) === JSON.stringify(defaults[key])) delete next[key];
  else next[key] = value;
  return next;
}

// "Best fit" or a fixed angle, for building or parking orientation.
// currentDeg is what "Fixed angle" starts from.
export function OrientationField({ label, value, currentDeg, onChange }) {
  const auto = value === 'auto' || value === undefined;
  return (
    <>
      <label className={`siteplan-field ${auto ? '' : 'siteplan-field-changed'}`}>
        <span className="siteplan-field-label">{label}</span>
        <span className="siteplan-field-input">
          <select value={auto ? 'auto' : 'fixed'} onChange={(e) => onChange(e.target.value === 'auto' ? undefined : Math.round(currentDeg || 0))}>
            <option value="auto">Best fit</option>
            <option value="fixed">Fixed angle</option>
          </select>
          <span className="siteplan-reset-spacer" />
        </span>
      </label>
      {!auto && (
        <label className="siteplan-field siteplan-field-changed">
          <span className="siteplan-field-label">Angle<span className="siteplan-field-unit"> ° from east</span></span>
          <span className="siteplan-field-input">
            <NumberInput value={value} min={-360} max={360} onChange={onChange} />
            <span className="siteplan-reset-spacer" />
          </span>
        </label>
      )}
    </>
  );
}

// idPrefix keeps inputs distinct between schemes and spaces.
// currentOrientationDeg / currentParkingDeg are what "Fixed angle" starts from.
// only: show just these groups, laid out flat (no open/close headings).
// keys: show just these settings ('mix' for the unit mix), flat - how a
// step shows its share of the settings. noOrientation leaves the
// orientation choices to the step that shows them on their own.
export function SchemeSettings({ type, overrides, onChange, idPrefix, currentOrientationDeg, currentParkingDeg, groupsOpen, only = null, keys = null, noOrientation = false }) {
  const settings = { ...defaultsFor(type), ...overrides };
  const fields = fieldsFor(type).filter((f) => !keys || keys.includes(f.key));
  const groups = [...new Set(fields.map((f) => f.group))].filter((g) => !only || only.includes(g));
  const flat = !!only || !!keys;
  const showMix = type.hasMix && (keys ? keys.includes('mix') : (!only || only.includes('Program')));
  const set = (key, value) => onChange(withOverride(type, overrides, key, value));
  const [open, setOpen] = useState(() => new Set(groupsOpen || groups.filter((g) => g !== 'Pro forma')));
  const toggle = (g) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    return next;
  });

  return (
    <div className="siteplan-settings">
      {showMix && (
        <MixEditor
          mix={settings.mix || DEFAULT_MIX}
          overridden={'mix' in overrides}
          onChange={(mix) => set('mix', mix)}
          onReset={() => set('mix', undefined)}
        />
      )}
      {groups.map((g) => {
        const changed = fields.filter((f) => f.group === g && f.key in overrides).length;
        return (
          <div key={g} className="siteplan-group">
            {flat ? (
              <>
                {keys && groups.length > 1 && <div className="siteplan-group-title">{g}</div>}
                {changed > 0 && <span className="siteplan-changed-count siteplan-changed-flat">{changed} changed from the defaults</span>}
              </>
            ) : (
              <button type="button" className="siteplan-group-title siteplan-group-toggle" onClick={() => toggle(g)}>
                {open.has(g) ? '▾' : '▸'} {g}
                {changed > 0 && <span className="siteplan-changed-count">{changed} changed</span>}
              </button>
            )}
            {(flat || open.has(g)) && fields.filter((f) => f.group === g && (!f.showIf || f.showIf(settings))).map((f) => (
              <SettingField
                key={`${idPrefix}-${f.key}`}
                field={f}
                value={settings[f.key]}
                overridden={f.key in overrides}
                onChange={(n) => set(f.key, n)}
                onReset={() => set(f.key, undefined)}
              />
            ))}
            {!noOrientation && (flat || open.has(g)) && g === 'Site' && (
              <OrientationField label="Building orientation" value={settings.rotation} currentDeg={currentOrientationDeg} onChange={(v) => set('rotation', v)} />
            )}
            {!noOrientation && (flat || open.has(g)) && g === 'Parking' && (
              <OrientationField label="Parking orientation" value={settings.parkingRotation} currentDeg={currentParkingDeg} onChange={(v) => set('parkingRotation', v)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
