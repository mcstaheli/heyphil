import { solveScheme } from './solver';

function rectSite(width, depth, lat = 40.76, lng = -111.89) {
  const dx = width / (364000 * Math.cos((lat * Math.PI) / 180));
  const dy = depth / 364000;
  return { type: 'Polygon', coordinates: [[[lng, lat], [lng + dx, lat], [lng + dx, lat + dy], [lng, lat + dy], [lng, lat]]] };
}
const scheme = (assetType, overrides = {}) => ({ id: 'a', name: 'A', assetType, overrides });

test('a 180-key hotel is built to 180 keys on fewer floors', () => {
  const site = rectSite(600, 500);
  const most = solveScheme(site, scheme('hotel', { floors: 8 }));
  expect(most.metrics.keys).toBeGreaterThan(180);
  const r = solveScheme(site, scheme('hotel', { floors: 8, targetYield: 180 }));
  expect(r.metrics.keys).toBe(180);
  expect(r.metrics.floors).toBeLessThanOrEqual(most.metrics.floors);
  expect(r.checks.find((c) => c.label === 'Target').status).toBe('pass');
  expect(r.metrics.parkingRequired).toBe(Math.ceil(180 * r.settings.parkingRatio - 1e-9));
});

test('a target the site can\'t reach fails its check', () => {
  const r = solveScheme(rectSite(300, 200), scheme('hotel', { targetYield: 5000 }));
  const c = r.checks.find((x) => x.label === 'Target');
  expect(c.status).toBe('fail');
  expect(c.actual).toMatch(/Only/);
});

test('units hit their target by type', () => {
  const r = solveScheme(rectSite(600, 400), scheme('mf-garden', { targetYield: 60 }));
  expect(r.metrics.units).toBe(60);
  expect(r.metrics.unitsByType.reduce((t, u) => t + u.count, 0)).toBe(60);
});

test('a fixed stall count replaces the ratio', () => {
  const r = solveScheme(rectSite(600, 400), scheme('mf-garden', { parkingFixed: 40 }));
  expect(r.metrics.parkingRequired).toBe(40);
  expect(r.checks.find((c) => c.label === 'Parking').limit).toMatch(/^40 required/);
});
