import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRejectionNote } from '../auto-fix/finalize.mjs';

test('no existing note - just the decline reason', () => {
  assert.equal(
    buildRejectionNote(undefined, 'smoke test failed'),
    'Auto-fix attempt declined: smoke test failed'
  );
  assert.equal(
    buildRejectionNote(null, 'smoke test failed'),
    'Auto-fix attempt declined: smoke test failed'
  );
  assert.equal(
    buildRejectionNote('', 'smoke test failed'),
    'Auto-fix attempt declined: smoke test failed'
  );
});

test('existing note is kept, not overwritten', () => {
  const result = buildRejectionNote('This looks like a genuine bug.', 'verifier rejected the diff');
  assert.equal(
    result,
    'This looks like a genuine bug.\n\nAuto-fix attempt declined: verifier rejected the diff'
  );
});

test('repeated declines stack rather than replace each other', () => {
  const first = buildRejectionNote('Original triage note.', 'reason one');
  const second = buildRejectionNote(first, 'reason two');
  assert.equal(
    second,
    'Original triage note.\n\nAuto-fix attempt declined: reason one\n\nAuto-fix attempt declined: reason two'
  );
});
