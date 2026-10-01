// Project Resources: the typed links shown at the top of Project Detail
// (ProjectResources.js) - Project Folder and Working Model always have a
// slot; Teaser / Offering Memorandum / Pitch Deck / Other are added as
// needed. Stored in the project's existing `links` JSONB, each with a
// `kind`. server/resource-rules.js mirrors the kind ids (a test checks they
// agree). Tested in scripts/tests/resources.test.js.

export const RESOURCE_KINDS = [
  { kind: 'folder', label: 'Project Folder', pinned: true, single: true },
  { kind: 'model', label: 'Working Model', pinned: true, single: true },
  { kind: 'teaser', label: 'Teaser' },
  { kind: 'om', label: 'Offering Memorandum' },
  { kind: 'deck', label: 'Pitch Deck' },
  { kind: 'other', label: 'Other' },
];

const KIND_ORDER = RESOURCE_KINDS.map((k) => k.kind);

// A link from before Resources existed has no kind - treat it as "other".
export function linkKind(link) {
  return link && KIND_ORDER.includes(link.kind) ? link.kind : 'other';
}

export function kindLabel(kind) {
  const found = RESOURCE_KINDS.find((k) => k.kind === kind);
  return found ? found.label : 'Other';
}

// Which icon/caption to show, from the URL alone.
export function detectSource(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { type: 'link', caption: '' };
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const path = parsed.pathname;
  if (host === 'docs.google.com') {
    if (path.startsWith('/spreadsheets')) return { type: 'sheets', caption: 'Google Sheets' };
    if (path.startsWith('/document')) return { type: 'doc', caption: 'Google Docs' };
    if (path.startsWith('/presentation')) return { type: 'slides', caption: 'Google Slides' };
  }
  if (host === 'drive.google.com') {
    if (/\/folders\//.test(path)) return { type: 'folder', caption: 'Google Drive' };
    return { type: 'file', caption: 'Google Drive' };
  }
  if (/\.pdf$/i.test(path)) return { type: 'pdf', caption: `PDF · ${host}` };
  return { type: 'link', caption: host };
}

// The two pinned slots (always shown, filled or empty) plus every other
// resource in kind order.
export function resourceLayout(links) {
  const all = links || [];
  const pinned = RESOURCE_KINDS.filter((k) => k.pinned).map((k) => ({
    kind: k.kind,
    label: k.label,
    link: all.find((l) => linkKind(l) === k.kind) || null,
  }));
  const pinnedIds = new Set(pinned.filter((p) => p.link).map((p) => p.link.id));
  const extras = all
    .filter((l) => !pinnedIds.has(l.id))
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (KIND_ORDER.indexOf(linkKind(a.l)) - KIND_ORDER.indexOf(linkKind(b.l))) || (a.i - b.i))
    .map(({ l }) => l);
  return { pinned, extras };
}

// Folder + model only, for the quick-open icons on board cards.
export function quickOpenLinks(links) {
  return ['folder', 'model']
    .map((kind) => (links || []).find((l) => linkKind(l) === kind))
    .filter(Boolean);
}

// Project Folder picker: folders in the Drive Projects folder, filtered by
// the search box (every typed word must appear), alphabetical, with the one
// named like this project (ignoring case, spacing and dash style) first and
// marked `suggested`.
const normalizeName = (s) => (s || '').toLowerCase().replace(/[‐-―−-]/g, '-').replace(/\s+/g, ' ').trim();

export function rankFolders(folders, query, projectName) {
  const words = normalizeName(query).split(' ').filter(Boolean);
  const target = normalizeName(projectName);
  return (folders || [])
    .filter((f) => {
      const name = normalizeName(f.name);
      return words.every((w) => name.includes(w));
    })
    .map((f) => ({ ...f, suggested: !!target && normalizeName(f.name) === target }))
    .sort((a, b) => (Number(b.suggested) - Number(a.suggested)) || a.name.localeCompare(b.name));
}
