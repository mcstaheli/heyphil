import { buildCombos, countCombos, evaluateOption, filterAndSort } from './generator';

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
