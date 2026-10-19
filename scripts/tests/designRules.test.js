import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESIGN_COLUMNS,
  DesignValidationError,
  deliveredAtFor,
  validateDate,
  validateDeliverable,
  validateLink,
  validateProjectId,
  validateStatus,
  validateText,
  isUuid,
} from '../../server/design-rules.js';

test('columns: six stages plus On Hold, in board order', () => {
  assert.deepEqual(DESIGN_COLUMNS, ['requested', 'scoping', 'in-design', 'in-review', 'revisions', 'delivered', 'on-hold']);
});

test('validateDeliverable: required, trimmed, capped', () => {
  assert.equal(validateDeliverable('  Lobby signage  '), 'Lobby signage');
  assert.throws(() => validateDeliverable('   '), DesignValidationError);
  assert.throws(() => validateDeliverable(undefined), DesignValidationError);
  assert.throws(() => validateDeliverable('x'.repeat(301)), DesignValidationError);
});

test('validateStatus: only known columns', () => {
  assert.equal(validateStatus('in-review'), 'in-review');
  assert.throws(() => validateStatus('done'), DesignValidationError);
});

test('validateProjectId: optional uuid', () => {
  assert.equal(validateProjectId(''), null);
  assert.equal(validateProjectId(null), null);
  const id = '670c4019-27c8-40e5-a7d4-999f106f9a15';
  assert.equal(validateProjectId(id), id);
  assert.throws(() => validateProjectId('1; drop table'), DesignValidationError);
});

test('validateDate: yyyy-mm-dd or empty', () => {
  assert.equal(validateDate('2026-11-03', 'Due date'), '2026-11-03');
  assert.equal(validateDate('', 'Due date'), null);
  assert.throws(() => validateDate('11/3/2026', 'Due date'), DesignValidationError);
  assert.throws(() => validateDate('2026-02-30', 'Due date'), DesignValidationError);
  assert.throws(() => validateDate('2026-13-01', 'Due date'), DesignValidationError);
  assert.equal(validateDate('2028-02-29', 'Due date'), '2028-02-29');
});

test('validateText: trims, empties to null, caps length', () => {
  assert.equal(validateText('  Easton ', 'Designer', 255), 'Easton');
  assert.equal(validateText('   ', 'Designer', 255), null);
  assert.throws(() => validateText('x'.repeat(256), 'Designer', 255), DesignValidationError);
  assert.throws(() => validateText(5, 'Designer', 255), DesignValidationError);
});

test('validateLink: http(s) only', () => {
  assert.equal(validateLink('https://drive.google.com/x'), 'https://drive.google.com/x');
  assert.equal(validateLink(''), null);
  assert.throws(() => validateLink('javascript:alert(1)'), DesignValidationError);
  assert.throws(() => validateLink('drive folder'), DesignValidationError);
});

test('deliveredAtFor: set on entering Delivered, cleared on leaving, else untouched', () => {
  assert.equal(deliveredAtFor('in-review', 'delivered'), 'now');
  assert.equal(deliveredAtFor('delivered', 'revisions'), null);
  assert.equal(deliveredAtFor('requested', 'scoping'), undefined);
  assert.equal(deliveredAtFor('delivered', 'delivered'), undefined);
  assert.equal(deliveredAtFor('requested', undefined), undefined);
});

test('isUuid: path ids are checked before they reach the database', () => {
  assert.equal(isUuid('670c4019-27c8-40e5-a7d4-999f106f9a15'), true);
  assert.equal(isUuid('abc'), false);
  assert.equal(isUuid(undefined), false);
});

import {
  DESIGN_PRIORITIES,
  DESIGN_OPTION_LISTS,
  buildDraftEmail,
  cleanFilename,
  isPreviewableType,
  stageAfterPosting,
  validateJournalEntry,
  validateOptionList,
  validatePriority,
} from '../../server/design-rules.js';

test('priorities: urgent to low, and only those', () => {
  assert.deepEqual(DESIGN_PRIORITIES, ['urgent', 'high', 'normal', 'low']);
  assert.equal(validatePriority('high'), 'high');
  assert.throws(() => validatePriority('critical'), DesignValidationError);
});

test('client priority list matches the server', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../client/src/designOptions.js', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/\{ id: '([a-z]+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(ids, DESIGN_PRIORITIES);
});

test('validateOptionList: trims, drops blanks and repeats, caps', () => {
  assert.deepEqual(validateOptionList([' Poster ', '', 'poster', 'Logo'], 'Types'), ['Poster', 'Logo']);
  assert.throws(() => validateOptionList('Poster', 'Types'), DesignValidationError);
  assert.throws(() => validateOptionList([5], 'Types'), DesignValidationError);
  assert.throws(() => validateOptionList(['x'.repeat(101)], 'Types'), DesignValidationError);
  assert.throws(() => validateOptionList(Array.from({ length: 51 }, (_, i) => `t${i}`), 'Types'), DesignValidationError);
  assert.ok(DESIGN_OPTION_LISTS.deliverableTypes.includes('Poster'));
  assert.ok(DESIGN_OPTION_LISTS.outputTypes.includes('Google Slides'));
});

test('validateJournalEntry: only people-posted kinds, safe links', () => {
  assert.deepEqual(validateJournalEntry({ kind: 'draft', body: ' v2 ', link: 'https://x.com/a' }), { kind: 'draft', body: 'v2', link: 'https://x.com/a' });
  assert.throws(() => validateJournalEntry({ kind: 'status', body: 'x' }), DesignValidationError);
  assert.throws(() => validateJournalEntry({ kind: 'comment', link: 'javascript:alert(1)' }), DesignValidationError);
});

test('stageAfterPosting: a draft goes to In Review, a final to Delivered', () => {
  assert.equal(stageAfterPosting('draft', 'in-design'), 'in-review');
  assert.equal(stageAfterPosting('draft', 'revisions'), 'in-review');
  assert.equal(stageAfterPosting('draft', 'in-review'), null);
  assert.equal(stageAfterPosting('draft', 'on-hold'), null);
  assert.equal(stageAfterPosting('final', 'in-review'), 'delivered');
  assert.equal(stageAfterPosting('final', 'delivered'), null);
  assert.equal(stageAfterPosting('comment', 'requested'), null);
});

test('cleanFilename: no paths, no control characters or quotes, capped', () => {
  assert.equal(cleanFilename('..%2F..%2Fetc%2Fpasswd'), 'passwd');
  assert.equal(cleanFilename('C:\\Users\\me\\poster.pdf'), 'poster.pdf');
  assert.equal(cleanFilename('bad"\nname.png'), 'badname.png');
  assert.equal(cleanFilename(''), 'file');
  const long = cleanFilename(`${'a'.repeat(300)}.pdf`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.pdf'));
});

test('isPreviewableType: images and PDF, never SVG or HTML', () => {
  assert.equal(isPreviewableType('image/png'), true);
  assert.equal(isPreviewableType('application/pdf'), true);
  assert.equal(isPreviewableType('image/svg+xml'), false);
  assert.equal(isPreviewableType('text/html'), false);
});

test('buildDraftEmail: addressed to the requester, escaped, links to the card', () => {
  const email = buildDraftEmail({
    request: { id: 'abc', deliverable: 'Lobby <sign>', projectTitle: 'Zion', requesterName: 'Chad Staheli', requesterEmail: 'chad@x.com' },
    entry: { body: 'Look at\nthe colours', link: 'https://drive.google.com/x' },
    authorName: 'Kallie Lowery',
    appUrl: 'https://heyphil.bot',
    attachmentName: 'v2.pdf',
  });
  assert.equal(email.to, 'chad@x.com');
  assert.match(email.subject, /Draft ready for your comments: Lobby <sign>/);
  assert.match(email.html, /Hi Chad,/);
  assert.match(email.html, /Lobby &lt;sign&gt; \(Zion\)/);
  assert.match(email.html, /Look at<br>the colours/);
  assert.match(email.html, /https:\/\/heyphil\.bot\/shared\/design\?request=abc/);
  assert.match(email.html, /v2\.pdf/);
  assert.doesNotMatch(email.html, /<sign>/);
});
