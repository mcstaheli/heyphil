// Read-only Google Drive access with HeyPhil's service account - used to
// list the deal folders in the Drive "Projects" folder for Project
// Detail's "Project Folder" picker. Same credentials as the Sheets client
// in index.js (local service-account.json, else GOOGLE_SERVICE_ACCOUNT_JSON),
// with the drive.readonly scope. For it to see anything, the Projects
// folder must be shared with the service account's email (Viewer).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { pickLatestLocked, SPREADSHEET_MIME } from './model-files.js';

// Philo's Drive "Projects" folder: one subfolder per deal.
export const PROJECTS_FOLDER_ID = process.env.PROJECTS_DRIVE_FOLDER_ID || '1BjGgr63M96iT1IU7lIPZMXM0dlbOSOFH';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveSetupError extends Error {
  constructor(message, serviceAccountEmail) {
    super(message);
    this.serviceAccountEmail = serviceAccountEmail || null;
  }
}

function loadCredentials() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'service-account.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return null;
}

function driveClient() {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new DriveSetupError('HeyPhil has no Google service account configured.');
  }
  const drive = google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive.readonly'] }),
  });
  return { drive, email: credentials.client_email };
}

// Check a folder is reachable first: if it isn't shared with the service
// account, files.list just returns nothing, which would look like "empty
// folder" instead of "not set up".
async function assertFolderReadable(drive, email, folderId, what) {
  try {
    await drive.files.get({ fileId: folderId, fields: 'id', supportsAllDrives: true });
  } catch (error) {
    const status = error.code || error.response?.status;
    const reason = error.errors?.[0]?.reason || error.response?.data?.error?.errors?.[0]?.reason;
    if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(error.message)) {
      throw new DriveSetupError('The Google Drive API is turned off for HeyPhil\'s Google Cloud project.', email);
    }
    if (status === 404 || status === 403) {
      throw new DriveSetupError(`${what} isn't shared with HeyPhil yet.`, email);
    }
    throw error;
  }
}

async function listChildren(drive, folderId, mimeType, fields) {
  const files = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      q: `'${folderId}' in parents${mimeType ? ` and mimeType = '${mimeType}'` : ''} and trashed = false`,
      fields: `nextPageToken, files(${fields})`,
      orderBy: 'name',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

// Every subfolder of the Projects folder: [{ id, name, url, modifiedTime }].
export async function listProjectFolders() {
  const { drive, email } = driveClient();
  await assertFolderReadable(drive, email, PROJECTS_FOLDER_ID, 'The Projects folder');
  const files = await listChildren(drive, PROJECTS_FOLDER_ID, FOLDER_MIME, 'id, name, webViewLink, modifiedTime');
  return files.map((f) => ({
    id: f.id,
    name: f.name,
    url: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
    modifiedTime: f.modifiedTime || null,
  }));
}

// Every Google Sheet under a folder, looking into subfolders too - a deal
// folder keeps its models a level or two down (e.g. "<Deal>/Financial
// Modeling/Versions/<Deal> — Hospitality Model — v2 — LOCKED ..."). Bounded
// so an unexpectedly huge tree can't turn this into hundreds of API calls.
async function collectSpreadsheets(drive, rootId, maxDepth = 3, maxFolders = 40) {
  const sheets = [];
  let level = [rootId];
  let visited = 0;
  for (let depth = 0; depth <= maxDepth && level.length; depth += 1) {
    const next = [];
    for (const folderId of level) {
      if (visited >= maxFolders) break;
      visited += 1;
      const children = await listChildren(drive, folderId, null, 'id, name, mimeType, webViewLink, modifiedTime');
      for (const child of children) {
        if (child.mimeType === SPREADSHEET_MIME) sheets.push(child);
        else if (child.mimeType === FOLDER_MIME) next.push(child.id);
      }
    }
    level = next;
  }
  return sheets;
}

// The latest locked model in a deal folder or any of its subfolders
// (model-files.js rules): { id, name, url, version, lockedOn } or null if
// there isn't one.
export async function latestLockedModel(folderId) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId || '')) {
    throw new DriveSetupError('That doesn\'t look like a Drive folder.');
  }
  const { drive, email } = driveClient();
  await assertFolderReadable(drive, email, folderId, 'This project\'s folder');
  const files = await collectSpreadsheets(drive, folderId);
  const latest = pickLatestLocked(files);
  if (!latest) return null;
  return {
    id: latest.id,
    name: latest.name,
    url: latest.webViewLink || `https://docs.google.com/spreadsheets/d/${latest.id}/edit`,
    version: latest.version,
    lockedOn: latest.lockedOn,
  };
}
