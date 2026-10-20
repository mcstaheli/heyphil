import { analyzeTerrain, fetchElevations, samplePoints } from './terrain';
import { makeProjection } from './geometry';

const lat = 40.76;
const lng = -111.89;
const fx = 364000 * Math.cos((lat * Math.PI) / 180);
const site = { type: 'Polygon', coordinates: [[[lng, lat], [lng + 600 / fx, lat], [lng + 600 / fx, lat + 400 / 364000], [lng, lat + 400 / 364000], [lng, lat]]] };

test('samples fall inside the site', () => {
  const pts = samplePoints(site, 30);
  expect(pts.length).toBeGreaterThan(20);
  for (const [x, y] of pts) {
    expect(x).toBeGreaterThanOrEqual(lng);
    expect(y).toBeGreaterThanOrEqual(lat);
  }
});

test('a site sloping 5% east: grade, relief, and a pad that cuts and fills evenly', () => {
  const proj = makeProjection(site.coordinates[0]);
  const samples = samplePoints(site, 60).map(([ln, la]) => {
    const [x] = proj.toFeet([ln, la]);
    return { lng: ln, lat: la, z: 4300 + 0.05 * x };
  });
  // A 200 x 60 ft building in the middle.
  const ring = [[-100, -30], [100, -30], [100, 30], [-100, 30]].map((p) => proj.toLatLng(p));
  const t = analyzeTerrain(site, samples, [ring]);
  expect(t.gradePct).toBeCloseTo(5, 0);
  expect(t.reliefFt).toBeGreaterThan(20);
  expect(t.pads[0].padFt).toBeCloseTo(4300, 0);
  expect(t.pads[0].cutCy).toBeGreaterThan(0);
  expect(t.pads[0].cutCy).toBeCloseTo(t.pads[0].fillCy, -1);
  expect(t.pads[0].slopePct).toBeGreaterThan(3);
  // Flat ground needs no earthwork.
  const flat = analyzeTerrain(site, samples.map((s) => ({ ...s, z: 4300 })), [ring]);
  expect(flat.cutCy).toBeCloseTo(0, 6);
  expect(flat.gradePct).toBeCloseTo(0, 6);
});

test('elevations: failed points are left out', async () => {
  let n = 0;
  const pts = await fetchElevations([[1, 1], [2, 2], [3, 3]], {
    fetchImpl: async () => {
      n++;
      if (n === 2) return { ok: false };
      return { ok: true, json: async () => ({ value: 4200 + n }) };
    },
  });
  expect(pts).toHaveLength(2);
  expect(pts.every((p) => p.z > 4200)).toBe(true);
});

test('edge samples spread around a many-sided boundary', () => {
  const n = 400;
  const ring = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [lng + (300 / fx) * Math.cos(a), lat + (300 / 364000) * Math.sin(a)];
  });
  const circle = { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
  const pts = samplePoints(circle, 30);
  const edge = pts.slice(-12);
  const angles = edge.map(([x, y]) => Math.atan2(y - lat, x - lng));
  expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI);
});
