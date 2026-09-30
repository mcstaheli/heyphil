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
