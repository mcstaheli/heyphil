import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSameBoardFamily, ForwardOnlyViolationError } from '../../server/board-db.js';

function assertBlocked(from, to) {
  assert.throws(() => assertSameBoardFamily(from, to), ForwardOnlyViolationError);
}

function assertAllowed(from, to) {
  assert.doesNotThrow(() => assertSameBoardFamily(from, to));
}

test('same status is always a no-op', () => {
  assertAllowed('on-deck', 'on-deck');
  assertAllowed('exited', 'exited');
});

test('cards move freely in either direction within the origination pipeline', () => {
  assertAllowed('on-deck', 'diligence');
  assertAllowed('ideation', 'on-deck');
  assertAllowed('diligence', 'on-deck');
  assertAllowed('operate', 'handoff');
  assertAllowed('assets', 'on-deck');
});

test('terminal stages (Abandoned/Exited) are no longer dead ends', () => {
  assertAllowed('abandoned', 'exited');
  assertAllowed('exited', 'abandoned');
  assertAllowed('abandoned', 'on-deck');
  assertAllowed('exited', 'assets');
});

test('crossing between the origination pipeline and Studio/unknown statuses is still rejected', () => {
  assertBlocked('on-deck', 'studio-launch');
  assertBlocked('studio-launch', 'on-deck');
  assertBlocked('exited', 'studio-exited');
});

test('Studio-board statuses (both sides unranked) move freely', () => {
  assertAllowed('studio-launch', 'studio-diligence');
  assertAllowed('studio-exited', 'studio-abandoned');
});
