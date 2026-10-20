import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ASSET_TYPE_IDS,
  SitePlanValidationError,
  defaultSchemes,
  isUuid,
  validateBoundary,
  validateMapView,
  validateName,
  validateProjectId,
  validateSchemes,
} from '../../server/site-plan-rules.js';

test('asset type ids match the client list', () => {
  const src = readFileSync(new URL('../../client/src/siteplanner/assetTypes.js', import.meta.url), 'utf8');
  const clientIds = [...src.matchAll(/^\s{4}id: '([a-z-]+)',$/gm)].map((m) => m[1]);
  assert.deepEqual(clientIds, ASSET_TYPE_IDS);
});

test('validateName: required, trimmed, capped', () => {
  assert.equal(validateName('  Lot 4 '), 'Lot 4');
  assert.throws(() => validateName(' '), SitePlanValidationError);
  assert.throws(() => validateName('x'.repeat(201)), SitePlanValidationError);
});

test('validateProjectId: optional uuid', () => {
  assert.equal(validateProjectId(''), null);
  assert.throws(() => validateProjectId('nope'), SitePlanValidationError);
});

test('validateBoundary: polygon of valid points, closed on the way in', () => {
  assert.equal(validateBoundary(null), null);
  const open = { type: 'Polygon', coordinates: [[[-111.9, 40.7], [-111.8, 40.7], [-111.8, 40.8]]] };
  const out = validateBoundary(open);
  assert.equal(out.coordinates[0].length, 4);
  assert.deepEqual(out.coordinates[0][3], [-111.9, 40.7]);
  assert.throws(() => validateBoundary({ type: 'Point', coordinates: [0, 0] }), SitePlanValidationError);
  assert.throws(() => validateBoundary({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }), SitePlanValidationError);
  assert.throws(() => validateBoundary({ type: 'Polygon', coordinates: [[[0, 0], [200, 0], [1, 1]]] }), SitePlanValidationError);
  assert.throws(() => validateBoundary({ type: 'Polygon', coordinates: [[[0, 0], ['a', 0], [1, 1]]] }), SitePlanValidationError);
});

test('validateMapView: lat/lng/zoom in range', () => {
  assert.deepEqual(validateMapView({ lat: 40, lng: -111, zoom: 18 }), { lat: 40, lng: -111, zoom: 18 });
  assert.equal(validateMapView(null), null);
  assert.throws(() => validateMapView({ lat: 91, lng: 0, zoom: 1 }), SitePlanValidationError);
});

test('validateSchemes: known types, unique ids, numeric overrides and a unit mix', () => {
  const ok = validateSchemes([
    { id: 'a', name: ' A ', assetType: 'mf-garden', overrides: { floors: 4, rotation: 'auto', mix: [{ name: '1 BR', size: 700, pct: 100 }] } },
    { id: 'b', name: 'B', assetType: 'industrial' },
  ]);
  assert.equal(ok[0].name, 'A');
  assert.deepEqual(ok[1].overrides, {});
  assert.throws(() => validateSchemes([]), SitePlanValidationError);
  assert.throws(() => validateSchemes([{ id: 'a', name: 'A', assetType: 'castle' }]), SitePlanValidationError);
  assert.throws(() => validateSchemes([{ id: 'a', name: 'A', assetType: 'hotel' }, { id: 'a', name: 'B', assetType: 'hotel' }]), SitePlanValidationError);
  assert.throws(() => validateSchemes([{ id: 'a', name: 'A', assetType: 'hotel', overrides: { floors: -1 } }]), SitePlanValidationError);
  assert.throws(() => validateSchemes([{ id: 'a', name: 'A', assetType: 'hotel', overrides: { floors: '3' } }]), SitePlanValidationError);
  assert.throws(() => validateSchemes([{ id: 'a', name: 'A', assetType: 'hotel', overrides: { 'bad key': 1 } }]), SitePlanValidationError);
  assert.throws(() => validateSchemes([{ id: 'a', name: 'A', assetType: 'mf-garden', overrides: { mix: [{ name: '', size: 1, pct: 1 }] } }]), SitePlanValidationError);
  assert.throws(() => validateSchemes(Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, name: 'S', assetType: 'hotel' }))), SitePlanValidationError);
  assert.deepEqual(validateSchemes(defaultSchemes()), defaultSchemes());
});

test('isUuid', () => {
  assert.equal(isUuid('670c4019-27c8-40e5-a7d4-999f106f9a15'), true);
  assert.equal(isUuid('x'), false);
});

import { validatePreset } from '../../server/site-plan-rules.js';

const square = { type: 'Polygon', coordinates: [[[-111.9, 40.7], [-111.899, 40.7], [-111.899, 40.701], [-111.9, 40.701], [-111.9, 40.7]]] };
const one = (extra) => validateSchemes([{ id: 'a', name: 'A', assetType: 'mf-garden', ...extra }])[0];

test('schemes keep hand-placed buildings, checked', () => {
  const b = { id: 'b1', center: [-111.9, 40.7], length: 200, depth: 65, angle: 12.5 };
  assert.deepEqual(one({ edits: { buildings: [b, { ...b, id: 'b2', floors: 4 }] } }).edits.buildings[1].floors, 4);
  assert.equal(one({}).edits, undefined);
  assert.throws(() => one({ edits: { buildings: [{ ...b, length: 0 }] } }), SitePlanValidationError);
  assert.throws(() => one({ edits: { buildings: [{ ...b, center: [500, 0] }] } }), SitePlanValidationError);
  assert.throws(() => one({ edits: { buildings: [b, b] } }), SitePlanValidationError);
  assert.throws(() => one({ edits: { buildings: [{ ...b, floors: 2.5 }] } }), SitePlanValidationError);
  assert.throws(() => one({ edits: 'nope' }), SitePlanValidationError);
});

test('schemes keep spaces: no-build, or an asset type with settings', () => {
  const out = one({
    spaces: [
      { id: 's1', name: ' Pond ', kind: 'no-build', polygon: square, assetType: 'retail' },
      { id: 's2', name: 'Pad', kind: 'asset', assetType: 'retail', overrides: { setback: 0 }, polygon: square },
    ],
  });
  assert.equal(out.spaces[0].name, 'Pond');
  assert.equal(out.spaces[0].assetType, undefined); // ignored for no-build
  assert.deepEqual(out.spaces[1].overrides, { setback: 0 });
  assert.throws(() => one({ spaces: [{ id: 's', name: 'X', kind: 'park', polygon: square }] }), SitePlanValidationError);
  assert.throws(() => one({ spaces: [{ id: 's', name: 'X', kind: 'asset', assetType: 'castle', polygon: square }] }), SitePlanValidationError);
  assert.throws(() => one({ spaces: [{ id: 's', name: 'X', kind: 'no-build' }] }), SitePlanValidationError);
});

test('pro forma dollar settings can go into the millions', () => {
  assert.equal(one({ overrides: { landCost: 4500000 } }).overrides.landCost, 4500000);
  assert.throws(() => one({ overrides: { landCost: 2e10 } }), SitePlanValidationError);
});

test('validatePreset', () => {
  assert.deepEqual(validatePreset({ name: ' Wrap ', assetType: 'mf-podium', overrides: { floors: 6 } }), { name: 'Wrap', assetType: 'mf-podium', overrides: { floors: 6 } });
  assert.throws(() => validatePreset({ name: '', assetType: 'mf-podium' }), SitePlanValidationError);
  assert.throws(() => validatePreset({ name: 'X', assetType: 'castle' }), SitePlanValidationError);
});

test('schemes keep parking areas and entries, checked', () => {
  const out = one({
    parkingAreas: [{ id: 'p1', polygon: square, angle: 30, stallAngle: 60 }, { id: 'p2', polygon: square }],
    entries: [{ id: 'e1', point: [-111.9, 40.7] }],
    overrides: { parkingRotation: 15, stallAngle: 45 },
  });
  assert.equal(out.parkingAreas[0].angle, 30);
  assert.equal(out.parkingAreas[0].stallAngle, 60);
  assert.equal(out.parkingAreas[1].angle, 'auto');
  assert.deepEqual(out.entries[0].point, [-111.9, 40.7]);
  assert.equal(out.overrides.parkingRotation, 15);
  assert.throws(() => one({ parkingAreas: [{ id: 'p', polygon: square, stallAngle: 30 }] }), SitePlanValidationError);
  assert.throws(() => one({ parkingAreas: [{ id: 'p', polygon: square, angle: 'sideways' }] }), SitePlanValidationError);
  assert.throws(() => one({ parkingAreas: [{ id: 'p' }] }), SitePlanValidationError);
  assert.throws(() => one({ entries: [{ id: 'e', point: [999, 0] }] }), SitePlanValidationError);
  assert.throws(() => one({ overrides: { parkingRotation: 'north' } }), SitePlanValidationError);
  assert.equal(one({ assetType: 'garage' }).assetType, 'garage');
});

test('schemes keep drawn drive aisles, checked', () => {
  const line = { type: 'LineString', coordinates: [[-111.9, 40.7], [-111.899, 40.7], [-111.899, 40.701]] };
  const out = one({ driveAisles: [{ id: 'a1', line, width: 26 }, { id: 'a2', line, twoWay: false }] });
  assert.equal(out.driveAisles[0].width, 26);
  assert.equal(out.driveAisles[0].twoWay, true);
  assert.equal(out.driveAisles[1].twoWay, false);
  assert.throws(() => one({ driveAisles: [{ id: 'a', line: { type: 'LineString', coordinates: [[0, 0]] } }] }), SitePlanValidationError);
  assert.throws(() => one({ driveAisles: [{ id: 'a', line, width: 4 }] }), SitePlanValidationError);
  assert.throws(() => one({ driveAisles: [{ id: 'a', line: square }] }), SitePlanValidationError);
});

test('a kept routed aisle keeps its fromBay mark', () => {
  const line = { type: 'LineString', coordinates: [[-111.9, 40.7], [-111.899, 40.7]] };
  assert.equal(one({ driveAisles: [{ id: 'a', line, fromBay: true }] }).driveAisles[0].fromBay, true);
  assert.equal(one({ driveAisles: [{ id: 'a', line, fromBay: 'yes' }] }).driveAisles[0].fromBay, undefined);
});

test('truck aisles and the data center type are accepted', () => {
  const line = { type: 'LineString', coordinates: [[-111.9, 40.7], [-111.899, 40.7]] };
  assert.equal(one({ driveAisles: [{ id: 'a', line, truck: true }] }).driveAisles[0].truck, true);
  assert.equal(one({ assetType: 'datacenter' }).assetType, 'datacenter');
});

test('stall edits keep a point and a known kind', () => {
  const out = one({ stallEdits: [{ point: [-111.9, 40.7], kind: 'ev', extra: 1 }, { point: [-111.9, 40.71], kind: 'removed' }] });
  assert.deepEqual(out.stallEdits, [{ point: [-111.9, 40.7], kind: 'ev' }, { point: [-111.9, 40.71], kind: 'removed' }]);
  assert.equal(one({}).stallEdits, undefined);
  assert.throws(() => one({ stallEdits: [{ point: [-111.9, 40.7], kind: 'golf' }] }), SitePlanValidationError);
  assert.throws(() => one({ stallEdits: [{ point: [500, 40.7], kind: 'ev' }] }), SitePlanValidationError);
});

test('a placed building can be L, U or courtyard shaped, with a wing depth', () => {
  const b = { id: 'b', center: [-111.9, 40.7], length: 200, depth: 150, angle: 0 };
  const out = one({ edits: { buildings: [{ ...b, shape: 'U', wing: 60 }] } });
  assert.equal(out.edits.buildings[0].shape, 'U');
  assert.equal(out.edits.buildings[0].wing, 60);
  assert.equal(one({ edits: { buildings: [{ ...b, shape: 'rect' }] } }).edits.buildings[0].shape, undefined);
  assert.throws(() => one({ edits: { buildings: [{ ...b, shape: 'star', wing: 60 }] } }), SitePlanValidationError);
  assert.throws(() => one({ edits: { buildings: [{ ...b, shape: 'L' }] } }), SitePlanValidationError);
});

test('a space can be a park', () => {
  const polygon = { type: 'Polygon', coordinates: [[[-111.9, 40.7], [-111.899, 40.7], [-111.899, 40.701], [-111.9, 40.7]]] };
  assert.equal(one({ spaces: [{ id: 's', name: 'Park', kind: 'green', polygon }] }).spaces[0].kind, 'green');
});
