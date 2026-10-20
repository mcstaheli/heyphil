import { DEFAULT_MIX, bedsBaths, effectiveSettings } from './assetTypes';
import { buildingProgram, largestRect, layoutBuilding, placedWings, shapeWings } from './buildings';
import { solveScheme } from './solver';

function rectSite(width, depth, lat = 40.76, lng = -111.89) {
  const dx = width / (364000 * Math.cos((lat * Math.PI) / 180));
  const dy = depth / 364000;
  return { type: 'Polygon', coordinates: [[[lng, lat], [lng + dx, lat], [lng + dx, lat + dy], [lng, lat + dy], [lng, lat]]] };
}
const scheme = (assetType, overrides = {}) => ({ id: 'a', name: 'A', assetType, overrides });
const s = effectiveSettings(scheme('mf-podium'));

test('a bar lays out units both sides of the corridor, keeping the mix', () => {
  const plan = layoutBuilding([{ u0: 0, u1: 300, v0: 0, v1: 65, axis: 'u' }], s, DEFAULT_MIX, { elevators: 1 });
  expect(plan.ok).toBe(true);
  expect(plan.units).toBeGreaterThan(14);
  // Every type in the mix shows up, near its share.
  const total = plan.counts.reduce((t, c) => t + c, 0);
  DEFAULT_MIX.forEach((u, i) => {
    if (u.pct >= 10) expect(Math.abs(plan.counts[i] / total * 100 - u.pct)).toBeLessThan(15);
  });
  expect(plan.pieces.cores.filter((c) => c.kind === 'stair').length).toBeGreaterThanOrEqual(2);
  expect(plan.pieces.cores.some((c) => c.kind === 'elevator')).toBe(true);
  // Rentable area is the plate less corridor and cores.
  expect(plan.nrsf).toBeLessThan(300 * 65);
  expect(plan.nrsf / (300 * 65)).toBeGreaterThan(0.7);
});

test('too shallow for a double-loaded corridor is not a plan', () => {
  expect(layoutBuilding([{ u0: 0, u1: 200, v0: 0, v1: 30, axis: 'u' }], s, DEFAULT_MIX).ok).toBe(false);
});

test('a courtyard is four wings around an open middle', () => {
  const { wings, middle } = shapeWings('courtyard', { u0: 0, u1: 300, v0: 0, v1: 250 }, 65);
  expect(wings).toHaveLength(4);
  expect(middle.u1 - middle.u0).toBeCloseTo(300 - 130, 6);
  expect(middle.v1 - middle.v0).toBeCloseTo(250 - 130, 6);
});

test('the program adds elevators for tall buildings and takes amenity off the ground floor', () => {
  const wing = [{ u0: 0, u1: 300, v0: 0, v1: 65, axis: 'u' }];
  const low = buildingProgram(wing, s, DEFAULT_MIX, 3, { walkUp: true });
  expect(low.elevators).toBe(0);
  const tall = buildingProgram(wing, { ...s, unitsPerElevator: 40 }, DEFAULT_MIX, 6);
  expect(tall.elevators).toBeGreaterThanOrEqual(Math.ceil((tall.plan.units * 6) / 40));
  expect(tall.units).toBe(tall.plan.units * 6 - tall.amenityUnits);
});

test('largest rectangle in a square with a notch', () => {
  const rings = [[[0, 0], [400, 0], [400, 400], [0, 400]]];
  const r = largestRect(rings, { minW: 100, minH: 100, maxW: 1000, maxH: 1000, step: 10 });
  expect((r.u1 - r.u0) * (r.v1 - r.v0)).toBeGreaterThan(0.9 * 400 * 400);
});

test('a courtyard scheme lays out a shaped building with unit tabulation', () => {
  const r = solveScheme(rectSite(600, 500), scheme('mf-podium', { buildingShape: 4 }));
  expect(r.error).toBeFalsy();
  const lay = r.metrics.unitLayout;
  expect(lay).toBeTruthy();
  expect(lay.shapes).toContain('courtyard');
  expect(r.geometry.courtyards.length).toBeGreaterThan(0);
  expect(r.geometry.unitPlans[0].units.length).toBeGreaterThan(10);
  expect(lay.beds).toBeGreaterThan(r.metrics.units * 0.5);
  expect(lay.efficiency).toBeGreaterThan(0.6);
  expect(lay.efficiency).toBeLessThan(0.95);
  expect(r.metrics.unitsByType.reduce((t, u) => t + u.count, 0)).toBe(r.metrics.units);
  expect(r.totals.unitLayout.beds).toBe(lay.beds);
});

test('bars get units laid out too, and a tiny site falls back to bars', () => {
  const bars = solveScheme(rectSite(600, 400), scheme('mf-podium'));
  expect(bars.metrics.unitLayout.shapes).toEqual(['bars']);
  expect(bars.metrics.unitsByType.reduce((t, u) => t + u.count, 0)).toBe(bars.metrics.units);
  const small = solveScheme(rectSite(300, 200), scheme('mf-podium', { buildingShape: 6 }));
  expect(small.error).toBeFalsy();
  expect(small.metrics.units).toBeGreaterThan(0);
  expect(small.metrics.unitLayout.shapes).toEqual(['bars']);
});

test('garden walk-ups are short bars without elevators', () => {
  const r = solveScheme(rectSite(600, 400), scheme('mf-garden', { buildingShape: 1, floors: 3 }));
  expect(r.metrics.unitLayout.elevators).toBe(0);
  expect(r.metrics.unitLayout.shapes).toEqual(['garden']);
});

test('where wings meet, the corner stair serves both', () => {
  const { wings } = shapeWings('courtyard', { u0: 0, u1: 250, v0: 0, v1: 250 }, 65);
  const plan = layoutBuilding(wings, { ...s, stairSpacing: 1000 }, DEFAULT_MIX, { elevators: 0 });
  expect(plan.pieces.cores.filter((c) => c.kind === 'stair')).toHaveLength(4);
});

test('saved mixes without beds and baths get them from the name or size', () => {
  expect(bedsBaths({ name: '2 BR', size: 1000 })).toEqual({ beds: 2, baths: 2 });
  expect(bedsBaths({ name: 'Junior 1 bed', size: 600 })).toEqual({ beds: 1, baths: 1 });
  expect(bedsBaths({ name: 'Micro', size: 400 })).toEqual({ beds: 0, baths: 1 });
  expect(bedsBaths({ name: 'Studio', size: 500, beds: 0, baths: 1 })).toEqual({ beds: 0, baths: 1 });
});

test('a hand-placed building deeper than it is long runs its corridor the long way', () => {
  const site = rectSite(600, 600);
  const [lng0, lat0] = site.coordinates[0][0];
  const center = [lng0 + 300 / (364000 * Math.cos((40.76 * Math.PI) / 180)), lat0 + 300 / 364000];
  const r = solveScheme(site, { ...scheme('mf-podium'), edits: { buildings: [{ id: 'b', center, length: 65, depth: 300, angle: 0 }] } });
  const avg = r.metrics.unitLayout.avgUnitSf;
  expect(avg).toBeGreaterThan(600);
  expect(avg).toBeLessThan(1200);
});

test('automatic bars laid out unit by unit still meet their parking', () => {
  const r = solveScheme(rectSite(600, 400), scheme('mf-garden', { parkingRatio: 1.5 }));
  expect(r.metrics.unitLayout).toBeTruthy();
  expect(r.metrics.parkingProvided).toBeGreaterThanOrEqual(r.metrics.parkingRequired);
});

test('a hand-placed courtyard building counts its wings, not its box', () => {
  const site = rectSite(600, 600);
  const [lng0, lat0] = site.coordinates[0][0];
  const center = [lng0 + 300 / (364000 * Math.cos((40.76 * Math.PI) / 180)), lat0 + 300 / 364000];
  const box = { id: 'b', center, length: 260, depth: 220, angle: 0 };
  const rect = solveScheme(site, { ...scheme('mf-podium'), edits: { buildings: [box] } });
  const court = solveScheme(site, { ...scheme('mf-podium'), edits: { buildings: [{ ...box, shape: 'courtyard', wing: 65 }] } });
  const wings = 260 * 220 - (260 - 130) * (220 - 130);
  expect(court.metrics.footprintSf).toBeCloseTo(wings, 0);
  expect(rect.metrics.footprintSf).toBeCloseTo(260 * 220, 0);
  expect(court.geometry.buildings).toHaveLength(4);
  expect(court.metrics.unitLayout.stairs).toBeGreaterThanOrEqual(4);
  expect(court.warnings.outside).toEqual([]);
});

test('a shape too small for its wings stays a rectangle', () => {
  expect(placedWings({ length: 100, depth: 80, shape: 'courtyard', wing: 65 })).toHaveLength(1);
  expect(placedWings({ length: 300, depth: 200, shape: 'L', wing: 60 })).toHaveLength(2);
});
