// Naming rules for the Philo hospitality model files in a deal's Drive
// folder - the same rules the "Philo Model Tools" Apps Script uses (all em
// dashes, U+2014):
//   locked file:   name contains "LOCKED"
//   version tag:   first match of /—\s*(v[\d.]+)\s*—/  (v1, v2 ... for deals)
//   locked on:     "LOCKED yyyy-mm-dd"
//   template:      name contains "[TEMPLATE]"
//   scratch copy:  "~scratch (safe to delete) — ..." (a temporary analysis copy)
// Used to default a project's Working Model tile to the latest locked
// version in its Project Folder. Tested in scripts/tests/modelFiles.test.js.

export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

export function parseModelFileName(name) {
  const n = name || '';
  const version = n.match(/—\s*(v[\d.]+)\s*—/);
  const lockedOn = n.match(/LOCKED\s+(\d{4}-\d{2}-\d{2})/);
  return {
    locked: n.includes('LOCKED'),
    version: version ? version[1] : null,
    lockedOn: lockedOn ? lockedOn[1] : null,
    template: n.includes('[TEMPLATE]'),
    scratch: n.startsWith('~scratch'),
  };
}

// "v10" > "v2", "v1.10" > "v1.9"
export function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map(Number);
  const pb = String(b || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// The latest locked deal model among a folder's files (Drive files.list
// results: { id, name, mimeType, modifiedTime, ... }), or null. Google
// Sheets only (not an exported .xlsx), no templates or scratch copies.
// Highest version wins; a tie goes to the most recently modified file.
export function pickLatestLocked(files) {
  let best = null;
  for (const file of files || []) {
    if (file.mimeType !== SPREADSHEET_MIME) continue;
    const meta = parseModelFileName(file.name);
    if (!meta.locked || !meta.version || meta.template || meta.scratch) continue;
    const candidate = { ...file, version: meta.version, lockedOn: meta.lockedOn };
    if (!best) {
      best = candidate;
      continue;
    }
    const byVersion = compareVersions(candidate.version, best.version);
    if (byVersion > 0 || (byVersion === 0 && (candidate.modifiedTime || '') > (best.modifiedTime || ''))) {
      best = candidate;
    }
  }
  return best;
}
