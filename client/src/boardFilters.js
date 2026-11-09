// The Project Board's person filter ("All Owners" dropdown). A card matches
// if the person owns it OR has an open @-assigned task on it (Improvements
// #54) - so filtering by Tracy also shows the cards where Tracy has work.
// Tested in scripts/tests/boardTasks.test.js.

const isOpen = (a) => !a.completedOn;
// Names compared ignoring case and surrounding spaces - the server matches
// people with LOWER(name), so "tracy smith" and "Tracy Smith" are one person.
const same = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export function matchesPersonFilter(card, person) {
  if (!person) return true;
  if (same(card.owner, person)) return true;
  return (card.actions || []).some((a) => isOpen(a) && same(a.assignee, person));
}

// Which tasks a card shows while filtering by a person: on a card they
// don't own, just the ones assigned to them (why the card is there).
export function tasksShownFor(card, person) {
  const actions = card.actions || [];
  if (!person || same(card.owner, person)) return actions;
  return actions.filter((a) => same(a.assignee, person));
}
