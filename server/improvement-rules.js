// Validation for the Improvements board (routes/improvements.js,
// improvements-db.js, and scripts/improvements.js all go through these).
// Pure - tested in scripts/tests/improvementRules.test.js.

export class ImprovementValidationError extends Error {}

// ---- screenshots ----
export const SCREENSHOT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Decoded size. The reporter sends a <=1600px-wide JPEG (~100-500 KB);
// this is a generous ceiling, well under express.json's 10 MB body limit.
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

// The image type from the file's own signature bytes, or null.
export function sniffImageType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// "data:image/jpeg;base64,..." -> { buffer, type }. The declared type must
// be one we serve AND match the bytes - the screenshot route sends these
// back with that Content-Type, so a mislabeled file must not get through.
export function parseScreenshotDataUri(value) {
  const m = typeof value === 'string' && /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/s.exec(value);
  if (!m) throw new ImprovementValidationError('screenshot must be a data:image/... base64 URI');
  const type = m[1].toLowerCase();
  if (!SCREENSHOT_TYPES.includes(type)) {
    throw new ImprovementValidationError('screenshot must be a JPEG, PNG or WebP image');
  }
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0) throw new ImprovementValidationError('screenshot is empty');
  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new ImprovementValidationError(`screenshot is too large (max ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MB)`);
  }
  if (sniffImageType(buffer) !== type) {
    throw new ImprovementValidationError(`screenshot data doesn't match its declared type (${type})`);
  }
  return { buffer, type };
}

// A screenshot stored the OLD way (a data: URI in the `screenshot` TEXT
// column, before the board upgrade) -> { buffer, type }, or null. Served
// only if the bytes really are JPEG/PNG/WebP, typed by the bytes: the old
// upload check accepted any "data:image/..." - including SVG, which can
// carry script and would run on this origin if opened directly.
export function screenshotFromLegacyText(text) {
  const m = typeof text === 'string' && /^data:image\/[a-z0-9.+-]+;base64,(.*)$/s.exec(text);
  if (!m) return null;
  const buffer = Buffer.from(m[1], 'base64');
  const type = sniffImageType(buffer);
  return type ? { buffer, type } : null;
}

// ---- board columns ----
// The Improvements board's columns (status values). No forward-only
// restriction - a card can move to any column. Mirrored in
// client/src/Improvements.js COLUMNS.
export const IMPROVEMENT_COLUMNS = ['intake', 'triaged-bugs', 'triaged-features', 'shipped', 'abandoned'];

// ---- reporter hint / triage fields ----
export const REPORTER_HINTS = ['broken', 'idea', 'unsure'];
export const PRIORITIES = ['high', 'normal', 'low'];
export const RESOLVED_STATUSES = ['shipped', 'abandoned'];

// Optional on a new report: null when not given.
export function validateReporterHint(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!REPORTER_HINTS.includes(value)) {
    throw new ImprovementValidationError(`reporterHint must be one of ${REPORTER_HINTS.join(', ')}`);
  }
  return value;
}

export function validatePriority(value) {
  if (!PRIORITIES.includes(value)) {
    throw new ImprovementValidationError(`priority must be one of ${PRIORITIES.join(', ')}`);
  }
  return value;
}

// Another card's #number (accepts 7, "7" or "#7"); null/"" clears it.
// Whether that card exists is checked against the database by the caller.
export function parseDuplicateOf(value, ownSeqNum) {
  if (value === undefined || value === null || value === '') return null;
  const raw = typeof value === 'number' ? String(value) : String(value).trim().replace(/^#/, '');
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN; // plain digits - no 0x10 / 1e2
  if (!Number.isInteger(n) || n <= 0) {
    throw new ImprovementValidationError('duplicateOf must be another card number, e.g. 7');
  }
  if (ownSeqNum !== undefined && ownSeqNum !== null && n === Number(ownSeqNum)) {
    throw new ImprovementValidationError("a card can't be a duplicate of itself");
  }
  return n;
}

// What resolved_at should become when a card moves prevStatus -> nextStatus:
// a Date to set it, null to clear it, undefined to leave it alone.
//   into Shipped/Abandoned from an open column -> now
//   out of Shipped/Abandoned into an open column (reopened) -> null
//   Shipped <-> Abandoned -> keep the original time
export function resolvedAtFor(prevStatus, nextStatus, prevResolvedAt, now = new Date()) {
  if (nextStatus === undefined || nextStatus === prevStatus) return undefined;
  const wasResolved = RESOLVED_STATUSES.includes(prevStatus);
  const isResolved = RESOLVED_STATUSES.includes(nextStatus);
  if (isResolved && !wasResolved) return now;
  if (!isResolved && wasResolved) return null;
  if (isResolved && wasResolved) return prevResolvedAt || now;
  return undefined;
}

// ---- report context ----
const MAX_ERRORS = 20;
const cap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

// What the reporter sends about the page it was on: { viewport, userAgent,
// errors }. Only those fields, sizes capped - it's stored as JSONB and
// shown in the card modal.
export function sanitizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return null;
  const vp = ctx.viewport;
  const viewport = vp && Number.isFinite(Number(vp.width)) && Number.isFinite(Number(vp.height))
    ? { width: Math.round(Number(vp.width)), height: Math.round(Number(vp.height)) }
    : null;
  const errors = Array.isArray(ctx.errors)
    ? ctx.errors.slice(-MAX_ERRORS).filter((e) => e && typeof e === 'object').map((e) => ({
      message: cap(e.message, 500) || '',
      stack: cap(e.stack, 500),
      source: cap(e.source, 40),
      time: cap(e.time, 40),
    }))
    : [];
  // The page's own build (the client is a separate Cloudflare Pages build,
  // which can lag the API's RAILWAY_GIT_COMMIT_SHA after a deploy).
  const clientCommit = typeof ctx.clientCommit === 'string' && /^[0-9a-f]{7,40}$/i.test(ctx.clientCommit)
    ? ctx.clientCommit : null;
  return { viewport, userAgent: cap(ctx.userAgent, 500), errors, clientCommit };
}
