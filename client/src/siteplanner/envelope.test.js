import turfArea from '@turf/area';
import { effectiveSettings } from './assetTypes';
import { insetByEdges, siteEdges } from './envelope';
import { solveScheme } from './solver';

function rectSite(width, depth, lat = 40.76, lng = -111.89) {
  const dx = width / (364000 * Math.cos((lat * Math.PI) / 180));
  const dy = depth / 364000;
  return { type: 'Polygon', coordinates: [[[lng, lat], [lng + dx, lat], [lng + dx, lat + dy], [lng, lat + dy], [lng, lat]]] };
}
const scheme = (assetType, overrides = {}) => ({ id: 'a', name: 'A', assetType, overrides });
const sf = (f) => turfArea(f) * 10.7639;

test('front is the longest edge by default, the rear faces away, the rest are sides', () => {
  const s = effectiveSettings(scheme('mf-garden', { setbackMode: 1, setback: 10, frontSetback: 30, rearSetback: 20 }));
  const edges = siteEdges(rectSite(600, 300), s);
  expect(edges).toHaveLength(4);
  const front = edges.find((e) => e.role === 'front');
  const rear = edges.find((e) => e.role === 'rear');
  expect(Math.abs(front.lengthFt - 600)).toBeLessThan(10);
  expect(Math.abs(rear.lengthFt - 600)).toBeLessThan(10);
  expect(front.facing).toBe('S');
  expect(rear.facing).toBe('N');
  expect(edges.filter((e) => e.role === 'side').map((e) => e.setback)).toEqual([10, 10]);
  // Picking edge 2 (the east side) as the front makes the west side the rear.
  const picked = siteEdges(rectSite(600, 300), { ...s, frontEdge: 2 });
  expect(picked[1].role).toBe('front');
  expect(picked[3].role).toBe('rear');
});

test('the setback area follows each edge', () => {
  const site = rectSite(600, 300);
  const s = effectiveSettings(scheme('mf-garden', { setbackMode: 1, setback: 10, frontSetback: 30, rearSetback: 20 }));
  const inset = insetByEdges(site, siteEdges(site, s));
  // (600 - 10 - 10) x (300 - 30 - 20)
  expect(sf(inset)).toBeGreaterThan(580 * 250 * 0.99);
  expect(sf(inset)).toBeLessThan(580 * 250 * 1.01);
});

test('density caps units', () => {
  const site = rectSite(600, 400);
  const free = solveScheme(site, scheme('mf-podium')).totals;
  const acres = free.siteAcres;
  const capped = solveScheme(site, scheme('mf-podium', { maxDensity: Math.floor(free.units / acres / 2) }));
  expect(capped.totals.units).toBeLessThanOrEqual(Math.floor((free.units / acres / 2) * acres) + 1e-9);
  expect(capped.checks.find((c) => c.label === 'Density').status).toBe('pass');
});

test('stepbacks take area off the upper floors and step the massing', () => {
  const site = rectSite(600, 400);
  const flat = solveScheme(site, scheme('mf-podium', { floors: 6, perimeterDrive: 0 }));
  const stepped = solveScheme(site, scheme('mf-podium', { floors: 6, perimeterDrive: 0, stepbackAbove: 3, stepbackDepth: 40, maxHeight: 120 }));
  expect(stepped.metrics.floors).toBe(flat.metrics.floors);
  expect(stepped.metrics.gsf).toBeLessThan(flat.metrics.gsf);
  expect(stepped.metrics.units).toBeLessThan(flat.metrics.units);
  expect(stepped.geometry.stepbacks.length).toBeGreaterThan(0);
  expect(stepped.geometry.envelope.upper).toBeTruthy();
  expect(stepped.geometry.envelope.topFt).toBe(120);
});

test('edges come back with the result for the map labels', () => {
  const r = solveScheme(rectSite(600, 400), scheme('mf-garden', { setbackMode: 1 }));
  expect(r.edges.map((e) => e.role).sort()).toEqual(['front', 'rear', 'side', 'side']);
});

test('a picked front edge is kept through the settings', () => {
  const site = rectSite(600, 300);
  const r = solveScheme(site, scheme('mf-garden', { setbackMode: 1, frontEdge: 2 }));
  expect(r.edges.find((e) => e.index === 2).role).toBe('front');
  expect(r.edges.find((e) => e.index === 4).role).toBe('rear');
});

test('a data center stepped back loses IT load with its floor area', () => {
  const site = rectSite(800, 600);
  const flat = solveScheme(site, scheme('datacenter', { floors: 3, perimeterDrive: 0 })).metrics;
  const stepped = solveScheme(site, scheme('datacenter', { floors: 3, perimeterDrive: 0, stepbackAbove: 1, stepbackDepth: 80 })).metrics;
  expect(stepped.gsf).toBeLessThan(flat.gsf);
  expect(stepped.itMw).toBeLessThan(flat.itMw);
});
