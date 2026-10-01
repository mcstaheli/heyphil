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

// Every subfolder of the Projects folder: [{ id, name, url, modifiedTime }].
export async function listProjectFolders() {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new DriveSetupError('HeyPhil has no Google service account configured.');
  }
  const email = credentials.client_email;
  const drive = google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive.readonly'] }),
  });

  // Check the Projects folder itself first: if it isn't shared with the
  // service account, files.list just returns nothing, which would look
  // like "no folders" instead of "not set up".
  try {
    await drive.files.get({ fileId: PROJECTS_FOLDER_ID, fields: 'id', supportsAllDrives: true });
  } catch (error) {
    const status = error.code || error.response?.status;
    const reason = error.errors?.[0]?.reason || error.response?.data?.error?.errors?.[0]?.reason;
    if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(error.message)) {
      throw new DriveSetupError('The Google Drive API is turned off for HeyPhil\'s Google Cloud project.', email);
    }
    if (status === 404 || status === 403) {
      throw new DriveSetupError('The Projects folder isn\'t shared with HeyPhil yet.', email);
    }
    throw error;
  }

  const folders = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      q: `'${PROJECTS_FOLDER_ID}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken, files(id, name, webViewLink, modifiedTime)',
      orderBy: 'name',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of data.files || []) {
      folders.push({
        id: f.id,
        name: f.name,
        url: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
        modifiedTime: f.modifiedTime || null,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return folders;
}
