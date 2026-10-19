// Shared bits of the Design board: priorities, card order, who a new
// request defaults to, and small formatters.

// Mirrors DESIGN_PRIORITIES in server/design-rules.js - keep in sync.
export const PRIORITIES = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
];

const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p.id, i]));

// Most urgent first; within a priority, the longest wait first.
export function compareRequests(a, b) {
  const pa = PRIORITY_RANK[a.priority] ?? PRIORITY_RANK.normal;
  const pb = PRIORITY_RANK[b.priority] ?? PRIORITY_RANK.normal;
  if (pa !== pb) return pa - pb;
  return new Date(a.requestedAt) - new Date(b.requestedAt);
}

// The designer a new request starts with.
export const DEFAULT_DESIGNER_FIRST_NAME = 'Kallie';

export function defaultDesigner(people) {
  const match = people.find((p) => p.name.split(' ')[0].toLowerCase() === DEFAULT_DESIGNER_FIRST_NAME.toLowerCase());
  return match ? match.name : DEFAULT_DESIGNER_FIRST_NAME;
}

// The signed-in person as they appear in People: by email, else by
// full name, else a first-name-only entry ("Chad" for "Chad Staheli") -
// never someone else who just shares the first name. '' if there's no
// match (the server then records them from their sign-in).
export function defaultRequester(people, user) {
  if (!user) return '';
  const email = (user.email || '').toLowerCase();
  const byEmail = email && people.find((p) => (p.email || '').toLowerCase() === email);
  if (byEmail) return byEmail.name;
  const full = (user.name || '').trim().toLowerCase();
  const first = full.split(' ')[0];
  const byName = full && (people.find((p) => p.name.toLowerCase() === full)
    || people.find((p) => !p.name.includes(' ') && p.name.toLowerCase() === first));
  return byName ? byName.name : '';
}

// A select's options, plus the current value if it's no longer in the
// list (so editing an older card doesn't silently drop it).
export function withCurrent(options, current) {
  return current && !options.includes(current) ? [...options, current] : options;
}

export function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // matches server/design-rules.js

// Posting a draft moves the card to In Review, a final to Delivered
// (mirrors stageAfterPosting in server/design-rules.js).
export function stageAfterPosting(kind, status) {
  if (kind === 'draft' && ['requested', 'scoping', 'in-design', 'revisions'].includes(status)) return 'in-review';
  if (kind === 'final' && status !== 'delivered') return 'delivered';
  return null;
}
