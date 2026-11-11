import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelingError, assertInsideRoot, cleanName, dateStamp, templateBaseName, releaseFileName,
  workingModelFileName, versionFileName, exportFileName, releaseVersionFromName, nameSaysActive,
  suggestNextVersion, releaseStamp, workingStamp, versionStamp, versionsRow, sheetSafe,
  isLockedRestriction, hasAnyReadOnly, copyFileName, copyStamp, promotedStamp, templateForFileName, classifyDealFiles, SPREADSHEET_MIME, slugKey,
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

test('names follow the existing Drive patterns (Utah date)', () => {
  const now = new Date('2026-11-12T05:30:00Z'); // still Nov 11 in Utah
  assert.equal(dateStamp(now), '2026-11-11');
  assert.equal(templateBaseName('Philo - Hospitality Model [TEMPLATE] — DRAFT'), 'Philo - Hospitality Model [TEMPLATE]');
  assert.equal(releaseFileName('Philo - Hospitality Model [TEMPLATE] — DRAFT', 'v1.2', now), 'Philo - Hospitality Model [TEMPLATE] — v1.2 — LOCKED 2026-11-11');
  assert.equal(workingModelFileName('Zion Promenade', 'Hospitality Model'), 'Zion Promenade — Hospitality Model');
  assert.equal(versionFileName('Zion Promenade', 'Hospitality Model', 'v2', now), 'Zion Promenade — Hospitality Model — v2 — LOCKED 2026-11-11');
  assert.match(exportFileName('Zion Promenade — Hospitality Model', now), /^Zion Promenade — Hospitality Model — Export 2026-11-11 \d{4}\.xlsx$/);
});

test('release names: version, ACTIVE marker, next version', () => {
  const v11 = 'Philo - Hospitality Model [TEMPLATE] — v1.1 — ACTIVE — LOCKED 2026-11-09';
  assert.equal(releaseVersionFromName(v11), 'v1.1');
  assert.equal(releaseVersionFromName('Philo - Hospitality Model [TEMPLATE] — v1.0 — LOCKED 2026-09-30'), 'v1.0');
  assert.equal(releaseVersionFromName('no version here'), null);
  assert.equal(nameSaysActive(v11), true);
  assert.equal(nameSaysActive('Philo — v1.0 — LOCKED 2026-09-30'), false);
  assert.equal(suggestNextVersion(['v1.0', 'v1.1']), 'v1.2');
  assert.equal(suggestNextVersion(['v1.9', 'v2']), 'v2.1');
  assert.equal(suggestNextVersion([]), 'v1.0');
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

test('import: template from file name, working-model ambiguity is flagged', () => {
  const templates = [{ id: 1, name: 'Hospitality Model' }, { id: 2, name: 'Senior Living CCRC Model' }];
  assert.equal(templateForFileName('Zion Promenade — Hospitality Model', templates), 1);
  assert.equal(templateForFileName('St George — Senior Living CCRC Model — v1 — LOCKED 2026-01-01', templates), 2);
  assert.equal(templateForFileName('Random sheet', templates), null);
  const s = (id) => ({ id, name: id, mimeType: SPREADSHEET_MIME });
  const out = classifyDealFiles({ workingFiles: [s('a'), s('b'), { id: 'pdf', mimeType: 'application/pdf' }], versionFiles: [s('v1')] }, new Set(['v1']));
  assert.equal(out.working.length, 2);
  assert.equal(out.problems.length, 1);
  assert.equal(out.versions[0].alreadyRegistered, true);
  assert.equal(slugKey('Senior Living CCRC Model'), 'senior-living-ccrc-model');
});

test('copies: name and stamps never read as LOCKED', () => {
  const now = new Date('2026-11-11T18:00:00Z');
  assert.equal(copyFileName('Test', 'Hospitality Model', 'Higher ADR case'), 'Test — Hospitality Model — Higher ADR case');
  assert.equal(copyStamp({ sourceName: 'v1', email: 'c@x' }, now), 'Copy of v1 · started 2026-11-11 by c@x');
  assert.equal(promotedStamp({ copyName: 'Higher ADR case', email: 'c@x' }, now), 'Deal model · working copy · from copy "Higher ADR case" · 2026-11-11 by c@x');
  assert.ok(!copyStamp({ sourceName: 'LOCKED thing', email: 'e' }, now).startsWith('LOCKED'));
});
