import { bandIntervals, candidateAngles, makeProjection, polygonArea, scanline } from './geometry';
import { effectiveSettings } from './assetTypes';
import { solveScheme, splitByMix, SF_PER_ACRE } from './solver';

// A width x depth (feet) rectangle in Salt Lake City, as GeoJSON.
function rectSite(width, depth, lat = 40.76, lng = -111.89) {
  const ftPerDegLat = 364000;
  const ftPerDegLng = 364000 * Math.cos((lat * Math.PI) / 180);
  const dx = width / ftPerDegLng;
  const dy = depth / ftPerDegLat;
  return {
    type: 'Polygon',
    coordinates: [[[lng, lat], [lng + dx, lat], [lng + dx, lat + dy], [lng, lat + dy], [lng, lat]]],
  };
}

const scheme = (assetType, overrides = {}) => ({ id: 'a', name: 'A', assetType, overrides });

// True if every [lat, lng] corner is inside the site's bounding box
// (the test sites are axis-aligned rectangles).
function insideBox(ring, site) {
  const xs = site.coordinates[0].map((p) => p[0]);
  const ys = site.coordinates[0].map((p) => p[1]);
  const tol = 1e-7;
  return ring.every(([lat, lng]) => lng >= Math.min(...xs) - tol && lng <= Math.max(...xs) + tol
    && lat >= Math.min(...ys) - tol && lat <= Math.max(...ys) + tol);
}

test('geometry: scanline and band intervals of a square', () => {
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
  expect(scanline(sq, 50)).toEqual([[0, 100]]);
  expect(bandIntervals(sq, 10, 40)).toEqual([[0, 100]]);
  expect(bandIntervals(sq, 90, 110)).toEqual([]);
  expect(polygonArea(sq)).toBe(10000);
  // A triangle narrows as v rises, so the band is limited by its top edge.
  const tri = [[0, 0], [100, 0], [50, 100]];
  const [[a, b]] = bandIntervals(tri, 0, 50);
  expect(a).toBeCloseTo(25, 2);
  expect(b).toBeCloseTo(75, 2);
});

test('geometry: an L-shaped band skips the notch', () => {
  const ell = [[0, 0], [200, 0], [200, 50], [100, 50], [100, 100], [0, 100]];
  expect(bandIntervals(ell, 10, 40)).toEqual([[0, 200]]);
  const across = bandIntervals(ell, 30, 70);
  expect(across).toHaveLength(1);
  expect(across[0][0]).toBeCloseTo(0, 2);
  expect(across[0][1]).toBeCloseTo(100, 2);
});

test('geometry: candidate angles start with the longest edge and add its perpendicular', () => {
  const angles = candidateAngles([[0, 0], [400, 0], [400, 100], [0, 100]]);
  expect(angles[0]).toBeCloseTo(0, 6);
  expect(angles).toHaveLength(2);
  expect(angles[1]).toBeCloseTo(Math.PI / 2, 6);
});

test('projection round-trips and measures feet', () => {
  const site = rectSite(600, 400);
  const proj = makeProjection(site.coordinates[0]);
  const [x1] = proj.toFeet(site.coordinates[0][0]);
  const [x2] = proj.toFeet(site.coordinates[0][1]);
  expect(Math.abs(x2 - x1)).toBeGreaterThan(590);
  expect(Math.abs(x2 - x1)).toBeLessThan(610);
  const [lat, lng] = proj.toLatLng(proj.toFeet([-111.89, 40.76]));
  expect(lat).toBeCloseTo(40.76, 9);
  expect(lng).toBeCloseTo(-111.89, 9);
});

test('splitByMix keeps the total', () => {
  const mix = [{ name: 'A', size: 1, pct: 33 }, { name: 'B', size: 1, pct: 33 }, { name: 'C', size: 1, pct: 34 }];
  const out = splitByMix(100, mix);
  expect(out.reduce((s, u) => s + u.count, 0)).toBe(100);
  expect(splitByMix(0, mix)).toEqual([]);
});

test('overrides layer over the defaults; stale keys are ignored', () => {
  const s = effectiveSettings(scheme('mf-garden', { floors: 4, lotWidth: 99 }));
  expect(s.floors).toBe(4);
  expect(s.buildingDepth).toBe(65);
  expect(s.lotWidth).toBeUndefined();
});

test('garden multifamily on a 600 x 400 ft site meets parking and stays inside the site', () => {
  const site = rectSite(600, 400);
  const r = solveScheme(site, scheme('mf-garden'));
  expect(r.error).toBeNull();
  const m = r.metrics;
  expect(m.siteAcres).toBeCloseTo((600 * 400) / SF_PER_ACRE, 0);
  expect(m.units).toBeGreaterThan(50);
  expect(m.parkingProvided).toBeGreaterThanOrEqual(m.parkingRequired);
  expect(m.parkingRequired).toBe(Math.ceil(m.units * 1.5));
  expect(m.floors).toBe(3);
  expect(m.unitsByType.reduce((s, u) => s + u.count, 0)).toBe(m.units);
  for (const b of r.geometry.buildings) expect(insideBox(b, site)).toBe(true);
  for (const p of r.geometry.parking) expect(insideBox(p.outline, site)).toBe(true);
});

test('a tighter parking ratio never yields more units', () => {
  const site = rectSite(600, 400);
  const loose = solveScheme(site, scheme('mf-garden', { parkingRatio: 1 })).metrics.units;
  const tight = solveScheme(site, scheme('mf-garden', { parkingRatio: 2.5 })).metrics.units;
  expect(tight).toBeLessThanOrEqual(loose);
});

test('FAR and coverage caps are respected and reported', () => {
  const site = rectSite(600, 400);
  const r = solveScheme(site, scheme('mf-garden', { maxFar: 0.3 }));
  expect(r.metrics.far).toBeLessThanOrEqual(0.3 + 1e-9);
  expect(r.limits).toContain('far');
  const c = solveScheme(site, scheme('retail', { maxCoverage: 10 }));
  expect(c.metrics.coverage).toBeLessThanOrEqual(0.1 + 1e-9);
});

test('a height limit lowers the floor count', () => {
  const r = solveScheme(rectSite(600, 400), scheme('mf-garden', { maxHeight: 25 }));
  expect(r.metrics.floors).toBe(2);
  expect(r.limits).toContain('height');
});

test('podium multifamily counts structured parking', () => {
  const r = solveScheme(rectSite(500, 400), scheme('mf-podium'));
  expect(r.metrics.parkingStructured).toBeGreaterThan(0);
  expect(r.metrics.parkingProvided).toBeGreaterThanOrEqual(r.metrics.parkingRequired);
});

test('townhomes front a street and park in garages', () => {
  const r = solveScheme(rectSite(500, 400), scheme('townhome'));
  expect(r.metrics.units).toBeGreaterThan(20);
  expect(r.geometry.streets.length).toBeGreaterThan(0);
  expect(r.metrics.parkingGarage).toBe(r.metrics.units * 2);
});

test('industrial gets a building, truck court and docks', () => {
  const r = solveScheme(rectSite(800, 600), scheme('industrial'));
  expect(r.metrics.gsf).toBeGreaterThan(100000);
  expect(r.geometry.truckCourts.length).toBeGreaterThan(0);
  expect(r.metrics.docks).toBeGreaterThan(0);
  expect(r.metrics.parkingProvided).toBeGreaterThanOrEqual(r.metrics.parkingRequired);
});

test('hotel keys and surface parking only', () => {
  const r = solveScheme(rectSite(400, 300), scheme('hotel'));
  expect(r.metrics.keys).toBeGreaterThan(0);
  expect(r.metrics.parkingProvided).toBeGreaterThanOrEqual(Math.ceil(r.metrics.keys * 0.8));
  const p = solveScheme(rectSite(400, 300), scheme('parking'));
  expect(p.metrics.parkingProvided).toBeGreaterThan(200);
});

test('a fixed orientation is used as given', () => {
  const r = solveScheme(rectSite(600, 400), scheme('mf-garden', { rotation: 90 }));
  expect(r.metrics.orientationDeg).toBe(90);
});

test('no boundary, or a setback that swallows the site, explains itself', () => {
  expect(solveScheme(null, scheme('mf-garden')).error).toMatch(/Draw the site/);
  const r = solveScheme(rectSite(60, 60), scheme('mf-garden', { setback: 40 }));
  expect(r.error).toMatch(/no room/);
});

test('a band laid along an edge that is a hair off level still fills', () => {
  // The bottom edge rises 0.0005 ft across 560 ft, as a rotated rectangle's does.
  const pts = [[-280, -381.8605], [280, -381.86], [280, 381.86], [-280, 381.86]];
  const [[a, b]] = bandIntervals(pts, -381.8605, -251.8605);
  expect(b - a).toBeGreaterThan(559);
});

test('townhomes taller than the height limit lose floors, not just get a chip', () => {
  const site = rectSite(500, 400);
  const full = solveScheme(site, scheme('townhome')).metrics;
  const capped = solveScheme(site, scheme('townhome', { maxHeight: 25 }));
  expect(capped.metrics.floors).toBe(2);
  expect(capped.limits).toContain('height');
  expect(capped.metrics.footprintSf / capped.metrics.units).toBeCloseTo(900, 5);
  expect(capped.metrics.units).toBe(full.units);
  const none = solveScheme(site, scheme('townhome', { maxHeight: 5 })).metrics;
  expect(none.units).toBe(0);
});

test('industrial tries the max depth even off the 20 ft step', () => {
  const r = solveScheme(rectSite(800, 600), scheme('industrial', { minBuildingDepth: 180, maxBuildingDepth: 210, rotation: 0 }));
  // 760 ft wide inside the setback, so a 210 ft deep building is 159,600 sf.
  expect(r.metrics.footprintSf).toBeGreaterThan(200 * 760);
});

test('a huge floor count is capped rather than hanging the page', () => {
  const r = solveScheme(rectSite(600, 400), scheme('mf-garden', { floors: 1000000, parkingRatio: 0 }));
  expect(r.metrics.floors).toBeLessThanOrEqual(100);
});
