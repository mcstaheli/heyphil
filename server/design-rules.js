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

// ---- Priority (#42) -------------------------------------------------------

// Mirrored in client/src/designOptions.js - keep in sync.
export const DESIGN_PRIORITIES = ['urgent', 'high', 'normal', 'low'];

export function validatePriority(value) {
  if (!DESIGN_PRIORITIES.includes(value)) {
    throw new DesignValidationError(`priority must be one of ${DESIGN_PRIORITIES.join(', ')}`);
  }
  return value;
}

// ---- Editable option lists (#40, #41) --------------------------------------

// The lists the board's settings gear edits, with what they start as.
export const DESIGN_OPTION_LISTS = {
  deliverableTypes: ['Poster', 'Logo', 'Website', 'One-pager', 'Signage', 'Brochure', 'Social media', 'Presentation', 'Other'],
  outputTypes: ['PDF', 'Print-ready PDF', 'Google Slides', 'PowerPoint', 'PNG', 'JPG', 'SVG', 'Illustrator (AI)', 'InDesign', 'Other'],
};

export const MAX_OPTIONS = 50;
export const MAX_OPTION_LENGTH = 100;

// Trimmed, blanks and repeats (ignoring case) dropped, order kept.
export function validateOptionList(value, label) {
  if (!Array.isArray(value)) throw new DesignValidationError(`${label} must be a list.`);
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new DesignValidationError(`${label} must be a list of text.`);
    const text = item.trim();
    if (!text) continue;
    if (text.length > MAX_OPTION_LENGTH) {
      throw new DesignValidationError(`Keep each of ${label.toLowerCase()} under ${MAX_OPTION_LENGTH} characters.`);
    }
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  if (out.length > MAX_OPTIONS) throw new DesignValidationError(`Keep ${label.toLowerCase()} to ${MAX_OPTIONS} options.`);
  return out;
}

// ---- Journal (#43) ------------------------------------------------------

// comment/draft/final are posted by people; status and email entries are
// written by the server as a record of what happened.
export const JOURNAL_POSTABLE_KINDS = ['comment', 'draft', 'final'];
export const JOURNAL_KINDS = [...JOURNAL_POSTABLE_KINDS, 'status', 'email'];

export function validateJournalEntry({ kind, body, link }) {
  if (!JOURNAL_POSTABLE_KINDS.includes(kind)) {
    throw new DesignValidationError(`kind must be one of ${JOURNAL_POSTABLE_KINDS.join(', ')}`);
  }
  const text = validateText(body, 'The note', 5000);
  const url = validateLink(link);
  return { kind, body: text, link: url };
}

// Posting a draft puts the card in front of the requester; posting the
// final delivers it. Returns the stage to move to, or null to stay.
export function stageAfterPosting(kind, currentStatus) {
  if (kind === 'draft' && ['requested', 'scoping', 'in-design', 'revisions'].includes(currentStatus)) return 'in-review';
  if (kind === 'final' && currentStatus !== 'delivered') return 'delivered';
  return null;
}

// ---- Attachments (#37) --------------------------------------------------

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_REQUEST = 50;

// A filename safe to store and to put in a Content-Disposition header:
// no path, no control characters, capped length.
export function cleanFilename(value) {
  let name = typeof value === 'string' ? value : '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // leave it as sent
  }
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  if (!name) name = 'file';
  if (name.length > 200) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name;
}

// Only these are shown inline in the browser; everything else downloads.
// SVG is left out on purpose - it can carry script.
export function isPreviewableType(contentType) {
  return /^image\/(png|jpe?g|gif|webp)$/i.test(contentType || '') || /^application\/pdf$/i.test(contentType || '');
}

// The "a draft is waiting for your comments" email.
export function buildDraftEmail({ request, entry, authorName, appUrl, attachmentName }) {
  const escape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cardUrl = `${appUrl}/shared/design?request=${request.id}`;
  const what = request.deliverable + (request.projectTitle ? ` (${request.projectTitle})` : '');
  const lines = [
    `<p>Hi ${escape((request.requesterName || '').split(' ')[0] || 'there')},</p>`,
    `<p>${escape(authorName || 'The designer')} posted a draft of <b>${escape(what)}</b> and it's waiting for your comments.</p>`,
  ];
  if (entry.body) lines.push(`<blockquote style="margin: 0 0 12px; padding-left: 12px; border-left: 3px solid #ddd; color: #555;">${escape(entry.body).replace(/\n/g, '<br>')}</blockquote>`);
  if (entry.link) lines.push(`<p>Draft: <a href="${escape(entry.link)}">${escape(entry.link)}</a></p>`);
  if (attachmentName) lines.push(`<p>Attached on the card: ${escape(attachmentName)}</p>`);
  lines.push(`<p><a href="${escape(cardUrl)}">Open the request in HeyPhil</a> to leave your comments.</p>`);
  return {
    from: 'HeyPhil <noreply@heyphil.bot>',
    to: request.requesterEmail,
    subject: `Draft ready for your comments: ${request.deliverable}`,
    html: lines.join('\n'),
  };
}
