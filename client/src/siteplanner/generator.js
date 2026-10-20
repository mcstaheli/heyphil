// The option generator: try every combination of a few settings - across
// one or more asset types - solve each, then keep the ones that meet your
// goals, best first. Any measure can be a goal or the sort, and an option
// you like can be regenerated around with finer steps.
import { defaultsFor, getAssetType } from './assetTypes';
import { hasSurfaceParking, solveScheme } from './solver';
import { planMetrics, yieldOf } from './results';

export const MAX_OPTIONS = 1000;

// What an option is measured by. better: which way is good (for the sort
// and the chart). kind: how it's shown.
export const MEASURES = [
  { key: 'yield', label: 'Yield (units, keys, sf…)', kind: 'int', better: 'high' },
  { key: 'units', label: 'Units', kind: 'int', better: 'high' },
  { key: 'keys', label: 'Hotel keys', kind: 'int', better: 'high' },
  { key: 'nsf', label: 'Net / leasable sf', kind: 'int', better: 'high' },
  { key: 'gsf', label: 'Gross sf', kind: 'int', better: 'high' },
  { key: 'buildingCount', label: 'Buildings', kind: 'int', better: 'low' },
  { key: 'floors', label: 'Floors', kind: 'int', better: 'low' },
  { key: 'heightFt', label: 'Height (ft)', kind: 'int', better: 'low' },
  { key: 'far', label: 'FAR', kind: 'dec', better: 'high' },
  { key: 'coverage', label: 'Lot coverage', kind: 'pct', better: 'low' },
  { key: 'density', label: 'Density (per acre)', kind: 'dec', better: 'high' },
  { key: 'efficiency', label: 'Efficiency (net / gross)', kind: 'pct', better: 'high' },
  { key: 'beds', label: 'Bedrooms', kind: 'int', better: 'high' },
  { key: 'parkingProvided', label: 'Stalls provided', kind: 'int', better: 'high' },
  { key: 'parkingRequired', label: 'Stalls required', kind: 'int', better: 'low' },
  { key: 'parkingSurplus', label: 'Stall surplus', kind: 'int', better: 'high' },
  { key: 'totalCost', label: 'Total cost', kind: 'money', better: 'low' },
  { key: 'profit', label: 'Profit', kind: 'money', better: 'high' },
  { key: 'yieldOnCost', label: 'Yield on cost', kind: 'pct', better: 'high' },
  { key: 'margin', label: 'Margin', kind: 'pct', better: 'high' },
];
export const measureOf = (key) => MEASURES.find((x) => x.key === key) || MEASURES[0];

// Every combination of the sweeps ([{ key, from, to, step }], or
// [{ key, values }] for a choice like stall angle), as override objects.
// Values are rounded to the step's decimals so 0.1 steps don't drift
// (0.30000000000000004).
export function buildCombos(sweeps) {
  const lists = sweeps.map(({ key, from, to, step, values: fixed }) => {
    if (Array.isArray(fixed)) return fixed.map((v) => [key, v]);
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const st = step > 0 ? step : 1;
    const decimals = (String(st).split('.')[1] || '').length;
    const values = [];
    for (let v = lo; v <= hi + 1e-9 && values.length <= MAX_OPTIONS; v += st) values.push(Number(v.toFixed(decimals)));
    return values.map((v) => [key, v]);
  });
  let combos = [{}];
  for (const list of lists) {
    const next = [];
    for (const c of combos) for (const [k, v] of list) next.push({ ...c, [k]: v });
    combos = next;
    if (combos.length > MAX_OPTIONS * 4) break; // the caller refuses these anyway
  }
  return combos;
}

export function countCombos(sweeps) {
  return sweeps.reduce((n, { from, to, step, values }) => {
    if (Array.isArray(values)) return n * values.length;
    const st = step > 0 ? step : 1;
    return n * (Math.floor((Math.abs(to - from) + 1e-9) / st) + 1);
  }, 1);
}

// The settings a sweep can change for a type: its settings, less parking
// orientation where there's no surface parking to turn.
export function settingKeys(type) {
  const keys = new Set(Object.keys(defaultsFor(type)));
  if (!hasSurfaceParking(type)) keys.delete('parkingRotation');
  return keys;
}

// The runs for a set of asset types: each type with every combination of
// the sweeps it has settings for. A sweep a type doesn't take is left out
// for it, so the same combination isn't solved twice.
export function buildRuns(sweeps, typeIds) {
  const runs = [];
  for (const id of typeIds) {
    const keys = settingKeys(getAssetType(id));
    const own = sweeps.filter((sw) => keys.has(sw.key));
    for (const combo of buildCombos(own)) runs.push({ assetType: id, combo });
    if (runs.length > MAX_OPTIONS * 4) break;
  }
  return runs;
}

export const countRuns = (sweeps, typeIds) => typeIds.reduce((n, id) => {
  const keys = settingKeys(getAssetType(id));
  return n + countCombos(sweeps.filter((sw) => keys.has(sw.key)));
}, 0);

// The scheme as another asset type: the settings that type also takes
// (zoning, setbacks, parking dimensions…) apply; the rest stay stored but
// are ignored, as when switching type by hand (effectiveSettings).
export function asType(scheme, assetType) {
  if (!assetType || assetType === scheme.assetType) return scheme;
  return { ...scheme, assetType };
}

// Solves one option: the scheme's own settings (as assetType) with this
// combination on top, laid out automatically (hand placement is left out).
export function evaluateOption(boundary, scheme, combo, assetType = scheme.assetType) {
  const base = asType(scheme, assetType);
  const variant = { ...base, edits: undefined, overrides: { ...base.overrides, ...combo } };
  const r = solveScheme(boundary, variant);
  const type = getAssetType(assetType);
  const m = planMetrics(r) || {};
  const pf = r.proforma || {};
  const fails = (r.checks || []).filter((c) => c.status === 'fail').map((c) => c.label);
  const measures = {
    yield: yieldOf(type, m).raw || 0,
    units: m.units || 0,
    keys: m.keys || 0,
    nsf: m.nsf || 0,
    gsf: m.gsf || 0,
    buildingCount: m.buildingCount || 0,
    floors: m.floors || 0,
    heightFt: m.heightFt || 0,
    far: m.far || 0,
    coverage: m.coverage || 0,
    density: m.density || 0,
    efficiency: m.unitLayout ? m.unitLayout.efficiency : (m.gsf > 0 ? (m.nsf || 0) / m.gsf : 0),
    beds: m.unitLayout ? m.unitLayout.beds : 0,
    parkingProvided: m.parkingProvided || 0,
    parkingRequired: m.parkingRequired || 0,
    parkingSurplus: (m.parkingProvided || 0) - (m.parkingRequired || 0),
    totalCost: pf.totalCost || 0,
    profit: pf.profit || 0,
    yieldOnCost: pf.yieldOnCost || 0,
    margin: pf.margin || 0,
  };
  return {
    combo,
    assetType,
    measures,
    // The common ones at the top level, as before.
    yield: measures.yield,
    far: measures.far,
    parkingRequired: measures.parkingRequired,
    parkingProvided: measures.parkingProvided,
    yieldOnCost: measures.yieldOnCost,
    profit: measures.profit,
    margin: measures.margin,
    fails,
    error: r.error,
  };
}

// Runs the options a few at a time so the page stays responsive. runs:
// [{ assetType, combo }] (or bare combos, for the scheme's own type).
// onProgress(done, total); returns a cancel function.
export function runOptions(boundary, scheme, runs, { onProgress, onDone, batch = 8 }) {
  let cancelled = false;
  const out = [];
  let i = 0;
  const step = () => {
    if (cancelled) return;
    const end = Math.min(runs.length, i + batch);
    for (; i < end; i++) {
      const run = runs[i].combo ? runs[i] : { combo: runs[i], assetType: scheme.assetType };
      out.push(evaluateOption(boundary, scheme, run.combo, run.assetType));
    }
    onProgress?.(i, runs.length);
    if (i < runs.length) setTimeout(step, 0);
    else onDone(out);
  };
  setTimeout(step, 0);
  return () => { cancelled = true; };
}

// Whether an option meets the goals. filters: { minYield, meetsParking,
// passesZoning, minYieldOnCost (fraction), rules: [{ measure, op: 'min' |
// 'max', value }] } (percent measures as fractions).
export function meetsGoals(o, filters) {
  if (o.error) return false;
  const v = (k) => (o.measures ? o.measures[k] : o[k]) || 0;
  // An option that builds nothing is never a result (it would top any
  // lowest-first sort).
  if (!(v('yield') > 0)) return false;
  if (v('yield') < (filters.minYield || 0)) return false;
  if (filters.meetsParking && o.parkingProvided < o.parkingRequired) return false;
  if (filters.passesZoning && o.fails.length) return false;
  if (o.yieldOnCost < (filters.minYieldOnCost || 0)) return false;
  for (const rule of filters.rules || []) {
    if (!Number.isFinite(rule.value)) continue;
    if (rule.op === 'max' ? v(rule.measure) > rule.value + 1e-9 : v(rule.measure) < rule.value - 1e-9) return false;
  }
  return true;
}

// The options that meet the goals, best first by sortBy (a measure key);
// dir 'asc' puts the lowest first.
// Ties go to profit when the options are of different types (their
// yields count different things), to yield otherwise.
export function filterAndSort(options, filters, sortBy, dir) {
  const key = measureOf(sortBy).key;
  const down = (dir || (measureOf(key).better === 'low' ? 'asc' : 'desc')) === 'desc';
  const v = (o, k) => (o.measures ? o.measures[k] : o[k]) || 0;
  const tie = new Set(options.map((o) => o.assetType)).size > 1 ? 'profit' : 'yield';
  return options.filter((o) => meetsGoals(o, filters))
    .sort((a, b) => (down ? v(b, key) - v(a, key) : v(a, key) - v(b, key)) || v(b, tie) - v(a, tie));
}

// Sweeps for a second, finer look around an option: each range narrows to
// one old step either side of the option's value (inside the old range),
// at half the step; a choice keeps only the option's pick. sweeps: the
// ones that produced the option.
export function regenerateSweeps(sweeps, option) {
  return sweeps.map((sw) => {
    if (!(sw.key in option.combo)) return sw;
    const v = option.combo[sw.key];
    if (Array.isArray(sw.values)) return { key: sw.key, values: [v] };
    const decimals = (String(sw.step).split('.')[1] || '').length;
    const half = Number((sw.step / 2).toFixed(Math.min(4, decimals + 1)));
    const step = sw.key === 'floors' || sw.step === 1 ? 1 : (half > 0 ? half : sw.step);
    const lo = Math.max(Math.min(sw.from, sw.to), sw.key === 'floors' ? 1 : 0);
    const hi = Math.max(sw.from, sw.to);
    const from = Math.max(lo, Number((v - sw.step).toFixed(4)));
    const to = Math.min(hi, Number((v + sw.step).toFixed(4)));
    return { key: sw.key, from, to, step };
  });
}
