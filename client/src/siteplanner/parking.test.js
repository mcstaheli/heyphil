import { adaRequired, bestOrientation, islandSlots, layBay, netStalls, parkingModule, sharedRequirement, stallTypes } from './parking';
import { defaultsFor, getAssetType } from './assetTypes';
import { solveScheme } from './solver';

const base = { ...defaultsFor(getAssetType('parking')) };

function rectSite(width, depth, lat = 40.76, lng = -111.89) {
  const dx = width / (364000 * Math.cos((lat * Math.PI) / 180));
  const dy = depth / 364000;
  return { type: 'Polygon', coordinates: [[[lng, lat], [lng + dx, lat], [lng + dx, lat + dy], [lng, lat + dy], [lng, lat]]] };
}
function rectIn(site, x0, y0, w, h) {
  const [[lng, lat]] = site.coordinates[0];
  const fx = 364000 * Math.cos((lat * Math.PI) / 180);
  const p = (x, y) => [lng + x / fx, lat + y / 364000];
  return { type: 'Polygon', coordinates: [[p(x0, y0), p(x0 + w, y0), p(x0 + w, y0 + h), p(x0, y0 + h), p(x0, y0)]] };
}
const scheme = (assetType, overrides = {}, extra = {}) => ({ id: 'a', name: 'A', assetType, overrides, ...extra });

test('stall modules: 90° two-way and angled one-way geometry', () => {
  const m90 = parkingModule(base, 90);
  expect(m90.depth).toBe(60);
  expect(m90.pitch).toBe(9);
  const m60 = parkingModule(base, 60);
  expect(m60.depth).toBeCloseTo(2 * (18 * Math.sin(Math.PI / 3) + 9 * 0.5) + 18, 6);
  expect(m60.pitch).toBeCloseTo(9 / Math.sin(Math.PI / 3), 6);
  expect(m60.oneWay).toBe(true);
  const m45 = parkingModule(base, 45);
  expect(m45.depth).toBeLessThan(m60.depth);
  // Compact stalls narrow the average pitch.
  expect(parkingModule({ ...base, compactPct: 50 }, 90).pitch).toBeCloseTo(8.5, 6);
});

test('islands: every N stalls and at the ends', () => {
  expect([...islandSlots(20, { islandEvery: 9, endIslands: 0 })]).toEqual([9, 19]);
  expect([...islandSlots(10, { islandEvery: 0, endIslands: 1 })].sort((a, b) => a - b)).toEqual([0, 9]);
  const sq = [[[0, 0], [300, 0], [300, 60], [0, 60]]];
  const plain = layBay(sq, 0, base, parkingModule(base, 90));
  const withIslands = layBay(sq, 0, { ...base, islandEvery: 10 }, parkingModule(base, 90));
  expect(plain.stalls).toBe(2 * 33);
  expect(withIslands.stalls).toBeLessThan(plain.stalls);
});

test('ADA counts follow the 208.2 table; they cost half a stall each', () => {
  expect(adaRequired(0)).toBe(0);
  expect(adaRequired(25)).toBe(1);
  expect(adaRequired(26)).toBe(2);
  expect(adaRequired(450)).toBe(9);
  expect(adaRequired(800)).toBe(16);
  expect(adaRequired(1250)).toBe(23);
  expect(netStalls(100)).toBe(98);
  const t = stallTypes(200, { compactPct: 10, evPct: 5 });
  expect(t.ada).toBe(6);
  expect(t.van).toBe(1);
  expect(t.standard + t.compact + t.ada).toBe(t.total);
  expect(t.ev).toBe(Math.ceil(t.total * 0.05));
});

test('best orientation lines bays up with a rotated lot', () => {
  // A 400 x 120 ft strip rotated 30°: the best angle should be ~30°.
  const a = (30 * Math.PI) / 180;
  const pts = [[0, 0], [400, 0], [400, 120], [0, 120]].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  const best = bestOrientation([pts], base, parkingModule(base, 90));
  const deg = ((best.angle * 180) / Math.PI) % 180;
  expect(Math.min(Math.abs(deg - 30), Math.abs(deg - 120))).toBeLessThan(1);
  expect(best.stalls).toBeGreaterThanOrEqual(2 * 2 * 44);
  const fixed = bestOrientation([pts], base, parkingModule(base, 90), { fixedDeg: 75 });
  expect(fixed.stalls).toBeLessThan(best.stalls);
});

test('shared parking: mixed uses need less than the sum', () => {
  const r = sharedRequirement([{ typeId: 'mf-garden', required: 300 }, { typeId: 'retail', required: 100 }]);
  expect(r.shared).toBe(true);
  expect(r.raw).toBe(400);
  expect(r.required).toBeLessThan(400);
  expect(r.required).toBe(Math.ceil(Math.max(300 * 0.6 + 100 * 0.95, 300 * 0.95 + 100 * 0.7, 300 * 0.7 + 100, 300 * 0.95 + 100 * 0.65)));
  expect(sharedRequirement([{ typeId: 'mf-garden', required: 300 }]).shared).toBe(false);
  expect(sharedRequirement([{ typeId: 'mf-garden', required: 100 }, { typeId: 'townhome', required: 40 }]).required).toBe(140);
});

test('parking-only lots pick their own best orientation and connect to the drive', () => {
  const r = solveScheme(rectSite(500, 300), scheme('parking'));
  expect(r.parking.perimeterDrive).toBe(true);
  expect(r.parking.disconnected).toBe(0);
  expect(r.metrics.parkingSurface).toBeGreaterThan(150);
  expect(r.geometry.drives.length).toBeGreaterThan(0);
  expect(r.geometry.entries).toHaveLength(1);
  expect(r.geometry.entries[0].reaches).toBe(true);
  expect(r.checks.find((c) => c.label === 'Circulation').status).toBe('pass');
  // A fixed angle is honoured.
  const fixed = solveScheme(rectSite(500, 300), scheme('parking', { parkingRotation: 45 }));
  expect(fixed.metrics.parkingOrientationDeg).toBe(45);
  // Angled stalls change the count and show their angle.
  const angled = solveScheme(rectSite(500, 300), scheme('parking', { stallAngle: 60 }));
  expect(angled.parking.stallAngle).toBe(60);
  expect(angled.metrics.parkingSurface).not.toBe(r.metrics.parkingSurface);
});

test('a bigger parking area takes ground from the buildings', () => {
  const site = rectSite(700, 450);
  const small = solveScheme(site, scheme('mf-garden', {}, { parkingAreas: [{ id: 'p', polygon: rectIn(site, 0, 0, 150, 450), angle: 'auto' }] }));
  const big = solveScheme(site, scheme('mf-garden', {}, { parkingAreas: [{ id: 'p', polygon: rectIn(site, 0, 0, 350, 450), angle: 'auto' }] }));
  expect(big.metrics.footprintSf).toBeLessThan(small.metrics.footprintSf);
  expect(big.parking.areas[0].stalls).toBeGreaterThan(small.parking.areas[0].stalls);
  // A fixed area angle is used.
  const fixed = solveScheme(site, scheme('mf-garden', {}, { parkingAreas: [{ id: 'p', polygon: rectIn(site, 0, 0, 350, 450), angle: 30 }] }));
  expect(fixed.parking.areas[0].orientationDeg).toBe(30);
});

test('leftover ground is parked too, and accessible stalls are drawn', () => {
  const r = solveScheme(rectSite(600, 400), scheme('mf-garden'));
  expect(r.parking.types.ada).toBeGreaterThan(0);
  const drawnAda = r.geometry.parking.reduce((n, p) => n + p.ada.length, 0);
  expect(drawnAda).toBe(r.parking.types.ada);
  expect(r.parking.sfPerStall).toBeGreaterThan(250);
  expect(r.parking.sfPerStall).toBeLessThan(600);
});

test('an entry placed far from the drive fails circulation', () => {
  const site = rectSite(600, 400);
  const [[lng, lat]] = site.coordinates[0];
  // In the middle of the site, nowhere near the boundary.
  const r = solveScheme(site, scheme('parking', {}, { entries: [{ id: 'e', point: [lng + 300 / (364000 * Math.cos((lat * Math.PI) / 180)), lat + 200 / 364000] }] }));
  expect(r.parking.entries[0].reaches).toBe(false);
  expect(r.checks.find((c) => c.label === 'Circulation').status).toBe('fail');
});

test('industrial adds trailer stalls; a garage counts structured stalls', () => {
  const ind = solveScheme(rectSite(900, 700), scheme('industrial'));
  expect(ind.totals.trailerRequired).toBeGreaterThan(0);
  expect(ind.totals.trailerStalls).toBeGreaterThanOrEqual(ind.totals.trailerRequired);
  expect(ind.geometry.trailers.length).toBeGreaterThan(0);
  const g = solveScheme(rectSite(300, 200), scheme('garage'));
  expect(g.metrics.parkingStructured).toBe(Math.floor((g.metrics.buildableSf * 4) / 330));
  expect(g.proforma.hardCost).toBeCloseTo(g.metrics.parkingStructured * 30000, 0);
});

test('mixed use reports shared parking in the check', () => {
  const site = rectSite(800, 400);
  const r = solveScheme(site, {
    ...scheme('mf-garden'),
    spaces: [{ id: 'r', name: 'Retail', kind: 'asset', assetType: 'retail', overrides: { setback: 0 }, polygon: rectIn(site, 560, 0, 240, 400) }],
  });
  expect(r.totals.sharedParking).toBe(true);
  expect(r.totals.parkingRequired).toBeLessThan(r.totals.parkingRequiredRaw);
  expect(r.checks.find((c) => c.label === 'Parking').limit).toMatch(/shared/);
});

test('review fixes: trailer fallback, ADA shortfall, garage limits, angled rows stay inside', () => {
  // A site too shallow for a trailer row still gets a warehouse.
  const ind = solveScheme(rectSite(800, 470), scheme('industrial'));
  expect(ind.metrics.gsf).toBeGreaterThan(0);
  // Rows packed with islands can't hold every accessible stall.
  const tight = solveScheme(rectSite(140, 140), scheme('parking', { islandEvery: 1, endIslands: 1, perimeterDrive: 0, setback: 0 }));
  const ada = tight.checks.find((c) => c.label === 'Accessible stalls');
  if (tight.parking.adaPlaced < tight.parking.types.ada) expect(ada.status).toBe('fail');
  // A garage over the height limit loses levels.
  const g = solveScheme(rectSite(300, 200), scheme('garage', { maxHeight: 35 }));
  expect(g.metrics.floors).toBe(3);
  expect(g.limits).toContain('height');
  // 45° stripes start inside the row outline.
  const m45 = parkingModule(base, 45);
  expect(m45.endLoss).toBeCloseTo(m45.proj / Math.tan(Math.PI / 4), 6);
});

test('shared parking lets the main layout build more', () => {
  const site = rectSite(800, 400);
  const withRetail = (shared) => solveScheme(site, {
    ...scheme('mf-garden', { sharedParking: shared, parkingRatio: 2 }),
    spaces: [{ id: 'r', name: 'Retail', kind: 'asset', assetType: 'retail', overrides: { setback: 0 }, polygon: rectIn(site, 560, 0, 240, 400) }],
  });
  const on = withRetail(1);
  const off = withRetail(0);
  expect(on.totals.units).toBeGreaterThanOrEqual(off.totals.units);
  expect(on.totals.parkingProvided).toBeGreaterThanOrEqual(on.totals.parkingRequired);
});
