import {
  test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelingError, assertInsideRoot, cleanName, dateStamp, exportFileName, nameSaysActive, releaseStamp, workingStamp, versionStamp, versionsRow, sheetSafe, isLockedRestriction, hasAnyReadOnly, modelFileName, copyStamp, nextVersion, nextRootVersion, parseVersion, versionTitle, slugKey,
} from '../../server/modeling/rules.js';

// A fake Drive: HeyPhil root R inside shared drive D, with the live
// Projects folder LIVE as R's sibling.
const FILES = {
  R: { parents: ['D'], driveId: 'D' },
  T: { parents: ['R'], driveId: 'D' },          // HeyPhil/Templates
  HOSP: { parents: ['T'], driveId: 'D' },
  REL: { parents: ['HOSP'], driveId: 'D' },
  V11: { parents: ['REL'], driveId: 'D' },
  LIVE: { parents: ['D'], driveId: 'D' },       // live Projects - outside
  LIVEFILE: { parents: ['LIVE'], driveId: 'D' },
  ORPHAN: { parents: [], driveId: 'D' },
  OTHERDRIVE: { parents: ['R'], driveId: 'X' }, // claims R as parent but lives elsewhere
  TRASHED: { parents: ['T'], driveId: 'D', trashed: true },
  LOOP1: { parents: ['LOOP2'], driveId: 'D' },
  LOOP2: { parents: ['LOOP1'], driveId: 'D' },
};
const ctx = (calls = []) => ({
  rootId: 'R',
  rootDriveId: 'D',
  getMeta: async (id) => { calls.push(id); return FILES[id] ? { id, ...FILES[id] } : null; },
});
const refused = (p) => assert.rejects(p, (e) => e instanceof ModelingError && e.status === 403);

test('assertInsideRoot: files and folders under the HeyPhil root pass', async () => {
  await assertInsideRoot('V11', ctx());
  await assertInsideRoot('T', ctx());
  await assertInsideRoot('R', ctx());
});

test('assertInsideRoot: the live folders, orphans, other drives, trash and loops are refused', async () => {
  await refused(assertInsideRoot('LIVE', ctx()));
  await refused(assertInsideRoot('LIVEFILE', ctx()));
  await refused(assertInsideRoot('ORPHAN', ctx()));
  await refused(assertInsideRoot('OTHERDRIVE', ctx()));
  await refused(assertInsideRoot('TRASHED', ctx()));
  await refused(assertInsideRoot('LOOP1', ctx()));
  await refused(assertInsideRoot('NOPE', ctx()));
  await assert.rejects(assertInsideRoot('', ctx()), ModelingError);
});

test('assertInsideRoot: remembers verified folders so later checks are short', async () => {
  const known = new Set();
  const calls = [];
  await assertInsideRoot('V11', { ...ctx(calls), known });
  assert.ok(known.has('REL') && known.has('HOSP') && known.has('T'));
  calls.length = 0;
  await assertInsideRoot('REL', { ...ctx(calls), known });
  assert.deepEqual(calls, []);
  // the cache never lets an outside file in
  await refused(assertInsideRoot('LIVEFILE', { ...ctx(), known }));
});

test('cleanName: trims, refuses empty, slashes and overlong', () => {
  assert.equal(cleanName('  Zion   Promenade ', 'deal name'), 'Zion Promenade');
  assert.throws(() => cleanName('  ', 'deal name'), /Enter a deal name/);
  assert.throws(() => cleanName('a/b', 'deal name'), /can't contain/);
  assert.throws(() => cleanName('x'.repeat(121), 'deal name'), /too long/);
});

test('stamps match the script formats', () => {
  const now = new Date('2026-11-11T18:00:00Z');
  assert.equal(releaseStamp({ version: 'v1.2', email: 'chad@philo.ventures', note: '' }, now), 'LOCKED · Template v1.2 · locked 2026-11-11 by chad@philo.ventures');
  assert.equal(releaseStamp({ version: 'v1.2', email: 'c@x', note: 'menu cleanup' }, now), 'LOCKED · Template v1.2 · locked 2026-11-11 by c@x · menu cleanup');
  assert.equal(workingStamp({ releaseVersion: 'v1.2' }, now), 'Deal model · working copy · started 2026-11-11 from template v1.2');
  assert.equal(versionStamp({ versionName: 'v2', email: 'c@x' }, now), 'LOCKED · Deal model v2 · locked 2026-11-11 by c@x');
  assert.ok(releaseStamp({ version: 'v1', email: 'e' }, now).startsWith('LOCKED'));
  assert.ok(!workingStamp({ releaseVersion: 'v1' }, now).startsWith('LOCKED'));
});

test('VERSIONS row: 8 columns B..I, typed text never becomes a formula', () => {
  const row = versionsRow({ version: 'v2', type: 'Deal snapshot', email: 'c@x', note: '=IMPORTXML("evil")', copyUrl: 'u1', sourceUrl: 'u2' }, new Date('2026-11-11T18:00:00Z'));
  assert.deepEqual(row, ['v2', 'Deal snapshot', '2026-11-11', 'c@x', '\'=IMPORTXML("evil")', 'u1', 'u2', '']);
  assert.equal(sheetSafe('+1'), "'+1");
  assert.equal(sheetSafe('ok'), 'ok');
});

test('lock state from Drive contentRestrictions', () => {
  assert.equal(isLockedRestriction([{ readOnly: true, ownerRestricted: true }]), true);
  assert.equal(isLockedRestriction([{ readOnly: true }]), false); // any editor could unlock
  assert.equal(isLockedRestriction(undefined), false);
  assert.equal(hasAnyReadOnly([{ readOnly: true }]), true);
  assert.equal(hasAnyReadOnly([{ readOnly: false }]), false);
});

test('copies: file names and stamps never read as LOCKED', () => {
  const now = new Date('2026-11-11T18:00:00Z');
  assert.equal(modelFileName({ projectName: 'Test', templateName: 'Hospitality Model', version: 'v3', label: 'Higher ADR case' }), 'Test — Hospitality Model — v3 (Higher ADR case)');
  assert.equal(modelFileName({ projectName: 'Test', templateName: 'Hospitality Model', version: 'v1' }), 'Test — Hospitality Model — v1');
  assert.equal(modelFileName({ templateFileName: 'Philo - Hospitality Model [TEMPLATE] — v1.2 — LOCKED 2026-11-11', version: 'v1.3' }), 'Philo - Hospitality Model [TEMPLATE] — v1.3');
  assert.equal(copyStamp({ sourceName: 'v1', email: 'c@x' }, now), 'Copy of v1 · started 2026-11-11 by c@x');
  assert.ok(!copyStamp({ sourceName: 'LOCKED thing', email: 'e' }, now).startsWith('LOCKED'));
});

test('versions: next on the line, else branch with a dot', () => {
  assert.equal(nextVersion('v2', ['v1', 'v2']), 'v3');
  assert.equal(nextVersion('v1.2', ['v1', 'v1.0', 'v1.1', 'v1.2']), 'v1.3');
  assert.equal(nextVersion('v2', ['v1', 'v2', 'v3']), 'v2.1');          // branch
  assert.equal(nextVersion('v2', ['v1', 'v2', 'v3', 'v2.1']), 'v2.2');  // another branch off v2
  assert.equal(nextVersion('v2.1', ['v2', 'v3', 'v2.1']), 'v2.2');      // continue the branch
  assert.equal(nextVersion('v2.1', ['v2', 'v3', 'v2.1', 'v2.2']), 'v2.1.1');
  assert.equal(nextVersion('V2', ['v2', 'V3']), 'v2.1');                // case-insensitive
  assert.equal(nextRootVersion([]), 'v1');
  assert.equal(nextRootVersion(['v1', 'v1.1', 'v2.3']), 'v3');
  assert.equal(nextVersion('Draft master', ['v1']), 'v2');              // unparseable parent -> next top level
  assert.deepEqual(parseVersion('v1.10'), [1, 10]);
  assert.equal(parseVersion('Working model'), null);
  assert.equal(versionTitle({ version: 'v3', label: 'Higher ADR case' }), 'v3 · Higher ADR case');
  assert.equal(versionTitle({ version: 'v3', label: null }), 'v3');
});

test('dates and ACTIVE marker (Utah date)', () => {
  const now = new Date('2026-11-12T05:30:00Z'); // still Nov 11 in Utah
  assert.equal(dateStamp(now), '2026-11-11');
  assert.match(exportFileName('Test — Hospitality Model — v1', now), /^Test — Hospitality Model — v1 — Export 2026-11-11 \d{4}\.xlsx$/);
  assert.equal(nameSaysActive('Philo - Hospitality Model [TEMPLATE] — v1.1 — ACTIVE — LOCKED 2026-11-09'), true);
  assert.equal(nameSaysActive('Philo — v1.0 — LOCKED 2026-09-30'), false);
  assert.equal(slugKey('Senior Living CCRC Model'), 'senior-living-ccrc-model');
});
