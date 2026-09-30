import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoteEntry } from '../../client/src/activityLog.js';

test('isNoteEntry: notes a person wrote', () => {
  // "+ Add Note" in CardModal (POST /api/origination/log)
  assert.equal(isNoteEntry({ action: 'Note', details: 'called Brian' }), true);
  // Old free-text Notes field, copied in by migrations/006
  assert.equal(isNoteEntry({ action: 'Notes (migrated)', details: 'old notes' }), true);
});

test('isNoteEntry: system activity is not a note', () => {
  assert.equal(isNoteEntry({ action: 'Updated', details: 'Status: build → capitalize' }), false);
  assert.equal(isNoteEntry({ action: 'Task Completed', details: 'Button up equity raise' }), false);
  assert.equal(isNoteEntry({ action: 'Created', details: 'New project in development.' }), false);
  // An "Updated" entry that merely mentions notes is still system activity
  assert.equal(isNoteEntry({ action: 'Updated', details: 'Notes updated' }), false);
});

test('isNoteEntry: tolerates missing input', () => {
  assert.equal(isNoteEntry(null), false);
  assert.equal(isNoteEntry(undefined), false);
  assert.equal(isNoteEntry({}), false);
});
