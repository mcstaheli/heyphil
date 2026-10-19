// Rules for the Design board (Shared Service Tools -> Design): design
// requests moving through their own Kanban columns. Kept free of database
// imports so scripts/tests can check them directly.

// Mirrored in client/src/DesignBoard.js - keep in sync. No forward-only
// restriction, same as the other boards: a card can move either way.
export const DESIGN_COLUMNS = ['requested', 'scoping', 'in-design', 'in-review', 'revisions', 'delivered', 'on-hold'];

export const MAX_DELIVERABLE_LENGTH = 300;

export class DesignValidationError extends Error {}

export function validateDeliverable(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new DesignValidationError('A design request needs a deliverable.');
  if (text.length > MAX_DELIVERABLE_LENGTH) {
    throw new DesignValidationError(`Keep the deliverable under ${MAX_DELIVERABLE_LENGTH} characters.`);
  }
  return text;
}

export function validateStatus(value) {
  if (!DESIGN_COLUMNS.includes(value)) {
    throw new DesignValidationError(`status must be one of ${DESIGN_COLUMNS.join(', ')}`);
  }
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A project is optional; '' or null clears it.
export function validateProjectId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new DesignValidationError('That project id isn\'t valid.');
  }
  return value;
}

// yyyy-mm-dd or empty (clears it).
export function validateDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  // Round-trip through UTC so a day that doesn't exist (2026-02-30) is
  // refused here rather than by Postgres.
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new DesignValidationError(`${label} must be a date (yyyy-mm-dd).`);
  }
  return value;
}

// Plain text fields with a length cap; empty clears them.
export function validateText(value, label, max) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new DesignValidationError(`${label} must be text.`);
  const text = value.trim();
  if (text.length > max) throw new DesignValidationError(`Keep ${label.toLowerCase()} under ${max} characters.`);
  return text || null;
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Files link: http(s) only, so a card can't carry a javascript: URL.
export function validateLink(value) {
  const text = validateText(value, 'Link', 2000);
  if (text === null) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new DesignValidationError('Link must be a full web address (https://...).');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new DesignValidationError('Link must start with https:// or http://.');
  }
  return text;
}

// delivered_at follows the card: 'now' when it moves into Delivered (the
// database stamps it, same clock as requested_at), null if it moves back
// out, undefined to leave the column alone.
export function deliveredAtFor(fromStatus, toStatus) {
  if (toStatus === undefined || toStatus === fromStatus) return undefined;
  if (toStatus === 'delivered') return 'now';
  if (fromStatus === 'delivered') return null;
  return undefined;
}
