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
