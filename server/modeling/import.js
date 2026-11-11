// Modeling (Labs) - Import: register templates, releases, deals and
// versions that already exist in the HeyPhil folder (e.g. added by hand),
// so the registry stays complete.
//   scan()  - reads the HeyPhil Templates and Projects folders only and
//             returns what it found, marking what HeyPhil already knows.
//             Writes nothing.
//   apply() - registers only the items the person ticked. Database only:
//             never changes anything in Drive (an unlocked release or
//             version is shown as "not locked" with a Lock button).
import * as g from './drive-guard.js';
import * as db from './db.js';
import {
  ModelingError, FOLDER_MIME, SPREADSHEET_MIME, isLockedRestriction, releaseVersionFromName, nameSaysActive,
  slugKey, templateForFileName, classifyDealFiles,
} from './rules.js';

const folders = (files) => files.filter((f) => f.mimeType === FOLDER_MIME);
const sheetsIn = (files) => files.filter((f) => f.mimeType === SPREADSHEET_MIME);
const byName = (files, name) => folders(files).find((f) => f.name.toLowerCase() === name.toLowerCase()) || null;
const fileInfo = (f) => ({ id: f.id, name: f.name, createdTime: f.createdTime, modifiedTime: f.modifiedTime, locked: isLockedRestriction(f.contentRestrictions) });

export async function scan() {
  const known = await db.knownFileIds();
  const registeredTemplates = await db.listTemplates();
  const templateByFolder = new Map(registeredTemplates.map((t) => [t.folderId, t]));

  // ---- templates: HeyPhil/Templates/<Template>/(draft, Releases/, Exports/)
  const templates = [];
  for (const folder of folders(await g.listChildren(g.MODELING_TEMPLATES_FOLDER_ID))) {
    const kids = await g.listChildren(folder.id); // eslint-disable-line no-await-in-loop
    const drafts = sheetsIn(kids);
    const releasesFolder = byName(kids, 'Releases');
    const exportsFolder = byName(kids, 'Exports');
    const releaseFiles = releasesFolder ? sheetsIn(await g.listChildren(releasesFolder.id)) : []; // eslint-disable-line no-await-in-loop
    const activeByName = releaseFiles.filter((f) => nameSaysActive(f.name));
    const problems = [];
    if (drafts.length !== 1) problems.push(drafts.length ? `${drafts.length} sheets directly in the folder - expected one Draft master.` : 'No Draft master sheet in the folder.');
    if (!releasesFolder) problems.push('No Releases folder.');
    if (activeByName.length > 1) problems.push('More than one release is named ACTIVE - none will be marked Active.');
    const existing = templateByFolder.get(folder.id);
    templates.push({
      folderId: folder.id,
      name: folder.name,
      key: slugKey(folder.name),
      alreadyRegistered: !!existing,
      templateId: existing?.id || null,
      draft: drafts.length === 1 ? fileInfo(drafts[0]) : null,
      releasesFolderId: releasesFolder?.id || null,
      exportsFolderId: exportsFolder?.id || null,
      releases: releaseFiles.map((f) => ({
        ...fileInfo(f),
        version: releaseVersionFromName(f.name) || f.name,
        active: activeByName.length === 1 && activeByName[0].id === f.id,
        alreadyRegistered: known.has(f.id),
      })),
      problems,
    });
  }

  // ---- deals: HeyPhil/Projects/<Deal>/Financial Modeling/(working, Versions/)
  const templateList = [
    ...registeredTemplates.map((t) => ({ id: `t${t.id}`, name: t.name })),
    ...templates.filter((t) => !t.alreadyRegistered).map((t) => ({ id: `f${t.folderId}`, name: t.name })),
  ];
  const deals = [];
  for (const dealFolder of folders(await g.listChildren(g.MODELING_PROJECTS_FOLDER_ID))) {
    const kids = await g.listChildren(dealFolder.id); // eslint-disable-line no-await-in-loop
    const fm = byName(kids, 'Financial Modeling');
    if (!fm) { deals.push({ folderId: dealFolder.id, name: dealFolder.name, skipped: 'No Financial Modeling folder.' }); continue; }
    const fmKids = await g.listChildren(fm.id); // eslint-disable-line no-await-in-loop
    const versionsFolder = byName(fmKids, 'Versions');
    const exportsFolder = byName(fmKids, 'Exports');
    const versionFiles = versionsFolder ? await g.listChildren(versionsFolder.id) : []; // eslint-disable-line no-await-in-loop
    const c = classifyDealFiles({ workingFiles: fmKids, versionFiles }, known);
    const sample = c.working[0] || c.versions[0];
    deals.push({
      folderId: dealFolder.id,
      name: dealFolder.name,
      fmFolderId: fm.id,
      versionsFolderId: versionsFolder?.id || null,
      exportsFolderId: exportsFolder?.id || null,
      templateGuess: sample ? templateForFileName(sample.name, templateList) : null,
      working: c.working.map(fileInfo).map((f, i) => ({ ...f, alreadyRegistered: c.working[i].alreadyRegistered })),
      versions: c.versions.map((f) => ({ ...fileInfo(f), alreadyRegistered: f.alreadyRegistered })),
      problems: c.problems,
      skipped: !c.working.length && !c.versions.length ? 'No spreadsheets in Financial Modeling.' : null,
    });
  }
  return { templates, deals, templateChoices: templateList };
}

// selection: { templates: [{ folderId, releaseIds: [...] }],
//              deals: [{ folderId, templateChoice, workingFileId, versionFileIds: [...] }] }
// Re-scans first and only registers files the scan still finds, so
// nothing outside the HeyPhil folder (or not shown) can be registered.
export async function apply(selection, actor) {
  const found = await scan();
  const done = [];
  const templateIdFor = new Map(); // "f<folderId>" / "t<id>" -> template id

  for (const t of found.templates) if (t.templateId) templateIdFor.set(`t${t.templateId}`, t.templateId);

  for (const pick of selection.templates || []) {
    const t = found.templates.find((x) => x.folderId === pick.folderId);
    if (!t) throw new ModelingError('A template in your selection is no longer in the HeyPhil Templates folder - scan again.');
    let templateId = t.templateId;
    if (!templateId) {
      if (!t.draft || !t.releasesFolderId) throw new ModelingError(`"${t.name}" can't be registered: ${t.problems.join(' ')}`);
      const row = await db.insertTemplate({ key: t.key, name: t.name, folderId: t.folderId, draftFileId: t.draft.id, releasesFolderId: t.releasesFolderId, exportsFolderId: t.exportsFolderId }, actor); // eslint-disable-line no-await-in-loop
      templateId = row.id;
      done.push(`Template "${t.name}"`);
    }
    templateIdFor.set(`f${t.folderId}`, templateId);
    for (const id of pick.releaseIds || []) {
      const r = t.releases.find((x) => x.id === id);
      if (!r || r.alreadyRegistered) continue;
      // eslint-disable-next-line no-await-in-loop
      const rel = await db.insertRelease({
        templateId, version: r.version, fileId: r.id, fileName: r.name, locked: r.locked, source: 'imported',
        releasedByEmail: actor.email, releasedByName: actor.name, releasedAt: r.createdTime, lockedByEmail: null,
      });
      done.push(`Release ${r.version}${r.locked ? '' : ' (not locked yet)'}`);
      if (r.active && !(await db.activeRelease(templateId))) { // eslint-disable-line no-await-in-loop
        if (r.locked) {
          await db.activateRelease(rel.id, actor); // eslint-disable-line no-await-in-loop
          done.push(`${r.version} marked Active`);
        } else {
          done.push(`${r.version} is named ACTIVE but isn't locked - lock it, then Mark Active`);
        }
      }
    }
  }

  for (const pick of selection.deals || []) {
    const d = found.deals.find((x) => x.folderId === pick.folderId);
    if (!d || d.skipped) throw new ModelingError('A deal in your selection is no longer in the HeyPhil Projects folder - scan again.');
    const templateId = templateIdFor.get(pick.templateChoice);
    if (!templateId) throw new ModelingError(`Pick a registered template for "${d.name}" (register the template in the same import).`);
    let deal = await db.findDealByName(d.name); // eslint-disable-line no-await-in-loop
    if (!deal) {
      // eslint-disable-next-line no-await-in-loop
      deal = await db.insertDeal({ name: d.name, templateId, dealFolderId: d.folderId, fmFolderId: d.fmFolderId, versionsFolderId: d.versionsFolderId, exportsFolderId: d.exportsFolderId, source: 'imported' }, actor);
      done.push(`Deal "${d.name}"`);
    } else if (deal.dealFolderId !== d.folderId) {
      throw new ModelingError(`HeyPhil already has a deal named "${d.name}" in a different folder.`);
    }
    const w = pick.workingFileId && d.working.find((x) => x.id === pick.workingFileId);
    if (w && !w.alreadyRegistered) {
      // eslint-disable-next-line no-await-in-loop
      await db.insertVersion({ dealId: deal.id, status: 'working', name: 'Working model', fileId: w.id, fileName: w.name, source: 'imported', createdByEmail: actor.email, createdByName: actor.name, createdAt: w.createdTime });
      done.push(`${d.name}: working model`);
    }
    for (const id of pick.versionFileIds || []) {
      const v = d.versions.find((x) => x.id === id);
      if (!v || v.alreadyRegistered) continue;
      const name = (/—\s*([^—]+?)\s*—\s*LOCKED/.exec(v.name) || [])[1] || v.name;
      // eslint-disable-next-line no-await-in-loop
      await db.insertVersion({ dealId: deal.id, status: 'locked', name, fileId: v.id, fileName: v.name, locked: v.locked, source: 'imported', createdByEmail: actor.email, createdByName: actor.name, createdAt: v.createdTime, lockedByEmail: null, lockedAt: v.createdTime });
      done.push(`${d.name}: version ${name}${v.locked ? '' : ' (not locked yet)'}`);
    }
  }
  return done;
}
