// Modeling (Labs) - the ONLY module that talks to Google for Modeling.
//
// Every call checks, before it runs, that each file or folder it touches
// sits inside the HeyPhil root folder (assertInsideRoot walks the parent
// chain). The live Templates/Projects folders are siblings of that root,
// so they can never be read, copied from, copied into, locked or written.
//
// There are deliberately no delete, trash, rename, move or overwrite
// functions here: every action copies a file, creates a folder or a new
// file, changes a lock, or writes cells in a copy HeyPhil itself just made
// (marked with appProperties.heyphilCreated - writeCells refuses anything
// else).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { ModelingError, assertInsideRoot, FOLDER_MIME, SPREADSHEET_MIME, isLockedRestriction } from './rules.js';

export const MODELING_ROOT_FOLDER_ID = process.env.MODELING_ROOT_FOLDER_ID || '1wC4dC1fl1W13lMo_PG0hlrTACQU_EjCH';
export const MODELING_TEMPLATES_FOLDER_ID = process.env.MODELING_TEMPLATES_FOLDER_ID || '16qAqlayHScUh5QjL9pOehhOorMLhI8ys';
export const MODELING_PROJECTS_FOLDER_ID = process.env.MODELING_PROJECTS_FOLDER_ID || '1ekQCrjFzsyOoMjUBYbj4CNJQtUmfw7pO';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LOCK_REASON = 'Locked by HeyPhil. Only a drive Manager can unlock it.';
const FILE_FIELDS = 'id,name,mimeType,parents,driveId,trashed,createdTime,modifiedTime,contentRestrictions,appProperties,webViewLink';

let clients = null;
let rootDriveId = null;
// No "already checked" cache: every call re-walks the parent chain, so a
// folder moved out of the HeyPhil root (or trashed) after an earlier check
// is refused on the very next call. (A few extra metadata reads per
// action; the configured Templates/Projects ids are checked the same way.)

function loadCredentials() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'service-account.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return null;
}

function google_() {
  if (clients) return clients;
  const credentials = loadCredentials();
  if (!credentials) throw new ModelingError('HeyPhil has no Google service account configured.', 500);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  });
  clients = { auth, drive: google.drive({ version: 'v3', auth }), sheets: google.sheets({ version: 'v4', auth }), email: credentials.client_email };
  return clients;
}

export function serviceAccountEmail() {
  return google_().email;
}

// A Google error as a sentence a person can act on.
export function describeGoogleError(error) {
  const status = error?.code || error?.response?.status;
  const msg = error?.response?.data?.error?.message || error?.message || 'Unknown Google error';
  if (status === 404) return `Google says the file wasn't found (${msg}).`;
  if (status === 403) return `Google refused it (${msg}).`;
  if (status === 429 || status >= 500) return `Google was busy or unavailable - try again (${msg}).`;
  return msg;
}

async function rawMeta(id) {
  try {
    const { data } = await google_().drive.files.get({ fileId: id, fields: FILE_FIELDS, supportsAllDrives: true });
    return data;
  } catch (error) {
    if ((error.code || error.response?.status) === 404) return null;
    throw error;
  }
}

async function rootDrive() {
  if (rootDriveId) return rootDriveId;
  const root = await rawMeta(MODELING_ROOT_FOLDER_ID);
  if (!root || !root.driveId) throw new ModelingError("HeyPhil's Modeling folder isn't reachable by the service account.", 500);
  rootDriveId = root.driveId;
  return rootDriveId;
}

// Refuses (403) unless `id` is inside the HeyPhil root.
export async function assertInside(id) {
  await assertInsideRoot(id, { rootId: MODELING_ROOT_FOLDER_ID, rootDriveId: await rootDrive(), getMeta: rawMeta });
}

export async function getFile(id) {
  await assertInside(id);
  const meta = await rawMeta(id);
  if (!meta) throw new ModelingError('That Drive file no longer exists.', 404);
  return meta;
}

export async function listChildren(folderId) {
  await assertInside(folderId);
  const files = [];
  let pageToken;
  do {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await google_().drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'drive',
      driveId: await rootDrive(), // eslint-disable-line no-await-in-loop
      pageSize: 200,
      pageToken,
    });
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

// A folder named exactly `name` directly inside `parentId`, or null.
export async function findChildFolder(parentId, name) {
  const kids = await listChildren(parentId);
  return kids.find((f) => f.mimeType === FOLDER_MIME && f.name === name) || null;
}

export async function createFolder(parentId, name, appProperties = {}) {
  await assertInside(parentId);
  const { data } = await google_().drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId], appProperties: { heyphilCreated: 'true', ...appProperties } },
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return data;
}

export async function findOrCreateFolder(parentId, name, appProperties) {
  return (await findChildFolder(parentId, name)) || createFolder(parentId, name, appProperties);
}

// A file this operation already made in `parentId` (so a retried step
// doesn't copy twice), or null.
export async function findCreatedBy(parentId, opId, step) {
  await assertInside(parentId);
  const { data } = await google_().drive.files.list({
    q: `'${parentId}' in parents and trashed = false and appProperties has { key='heyphilOp' and value='${opId}' } and appProperties has { key='heyphilStep' and value='${step}' }`,
    fields: `files(${FILE_FIELDS})`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return data.files[0] || null;
}

// Copies sourceId into parentId as a NEW file. Never touches the source.
export async function copyFile(sourceId, parentId, name, { opId, step }) {
  await assertInside(sourceId);
  await assertInside(parentId);
  const existing = await findCreatedBy(parentId, opId, step);
  if (existing) return existing;
  const { data } = await google_().drive.files.copy({
    fileId: sourceId,
    requestBody: { name, parents: [parentId], appProperties: { heyphilCreated: 'true', heyphilOp: String(opId), heyphilStep: step } },
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return data;
}

// Drive's read-only Lock that only shared-drive Managers can remove.
export async function lockFile(fileId) {
  await assertInside(fileId);
  await google_().drive.files.update({
    fileId,
    requestBody: { contentRestrictions: [{ readOnly: true, ownerRestricted: true, reason: LOCK_REASON }] },
    supportsAllDrives: true,
  });
  const after = await rawMeta(fileId);
  if (!isLockedRestriction(after?.contentRestrictions)) {
    throw new ModelingError("Drive accepted the lock request but the file doesn't show as locked.", 500);
  }
  return after;
}

// Only for a copy HeyPhil just made that came out locked because its
// source was locked (a working model must be editable).
export async function unlockNewCopy(fileId) {
  const meta = await getFile(fileId);
  if (meta.appProperties?.heyphilCreated !== 'true') {
    throw new ModelingError('Refused: HeyPhil only unlocks copies it made itself.', 403);
  }
  await google_().drive.files.update({ fileId, requestBody: { contentRestrictions: [{ readOnly: false }] }, supportsAllDrives: true });
}

// ---- Sheets: writes only on copies HeyPhil made ----
async function assertHeyPhilCopy(spreadsheetId) {
  const meta = await getFile(spreadsheetId);
  if (meta.mimeType !== SPREADSHEET_MIME) throw new ModelingError('That file is not a Google Sheet.', 400);
  if (meta.appProperties?.heyphilCreated !== 'true') {
    throw new ModelingError('Refused: HeyPhil only writes cells in copies it made itself.', 403);
  }
}

export async function readSheetMeta(spreadsheetId) {
  await assertInside(spreadsheetId);
  const { data } = await google_().sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,index),protectedRanges(protectedRangeId,requestingUserCanEdit))',
  });
  return data.sheets;
}

export async function writeCells(spreadsheetId, { updates = [], appends = [], deleteProtectedRangeIds = [] }) {
  await assertHeyPhilCopy(spreadsheetId);
  const { sheets } = google_();
  if (deleteProtectedRangeIds.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: deleteProtectedRangeIds.map((protectedRangeId) => ({ deleteProtectedRange: { protectedRangeId } })) },
    });
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates.map((u) => ({ range: u.range, values: u.values })) },
    });
  }
  for (const a of appends) {
    // eslint-disable-next-line no-await-in-loop
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: a.range, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: a.values },
    });
  }
}

// Template structure on a copy HeyPhil made: add a tab if it's missing and
// add named ranges (never removes or renames anything). `named`:
// [{ name, sheet, startRow, endRow, startCol, endCol }] (0-based, end
// exclusive). Names that already exist are left alone and reported.
export async function addTemplateStructure(spreadsheetId, { ensureSheets = [], named = [], ensureSize = {} }) {
  await assertHeyPhilCopy(spreadsheetId);
  const { sheets } = google_();
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'namedRanges(name),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))' });
  const tabs = new Map(data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const grid = new Map(data.sheets.map((s) => [s.properties.title, s.properties.gridProperties]));
  const have = new Set((data.namedRanges || []).map((n) => n.name));
  const add = ensureSheets.filter((t) => !tabs.has(t)).map((title) => ({ addSheet: { properties: { title } } }));
  if (add.length) {
    const { data: r } = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: add } });
    r.replies.forEach((rep) => tabs.set(rep.addSheet.properties.title, rep.addSheet.properties.sheetId));
  }
  // grow (never shrink) a tab so the rows/columns to be written exist
  const grow = [];
  for (const [title, want] of Object.entries(ensureSize)) {
    const have0 = grid.get(title) || { rowCount: 1000, columnCount: 26 }; // a tab just added has the defaults
    const sheetId = tabs.get(title);
    if (want.rows > have0.rowCount) grow.push({ appendDimension: { sheetId, dimension: 'ROWS', length: want.rows - have0.rowCount } });
    if (want.cols > have0.columnCount) grow.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: want.cols - have0.columnCount } });
  }
  if (grow.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: grow } });
  const skipped = named.filter((n) => have.has(n.name)).map((n) => n.name);
  const requests = named.filter((n) => !have.has(n.name)).map((n) => {
    if (!tabs.has(n.sheet)) throw new ModelingError(`No "${n.sheet}" tab for ${n.name}.`);
    return { addNamedRange: { namedRange: { name: n.name, range: {
      sheetId: tabs.get(n.sheet), startRowIndex: n.startRow, endRowIndex: n.endRow, startColumnIndex: n.startCol, endColumnIndex: n.endCol,
    } } } };
  });
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  return { addedSheets: add.length, grew: grow.length, addedNames: requests.length, skipped };
}

export async function readCells(spreadsheetId, ranges, { render = 'FORMATTED_VALUE' } = {}) {
  await assertInside(spreadsheetId);
  const { data } = await google_().sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges, valueRenderOption: render, dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return data.valueRanges.map((r) => r.values || []);
}

// The named ranges a file has, and its tab names (an older version may lack
// some names, or the HeyPhil Map tab).
export async function readStructure(spreadsheetId) {
  await assertInside(spreadsheetId);
  const { data } = await google_().sheets.spreadsheets.get({ spreadsheetId, fields: 'namedRanges(name),sheets(properties(title))' });
  return { names: new Set((data.namedRanges || []).map((n) => n.name)), tabs: new Set(data.sheets.map((t) => t.properties.title)) };
}

// Values of named ranges as { name: { display, raw } } - display as the
// sheet formats it, raw unformatted (numbers stay numbers). Single cells
// give scalars; multi-cell ranges give arrays of rows.
export async function readNamedValues(spreadsheetId, names) {
  if (!names.length) return {};
  await assertInside(spreadsheetId);
  const get = (render) => google_().sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges: names, valueRenderOption: render, dateTimeRenderOption: 'FORMATTED_STRING',
  }).then((r) => r.data.valueRanges);
  const [shown, raw] = await Promise.all([get('FORMATTED_VALUE'), get('UNFORMATTED_VALUE')]);
  // The shape comes from the range itself (the API trims empty trailing
  // rows/cells): one cell -> a value; more -> a full rows x cols grid.
  const shape = (a1) => {
    const m = /!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(a1 || '');
    if (!m || !m[3]) return null;
    const col = (L) => [...L].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    return { rows: +m[4] - +m[2] + 1, cols: col(m[3]) - col(m[1]) + 1 };
  };
  const shaped = (vr) => {
    const dims = shape(vr.range);
    const v = vr.values || [];
    if (!dims || (dims.rows === 1 && dims.cols === 1)) return (v[0] || [])[0] ?? null;
    return Array.from({ length: dims.rows }, (_, r) => Array.from({ length: dims.cols }, (_, c) => (v[r] || [])[c] ?? null));
  };
  return Object.fromEntries(names.map((n, i) => [n, { display: shaped(shown[i]), raw: shaped(raw[i]) }]));
}

// ---- export ----
// The whole workbook as .xlsx bytes. Falls back to the export link for
// files over the API's 10 MB export limit.
export async function exportXlsx(fileId) {
  await assertInside(fileId);
  const { drive, auth } = google_();
  try {
    const res = await drive.files.export({ fileId, mimeType: XLSX_MIME }, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  } catch (error) {
    const reason = error?.response?.data?.error?.errors?.[0]?.reason || '';
    if (!/exportSizeLimitExceeded/i.test(reason) && !/too large/i.test(error.message || '')) throw error;
    const client = await auth.getClient();
    const res = await client.request({ url: `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`, responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  }
}

export async function uploadFile(parentId, name, buffer, { opId, step }) {
  await assertInside(parentId);
  const existing = await findCreatedBy(parentId, opId, step);
  if (existing) return existing;
  const { data } = await google_().drive.files.create({
    requestBody: { name, parents: [parentId], mimeType: XLSX_MIME, appProperties: { heyphilCreated: 'true', heyphilOp: String(opId), heyphilStep: step } },
    media: { mimeType: XLSX_MIME, body: Readable.from(buffer) },
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return data;
}

export async function downloadFile(fileId) {
  await assertInside(fileId);
  const res = await google_().drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}
