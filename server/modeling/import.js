// Modeling (Labs) - Import: register templates, projects and models that
// already exist in the HeyPhil folder (e.g. added by hand), so the
// registry stays complete.
//   scan()  - reads the HeyPhil Templates and Projects folders only and
//             returns what it found, marking what HeyPhil already knows.
//             Writes nothing.
//   apply() - registers only the files the person ticked. Database only:
//             never changes anything in Drive (an unlocked file stays
//             Unlocked until someone locks it).
import * as g from './drive-guard.js';
import * as db from './db.js';
import {
  ModelingError, FOLDER_MIME, SPREADSHEET_MIME, isLockedRestriction, nameSaysActive, slugKey, parseVersion, nextRootVersion,
} from './rules.js';

const folders = (files) => files.filter((f) => f.mimeType === FOLDER_MIME);
const sheetsIn = (files) => files.filter((f) => f.mimeType === SPREADSHEET_MIME);
const byName = (files, name) => folders(files).find((f) => f.name.toLowerCase() === name.toLowerCase()) || null;

// Version and label read from a file name:
//   "… [TEMPLATE] — DRAFT"                         -> label "Draft master"
//   "… — v1.1 — ACTIVE — LOCKED 2026-11-09"         -> v1.1
//   "Test — Hospitality Model — v3 (High ADR)"      -> v3, "High ADR"
// A file with no version in its name gets the next free top-level number
// when it's registered.
export function versionFromFile(fileName) {
  const n = String(fileName || '');
  if (/—\s*DRAFT\s*$/i.test(n)) return { version: null, label: 'Draft master' };
  for (const part of n.split(' — ').map((x) => x.trim()).reverse()) {
    const m = /^(v\d+(?:\.\d+)*)(?:\s*\((.+)\))?$/i.exec(part);
    if (m && parseVersion(m[1])) return { version: m[1].toLowerCase(), label: m[2] || null };
  }
  return { version: null, label: null };
}

const fileInfo = (f, known, extra = {}) => ({
  id: f.id, name: f.name, createdTime: f.createdTime, locked: isLockedRestriction(f.contentRestrictions), alreadyRegistered: known.has(f.id), ...extra,
});

export async function scan() {
  const known = await db.knownFileIds();
  const registered = await db.listTemplates();
  const byFolder = new Map(registered.map((t) => [t.folderId, t]));

  // ---- templates: HeyPhil/Templates/<Template>/(sheets, Releases/, Exports/)
  const templates = [];
  for (const folder of folders(await g.listChildren(g.MODELING_TEMPLATES_FOLDER_ID))) {
    const kids = await g.listChildren(folder.id); // eslint-disable-line no-await-in-loop
    const releases = byName(kids, 'Releases');
    const exportsF = byName(kids, 'Exports');
    const rootSheets = sheetsIn(kids);
    const releaseSheets = releases ? sheetsIn(await g.listChildren(releases.id)) : []; // eslint-disable-line no-await-in-loop
    const named = releaseSheets.filter((f) => nameSaysActive(f.name));
    const t = byFolder.get(folder.id);
    const problems = [];
    if (!releases && !t) problems.push('No Releases folder - it holds the template\'s models.');
    if (named.length > 1) problems.push('More than one file is named ACTIVE - none will be made Active.');
    templates.push({
      folderId: folder.id, name: folder.name, key: slugKey(folder.name),
      alreadyRegistered: !!t, templateId: t?.id || null,
      modelsFolderId: t?.modelsFolderId || releases?.id || null, exportsFolderId: t?.exportsFolderId || exportsF?.id || null,
      files: [
        ...rootSheets.map((f) => fileInfo(f, known, { ...versionFromFile(f.name), where: 'template folder', root: true })),
        ...releaseSheets.map((f) => fileInfo(f, known, { ...versionFromFile(f.name), where: 'Releases', active: named.length === 1 && named[0].id === f.id })),
      ],
      problems,
    });
  }

  // ---- projects: HeyPhil/Projects/<Project>/Financial Modeling/(sheets, Models/, Versions/, Copies/)
  const projects = [];
  for (const dealFolder of folders(await g.listChildren(g.MODELING_PROJECTS_FOLDER_ID))) {
    const kids = await g.listChildren(dealFolder.id); // eslint-disable-line no-await-in-loop
    const fm = byName(kids, 'Financial Modeling');
    if (!fm) { projects.push({ folderId: dealFolder.id, name: dealFolder.name, skipped: 'No Financial Modeling folder.', files: [] }); continue; }
    const fmKids = await g.listChildren(fm.id); // eslint-disable-line no-await-in-loop
    const files = sheetsIn(fmKids).map((f) => fileInfo(f, known, { where: 'Financial Modeling' }));
    for (const sub of ['Models', 'Versions', 'Copies']) {
      const sf = byName(fmKids, sub);
      if (sf) files.push(...sheetsIn(await g.listChildren(sf.id)).map((f) => fileInfo(f, known, { where: sub }))); // eslint-disable-line no-await-in-loop
    }
    files.forEach((f) => Object.assign(f, versionFromFile(f.name)));
    projects.push({
      folderId: dealFolder.id, name: dealFolder.name, fmFolderId: fm.id,
      modelsFolderId: byName(fmKids, 'Models')?.id || null, exportsFolderId: byName(fmKids, 'Exports')?.id || null,
      files, skipped: files.length ? null : 'No spreadsheets in Financial Modeling.',
    });
  }
  return { templates, projects };
}

// selection: { templates: [{ folderId, fileIds: [...] }], projects: [{ folderId, fileIds: [...] }] }
// Re-scans first and registers only files the scan still finds, so
// nothing outside the HeyPhil folder (or not shown) can be registered.
export async function apply(selection, actor) {
  const found = await scan();
  const done = [];

  for (const pick of selection.templates || []) {
    const t = found.templates.find((x) => x.folderId === pick.folderId);
    if (!t) throw new ModelingError('A template in your selection is no longer in the HeyPhil Templates folder - scan again.');
    let templateId = t.templateId;
    if (!templateId) {
      if (!t.modelsFolderId) throw new ModelingError(`"${t.name}" can't be registered: ${t.problems.join(' ')}`);
      // eslint-disable-next-line no-await-in-loop
      templateId = (await db.insertTemplate({ key: t.key, name: t.name, folderId: t.folderId, modelsFolderId: t.modelsFolderId, exportsFolderId: t.exportsFolderId }, actor)).id;
      done.push(`Template "${t.name}"`);
    }
    const picked = t.files.filter((f) => (pick.fileIds || []).includes(f.id) && !f.alreadyRegistered);
    const roots = t.files.filter((f) => f.root);
    // eslint-disable-next-line no-await-in-loop
    const lines = await db.withVersionLock({ templateId }, async (client) => {
      const out = [];
      // numbers first: files whose names carry a version keep it; the
      // rest (e.g. the Draft master) get the next free number after them
      const taken = await db.takenVersions({ templateId }, client);
      const plan = new Map();
      for (const f of [...picked].sort((x, y) => (y.version ? 1 : 0) - (x.version ? 1 : 0))) {
        const version = f.version && !taken.some((v) => v.toLowerCase() === f.version) ? f.version : nextRootVersion(taken);
        taken.push(version);
        plan.set(f.id, version);
      }
      // ...but insert the Draft master first, so the others can point at it
      let rootModelId = roots.length === 1 ? await db.getModelIdByFileId(roots[0].id) : null;
      for (const f of [...picked].sort((x, y) => (y.root ? 1 : 0) - (x.root ? 1 : 0))) {
        const version = plan.get(f.id);
        const m = await db.insertModel({ // eslint-disable-line no-await-in-loop
          templateId, version, label: f.label, fileId: f.id, fileName: f.name, parentModelId: f.root ? null : rootModelId, origin: 'import', locked: f.locked,
          createdByEmail: actor.email, createdByName: actor.name, createdAt: f.createdTime,
        }, client);
        if (f.root && roots.length === 1) rootModelId = m.id;
        out.push(`${t.name}: ${version}${f.label ? ` · ${f.label}` : ''}${f.locked ? ' (locked)' : ' (unlocked)'}${f.version && f.version !== version ? ` - renumbered: ${f.version} was taken` : ''}`);
        if (f.active) out.push({ activate: m.id, version, locked: f.locked });
      }
      return out;
    });
    for (const line of lines) {
      if (typeof line === 'string') { done.push(line); continue; }
      if (line.locked && !(await db.activeModel({ templateId }))) { // eslint-disable-line no-await-in-loop
        await db.activateModel(line.activate, actor); // eslint-disable-line no-await-in-loop
        done.push(`${line.version} made Active (its file is named ACTIVE)`);
      } else if (!line.locked) {
        done.push(`${line.version} is named ACTIVE but isn't locked - lock it, then Make Active`);
      }
    }
  }

  for (const pick of selection.projects || []) {
    const p = found.projects.find((x) => x.folderId === pick.folderId);
    if (!p || p.skipped) throw new ModelingError('A project in your selection is no longer in the HeyPhil Projects folder - scan again.');
    let project = await db.findProjectByName(p.name); // eslint-disable-line no-await-in-loop
    if (!project) {
      // eslint-disable-next-line no-await-in-loop
      project = await db.insertProject({ name: p.name, dealFolderId: p.folderId, fmFolderId: p.fmFolderId, modelsFolderId: p.modelsFolderId, exportsFolderId: p.exportsFolderId, source: 'imported' }, actor);
      done.push(`Project "${p.name}"`);
    } else if (project.dealFolderId && project.dealFolderId !== p.folderId) {
      throw new ModelingError(`HeyPhil already has a project named "${p.name}" in a different folder.`);
    }
    const picked = p.files.filter((x) => (pick.fileIds || []).includes(x.id) && !x.alreadyRegistered);
    // eslint-disable-next-line no-await-in-loop
    const lines = await db.withVersionLock({ projectId: project.id }, async (client) => {
      const out = [];
      const taken = await db.takenVersions({ projectId: project.id }, client);
      // numbered files first, so they keep their numbers
      for (const f of [...picked].sort((x, y) => (y.version ? 1 : 0) - (x.version ? 1 : 0))) {
        const version = f.version && !taken.some((v) => v.toLowerCase() === f.version) ? f.version : nextRootVersion(taken);
        taken.push(version);
        await db.insertModel({ // eslint-disable-line no-await-in-loop
          projectId: project.id, version, label: f.label, fileId: f.id, fileName: f.name, origin: 'import', locked: f.locked,
          createdByEmail: actor.email, createdByName: actor.name, createdAt: f.createdTime,
        }, client);
        out.push(`${p.name}: ${version}${f.label ? ` · ${f.label}` : ''}${f.locked ? ' (locked)' : ' (unlocked)'}${f.version && f.version !== version ? ` - renumbered: ${f.version} was taken` : ''}`);
      }
      return out;
    });
    done.push(...lines);
  }
  return done;
}
