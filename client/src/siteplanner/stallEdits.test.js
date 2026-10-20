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
