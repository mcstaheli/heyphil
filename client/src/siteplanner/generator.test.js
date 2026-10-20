import { asType, buildCombos, buildRuns, countCombos, countRuns, evaluateOption, filterAndSort, regenerateSweeps } from './generator';

function rectSite(width, depth, lat = 40.76, lng = -111.89) {
  const dx = width / (364000 * Math.cos((lat * Math.PI) / 180));
  const dy = depth / 364000;
  return { type: 'Polygon', coordinates: [[[lng, lat], [lng + dx, lat], [lng + dx, lat + dy], [lng, lat + dy], [lng, lat]]] };
}

test('buildCombos: every combination, steps without float drift', () => {
  const combos = buildCombos([{ key: 'floors', from: 2, to: 4, step: 1 }, { key: 'parkingRatio', from: 1.1, to: 1.3, step: 0.1 }]);
  expect(combos).toHaveLength(9);
  expect(combos.map((c) => c.parkingRatio)).toContain(1.2);
  expect(combos.every((c) => [1.1, 1.2, 1.3].includes(c.parkingRatio))).toBe(true);
  expect(countCombos([{ from: 2, to: 4, step: 1 }, { from: 1.1, to: 1.3, step: 0.1 }])).toBe(9);
  expect(buildCombos([{ key: 'floors', from: 5, to: 3, step: 1 }]).map((c) => c.floors)).toEqual([3, 4, 5]);
});

test('options solve, filter by goals and sort best first', () => {
  const site = rectSite(600, 400);
  const scheme = { id: 'a', name: 'A', assetType: 'mf-garden', overrides: {} };
  const t0 = Date.now();
  const options = buildCombos([{ key: 'floors', from: 1, to: 4, step: 1 }]).map((c) => evaluateOption(site, scheme, c));
  const perOption = (Date.now() - t0) / options.length;
  expect(perOption).toBeLessThan(200); // fast enough to run hundreds in the browser
  const byYield = filterAndSort(options, { meetsParking: true }, 'yield');
  expect(byYield.length).toBeGreaterThan(0);
  for (let i = 1; i < byYield.length; i++) expect(byYield[i - 1].yield).toBeGreaterThanOrEqual(byYield[i].yield);
  expect(byYield.every((o) => o.parkingProvided >= o.parkingRequired)).toBe(true);
  const none = filterAndSort(options, { minYield: 1e9 }, 'yield');
  expect(none).toHaveLength(0);
  const capped = filterAndSort(
    buildCombos([{ key: 'floors', from: 1, to: 4, step: 1 }]).map((c) => evaluateOption(site, { ...scheme, overrides: { maxFar: 0.5 } }, c)),
    { passesZoning: true },
    'yield'
  );
  expect(capped.every((o) => o.far <= 0.5 + 1e-9)).toBe(true);
});

test('an option ignores hand placement and keeps the scheme other settings', () => {
  const site = rectSite(600, 400);
  const o = evaluateOption(site, {
    id: 'a', name: 'A', assetType: 'mf-garden', overrides: { parkingRatio: 1 },
    edits: { buildings: [{ id: 'b', center: [-111.889, 40.7605], length: 100, depth: 65, angle: 0 }] },
  }, { floors: 2 });
  expect(o.yield).toBeGreaterThan(30);
  expect(o.parkingRequired).toBe(Math.ceil(o.yield * 1));
});

test('a choice sweeps every option', () => {
  const combos = buildCombos([{ key: 'stallAngle', values: [90, 60, 45] }, { key: 'floors', from: 2, to: 3, step: 1 }]);
  expect(combos).toHaveLength(6);
  expect(countCombos([{ key: 'stallAngle', values: [90, 60, 45] }, { from: 2, to: 3, step: 1 }])).toBe(6);
  expect(new Set(combos.map((c) => c.stallAngle))).toEqual(new Set([90, 60, 45]));
});

test('a run across asset types sweeps each type only on settings it has', () => {
  const sweeps = [{ key: 'floors', from: 2, to: 3, step: 1 }, { key: 'lotWidth', from: 20, to: 30, step: 10 }];
  const runs = buildRuns(sweeps, ['mf-garden', 'townhome', 'parking']);
  // garden: floors x2; townhome: floors x2 and lot width x2; parking: neither, one run
  expect(runs.filter((r) => r.assetType === 'mf-garden')).toHaveLength(2);
  expect(runs.filter((r) => r.assetType === 'townhome')).toHaveLength(4);
  expect(runs.filter((r) => r.assetType === 'parking')).toHaveLength(1);
  expect(runs.find((r) => r.assetType === 'mf-garden').combo.lotWidth).toBeUndefined();
  expect(countRuns(sweeps, ['mf-garden', 'townhome', 'parking'])).toBe(runs.length);
});

test('another type uses the settings it shares and skips sweeps it has no use for', () => {
  const s = asType({ id: 'a', assetType: 'mf-garden', overrides: { maxFar: 2, buildingShape: 4, setback: 15 } }, 'industrial');
  expect(s.assetType).toBe('industrial');
  expect(s.overrides.maxFar).toBe(2);
  // Townhomes have no surface parking to turn: one run, not twelve.
  const runs = buildRuns([{ key: 'parkingRotation', from: 0, to: 165, step: 15 }], ['mf-garden', 'townhome']);
  expect(runs.filter((r) => r.assetType === 'townhome')).toHaveLength(1);
  expect(runs.filter((r) => r.assetType === 'mf-garden')).toHaveLength(12);
});

test('goals on any measure, sorting either way', () => {
  const site = rectSite(600, 400);
  const scheme = { id: 'a', name: 'A', assetType: 'mf-garden', overrides: {} };
  const options = buildCombos([{ key: 'floors', from: 1, to: 4, step: 1 }]).map((c) => evaluateOption(site, scheme, c));
  expect(options[0].measures.totalCost).toBeGreaterThan(0);
  const short = filterAndSort(options, { rules: [{ measure: 'heightFt', op: 'max', value: 25 }] }, 'yield');
  expect(short.every((o) => o.measures.heightFt <= 25)).toBe(true);
  const cheapest = filterAndSort(options, {}, 'totalCost');
  for (let i = 1; i < cheapest.length; i++) expect(cheapest[i - 1].measures.totalCost).toBeLessThanOrEqual(cheapest[i].measures.totalCost);
  const mixed = buildRuns([{ key: 'floors', from: 2, to: 2, step: 1 }], ['mf-garden', 'retail'])
    .map((r) => evaluateOption(site, scheme, r.combo, r.assetType));
  expect(new Set(mixed.map((o) => o.assetType))).toEqual(new Set(['mf-garden', 'retail']));
});

test('regenerate narrows around an option at finer steps', () => {
  const next = regenerateSweeps(
    [{ key: 'parkingRatio', from: 1, to: 2, step: 0.5 }, { key: 'floors', from: 1, to: 5, step: 1 }, { key: 'stallAngle', values: [90, 60, 45] }],
    { combo: { parkingRatio: 1.5, floors: 3, stallAngle: 60 } },
  );
  expect(next[0]).toEqual({ key: 'parkingRatio', from: 1, to: 2, step: 0.25 });
  expect(next[1]).toEqual({ key: 'floors', from: 2, to: 4, step: 1 });
  expect(next[2]).toEqual({ key: 'stallAngle', values: [60] });
  // Never below the old range (or one floor).
  const low = regenerateSweeps([{ key: 'floors', from: 1, to: 4, step: 1 }], { combo: { floors: 1 } });
  expect(low[0]).toEqual({ key: 'floors', from: 1, to: 2, step: 1 });
});
