// The option generator (#5): try every combination of a few settings,
// solve each, then keep the ones that meet your goals, best first.
import { getAssetType } from './assetTypes';
import { solveScheme } from './solver';
import { planMetrics, yieldOf } from './results';

export const MAX_OPTIONS = 1000;

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

// Solves one option: the scheme's own settings with this combination on
// top, laid out automatically (hand placement is left out).
export function evaluateOption(boundary, scheme, combo) {
  const variant = { ...scheme, edits: undefined, overrides: { ...scheme.overrides, ...combo } };
  const r = solveScheme(boundary, variant);
  const type = getAssetType(scheme.assetType);
  const m = planMetrics(r);
  const fails = (r.checks || []).filter((c) => c.status === 'fail').map((c) => c.label);
  return {
    combo,
    yield: yieldOf(type, m).raw || 0,
    far: m?.far || 0,
    parkingRequired: m?.parkingRequired || 0,
    parkingProvided: m?.parkingProvided || 0,
    yieldOnCost: r.proforma?.yieldOnCost || 0,
    profit: r.proforma?.profit || 0,
    margin: r.proforma?.margin || 0,
    fails,
    error: r.error,
  };
}

// Runs the options a few at a time so the page stays responsive.
// onProgress(done, total); returns a cancel function.
export function runOptions(boundary, scheme, combos, { onProgress, onDone, batch = 8 }) {
  let cancelled = false;
  const out = [];
  let i = 0;
  const step = () => {
    if (cancelled) return;
    const end = Math.min(combos.length, i + batch);
    for (; i < end; i++) out.push(evaluateOption(boundary, scheme, combos[i]));
    onProgress?.(i, combos.length);
    if (i < combos.length) setTimeout(step, 0);
    else onDone(out);
  };
  setTimeout(step, 0);
  return () => { cancelled = true; };
}

// filters: { minYield, meetsParking, passesZoning, minYieldOnCost (fraction) }
export function filterAndSort(options, filters, sortBy) {
  const kept = options.filter((o) => !o.error
    && o.yield >= (filters.minYield || 0)
    && (!filters.meetsParking || o.parkingProvided >= o.parkingRequired)
    && (!filters.passesZoning || o.fails.length === 0)
    && o.yieldOnCost >= (filters.minYieldOnCost || 0));
  const key = { yield: 'yield', yieldOnCost: 'yieldOnCost', profit: 'profit' }[sortBy] || 'yield';
  return kept.sort((a, b) => b[key] - a[key] || b.yield - a.yield);
}
