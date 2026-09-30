// Who may edit or delete an Activity Log entry - enforced by PATCH/DELETE
// /api/origination/log/:id. Mirrors canModifyNote/noteAuthorName in
// client/src/activityLog.js (which only decides whether to show the
// controls); scripts/tests/activityLog.test.js checks the two agree. Kept
// as a copy because importing client/src from the server makes Node warn
// on every boot (client/package.json isn't "type": "module").
//   - 'Note': only its author.
//   - 'Notes (migrated)': any signed-in user - it came from the old shared
//     Notes field, which anyone could edit.
//   - System activity: never.

// The author string stored on a note (activity_log.user_name).
export function noteAuthorName(user) {
  return (user && (user.name || user.email)) || '';
}

export function canModifyNote(entry, userName) {
  if (!entry || !userName) return false;
  if (entry.action === 'Notes (migrated)') return true;
  return entry.action === 'Note' && entry.user === userName;
}
