import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoteEntry, canModifyNote, noteAuthorName } from '../../client/src/activityLog.js';
import * as server from '../../server/note-permissions.js';

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

test('canModifyNote: only the author can change their own note', () => {
  const note = { action: 'Note', user: 'Chad Staheli', details: 'called Brian' };
  assert.equal(canModifyNote(note, 'Chad Staheli'), true);
  assert.equal(canModifyNote(note, 'Greg'), false);
  assert.equal(canModifyNote(note, ''), false);
  assert.equal(canModifyNote(note, undefined), false);
});

test('canModifyNote: migrated notes are editable by any signed-in user', () => {
  // They came from the old shared Notes field, which anyone could edit.
  const migrated = { action: 'Notes (migrated)', user: null, details: 'old notes' };
  assert.equal(canModifyNote(migrated, 'Greg'), true);
  assert.equal(canModifyNote(migrated, ''), false);
});

test('canModifyNote: system activity is never editable', () => {
  const sys = { action: 'Updated', user: 'Chad Staheli', details: 'Status: build → capitalize' };
  assert.equal(canModifyNote(sys, 'Chad Staheli'), false);
  assert.equal(canModifyNote(null, 'Chad Staheli'), false);
});

test('noteAuthorName: name, else email', () => {
  assert.equal(noteAuthorName({ name: 'Chad Staheli', email: 'c@x.com' }), 'Chad Staheli');
  assert.equal(noteAuthorName({ email: 'c@x.com' }), 'c@x.com');
  assert.equal(noteAuthorName(null), '');
});

test('server and client note permissions agree', () => {
  const entries = [
    { action: 'Note', user: 'Chad Staheli' },
    { action: 'Note', user: 'Greg' },
    { action: 'Notes (migrated)', user: null },
    { action: 'Updated', user: 'Chad Staheli' },
    null,
  ];
  const users = [{ name: 'Chad Staheli', email: 'c@x.com' }, { email: 'greg@x.com' }, null];
  for (const user of users) {
    assert.equal(server.noteAuthorName(user), noteAuthorName(user));
    for (const entry of entries) {
      const name = noteAuthorName(user);
      assert.equal(server.canModifyNote(entry, name), canModifyNote(entry, name), JSON.stringify({ entry, user }));
    }
  }
});
