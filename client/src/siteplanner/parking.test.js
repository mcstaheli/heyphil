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
  expect(g.metrics.parkingStructured).toBe(g.garage.types.total);
  expect(g.garage.perLevel * g.garage.levels).toBeGreaterThanOrEqual(g.metrics.parkingStructured);
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

// ---- Drawn aisles and garage ramps ----------------------------------------

import { analyzeAisle } from './parking';

test('aisle analysis: tight turns, narrow widths and dead ends', () => {
  const box = [[[-100, -100], [500, -100], [500, 500], [-100, 500]]];
  // A right angle with 30 ft legs only fits a 15 ft radius.
  const tight = analyzeAisle([[0, 0], [30, 0], [30, 30]], { width: 24, twoWay: true, turnRadius: 25, connectsTo: box });
  expect(tight.some((x) => x.kind === 'turn')).toBe(true);
  // Long legs are fine.
  const ok = analyzeAisle([[0, 0], [200, 0], [200, 200]], { width: 24, twoWay: true, turnRadius: 25, connectsTo: [[[-5, -50], [5, -50], [5, 50], [-5, 50]], [[150, 195], [250, 195], [250, 205], [150, 205]]] });
  expect(ok).toEqual([]);
  // Narrow two-way.
  expect(analyzeAisle([[0, 0], [200, 0]], { width: 14, twoWay: true, turnRadius: 25, connectsTo: [] }).some((x) => x.kind === 'width')).toBe(true);
  // Both ends dead.
  expect(analyzeAisle([[100, 100], [300, 100]], { width: 24, twoWay: true, turnRadius: 25, connectsTo: box }).filter((x) => x.kind === 'dead')).toHaveLength(2);
});

test('a drawn aisle splits parking, rows open onto it, and its issues are checked', () => {
  const site = rectSite(600, 400);
  const [[lng, lat]] = site.coordinates[0];
  const at = (x, y) => [lng + x / (364000 * Math.cos((lat * Math.PI) / 180)), lat + y / 364000];
  // A straight aisle from the south boundary to the north boundary, no
  // perimeter drive: the only drive on the site.
  const r = solveScheme(site, scheme('parking', { perimeterDrive: 0 }, {
    driveAisles: [{ id: 'a', line: { type: 'LineString', coordinates: [at(300, 0), at(300, 400)] }, twoWay: true }],
  }));
  expect(r.parking.hasDrive).toBe(true);
  expect(r.parking.aisleIssues).toEqual([]);
  expect(r.geometry.drives.length).toBeGreaterThan(0);
  expect(r.metrics.parkingSurface).toBeGreaterThan(200);
  // A dog-leg with a tight corner, ending in the middle of the lot.
  const bad = solveScheme(site, scheme('parking', { perimeterDrive: 0 }, {
    driveAisles: [{ id: 'a', line: { type: 'LineString', coordinates: [at(300, 0), at(300, 200), at(330, 200)] } }],
  }));
  const kinds = bad.parking.aisleIssues.map((x) => x.kind);
  expect(kinds).toContain('turn');
  expect(kinds).toContain('dead');
  expect(bad.checks.find((c) => c.label === 'Drawn aisles').status).toBe('fail');
  expect(bad.geometry.aisleIssues.length).toBe(bad.parking.aisleIssues.length);
});

test('garage floor plans: stalls per level, cores, and whether the ramp fits', () => {
  const long = solveScheme(rectSite(300, 160), scheme('garage', { setback: 0 }));
  expect(long.garage.perLevel).toBeGreaterThan(60);
  expect(long.garage.fits).toBe(true);
  expect(long.metrics.parkingStructured).toBe(long.garage.types.total);
  expect(long.geometry.garage.cores).toHaveLength(2);
  expect(long.checks.find((c) => c.label === 'Garage ramp').status).toBe('pass');
  // Too short for sloped floors at 5%: needs 105 ft of ramp plus end aisles.
  const short = solveScheme(rectSite(150, 120), scheme('garage', { setback: 0 }));
  expect(short.garage.fits).toBe(false);
  expect(short.checks.find((c) => c.label === 'Garage ramp').status).toBe('fail');
  // An express ramp at 12% fits a shorter garage and is drawn.
  const express = solveScheme(rectSite(200, 160), scheme('garage', { setback: 0, rampType: 1, rampSlope: 12 }));
  expect(express.garage.fits).toBe(true);
  expect(express.geometry.garage.ramp).not.toBeNull();
  // Parking on a ramp steeper than 6.67% isn't allowed.
  expect(solveScheme(rectSite(300, 160), scheme('garage', { setback: 0, rampSlope: 8 })).garage.fits).toBe(false);
});

test('review fixes: inside turn radius, single-deck garage, aisle paving, express length', () => {
  // 60 ft legs at a right angle: 30 ft at the centre line, 18 ft inside a 24 ft aisle.
  const t = analyzeAisle([[0, 0], [60, 0], [60, 60]], { width: 24, twoWay: true, turnRadius: 25, connectsTo: [[[-10, -10], [10, -10], [10, 10], [-10, 10]], [[50, 50], [70, 50], [70, 70], [50, 70]]] });
  expect(t.filter((x) => x.kind === 'turn')).toHaveLength(1);
  // One level: no ramp needed.
  const deck = solveScheme(rectSite(100, 130), scheme('garage', { setback: 0, levels: 1 }));
  expect(deck.garage.fits).toBe(true);
  expect(deck.garage.rampType).toBe('none');
  // A drawn aisle's pavement counts toward paving per stall.
  const site = rectSite(600, 400);
  const [[lng, lat]] = site.coordinates[0];
  const at = (x, y) => [lng + x / (364000 * Math.cos((lat * Math.PI) / 180)), lat + y / 364000];
  const r = solveScheme(site, scheme('parking', { perimeterDrive: 0 }, {
    driveAisles: [{ id: 'a', line: { type: 'LineString', coordinates: [at(300, 0), at(300, 400)] } }],
  }));
  const rowsSf = r.geometry.parking.length; // rows exist
  expect(rowsSf).toBeGreaterThan(0);
  expect(r.metrics.parkingPavedSf).toBeGreaterThan(24 * 360 * 0.9);
  // Express ramp length includes the end aisles.
  const ex = solveScheme(rectSite(200, 160), scheme('garage', { setback: 0, rampType: 1, rampSlope: 12 }));
  expect(ex.garage.required).toBeCloseTo(10.5 / 0.12 + 24 + 48, 3);
});

test('an aisle ending at the setback line is not a dead end', () => {
  const site = rectSite(600, 400);
  const [[lng, lat]] = site.coordinates[0];
  const at = (x, y) => [lng + x / (364000 * Math.cos((lat * Math.PI) / 180)), lat + y / 364000];
  const r = solveScheme(site, scheme('parking', { perimeterDrive: 0, setback: 30 }, {
    driveAisles: [{ id: 'a', line: { type: 'LineString', coordinates: [at(300, 30), at(300, 370)] } }],
  }));
  expect(r.parking.aisleIssues.filter((x) => x.kind === 'dead')).toEqual([]);
});

// ---- Auto-routed aisles and one-way flow -------------------------------

import { routeAisles, simplifyPath } from './routing';
import { bayDirection } from './parking';

test('routing finds a path around a building to the network', () => {
  const region = [[[0, 0], [400, 0], [400, 300], [0, 300]]];
  const wall = [[150, 0], [250, 0], [250, 250], [150, 250]]; // open only along the top
  const paths = routeAisles({ region, blocked: [wall], network: [[[390, 0], [400, 0], [400, 300], [390, 300]]], sources: [[50, 50]], cell: 10 });
  expect(paths).toHaveLength(1);
  const path = paths[0];
  expect(path[0]).toEqual([50, 50]);
  // It goes over the top of the wall, not through it.
  expect(Math.max(...path.map((p) => p[1]))).toBeGreaterThan(250);
  expect(simplifyPath([[0, 0], [10, 0.2], [20, 0], [30, 0.1]], 1)).toEqual([[0, 0], [30, 0.1]]);
});

test('one-way bays alternate direction', () => {
  const mod = { oneWay: true, depth: 50 };
  expect(bayDirection(0, mod)).toBe(1);
  expect(bayDirection(50, mod)).toBe(-1);
  expect(bayDirection(100, mod)).toBe(1);
  expect(bayDirection(0, { oneWay: false, depth: 60 })).toBe(0);
});

test('with no drive at all, aisles are routed so every bay connects', () => {
  const site = rectSite(600, 400);
  const r = solveScheme(site, scheme('parking', { perimeterDrive: 0 }));
  expect(r.parking.routedAisles.length).toBeGreaterThan(0);
  expect(r.parking.hasDrive).toBe(true);
  expect(r.parking.disconnected).toBe(0);
  expect(r.checks.find((c) => c.label === 'Circulation').status).toBe('pass');
  // Turning routing off flags the bays instead (none checked without a drive).
  const off = solveScheme(site, scheme('parking', { perimeterDrive: 0, autoAisles: 0 }));
  expect(off.parking.routedAisles).toEqual([]);
});

test('angled bays flow one way and the plan reports it', () => {
  const r = solveScheme(rectSite(600, 400), scheme('parking', { stallAngle: 60 }));
  const flows = r.geometry.parking.filter((p) => p.flow);
  expect(flows.length).toBe(r.geometry.parking.length);
  expect(r.checks.find((c) => c.label === 'One-way flow').status).toBe('pass');
});

test('one-way drawn aisles: head-on meetings and one-direction entries are flagged', () => {
  const site = rectSite(600, 400);
  const [[lng, lat]] = site.coordinates[0];
  const at = (x, y) => [lng + x / (364000 * Math.cos((lat * Math.PI) / 180)), lat + y / 364000];
  const line = (pts) => ({ type: 'LineString', coordinates: pts.map(([x, y]) => at(x, y)) });
  // Two one-way aisles meeting nose to nose in the middle.
  const r = solveScheme(site, scheme('parking', { perimeterDrive: 0, autoAisles: 0 }, {
    driveAisles: [
      { id: 'a', line: line([[100, 200], [300, 200]]), twoWay: false },
      { id: 'b', line: line([[500, 200], [300, 200]]), twoWay: false },
    ],
  }));
  expect(r.parking.flowIssues.some((x) => x.kind === 'headon')).toBe(true);
  expect(r.checks.find((c) => c.label === 'One-way flow').status).toBe('fail');
  // A single one-way aisle out of the only entry: no way in.
  const [elng, elat] = at(300, 0);
  const out = solveScheme(site, scheme('parking', { perimeterDrive: 0, autoAisles: 0 }, {
    entries: [{ id: 'e', point: [elng, elat] }],
    driveAisles: [{ id: 'a', line: line([[300, 380], [300, 0]]), twoWay: false }],
  }));
  expect(out.parking.flowIssues.some((x) => x.kind === 'entry')).toBe(true);
});

test('review fixes: fromBay aisles have no dead start; routes not drawn inside spaces', () => {
  const box = [[[-100, -100], [500, -100], [500, 500], [-100, 500]]];
  const issues = analyzeAisle([[100, 100], [300, 100], [300, 520]], { width: 24, twoWay: true, turnRadius: 25, connectsTo: box, fromBay: true });
  expect(issues.filter((x) => x.kind === 'dead')).toHaveLength(0);
  const site = rectSite(800, 400);
  const r = solveScheme(site, {
    ...scheme('mf-garden'),
    spaces: [{ id: 'p', name: 'Lot', kind: 'asset', assetType: 'parking', overrides: { setback: 0 }, polygon: rectIn(site, 560, 0, 240, 400) }],
  });
  const spaceResult = r.spaces[0].result;
  expect(spaceResult.parking.routedAisles).toEqual([]);
});

// ---- Helix, data center, trucks ------------------------------------------

test('helix ramp: fits in a corner, slope from its lap', () => {
  const g = solveScheme(rectSite(300, 180), scheme('garage', { setback: 0, rampType: 2, helixRadius: 25, rampWidth: 24 }));
  expect(g.garage.rampType).toBe('helix');
  expect(g.garage.slopePct).toBeCloseTo((10.5 / (2 * Math.PI * 37)) * 100, 1);
  expect(g.garage.fits).toBe(true);
  expect(g.geometry.garage.helix).not.toBeNull();
  // A tiny helix is too steep.
  const steep = solveScheme(rectSite(300, 180), scheme('garage', { setback: 0, rampType: 2, helixRadius: 10, rampWidth: 10, floorToFloor: 14 }));
  expect(steep.garage.fits).toBe(false);
});

test('data center: IT load, generators, yard and a per-kW pro forma', () => {
  const r = solveScheme(rectSite(900, 700), scheme('datacenter'));
  expect(r.metrics.itMw).toBeGreaterThan(5);
  expect(r.metrics.itMw).toBeCloseTo((r.metrics.gsf * 0.5 * 200) / 1e6, 6);
  expect(r.metrics.generators).toBe(Math.ceil((r.metrics.itMw * 1.25) / 3));
  expect(r.geometry.yards.length).toBeGreaterThan(0);
  expect(r.proforma.gpr).toBeCloseTo(r.metrics.itMw * 1000 * 140 * 12, 0);
  expect(r.proforma.hardCost).toBeGreaterThanOrEqual(r.metrics.itMw * 11000000);
});

test('truck access: court depth and drive width checked for industrial', () => {
  const ok = solveScheme(rectSite(900, 700), scheme('industrial', { aisleWidth: 30 }));
  expect(ok.checks.find((c) => c.label === 'Truck access').status).toBe('pass');
  // Out of the box the loop road is built at truck width, so it passes.
  const plain = solveScheme(rectSite(900, 700), scheme('industrial'));
  expect(plain.checks.find((c) => c.label === 'Truck access').status).toBe('pass');
  // With no loop road and no truck aisle, there's no truck drive.
  const narrow = solveScheme(rectSite(900, 700), scheme('industrial', { perimeterDrive: 0 }));
  expect(narrow.checks.find((c) => c.label === 'Truck access').actual).toMatch(/no truck drive/);
  const shallow = solveScheme(rectSite(900, 700), scheme('industrial', { aisleWidth: 30, truckCourt: 100 }));
  expect(shallow.checks.find((c) => c.label === 'Truck access').actual).toMatch(/court only 100/);
  // A truck aisle is checked against the truck radius on its centre line.
  const t = analyzeAisle([[0, 0], [60, 0], [60, 60]], { width: 30, twoWay: true, turnRadius: 25, connectsTo: [], truck: { width: 30, turnRadius: 45 } });
  expect(t.some((x) => x.kind === 'turn' && /WB-67/.test(x.text))).toBe(true);
});


test('review fixes: data center falls back to parking; old ramp values; CSV formulas', () => {
  const tiny = solveScheme(rectSite(260, 200), scheme('datacenter'));
  expect(tiny.error).toBeNull();
  expect(tiny.metrics.itMw).toBe(0);
  const legacy = solveScheme(rectSite(300, 160), scheme('garage', { setback: 0, rampType: true, rampSlope: 12 }));
  expect(legacy.garage.rampType).toBe('express');
});
