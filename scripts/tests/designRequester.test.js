import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requesterFor, DesignValidationError } from '../../server/design-rules.js';

const actor = { name: 'Kallie Lowery', email: 'kallie@philo.ventures' };
const greg = { name: 'Greg', email: 'greg@philo.ventures' };

test('requesterFor: a name matching People uses that person (their exact name and email)', () => {
  assert.deepEqual(requesterFor('greg', greg, actor, { isNew: true }), { name: 'Greg', email: 'greg@philo.ventures' });
  assert.deepEqual(requesterFor('Greg', { name: 'Greg', email: null }, actor, { isNew: true }), { name: 'Greg', email: null });
});

test('requesterFor: any other name on a new request -> the submitter\'s email ("Your name")', () => {
  assert.deepEqual(requesterFor('  Jane from Marketing ', null, actor, { isNew: true }), { name: 'Jane from Marketing', email: 'kallie@philo.ventures' });
});

test('requesterFor: any other name on an edit has no email - never the previous requester\'s', () => {
  // Tracy's request renamed to someone not in People must not keep emailing Tracy
  assert.deepEqual(requesterFor('Bob Jones', null, actor, { isNew: false, existingEmail: 'tracy@x.com' }), { name: 'Bob Jones', email: null });
});

test('requesterFor: blank on a new request -> the submitter; blank on an edit -> nobody', () => {
  assert.deepEqual(requesterFor('', null, actor, { isNew: true }), { name: 'Kallie Lowery', email: 'kallie@philo.ventures' });
  assert.deepEqual(requesterFor('   ', null, actor, { isNew: false, existingEmail: 'x@x.com' }), { name: null, email: null });
});

test('requesterFor: too long is refused', () => {
  assert.throws(() => requesterFor('x'.repeat(256), null, actor, { isNew: true }), DesignValidationError);
});
