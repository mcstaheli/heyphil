// Modeling (Labs) - a model's inputs: which cells each mapped input covers,
// what they hold now, and turning a person's answers into cell writes.
// The pure parts (cellsFor, parseGridSpec, coerce, planWrites,
// targetAdjustment) are tested in scripts/tests/modelingInputs.test.js.
import { ModelingError, sheetSafe } from './rules.js';

const colLetter = (n) => {
  let s = '';
  let x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
};
const colIndex = (L) => [...L].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const a1 = (sheet, row, col) => `'${String(sheet).replace(/'/g, "''")}'!${colLetter(col)}${row + 1}`;

// "D:Phase name:text|E:Keys offline:integer|C:Category:choice:a|b" ->
// [{ col: 'D', label, type, choices }]. Choices may contain "|" only as
// the last field of the last column... so choices use the remainder.
export function parseGridSpec(spec) {
  const out = [];
  const parts = String(spec || '').split('|');
  let i = 0;
  while (i < parts.length) {
    const m = /^([A-Z]+):([^:]+):([a-z]+)(?::(.*))?$/.exec(parts[i].trim());
    if (!m) { i += 1; continue; }
    const col = { col: m[1], label: m[2], type: m[3], choices: null };
    if (m[4] !== undefined) {
      // choices run until the next "X:Label:type" column
      const choices = [m[4]];
      while (i + 1 < parts.length && !/^[A-Z]+:[^:]+:[a-z]+/.test(parts[i + 1].trim())) { i += 1; choices.push(parts[i]); }
      col.choices = choices.map((c) => c.trim()).filter(Boolean);
    }
    out.push(col);
    i += 1;
  }
  return out;
}

// The cells an input covers: [{ range, row, col }] in reading order.
// `def`: its named range's location. Grids: only the spec's input columns
// (a "label" column is shown, never written).
export function cellsFor(input, def) {
  if (!def) return [];
  const rows = [];
  for (let r = def.startRow; r < def.endRow; r += 1) rows.push(r);
  if (input.kind === 'grid') {
    // only columns inside the named range - a spec column outside it is
    // never read, checked for formulas, or written
    const cols = parseGridSpec(input.options);
    const inside = (c) => colIndex(c.col) >= def.startCol && colIndex(c.col) < def.endCol;
    return rows.flatMap((r, ri) => cols.map((c, ci) => ({ c, ci })).filter(({ c }) => inside(c))
      .map(({ c, ci }) => ({ range: a1(def.sheet, r, colIndex(c.col)), row: ri, col: ci, writable: c.type !== 'label' })));
  }
  if (input.kind === 'list') {
    // a column of values (or a row, for a one-row range like Year 1..8)
    const cells = [];
    if (def.endRow - def.startRow === 1) {
      for (let c = def.startCol; c < def.endCol; c += 1) cells.push({ range: a1(def.sheet, def.startRow, c), row: c - def.startCol, col: 0, writable: true });
    } else {
      rows.forEach((r, ri) => cells.push({ range: a1(def.sheet, r, def.startCol), row: ri, col: 0, writable: true }));
    }
    return cells;
  }
  return [{ range: a1(def.sheet, def.startRow, def.startCol), row: 0, col: 0, writable: true }];
}

// A person's answer -> the value written to the sheet (USER_ENTERED), or
// throws a ModelingError saying what's wrong.
export function coerce(type, value, { label = 'This answer', choices = null } = {}) {
  if (value === null || value === undefined || value === '') return '';
  const num = (v) => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n)) throw new ModelingError(`${label} must be a number.`);
    return n;
  };
  switch (type) {
    case 'currency':
    case 'number':
    case 'multiple':
      return num(value);
    case 'integer': {
      const n = num(value);
      if (!Number.isInteger(n)) throw new ModelingError(`${label} must be a whole number.`);
      return n;
    }
    case 'percent': {
      // answers come as fractions (0.25); "25%" typed as text is accepted too
      if (typeof value === 'string' && value.trim().endsWith('%')) return num(value.trim().slice(0, -1)) / 100;
      return num(value);
    }
    case 'month': {
      const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(value));
      if (!m || +m[2] < 1 || +m[2] > 12) throw new ModelingError(`${label} must be a month (YYYY-MM).`);
      return `${m[1]}-${m[2]}-01`;
    }
    case 'choice':
      if (choices && !choices.includes(String(value))) throw new ModelingError(`${label} must be one of: ${choices.join(', ')}.`);
      return sheetSafe(String(value));
    case 'text':
    default:
      return sheetSafe(String(value).slice(0, 500));
  }
}

// What the Quick "target" questions write: the adjustment that makes the
// stabilized average hit the target, given today's adjustment and today's
// resulting average (both raw numbers).
export function targetAdjustment(target, currentAdj, currentOut) {
  const t = Number(target);
  const adj = Number(currentAdj) || 0;
  const out = Number(currentOut);
  if (!Number.isFinite(t) || t <= 0) throw new ModelingError('The target must be a positive number.');
  if (!Number.isFinite(out) || out <= 0) throw new ModelingError("The model's current value can't be read, so the target can't be applied.");
  return (1 + adj) * (t / out) - 1;
}

// Is cell (row, col) of a field a formula? (a single input's flag is a
// boolean; lists/grids carry a grid of flags in the field's own layout)
const isFormulaCell = (f, row = 0, col = 0) => (f.formula === true) || (Array.isArray(f.formula) && f.formula?.[row]?.[col] === true);

// Plans the writes for a set of answers. `fields`: the inputs as read
// (with cells, current raw values and formula flags); `answers`: { key:
// value } for single inputs, and for lists/grids ONLY the changed cells as
// { cells: { "row,col": value } } (an array of every row is accepted too);
// `overrides`: keys whose formulas may be replaced.
// Returns { cells: [{ range, value }], changes: [{ key, label, from, to, cells? }] }.
export function planWrites(fields, answers, overrides = {}) {
  const cells = [];
  const changes = [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [key, answer] of Object.entries(answers || {})) {
    const f = byKey.get(key);
    if (!f) throw new ModelingError(`"${key}" isn't an input of this model.`);
    if (f.kind === 'target') continue; // planned by the caller (needs live values)
    const label = f.question || key;
    if (f.kind === 'input') {
      const cell = f.cells[0];
      if (!cell) throw new ModelingError(`${label}: this model doesn't have that input.`);
      const v = coerce(f.type, answer, { label, choices: f.type === 'choice' ? String(f.options || '').split('|') : null });
      if (sameValue(v, f.raw)) continue; // (month raws are already YYYY-MM-01)
      if (isFormulaCell(f) && !overrides[key]) throw new ModelingError(`${label} is calculated by the model - choose Override to replace it.`);
      cells.push({ range: cell.range, value: v });
      changes.push({ key, label, from: f.display ?? null, to: v });
      continue;
    }
    // list / grid: the changed cells
    let edits;
    if (answer && typeof answer === 'object' && !Array.isArray(answer) && answer.cells) {
      edits = Object.entries(answer.cells).map(([rc, v]) => { const [r, c] = rc.split(',').map(Number); return { r, c, v }; });
    } else if (Array.isArray(answer)) {
      edits = answer.flatMap((row, r) => (Array.isArray(row) ? row : [row]).map((v, c) => ({ r, c, v })));
    } else {
      throw new ModelingError(`${label} needs a table of values.`);
    }
    const spec = f.kind === 'grid' ? parseGridSpec(f.options) : [{ type: f.type }];
    const done = [];
    for (const { r, c, v: val } of edits) {
      if (val === undefined) continue;
      const cell = f.cells.find((x) => x.row === r && x.col === c);
      if (!cell) throw new ModelingError(`${label}: row ${r + 1} doesn't exist in this model.`);
      if (!cell.writable) continue; // a label column is shown, never written
      const colSpec = spec[c] || {};
      const where = `${label} (row ${r + 1}${colSpec.label ? `, ${colSpec.label}` : ''})`;
      const v = coerce(colSpec.type || f.type, val, { label: where, choices: colSpec.choices || null });
      const current = Array.isArray(f.raw) ? f.raw[r]?.[c] : undefined;
      if (sameValue(v, current)) continue;
      if (isFormulaCell(f, r, c) && !overrides[key]) throw new ModelingError(`${where} is calculated by the model - choose Override to replace it.`);
      cells.push({ range: cell.range, value: v });
      done.push({ row: r, col: c, from: Array.isArray(f.display) ? f.display[r]?.[c] ?? null : null, to: v });
    }
    if (done.length) changes.push({ key, label, from: null, to: `${done.length} cell${done.length === 1 ? '' : 's'}`, cells: done.slice(0, 100) });
  }
  return { cells, changes };
}

function sameValue(next, current) {
  if (next === '' && (current === '' || current === null || current === undefined)) return true;
  if (typeof next === 'number' && typeof current === 'number') return Math.abs(next - current) < 1e-12;
  return String(next) === String(current ?? '');
}

// A sheet date serial -> "YYYY-MM-01" (month inputs), else the value.
export function serialToMonth(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v ?? null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Re-lays a named range's full grid (rows x all its columns) into the
// field's own layout: grid -> the spec's columns, list/input -> as cells.
export function toFieldLayout(field, def, grid) {
  if (!Array.isArray(grid)) grid = [[grid]];
  if (field.kind === 'grid') {
    const cols = parseGridSpec(field.options);
    const n = def.endRow - def.startRow;
    return Array.from({ length: n }, (_, r) => cols.map((c) => {
      const idx = colIndex(c.col) - def.startCol;
      const v = idx >= 0 ? (grid[r] || [])[idx] : null;
      return c.type === 'month' ? serialToMonth(v) : (v ?? null);
    }));
  }
  if (field.kind === 'list') {
    const flat = def.endRow - def.startRow === 1 ? (grid[0] || []) : grid.map((r) => r[0]);
    const n = def.endRow - def.startRow === 1 ? def.endCol - def.startCol : def.endRow - def.startRow;
    return Array.from({ length: n }, (_, i) => [field.type === 'month' ? serialToMonth(flat[i]) : (flat[i] ?? null)]);
  }
  const v = (grid[0] || [])[0];
  return field.type === 'month' ? serialToMonth(v) : (v ?? null);
}

// Goal seek for the Quick targets: the next adjustment to try, from the
// last two (adjustment, result) points (secant), or - with one point - a
// proportional step. The model's response isn't linear (busy months cap at
// 100% occupancy), so the caller repeats until it's close enough.
export function nextGuess(target, points) {
  const [p0, p1] = points.slice(-2);
  if (!p1 || Math.abs(p1.out - p0.out) < 1e-12) {
    const last = p1 || p0;
    return (1 + last.adj) * (target / last.out) - 1;
  }
  return p1.adj + (target - p1.out) * (p1.adj - p0.adj) / (p1.out - p0.out);
}

export const closeEnough = (target, out) => Math.abs(out - target) <= Math.max(Math.abs(target) * 0.0005, 1e-9);
