import { solveScheme } from './solver';
import { findStall } from './SelectionBar';

function rectSite(width, depth, lat = 40.76, lng = -111.89) {
  const dx = width / (364000 * Math.cos((lat * Math.PI) / 180));
  const dy = depth / 364000;
  return { type: 'Polygon', coordinates: [[[lng, lat], [lng + dx, lat], [lng + dx, lat + dy], [lng, lat + dy], [lng, lat]]] };
}
const lot = (stallEdits) => solveScheme(rectSite(400, 300), { id: 'a', name: 'A', assetType: 'parking', overrides: {}, stallEdits });

test('a stall changed by hand changes on the map and in the counts', () => {
  const before = lot();
  const bay = before.geometry.parking[3];
  const slot = bay.slots.find((x) => x.kind === 'standard');
  const at = [slot.center[1], slot.center[0]];
  expect(findStall(before.geometry.parking, slot.center).slot.center).toEqual(slot.center);

  const removed = lot([{ point: at, kind: 'removed' }]);
  expect(removed.totals.parkingSurface).toBe(before.totals.parkingSurface - 1);
  expect(findStall(removed.geometry.parking, slot.center).slot.kind).toBe('removed');

  const ev = lot([{ point: at, kind: 'ev' }]);
  expect(findStall(ev.geometry.parking, slot.center).slot).toMatchObject({ kind: 'ev', byHand: true });
  expect(ev.totals.stallTypes.ev).toBeGreaterThanOrEqual(1);
  expect(ev.totals.parkingSurface).toBe(before.totals.parkingSurface);
});

test('accessible stalls marked by hand count toward the requirement', () => {
  const before = lot();
  const required = before.totals.stallTypes.ada;
  // Mark one far-off stall accessible: the automatic ones drop by one.
  const bays = before.geometry.parking;
  const slot = bays[bays.length - 1].slots.find((x) => x.kind === 'standard');
  const r = lot([{ point: [slot.center[1], slot.center[0]], kind: 'van' }]);
  expect(findStall(r.geometry.parking, slot.center).slot.kind).toBe('van');
  expect(r.parking.adaPlaced).toBe(required);
  expect(r.geometry.parking.reduce((t, b) => t + b.ada.length, 0)).toBe(required);
});

test('more accessible stalls than required count as accessible, and vans are placed', () => {
  const before = lot();
  expect(before.geometry.parking.reduce((t, b) => t + b.van.length, 0)).toBe(before.totals.stallTypes.van);
  const slots = before.geometry.parking.flatMap((b) => b.slots).filter((x) => x.kind === 'standard').slice(0, before.totals.stallTypes.ada + 3);
  const r = lot(slots.map((x) => ({ point: [x.center[1], x.center[0]], kind: 'ada' })));
  const t = r.totals.stallTypes;
  expect(t.ada).toBe(slots.length);
  expect(t.standard + t.ada + t.compact).toBe(t.total);
  expect(r.checks.find((c) => c.label === 'Accessible stalls').limit).toMatch(new RegExp(`^${before.totals.stallTypes.ada} required`));
});

test('a bay taken over as a parking area keeps its stalls', () => {
  const site = rectSite(400, 300);
  const before = lot();
  const bay = before.geometry.parking[2];
  const ring = bay.outline.map(([lat, lng]) => [lng, lat]);
  // Grown 1.5 ft as the editor does.
  const cx = ring.reduce((t, p) => t + p[0], 0) / 4;
  const cy = ring.reduce((t, p) => t + p[1], 0) / 4;
  const grown = ring.map(([x, y]) => [x + Math.sign(x - cx) * 1.5 / 280000, y + Math.sign(y - cy) * 1.5 / 364000]);
  const r = solveScheme(site, {
    id: 'a', name: 'A', assetType: 'parking', overrides: {},
    parkingAreas: [{ id: 'p', polygon: { type: 'Polygon', coordinates: [[...grown, grown[0]]] }, angle: Math.round(bay.angleExact * 1000) / 1000 }],
  });
  const area = r.parking.areas.find((a) => a.id === 'p');
  expect(area.stalls).toBeGreaterThanOrEqual(bay.stallCount - 2);
});

test('a park is planted, counted as open space, and kept free of buildings and parking', () => {
  const site = rectSite(500, 400);
  const [lng0, lat0] = site.coordinates[0][0];
  const ft = (x, y) => [lng0 + x / (364000 * Math.cos((40.76 * Math.PI) / 180)), lat0 + y / 364000];
  const park = { type: 'Polygon', coordinates: [[ft(150, 150), ft(300, 150), ft(300, 250), ft(150, 250), ft(150, 150)]] };
  const r = solveScheme(site, { id: 'a', name: 'A', assetType: 'mf-garden', overrides: {}, spaces: [{ id: 'p', name: 'Park', kind: 'green', polygon: park }] });
  expect(r.totals.openSpaceSf).toBeGreaterThan(150 * 100 * 0.95);
  expect(r.trees.length).toBeGreaterThan(10);
  const [x0, y0] = ft(150, 150);
  const [x1, y1] = ft(300, 250);
  const inPark = ([lat, lng]) => lng > x0 + 1e-6 && lng < x1 - 1e-6 && lat > y0 + 1e-6 && lat < y1 - 1e-6;
  expect(r.geometry.buildings.every((ring) => !ring.some(inPark))).toBe(true);
  expect(r.trees.filter(inPark).length).toBeGreaterThan(5);
});
