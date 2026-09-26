import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertForwardMove, ForwardOnlyViolationError } from '../../server/board-db.js';

function assertBlocked(from, to) {
  assert.throws(() => assertForwardMove(from, to), ForwardOnlyViolationError);
}

function assertAllowed(from, to) {
  assert.doesNotThrow(() => assertForwardMove(from, to));
}

test('same status is always a no-op', () => {
  assertAllowed('on-deck', 'on-deck');
  assertAllowed('exited', 'exited');
});

test('forward moves within the origination pipeline are allowed', () => {
  assertAllowed('on-deck', 'diligence');
  assertAllowed('ideation', 'on-deck');
  // Build is skippable - a rank jump, not a hit on every rank, is fine.
  assertAllowed('handoff', 'operate');
});

test('backward moves within the origination pipeline are rejected', () => {
  assertBlocked('diligence', 'on-deck');
  assertBlocked('operate', 'handoff');
  assertBlocked('assets', 'on-deck');
});

test('terminal stages (Abandoned/Exited) are dead ends - not even to each other', () => {
  assertBlocked('abandoned', 'exited');
  assertBlocked('exited', 'abandoned');
  // Also can't leave a terminal stage for anything else, forward or not.
  assertBlocked('abandoned', 'on-deck');
  assertBlocked('exited', 'assets');
});

test('entering a terminal stage from any earlier active stage is still allowed', () => {
  assertAllowed('on-deck', 'abandoned');
  assertAllowed('operate', 'abandoned');
  assertAllowed('assets', 'exited');
  assertAllowed('ideation', 'exited');
});

test('crossing between the origination pipeline and Studio/unknown statuses is rejected', () => {
  assertBlocked('on-deck', 'studio-launch');
  assertBlocked('studio-launch', 'on-deck');
  assertBlocked('exited', 'studio-exited');
});

test('Studio-board statuses (both sides unranked) move freely', () => {
  assertAllowed('studio-launch', 'studio-diligence');
  assertAllowed('studio-exited', 'studio-abandoned');
});
