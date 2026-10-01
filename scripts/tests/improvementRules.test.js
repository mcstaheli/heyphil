import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ImprovementValidationError,
  MAX_SCREENSHOT_BYTES,
  parseScreenshotDataUri,
  sniffImageType,
  validateReporterHint,
  validatePriority,
  parseDuplicateOf,
  resolvedAtFor,
  sanitizeContext,
  screenshotFromLegacyText,
} from '../../server/improvement-rules.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from([1])]);
const uri = (type, buf) => `data:${type};base64,${buf.toString('base64')}`;

test('sniffImageType: from the actual bytes', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(WEBP), 'image/webp');
  assert.equal(sniffImageType(Buffer.from('GIF89a')), null);
});

test('parseScreenshotDataUri: accepts jpeg/png/webp whose bytes match', () => {
  assert.deepEqual(parseScreenshotDataUri(uri('image/jpeg', JPEG)), { buffer: JPEG, type: 'image/jpeg' });
  assert.equal(parseScreenshotDataUri(uri('image/png', PNG)).type, 'image/png');
  assert.equal(parseScreenshotDataUri(uri('image/webp', WEBP)).type, 'image/webp');
});

test('parseScreenshotDataUri: rejects other types, mismatched bytes, junk', () => {
  const bad = (v, re) => assert.throws(() => parseScreenshotDataUri(v), (e) => e instanceof ImprovementValidationError && re.test(e.message));
  bad(uri('image/gif', Buffer.from('GIF89a')), /JPEG, PNG or WebP/);
  bad(uri('image/svg+xml', Buffer.from('<svg/>')), /JPEG, PNG or WebP/);
  bad(uri('image/png', JPEG), /doesn't match/);            // says PNG, is JPEG
  bad(uri('image/png', Buffer.from('not an image')), /doesn't match/);
  bad('https://example.com/x.png', /data:image/);
  bad('data:image/png;base64,', /empty/);
  bad(42, /data:image/);
});

test('parseScreenshotDataUri: size cap is on the decoded bytes', () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(MAX_SCREENSHOT_BYTES)]);
  assert.throws(() => parseScreenshotDataUri(uri('image/jpeg', big)), /too large/);
  const ok = Buffer.concat([JPEG, Buffer.alloc(MAX_SCREENSHOT_BYTES - JPEG.length)]);
  assert.equal(parseScreenshotDataUri(uri('image/jpeg', ok)).buffer.length, MAX_SCREENSHOT_BYTES);
});

test('validateReporterHint / validatePriority', () => {
  assert.equal(validateReporterHint('broken'), 'broken');
  assert.equal(validateReporterHint(undefined), null);
  assert.equal(validateReporterHint(''), null);
  assert.throws(() => validateReporterHint('urgent'), ImprovementValidationError);
  for (const p of ['high', 'normal', 'low']) assert.equal(validatePriority(p), p);
  assert.throws(() => validatePriority('critical'), ImprovementValidationError);
  assert.throws(() => validatePriority(null), ImprovementValidationError);
});

test('parseDuplicateOf: a positive card number, not itself; null/"" clears', () => {
  assert.equal(parseDuplicateOf(7, 12), 7);
  assert.equal(parseDuplicateOf('7', 12), 7);
  assert.equal(parseDuplicateOf('#7', 12), 7);
  assert.equal(parseDuplicateOf(null, 12), null);
  assert.equal(parseDuplicateOf('', 12), null);
  assert.throws(() => parseDuplicateOf(12, 12), /itself/);
  assert.throws(() => parseDuplicateOf('abc', 12), /card number/);
  assert.throws(() => parseDuplicateOf(0, 12), /card number/);
  assert.throws(() => parseDuplicateOf(1.5, 12), /card number/);
});

test('resolvedAtFor: set on entering shipped/abandoned, cleared on reopen, else unchanged', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const earlier = new Date('2026-09-01T00:00:00Z');
  assert.equal(resolvedAtFor('triaged-bugs', 'shipped', null, now), now);
  assert.equal(resolvedAtFor('intake', 'abandoned', null, now), now);
  assert.equal(resolvedAtFor('shipped', 'triaged-bugs', earlier, now), null);       // reopened
  assert.equal(resolvedAtFor('shipped', 'abandoned', earlier, now), earlier);       // still resolved: keep
  assert.equal(resolvedAtFor('intake', 'triaged-features', null, now), undefined);  // no change
  assert.equal(resolvedAtFor('shipped', 'shipped', earlier, now), undefined);       // same status
  assert.equal(resolvedAtFor('shipped', undefined, earlier, now), undefined);       // status not in patch
});

test('sanitizeContext: keeps viewport/userAgent/errors, caps sizes, drops the rest', () => {
  const ctx = sanitizeContext({
    viewport: { width: 1440.7, height: 900, extra: 1 },
    userAgent: 'x'.repeat(2000),
    errors: Array.from({ length: 30 }, (_, i) => ({ message: `e${i}`.padEnd(3000, '!'), stack: 's'.repeat(5000), source: 'window.error', time: '2026-10-01T00:00:00Z', junk: true })),
    secret: 'nope',
  });
  assert.deepEqual(ctx.viewport, { width: 1441, height: 900 });
  assert.equal(ctx.userAgent.length, 500);
  assert.equal(ctx.errors.length, 20);
  assert.equal(ctx.errors[0].message.startsWith('e10'), true); // the LAST 20
  assert.equal(ctx.errors[0].message.length, 500);
  assert.equal(ctx.errors[0].stack.length, 500);
  assert.deepEqual(Object.keys(ctx.errors[0]).sort(), ['message', 'source', 'stack', 'time']);
  assert.equal('secret' in ctx, false);
  assert.equal(sanitizeContext(null), null);
  assert.equal(sanitizeContext('nope'), null);
  assert.deepEqual(sanitizeContext({ errors: 'nope' }), { viewport: null, userAgent: null, errors: [], clientCommit: null });
});

test('screenshotFromLegacyText: old data: URIs are served only if the bytes really are JPEG/PNG/WebP', () => {
  assert.deepEqual(screenshotFromLegacyText(uri('image/png', PNG)), { buffer: PNG, type: 'image/png' });
  // an SVG (could carry script) under the old loose check: never served
  assert.equal(screenshotFromLegacyText('data:image/svg+xml;base64,' + Buffer.from('<svg onload="x()"/>').toString('base64')), null);
  // declared PNG but bytes are SVG: never served as anything
  assert.equal(screenshotFromLegacyText('data:image/png;base64,' + Buffer.from('<svg/>').toString('base64')), null);
  assert.equal(screenshotFromLegacyText('nonsense'), null);
  assert.equal(screenshotFromLegacyText(null), null);
});

test('parseDuplicateOf: plain digits only (no hex / exponent / spaces inside)', () => {
  assert.throws(() => parseDuplicateOf('0x10', 99), /card number/);
  assert.throws(() => parseDuplicateOf('1e2', 99), /card number/);
  assert.throws(() => parseDuplicateOf('1 2', 99), /card number/);
  assert.equal(parseDuplicateOf(' 12 ', 99), 12);
});

test('sanitizeContext: keeps the page build commit (hex only)', () => {
  assert.equal(sanitizeContext({ clientCommit: 'abc1234' }).clientCommit, 'abc1234');
  assert.equal(sanitizeContext({ clientCommit: '<script>' }).clientCommit, null);
});
