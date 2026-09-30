import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planBeginHandoff,
  planEndHandoff,
  planCancelHandoff,
  HandoffNotReadyError,
} from '../../server/handoff.js';

const NOW = new Date('2026-09-30T18:00:00Z');
const row = (extra = {}) => ({ status: 'capitalize', owner: 'Chad', handoff: null, ...extra });

test('planBeginHandoff: starts a handoff to a second person, stage untouched', () => {
  const plan = planBeginHandoff(row(), 'Greg', 'Chad Staheli', NOW);
  assert.deepEqual(plan.handoff, {
    lead: 'Greg',
    originator: 'Chad',
    startedAt: '2026-09-30T18:00:00.000Z',
    startedBy: 'Chad Staheli',
  });
  assert.equal('status' in plan, false); // handoff is a state, not a stage change
});

test('planBeginHandoff: trims the lead name', () => {
  assert.equal(planBeginHandoff(row(), '  Greg ', 'x', NOW).handoff.lead, 'Greg');
});

test('planBeginHandoff: works from an unassigned card', () => {
  assert.equal(planBeginHandoff(row({ owner: null }), 'Greg', 'x', NOW).handoff.originator, null);
});

test('planBeginHandoff: refuses bad requests', () => {
  assert.throws(() => planBeginHandoff(row({ handoff: { lead: 'Tracy' } }), 'Greg', 'x', NOW), HandoffNotReadyError);
  assert.throws(() => planBeginHandoff(row(), '', 'x', NOW), /Choose who/);
  assert.throws(() => planBeginHandoff(row(), '   ', 'x', NOW), /Choose who/);
  assert.throws(() => planBeginHandoff(row(), 'Chad', 'x', NOW), /someone other than/);
  assert.throws(() => planBeginHandoff(row({ status: 'studio-launch' }), 'Greg', 'x', NOW), /Studio/);
});

test('planEndHandoff: handoff lead takes over, originator removed, handoff cleared', () => {
  const r = row({ handoff: { lead: 'Greg', originator: 'Chad', startedAt: '2026-09-01T00:00:00Z' } });
  assert.deepEqual(planEndHandoff(r), { owner: 'Greg', handoff: null, originator: 'Chad', lead: 'Greg' });
});

test('planEndHandoff: reports the current owner as originator if it changed mid-handoff', () => {
  const r = row({ owner: 'Tracy', handoff: { lead: 'Greg', originator: 'Chad' } });
  assert.equal(planEndHandoff(r).originator, 'Tracy');
});

test('planEndHandoff / planCancelHandoff: only while in handoff', () => {
  assert.throws(() => planEndHandoff(row()), /not in handoff/);
  assert.throws(() => planCancelHandoff(row()), /not in handoff/);
});

test('planCancelHandoff: clears the handoff, owner unchanged', () => {
  const r = row({ handoff: { lead: 'Greg', originator: 'Chad' } });
  assert.deepEqual(planCancelHandoff(r), { handoff: null, lead: 'Greg' });
});

test('planEndHandoff: owner already switched to the lead mid-handoff - originator is the recorded one', () => {
  const r = row({ owner: 'Greg', handoff: { lead: 'Greg', originator: 'Chad' } });
  assert.equal(planEndHandoff(r).originator, 'Chad');
  assert.equal(planEndHandoff(r).owner, 'Greg');
});
