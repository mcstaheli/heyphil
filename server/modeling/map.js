// Modeling (Labs) - the HeyPhil Map: the rows a template carries on its
// "HeyPhil Map" tab that tell HeyPhil which named ranges are inputs (with
// their questions) and which are outputs (and how to show them).
// Written by scripts/modeling/hospitality-map.mjs; columns:
//   Key | Kind | Target | Step | Level | Order | Question | Help | Type |
//   Options | Show if | Notes
// parseMap is pure (tested in scripts/tests/modelingMap.test.js).

export const MAP_TAB = 'HeyPhil Map';
export const MAP_RANGE = `'${MAP_TAB}'!A1:L600`;
const KINDS = new Set(['step', 'input', 'list', 'grid', 'target', 'output']);
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

// [[header...], [row...]] -> { steps, inputs, outputs, problems }
export function parseMap(rows) {
  const problems = [];
  if (!Array.isArray(rows) || rows.length < 2) return { steps: [], inputs: [], outputs: [], problems: ['The HeyPhil Map tab is empty.'] };
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const need = ['key', 'kind', 'target', 'step', 'level', 'order', 'question'];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) return { steps: [], inputs: [], outputs: [], problems: [`The HeyPhil Map is missing columns: ${missing.join(', ')}.`] };
  const cell = (r, name) => {
    const i = col(name);
    return i < 0 ? '' : String(r[i] ?? '').trim();
  };
  const steps = [];
  const inputs = [];
  const outputs = [];
  const seen = new Set();
  rows.slice(1).forEach((r, idx) => {
    const key = cell(r, 'key');
    const kind = cell(r, 'kind').toLowerCase();
    if (!key && !kind) return; // blank row
    const line = idx + 2;
    if (!KINDS.has(kind)) { problems.push(`Row ${line}: unknown kind "${kind}".`); return; }
    if (seen.has(`${kind}:${key}`)) { problems.push(`Row ${line}: "${key}" appears twice.`); return; }
    seen.add(`${kind}:${key}`);
    const item = {
      key,
      kind,
      target: cell(r, 'target') || null,
      step: cell(r, 'step'),
      level: cell(r, 'level').toLowerCase() || null,
      order: Number(cell(r, 'order')) || 0,
      question: cell(r, 'question'),
      help: cell(r, 'help') || null,
      type: cell(r, 'type').toLowerCase() || null,
      options: cell(r, 'options') || null,
      showIf: cell(r, 'show if') || null,
      notes: cell(r, 'notes') || null,
    };
    if (kind !== 'step' && (!item.target || !NAME_RE.test(item.target))) {
      problems.push(`Row ${line}: "${key}" has no valid named range in Target.`);
      return;
    }
    if (kind === 'step') steps.push({ key, title: item.question, intro: item.help, order: item.order });
    else if (kind === 'output') outputs.push({ key, name: item.target, group: item.step, level: item.level === 'headline' ? 'headline' : 'detail', order: item.order, label: item.question, type: item.type || 'text' });
    else inputs.push(item);
  });
  steps.sort((a, b) => a.order - b.order);
  const stepOrder = new Map(steps.map((s, i) => [s.key, i]));
  inputs.sort((a, b) => ((stepOrder.get(a.step) ?? 999) - (stepOrder.get(b.step) ?? 999)) || (a.order - b.order));
  // output groups keep the order they first appear in
  const groupOrder = [];
  outputs.forEach((o) => { if (!groupOrder.includes(o.group)) groupOrder.push(o.group); });
  outputs.sort((a, b) => (groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group)) || (a.order - b.order));
  return { steps, inputs, outputs, problems };
}

// Output values -> display groups. `values`: { name: { display, raw } }.
// Names the file doesn't have are left out (an older version may lack one).
export function groupOutputs(outputs, values) {
  const groups = [];
  for (const o of outputs) {
    if (!(o.name in values)) continue;
    let g = groups.find((x) => x.name === o.group);
    if (!g) { g = { name: o.group, items: [] }; groups.push(g); }
    g.items.push({ key: o.key, label: o.label, type: o.type, level: o.level, ...values[o.name] });
  }
  return groups;
}

// A raw sheet value as a number when it is one ("12.5%" was already
// unformatted by the API, so this only guards against text/blank).
export function asNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

// The difference between two outputs, for a comparison table. Percents and
// multiples compare in points/turns; money in dollars.
export function outputDelta(type, base, other) {
  const a = asNumber(base);
  const b = asNumber(other);
  if (a === null || b === null) return null;
  const d = b - a;
  if (Math.abs(d) < 1e-9) return { value: 0, label: '-' };
  const sign = d > 0 ? '+' : '−';
  const abs = Math.abs(d);
  if (type === 'percent') return { value: d, label: `${sign}${(abs * 100).toFixed(1)} pts` };
  if (type === 'multiple') return { value: d, label: `${sign}${abs.toFixed(2)}x` };
  if (type === 'currency') {
    // thresholds sit where rounding would roll over ($999.6 -> $1K, not $1000)
    const short = abs >= 999500 ? `$${(abs / 1e6).toFixed(2)}M` : abs >= 999.5 ? `$${Math.round(abs / 1e3)}K` : `$${abs.toFixed(abs < 10 ? 2 : 0)}`;
    return { value: d, label: `${sign}${short}` };
  }
  return { value: d, label: `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}` };
}
