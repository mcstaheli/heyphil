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
