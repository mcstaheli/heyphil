// The inputs screen's rules (pure; tested in inputsForm.test.js).

export const LEVELS = [
  { id: 'quick', label: 'Quick', help: 'The napkin questions - everything else uses the template\'s defaults' },
  { id: 'standard', label: 'Standard', help: 'The usual assumptions for a full look' },
  { id: 'detail', label: 'Everything', help: 'Every input, including tables and tax' },
];

// Quick: the quick questions (incl. occupancy/ADR targets). Standard adds
// standard ones. Everything: all of them - with the raw adjustment cells
// instead of the Quick targets (the two would fight).
export function visibleFields(fields, level) {
  return fields.filter((f) => {
    if (level === 'quick') return f.level === 'quick';
    if (f.kind === 'target') return false;
    if (level === 'standard') return f.level === 'quick' || f.level === 'standard';
    return true;
  });
}

// "in_keys_added!=0", "in_loan_sizing_method=Loan Amount (manual)".
// `current`: each field's value in SHEET units (see sheetValues) - the
// rules are written against what the sheet holds.
export function isShown(field, current, fields) {
  const rule = field.showIf;
  if (!rule) return true;
  const m = /^([A-Za-z0-9_]+)\s*(!=|=)\s*(.*)$/.exec(rule);
  if (!m) return true;
  const [, key, op, want] = m;
  if (!fields.some((f) => f.key === key)) return true;
  const have = current[key];
  const w = want.trim();
  const isMonth = (x) => /^\d{4}-\d{2}/.test(String(x ?? ''));
  let same;
  if (isMonth(have) && isMonth(w)) same = String(have).slice(0, 7) === w.slice(0, 7);
  else if (have !== '' && have !== null && have !== undefined && w !== '' && Number.isFinite(Number(have)) && Number.isFinite(Number(w))) same = Math.abs(Number(have) - Number(w)) < 1e-9;
  else same = String(have ?? '').trim() === w;
  return op === '=' ? same : !same;
}

// "D:Phase name:text|C:Category:choice:a|b" -> [{ col, label, type, choices }]
// (same rules as server/modeling/inputs.js)
export function parseGridSpec(spec) {
  const out = [];
  const parts = String(spec || '').split('|');
  let i = 0;
  while (i < parts.length) {
    const m = /^([A-Z]+):([^:]+):([a-z]+)(?::(.*))?$/.exec(parts[i].trim());
    if (!m) { i += 1; continue; }
    const col = { col: m[1], label: m[2], type: m[3], choices: null };
    if (m[4] !== undefined) {
      const choices = [m[4]];
      while (i + 1 < parts.length && !/^[A-Z]+:[^:]+:[a-z]+/.test(parts[i + 1].trim())) { i += 1; choices.push(parts[i]); }
      col.choices = choices.map((c) => c.trim()).filter(Boolean);
    }
    out.push(col);
    i += 1;
  }
  return out;
}

const round = (n) => Math.round(n * 1e6) / 1e6;
// sheet value -> what the person sees and types (percent as 25 for 25%)
function toEdit(type, raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  if (type === 'percent') return typeof raw === 'number' ? String(round(raw * 100)) : String(raw);
  if (type === 'month') return String(raw).slice(0, 7);
  return typeof raw === 'number' ? String(round(raw)) : String(raw);
}
// typed -> what the server takes (it validates and converts further)
function fromEdit(type, v) {
  if (v === '' || v === null || v === undefined) return '';
  if (type === 'percent') {
    const n = Number(String(v).replace(/[%,\s]/g, ''));
    return Number.isFinite(n) ? n / 100 : v;
  }
  return v;
}

export function toEditValue(f) {
  if (f.kind === 'list') return (f.raw || []).map((r) => [toEdit(f.type, r[0])]);
  if (f.kind === 'grid') {
    const cols = parseGridSpec(f.options);
    return (f.raw || []).map((r) => cols.map((c, i) => (c.type === 'label' ? (r[i] ?? '') : toEdit(c.type, r[i]))));
  }
  return toEdit(f.type, f.raw);
}

export function fromEditValue(f, v) {
  if (f.kind === 'list') return (v || []).map((r) => fromEdit(f.type, r[0]));
  if (f.kind === 'grid') {
    const cols = parseGridSpec(f.options);
    return (v || []).map((r) => cols.map((c, i) => (c.type === 'label' ? r[i] : fromEdit(c.type, r[i]))));
  }
  return fromEdit(f.type, v);
}

export const displayOf = (item) => (item ? item.display ?? '-' : '-');

// Each field's value in sheet units, with the person's edits applied
// (single inputs only - show-if rules never point at tables).
export function sheetValues(fields, edits) {
  return Object.fromEntries(fields.map((f) => [f.key, f.kind === 'input' && f.key in edits ? fromEditValue(f, edits[f.key]) : f.raw]));
}

// What to send for one field: the converted value for a single input; for
// a list/grid ONLY the cells that differ from what was loaded, as
// { cells: { "row,col": value } } - untouched cells are never rewritten.
export function answerFor(f, editValue) {
  if (f.kind !== 'list' && f.kind !== 'grid') return fromEditValue(f, editValue);
  const before = toEditValue(f);
  const cols = f.kind === 'grid' ? parseGridSpec(f.options) : [{ type: f.type }];
  const cells = {};
  (editValue || []).forEach((row, r) => row.forEach((v, c) => {
    if (cols[c]?.type === 'label') return;
    if (String(v ?? '') !== String(before[r]?.[c] ?? '')) cells[`${r},${c}`] = fromEdit(cols[c]?.type || f.type, v);
  }));
  return Object.keys(cells).length ? { cells } : null;
}

// Is a table cell a formula (shown, not editable without Override)?
export const cellIsFormula = (f, r, c) => Array.isArray(f.formula) && f.formula?.[r]?.[c] === true;
