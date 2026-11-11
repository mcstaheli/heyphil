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

// "Philo - Hospitality Model [TEMPLATE] — DRAFT" -> "Philo - Hospitality Model [TEMPLATE]"
export function templateBaseName(draftFileName) {
  return String(draftFileName || '').replace(/\s*—\s*DRAFT\s*$/i, '').trim();
}

export function releaseFileName(draftFileName, version, now = new Date()) {
  return [templateBaseName(draftFileName), version, `LOCKED ${dateStamp(now)}`].join(DASH);
}

export function workingModelFileName(dealName, templateName) {
  return [dealName, templateName].join(DASH);
}

export function versionFileName(dealName, templateName, versionName, now = new Date()) {
  return [dealName, templateName, versionName, `LOCKED ${dateStamp(now)}`].join(DASH);
}

// How a version is named in messages: the working model, else its name.
export const versionLabel = (v) => (v.status === 'working' ? 'the working model' : v.name);

export function copyFileName(dealName, templateName, copyName) {
  return [dealName, templateName, copyName].join(DASH);
}

export function exportFileName(sourceFileName, now = new Date()) {
  return `${sourceFileName}${DASH}Export ${timeStamp(now)}.xlsx`;
}

// "v1.1" out of "Philo - Hospitality Model [TEMPLATE] — v1.1 — ACTIVE — LOCKED 2026-11-09"
export function releaseVersionFromName(fileName) {
  const m = /—\s*(v\d+(?:\.\d+)*)\s*(?:—|$)/i.exec(String(fileName || ''));
  return m ? m[1] : null;
}

export function nameSaysActive(fileName) {
  return /—\s*ACTIVE\s*(—|$)/i.test(String(fileName || ''));
}

// The next release number after the highest one so far: v1.1 -> v1.2.
export function suggestNextVersion(versions) {
  const parsed = (versions || [])
    .map((v) => /^v(\d+)(?:\.(\d+))?/i.exec(v || ''))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2] || 0)]);
  if (!parsed.length) return 'v1.0';
  parsed.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const [major, minor] = parsed[parsed.length - 1];
  return `v${major}.${minor + 1}`;
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

// A copy made the deal's working model.
export function promotedStamp({ copyName, email }, now = new Date()) {
  return `Deal model · working copy · from copy "${copyName}" · ${dateStamp(now)} by ${email}`;
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

// Which template a deal's model belongs to, from its file name
// ("Zion Promenade — Hospitality Model ..."), else null.
export function templateForFileName(fileName, templates) {
  const name = String(fileName || '').toLowerCase();
  const hit = (templates || [])
    .filter((t) => name.includes(`— ${t.name.toLowerCase()}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return hit ? hit.id : null;
}

// One spreadsheet found during an import scan, with what it would be
// registered as. `registeredIds` = Drive file ids HeyPhil already knows.
export function classifyDealFiles({ workingFiles, versionFiles }, registeredIds) {
  const known = (f) => registeredIds.has(f.id);
  const working = workingFiles.filter((f) => f.mimeType === SPREADSHEET_MIME);
  const versions = versionFiles.filter((f) => f.mimeType === SPREADSHEET_MIME);
  const problems = [];
  if (working.length > 1) problems.push(`${working.length} spreadsheets directly in Financial Modeling - pick the working model.`);
  return {
    working: working.map((f) => ({ ...f, alreadyRegistered: known(f) })),
    versions: versions.map((f) => ({ ...f, alreadyRegistered: known(f) })),
    problems,
  };
}
