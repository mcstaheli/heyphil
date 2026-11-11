// Modeling (Labs) - pure rules: the HeyPhil-folder boundary check, file
// names, the in-sheet status stamps, import classification and validation.
// No I/O here; tested in scripts/tests/modelingRules.test.js.

export class ModelingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------- boundary
// Walks a file's parent chain until it reaches `rootId`. Files in a shared
// drive have exactly one parent; the chain ends at the drive itself.
// `getMeta(id)` -> { id, parents, driveId, trashed }. Throws a
// ModelingError (403) for anything outside the root - including a file in
// a different shared drive, a trashed file, or a chain that never reaches
// the root. `known` (Set) short-circuits ids already verified inside.
export const MAX_FOLDER_DEPTH = 25;

export async function assertInsideRoot(fileId, { rootId, rootDriveId, getMeta, known }) {
  if (!fileId || typeof fileId !== 'string') throw new ModelingError('No Drive file given.', 400);
  if (fileId === rootId || (known && known.has(fileId))) return;
  const chain = [];
  let id = fileId;
  for (let depth = 0; depth < MAX_FOLDER_DEPTH; depth += 1) {
    const meta = await getMeta(id); // eslint-disable-line no-await-in-loop
    if (!meta) break;
    if (meta.trashed) throw new ModelingError('That Drive file is in the trash.', 403);
    if (rootDriveId && meta.driveId !== rootDriveId) break;
    chain.push(id);
    const parent = (meta.parents || [])[0];
    if (!parent) break;
    if (parent === rootId || (known && known.has(parent))) {
      if (known) chain.forEach((c) => known.add(c));
      return;
    }
    id = parent;
  }
  throw new ModelingError('Refused: that Drive file is outside the HeyPhil folder.', 403);
}

// ---------------------------------------------------------------- names
const DASH = ' — ';

// Text a person typed for a name - trimmed, not empty, no characters that
// would make a confusing Drive name.
export function cleanName(value, what, max = 120) {
  const s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!s) throw new ModelingError(`Enter a ${what}.`);
  if (s.length > max) throw new ModelingError(`The ${what} is too long (max ${max} characters).`);
  if (/[/\\]/.test(s)) throw new ModelingError(`The ${what} can't contain / or \\.`);
  return s;
}

export function cleanNote(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 500);
}

// YYYY-MM-DD in Utah time (Philo's dates in file names and stamps).
export function dateStamp(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function timeStamp(now = new Date()) {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return `${dateStamp(now)} ${t.replace(':', '')}`;
}

export function exportFileName(sourceFileName, now = new Date()) {
  return `${sourceFileName}${DASH}Export ${timeStamp(now)}.xlsx`;
}

export function nameSaysActive(fileName) {
  return /—\s*ACTIVE\s*(—|$)/i.test(String(fileName || ''));
}

// ---------------------------------------------------------------- versions
// Every model has a version number, unique within its template/project.
//   - a copy takes the next number on its parent's line (v2 -> v3,
//     v1.2 -> v1.3, v2.1 -> v2.2);
//   - if that's taken, it branches with a dot: the first free v2.1, v2.2…
//     (from v2.1: v2.1.1…);
//   - a model with no parent in its owner (Use Template, imports without a
//     number) takes the next free top-level number: v1, v2…
export function parseVersion(v) {
  const m = /^v?(\d+(?:\.\d+)*)$/i.exec(String(v || '').trim());
  return m ? m[1].split('.').map(Number) : null;
}
const fmt = (segs) => `v${segs.join('.')}`;

export function nextRootVersion(existing) {
  const tops = (existing || []).map(parseVersion).filter(Boolean).map((seg) => seg[0]);
  const taken = new Set((existing || []).map((v) => String(v).toLowerCase()));
  for (let n = 1; n < 10000; n += 1) if (!taken.has(`v${n}`) && !tops.includes(n)) return `v${n}`;
  throw new ModelingError('No free version number.');
}

export function nextVersion(parentVersion, existing) {
  const taken = new Set((existing || []).map((v) => String(v).toLowerCase()));
  const free = (segs) => !taken.has(fmt(segs).toLowerCase());
  const p = parseVersion(parentVersion);
  if (!p) return nextRootVersion(existing);
  const inc = [...p.slice(0, -1), p[p.length - 1] + 1];
  if (free(inc)) return fmt(inc);
  for (let n = 1; n < 10000; n += 1) if (free([...p, n])) return fmt([...p, n]);
  throw new ModelingError('No free version number.');
}

// "v3" or "v3 · Higher ADR case"
export const versionTitle = (m) => (m.label ? `${m.version} · ${m.label}` : m.version);

// The Drive name for a new model:
//   template model: "<template file base> — <version>", the base being the
//     source file's name up to its first " — " ("Philo - Hospitality
//     Model [TEMPLATE] — v1.3")
//   project model: "<project> — <template> — <version> (<label>)"
// Names never change afterwards (HeyPhil never renames), so lock state and
// Active live in HeyPhil, not in the name.
export function modelFileName({ templateFileName, projectName, templateName, version, label }) {
  const v = label ? `${version} (${label})` : version;
  if (templateFileName !== undefined) return [String(templateFileName).split(DASH)[0].trim(), v].join(DASH);
  return [projectName, templateName, v].filter(Boolean).join(DASH);
}

// ---------------------------------------------------------------- stamps
// The same formats the Philo Model Tools script writes, so the sheet and
// HeyPhil read the same way. A file is "locked" to the script iff its
// stamp starts with "LOCKED".
const withNote = (s, note) => (note ? `${s} · ${note}` : s);

export function releaseStamp({ version, email, note }, now = new Date()) {
  return withNote(`LOCKED · Template ${version} · locked ${dateStamp(now)} by ${email}`, note);
}

export function workingStamp({ releaseVersion }, now = new Date()) {
  return `Deal model · working copy · started ${dateStamp(now)} from template ${releaseVersion}`;
}

export function versionStamp({ versionName, email, note }, now = new Date()) {
  return withNote(`LOCKED · Deal model ${versionName} · locked ${dateStamp(now)} by ${email}`, note);
}

// An editable copy of a version (never starts with LOCKED, so the sheet
// treats it as editable).
export function copyStamp({ sourceName, email }, now = new Date()) {
  return `Copy of ${sourceName} · started ${dateStamp(now)} by ${email}`;
}

// Text typed by a person never becomes a formula in the sheet.
export function sheetSafe(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

// One VERSIONS-tab row, columns B..I:
// Version | Type | Locked on | Locked by | Note | Locked copy | Source file | Status
export function versionsRow({ version, type, email, note, copyUrl, sourceUrl }, now = new Date()) {
  return [version, type, dateStamp(now), email, note || '', copyUrl, sourceUrl, ''].map(sheetSafe);
}

export const sheetUrl = (fileId) => `https://docs.google.com/spreadsheets/d/${fileId}/edit`;

// A Drive "Lock" that only drive Managers can remove.
export function isLockedRestriction(contentRestrictions) {
  return (contentRestrictions || []).some((r) => r && r.readOnly && r.ownerRestricted);
}

export function hasAnyReadOnly(contentRestrictions) {
  return (contentRestrictions || []).some((r) => r && r.readOnly);
}

// ---------------------------------------------------------------- import
export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function slugKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'template';
}
