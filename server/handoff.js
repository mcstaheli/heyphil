// Handoff is a STATE a card can be in, not a board stage: "Begin Handoff"
// names a second person (the handoff lead) and starts the days-in-handoff
// clock; "End Handoff" makes the handoff lead the card's owner (the
// originating lead is removed); "Cancel Handoff" drops it with the owner
// unchanged. The card's stage never changes. Stored in projects.handoff:
//   { lead, originator, startedAt, startedBy }   or NULL when not in handoff
//
// These are the pure rules; board-db.js applies them inside a locked
// transaction (beginHandoff / endHandoff / cancelHandoff). Tested in
// scripts/tests/handoff.test.js.

export class HandoffNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HandoffNotReadyError';
  }
}

export function planBeginHandoff(row, lead, startedBy, now = new Date()) {
  if (row.status && row.status.startsWith('studio-')) {
    throw new HandoffNotReadyError('Handoff is only for origination projects, not the Studio board.');
  }
  if (row.handoff) {
    throw new HandoffNotReadyError('This project is already in handoff.');
  }
  const name = (lead || '').trim();
  if (!name) {
    throw new HandoffNotReadyError('Choose who is taking over.');
  }
  if (name === row.owner) {
    throw new HandoffNotReadyError('The handoff lead must be someone other than the current lead.');
  }
  return {
    handoff: {
      lead: name,
      originator: row.owner || null,
      startedAt: now.toISOString(),
      startedBy: startedBy || null,
    },
  };
}

function requireInHandoff(row) {
  if (!row.handoff || !row.handoff.lead) {
    throw new HandoffNotReadyError('This project is not in handoff.');
  }
}

export function planEndHandoff(row) {
  requireInHandoff(row);
  return {
    owner: row.handoff.lead,
    handoff: null,
    // Whoever actually owns it right now is who's being replaced - that's
    // normally the originator recorded at Begin, unless the owner was
    // changed by hand mid-handoff. If it was changed to the handoff lead
    // themselves, the one being replaced is still the recorded originator.
    originator: (row.owner && row.owner !== row.handoff.lead ? row.owner : row.handoff.originator) || null,
    lead: row.handoff.lead,
  };
}

export function planCancelHandoff(row) {
  requireInHandoff(row);
  return { handoff: null, lead: row.handoff.lead };
}
