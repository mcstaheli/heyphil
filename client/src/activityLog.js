// Activity Log helpers for CardModal. A card's log mixes two kinds of
// entries: notes a person wrote themselves, which are what matter most when
// scanning a card, and system activity (moves, field edits, task changes).
// The modal highlights the former.

// 'Note' is what "+ Add Note" writes (POST /api/origination/log);
// 'Notes (migrated)' is the old free-text Notes field, copied into the log
// by server/migrations/006-notes-to-activity-log.js.
export const NOTE_ACTIONS = ['Note', 'Notes (migrated)'];

export function isNoteEntry(entry) {
  return !!entry && NOTE_ACTIONS.includes(entry.action);
}

// The author string stored on a note (activity_log.user_name) - the same
// `name || email` the server uses when it writes one, so client and server
// agree on whose note it is.
export function noteAuthorName(user) {
  return (user && (user.name || user.email)) || '';
}

// Who may edit or delete a log entry. The server enforces its own copy of
// this (server/note-permissions.js - scripts/tests/activityLog.test.js
// checks they agree); the client only uses it to decide whether to show
// the controls.
//   - 'Note': only its author.
//   - 'Notes (migrated)': any signed-in user - it came from the old shared
//     Notes field, which anyone could edit.
//   - System activity: never.
export function canModifyNote(entry, userName) {
  if (!entry || !userName) return false;
  if (entry.action === 'Notes (migrated)') return true;
  return entry.action === 'Note' && entry.user === userName;
}
