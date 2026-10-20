import { inUtah, parcelAt, parcelBoundary, parcelInfo } from './parcels';

const square = [[-111.9, 40.7], [-111.899, 40.7], [-111.899, 40.701], [-111.9, 40.701], [-111.9, 40.7]];

test('inUtah', () => {
  expect(inUtah(40.76, -111.89)).toBe(true);
  expect(inUtah(39.74, -104.99)).toBe(false); // Denver
});

test('parcelBoundary takes the largest piece and closes it', () => {
  const small = [[-111.9, 40.7], [-111.8999, 40.7], [-111.8999, 40.7001], [-111.9, 40.7]];
  const b = parcelBoundary({ type: 'MultiPolygon', coordinates: [[small], [square]] });
  expect(b.coordinates[0]).toHaveLength(5);
  expect(b.coordinates[0][1]).toEqual([-111.899, 40.7]);
  expect(parcelBoundary({ type: 'Polygon', coordinates: [square.slice(0, -1)] }).coordinates[0]).toHaveLength(5);
  // Thinned to the boundary's 1,000-point limit.
  const big = Array.from({ length: 2500 }, (_, i) => [-111.9 + 0.001 * Math.cos(i / 400), 40.7 + 0.001 * Math.sin(i / 400)]);
  expect(parcelBoundary({ type: 'Polygon', coordinates: [big] }).coordinates[0].length).toBeLessThanOrEqual(1001);
});

test('parcelInfo reads the Utah fields and works out acres', () => {
  const p = parcelInfo({ PARCEL_ID: '16063010320000', PARCEL_ADD: '324 S STATE ST', PARCEL_CITY: 'Salt Lake City', County: 'SaltLake', OWN_TYPE: 'Private', ParcelsCur: 1790553600000 }, { type: 'Polygon', coordinates: [square] });
  expect(p.id).toBe('16063010320000');
  expect(p.address).toBe('324 S STATE ST');
  expect(p.acres).toBeGreaterThan(2);
  expect(p.acres).toBeLessThan(3.5);
  expect(p.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('parcelAt: outside Utah, nothing there, and a hit', async () => {
  expect((await parcelAt(39.74, -104.99)).reason).toMatch(/Utah/);
  const none = await parcelAt(40.76, -111.89, async () => ({ ok: true, json: async () => ({ features: [] }) }));
  expect(none.parcel).toBeNull();
  const hit = await parcelAt(40.76, -111.89, async (url) => {
    expect(url).toContain('geometry=-111.89%2C40.76');
    return { ok: true, json: async () => ({ features: [{ properties: { PARCEL_ID: 'X' }, geometry: { type: 'Polygon', coordinates: [square] } }] }) };
  });
  expect(hit.parcel.id).toBe('X');
  await expect(parcelAt(40.76, -111.89, async () => ({ ok: false }))).rejects.toThrow(/parcel service/);
});

test('a bad data date leaves the date out instead of failing', () => {
  expect(parcelInfo({ ParcelsCur: 'not a date' }, null).asOf).toBeNull();
});
