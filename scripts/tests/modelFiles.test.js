import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelFileName, pickLatestLocked, compareVersions } from '../../server/model-files.js';
import { driveFolderId } from '../../client/src/resources.js';

const SHEET = 'application/vnd.google-apps.spreadsheet';
const f = (name, extra = {}) => ({ id: name, name, mimeType: SHEET, modifiedTime: '2026-09-30T12:00:00Z', ...extra });

test('parseModelFileName: em-dash naming rules', () => {
  assert.deepEqual(parseModelFileName('Zion Promenade — Hospitality Model — v2 — LOCKED 2026-09-30'),
    { locked: true, version: 'v2', lockedOn: '2026-09-30', template: false, scratch: false });
  assert.deepEqual(parseModelFileName('Zion Promenade — Hospitality Model'),
    { locked: false, version: null, lockedOn: null, template: false, scratch: false });
  assert.equal(parseModelFileName('Philo - Hospitality Model [TEMPLATE] — v1.1 — ACTIVE — LOCKED 2026-09-30').template, true);
  assert.equal(parseModelFileName('~scratch (safe to delete) — Zion — v2 — LOCKED 2026-09-30').scratch, true);
});

test('compareVersions: numeric, dotted', () => {
  assert.ok(compareVersions('v10', 'v2') > 0);
  assert.ok(compareVersions('v1.10', 'v1.9') > 0);
  assert.equal(compareVersions('v2', 'v2'), 0);
});

test('pickLatestLocked: highest locked version wins; working copy, templates, scratch and non-sheets ignored', () => {
  const files = [
    f('Zion Promenade — Hospitality Model'), // working copy
    f('Zion Promenade — Hospitality Model — v2 — LOCKED 2026-09-12'),
    f('Zion Promenade — Hospitality Model — v10 — LOCKED 2026-09-28'),
    f('Zion Promenade — Hospitality Model — v3 — LOCKED 2026-09-20'),
    f('~scratch (safe to delete) — Zion Promenade — Hospitality Model — v11 — LOCKED 2026-09-30'),
    f('Philo - Hospitality Model [TEMPLATE] — v1.1 — ACTIVE — LOCKED 2026-09-30'),
    f('Zion Promenade — Hospitality Model — v12 — LOCKED 2026-09-30.xlsx', { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  ];
  const latest = pickLatestLocked(files);
  assert.equal(latest.name, 'Zion Promenade — Hospitality Model — v10 — LOCKED 2026-09-28');
  assert.equal(latest.version, 'v10');
  assert.equal(latest.lockedOn, '2026-09-28');
});

test('pickLatestLocked: same version twice -> most recently modified; none locked -> null', () => {
  const a = f('X — Hospitality Model — v2 — LOCKED 2026-09-12', { id: 'old', modifiedTime: '2026-09-12T00:00:00Z' });
  const b = f('X — Hospitality Model — v2 — LOCKED 2026-09-12', { id: 'new', modifiedTime: '2026-09-13T00:00:00Z' });
  assert.equal(pickLatestLocked([a, b]).id, 'new');
  assert.equal(pickLatestLocked([f('X — Hospitality Model')]), null);
  assert.equal(pickLatestLocked([]), null);
});

test('driveFolderId: from the usual Drive folder URLs', () => {
  assert.equal(driveFolderId('https://drive.google.com/drive/folders/1BjGgr63M96iT1IU7lIPZMXM0dlbOSOFH'), '1BjGgr63M96iT1IU7lIPZMXM0dlbOSOFH');
  assert.equal(driveFolderId('https://drive.google.com/drive/u/0/folders/abc_DEF-123?usp=sharing'), 'abc_DEF-123');
  assert.equal(driveFolderId('https://docs.google.com/spreadsheets/d/abc/edit'), null);
  assert.equal(driveFolderId(undefined), null);
});
