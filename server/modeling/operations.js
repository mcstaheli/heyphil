// Modeling (Labs) - the long actions (Release Template, Use Template,
// Lock Version, Lock file, Export to Excel), run step by step in the
// background. Every step is saved as it finishes, with what it created, so:
//   - the page shows live progress and a clear result,
//   - a failure stops the action and records exactly which steps were and
//     weren't done (with links to anything already created),
//   - Retry resumes from the first unfinished step. Steps are written to
//     be safe to repeat: copies are found again by the operation id
//     stamped on them, folders are found by name before being created, and
//     database rows are keyed by Drive file id.
// Nothing is ever deleted or overwritten.
import * as g from './drive-guard.js';
import * as db from './db.js';
import { broadcastChange } from '../realtime.js';
import { financialModelOnly } from './export-xlsx.js';
import {
  ModelingError, releaseFileName, workingModelFileName, versionFileName, exportFileName,
  releaseStamp, workingStamp, versionStamp, versionsRow, sheetUrl, hasAnyReadOnly, isLockedRestriction,
} from './rules.js';

const FM_FOLDER = 'Financial Modeling';

// Folders inside a deal's Financial Modeling folder, made if missing.
async function ensureDealSubfolders(deal, opId) {
  const app = { heyphilOp: String(opId) };
  const versions = deal.versionsFolderId ? await g.getFile(deal.versionsFolderId) : await g.findOrCreateFolder(deal.fmFolderId, 'Versions', app);
  const exportsF = deal.exportsFolderId ? await g.getFile(deal.exportsFolderId) : await g.findOrCreateFolder(deal.fmFolderId, 'Exports', app);
  await db.setDealFolders(deal.id, { versionsFolderId: versions.id, exportsFolderId: exportsF.id });
  return { versionsFolderId: versions.id, exportsFolderId: exportsF.id };
}

async function stampNewCopy(fileId, template, { stamp, row, removeProtections = false }) {
  const updates = [{ range: template.stampCell, values: [[stamp]] }];
  let appends = row ? [{ range: template.versionsRange, values: [row] }] : [];
  if (row) {
    // a retry must not add the row twice: the copy's link (column G) is unique to it
    const [existing] = await g.readCells(fileId, [template.versionsRange]);
    if (existing.some((r) => r[5] === row[5])) appends = [];
  }
  let deleteProtectedRangeIds = [];
  if (removeProtections) {
    const sheets = await g.readSheetMeta(fileId);
    const ranges = sheets.flatMap((s) => s.protectedRanges || []);
    deleteProtectedRangeIds = ranges.map((r) => r.protectedRangeId);
  }
  await g.writeCells(fileId, { updates, appends, deleteProtectedRangeIds });
}

// A release's lock is re-read from Drive (someone could have unlocked it
// by hand); HeyPhil's record is corrected if so.
export async function assertReleaseLockedInDrive(rel) {
  const meta = await g.getFile(rel.fileId);
  if (!isLockedRestriction(meta.contentRestrictions)) {
    await db.markReleaseUnlocked(rel.id);
    throw new ModelingError(`${rel.version} is no longer locked in Drive (someone unlocked it). Lock it again from the Templates tab first.`);
  }
}

async function assertNoOtherWorkingModel(dealId, opId) {
  const w = await db.workingVersion(dealId);
  if (w && w.operationId !== opId) {
    throw new ModelingError('This deal already has a working model (made by another action) - nothing more to do here.', 409);
  }
}

// ---------------------------------------------------------------- kinds
// Each kind: steps [{ key, label, rerun? }] and run[key](ctx). ctx.state is
// saved after every step; ctx.mem lives only for this run (rerun steps
// rebuild it on retry).
export const KINDS = {
  release: {
    title: (p) => `Release ${p.version}`,
    steps: [
      { key: 'copy', label: 'Copy the Draft master into Releases' },
      { key: 'register', label: 'Record the release in HeyPhil' },
      { key: 'stamp', label: 'Stamp the status line and VERSIONS row in the copy' },
      { key: 'lock', label: 'Lock the release (view-only)' },
    ],
    run: {
      async copy(ctx) {
        const t = await db.getTemplate(ctx.params.templateId);
        const draft = await g.getFile(t.draftFileId);
        const name = releaseFileName(draft.name, ctx.params.version);
        const copy = await g.copyFile(t.draftFileId, t.releasesFolderId, name, { opId: ctx.op.id, step: 'copy' });
        Object.assign(ctx.state, { fileId: copy.id, fileName: copy.name });
        if (hasAnyReadOnly(copy.contentRestrictions)) await g.unlockNewCopy(copy.id);
        return `Created "${copy.name}"`;
      },
      async register(ctx) {
        const rel = await db.insertRelease({
          templateId: ctx.params.templateId, version: ctx.params.version, fileId: ctx.state.fileId, fileName: ctx.state.fileName,
          note: ctx.params.note, releasedByEmail: ctx.actor.email, releasedByName: ctx.actor.name, operationId: ctx.op.id,
        });
        ctx.state.releaseId = rel.id;
      },
      async stamp(ctx) {
        const t = await db.getTemplate(ctx.params.templateId);
        await stampNewCopy(ctx.state.fileId, t, {
          stamp: releaseStamp({ version: ctx.params.version, email: ctx.actor.email, note: ctx.params.note }),
          row: versionsRow({ version: ctx.params.version, type: 'Template release', email: ctx.actor.email, note: ctx.params.note, copyUrl: sheetUrl(ctx.state.fileId), sourceUrl: sheetUrl(t.draftFileId) }),
        });
      },
      async lock(ctx) {
        await g.lockFile(ctx.state.fileId);
        await db.markReleaseLocked(ctx.state.releaseId, ctx.actor);
      },
    },
  },

  'use-template': {
    title: (p) => `Use Template for ${p.dealName}`,
    steps: [
      { key: 'check', label: 'Check the Active release', rerun: true },
      { key: 'deal', label: 'Record the deal in HeyPhil' },
      { key: 'folders', label: 'Find or create the deal folders' },
      { key: 'copy', label: 'Copy the Active release as the working model' },
      { key: 'prepare', label: 'Make the working model editable and stamp it' },
      { key: 'register', label: 'Record the working model in HeyPhil' },
    ],
    run: {
      // Runs again on every retry: things may have changed since.
      async check(ctx) {
        const rel = await db.getRelease(ctx.params.releaseId);
        if (!rel || rel.status !== 'active') throw new ModelingError('The Active release changed - start Use Template again.');
        await assertReleaseLockedInDrive(rel);
        const dealId = ctx.state.dealId || ctx.params.dealId;
        if (dealId) await assertNoOtherWorkingModel(dealId, ctx.op.id);
        const sheets = await g.readSheetMeta(rel.fileId);
        const ranges = sheets.flatMap((s) => s.protectedRanges || []);
        if (ranges.length) {
          throw new ModelingError(`${rel.version} has sheet protections made by the old script that HeyPhil can't remove, so a working model copied from it would stay uneditable. Release a new version from HeyPhil and make it Active, then try again.`);
        }
        return `${rel.version}`;
      },
      async deal(ctx) {
        if (ctx.params.dealId) { ctx.state.dealId = ctx.params.dealId; return 'Existing deal'; }
        const existing = await db.findDealByName(ctx.params.dealName);
        const madeByThisAction = existing && existing.createdByEmail === ctx.op.actorEmail
          && existing.templateId === ctx.params.templateId && new Date(existing.createdAt) >= new Date(ctx.op.startedAt);
        if (existing && !madeByThisAction) throw new ModelingError(`Someone else has since created a deal named "${existing.name}" - use Use Template on that deal instead.`, 409);
        const deal = existing // made by this action before a retry
          || await db.insertDeal({ name: ctx.params.dealName, templateId: ctx.params.templateId }, ctx.actor);
        ctx.state.dealId = deal.id;
        return 'New deal';
      },
      async folders(ctx) {
        const deal = await db.getDeal(ctx.state.dealId);
        const app = { heyphilOp: String(ctx.op.id) };
        const dealFolder = deal.dealFolderId ? await g.getFile(deal.dealFolderId) : await g.findOrCreateFolder(g.MODELING_PROJECTS_FOLDER_ID, deal.name, app);
        const reused = !deal.dealFolderId && dealFolder.appProperties?.heyphilOp !== String(ctx.op.id);
        const fm = deal.fmFolderId ? await g.getFile(deal.fmFolderId) : await g.findOrCreateFolder(dealFolder.id, FM_FOLDER, app);
        await db.setDealFolders(deal.id, { dealFolderId: dealFolder.id, fmFolderId: fm.id });
        await ensureDealSubfolders({ ...deal, fmFolderId: fm.id }, ctx.op.id);
        Object.assign(ctx.state, { dealFolderId: dealFolder.id, fmFolderId: fm.id });
        return reused ? `Used the existing "${deal.name}" folder` : `Created "${deal.name}/${FM_FOLDER}"`;
      },
      async copy(ctx) {
        const deal = await db.getDeal(ctx.state.dealId);
        await assertNoOtherWorkingModel(deal.id, ctx.op.id);
        const rel = await db.getRelease(ctx.params.releaseId);
        const copy = await g.copyFile(rel.fileId, ctx.state.fmFolderId, workingModelFileName(deal.name, deal.templateName), { opId: ctx.op.id, step: 'copy' });
        Object.assign(ctx.state, { fileId: copy.id, fileName: copy.name });
        return `Created "${copy.name}"`;
      },
      async prepare(ctx) {
        const meta = await g.getFile(ctx.state.fileId);
        if (hasAnyReadOnly(meta.contentRestrictions)) await g.unlockNewCopy(ctx.state.fileId); // came out locked like its release
        const t = await db.getTemplate(ctx.params.templateId);
        const rel = await db.getRelease(ctx.params.releaseId);
        await stampNewCopy(ctx.state.fileId, t, { stamp: workingStamp({ releaseVersion: rel.version }), removeProtections: true });
      },
      async register(ctx) {
        const v = await db.insertVersion({
          dealId: ctx.state.dealId, status: 'working', name: 'Working model', fileId: ctx.state.fileId, fileName: ctx.state.fileName,
          fromReleaseId: ctx.params.releaseId, createdByEmail: ctx.actor.email, createdByName: ctx.actor.name, operationId: ctx.op.id,
        });
        ctx.state.versionId = v.id;
      },
    },
  },

  'lock-version': {
    title: (p) => `Lock version ${p.name}`,
    steps: [
      { key: 'copy', label: 'Copy the working model into Versions' },
      { key: 'register', label: 'Record the version in HeyPhil' },
      { key: 'stamp', label: 'Stamp the status line and VERSIONS row in the copy' },
      { key: 'lock', label: 'Lock the version (view-only)' },
    ],
    run: {
      async copy(ctx) {
        const deal = await db.getDeal(ctx.params.dealId);
        const working = await db.workingVersion(deal.id);
        if (!working) throw new ModelingError('This deal has no working model to lock.');
        const { versionsFolderId } = await ensureDealSubfolders(deal, ctx.op.id);
        const copy = await g.copyFile(working.fileId, versionsFolderId,
          versionFileName(deal.name, deal.templateName, ctx.params.name), { opId: ctx.op.id, step: 'copy' });
        Object.assign(ctx.state, { fileId: copy.id, fileName: copy.name, workingId: working.id, workingFileId: working.fileId });
        if (hasAnyReadOnly(copy.contentRestrictions)) await g.unlockNewCopy(copy.id);
        return `Created "${copy.name}"`;
      },
      async register(ctx) {
        const v = await db.insertVersion({
          dealId: ctx.params.dealId, status: 'locked', name: ctx.params.name, fileId: ctx.state.fileId, fileName: ctx.state.fileName,
          fromVersionId: ctx.state.workingId, note: ctx.params.note, createdByEmail: ctx.actor.email, createdByName: ctx.actor.name, operationId: ctx.op.id,
        });
        ctx.state.versionId = v.id;
      },
      async stamp(ctx) {
        const deal = await db.getDeal(ctx.params.dealId);
        const t = await db.getTemplate(deal.templateId);
        await stampNewCopy(ctx.state.fileId, t, {
          stamp: versionStamp({ versionName: ctx.params.name, email: ctx.actor.email, note: ctx.params.note }),
          row: versionsRow({ version: ctx.params.name, type: 'Deal snapshot', email: ctx.actor.email, note: ctx.params.note, copyUrl: sheetUrl(ctx.state.fileId), sourceUrl: sheetUrl(ctx.state.workingFileId) }),
        });
      },
      async lock(ctx) {
        await g.lockFile(ctx.state.fileId);
        await db.markVersionLocked(ctx.state.versionId, ctx.actor);
      },
    },
  },

  // Locks a registered release or locked version that isn't locked in
  // Drive yet (e.g. found by Import).
  'lock-file': {
    title: (p) => `Lock ${p.label}`,
    steps: [{ key: 'lock', label: 'Lock the file (view-only)' }],
    run: {
      async lock(ctx) {
        const { kind, id } = ctx.params;
        const rec = kind === 'release' ? await db.getRelease(id) : await db.getVersion(id);
        await g.lockFile(rec.fileId);
        if (kind === 'release') await db.markReleaseLocked(id, ctx.actor);
        else await db.markVersionLocked(id, ctx.actor);
      },
    },
  },

  export: {
    title: (p) => `Export ${p.label}`,
    steps: [
      { key: 'download', label: 'Export the workbook from Google Sheets', rerun: true },
      { key: 'trim', label: 'Keep the Financial Model tab, freeze links to other tabs', rerun: true },
      { key: 'save', label: 'Save the .xlsx in Exports' },
      { key: 'register', label: 'Record the export in HeyPhil' },
    ],
    run: {
      async download(ctx) {
        if (ctx.state.exportFileId) return 'Already saved';
        const src = await exportSource(ctx.params);
        ctx.mem.xlsx = await g.exportXlsx(src.fileId);
        return `${Math.round(ctx.mem.xlsx.length / 1024)} KB`;
      },
      async trim(ctx) {
        if (ctx.state.exportFileId) return 'Already saved';
        const src = await exportSource(ctx.params);
        const { buffer, frozen } = await financialModelOnly(ctx.mem.xlsx, src.template.exportSheet);
        ctx.mem.out = buffer;
        return `${frozen} cells frozen to values`;
      },
      async save(ctx) {
        const src = await exportSource(ctx.params);
        const folderId = await exportFolder(src, ctx.op.id);
        const file = await g.uploadFile(folderId, exportFileName(src.fileName), ctx.mem.out, { opId: ctx.op.id, step: 'save' });
        Object.assign(ctx.state, { exportFileId: file.id, exportFileName: file.name, folderId });
        return `Saved "${file.name}"`;
      },
      async register(ctx) {
        const e = await db.insertExport({
          versionId: ctx.params.kind === 'version' ? ctx.params.id : null, releaseId: ctx.params.kind === 'release' ? ctx.params.id : null,
          fileId: ctx.state.exportFileId, fileName: ctx.state.exportFileName, folderId: ctx.state.folderId,
          email: ctx.actor.email, name: ctx.actor.name, operationId: ctx.op.id,
        });
        ctx.state.exportId = e.id;
      },
    },
  },
};

async function exportSource({ kind, id }) {
  if (kind === 'release') {
    const rel = await db.getRelease(id);
    const template = await db.getTemplate(rel.templateId);
    return { fileId: rel.fileId, fileName: rel.fileName, template };
  }
  const v = await db.getVersion(id);
  const deal = await db.getDeal(v.dealId);
  const template = await db.getTemplate(deal.templateId);
  return { fileId: v.fileId, fileName: v.fileName, template, deal };
}

async function exportFolder(src, opId) {
  if (src.deal) return (await ensureDealSubfolders(src.deal, opId)).exportsFolderId;
  if (src.template.exportsFolderId) return src.template.exportsFolderId;
  throw new ModelingError('This template has no Exports folder registered.');
}

// ---------------------------------------------------------------- runner
// Each run has its own id; progress is saved only while the database
// still names this run as the owner (so two server instances overlapping
// during a deploy can't both run one action), with a heartbeat so a run
// that died is detected (db.failStaleOperations) and can be retried.
const HEARTBEAT_MS = 20000;
const newRunnerId = () => `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function start(kind, { targetKey, params }, actor) {
  const def = KINDS[kind];
  const steps = def.steps.map((s) => ({ key: s.key, label: s.label, status: 'pending' }));
  const runnerId = newRunnerId();
  const op = await db.startOperation({ kind, targetKey, params, steps, runnerId }, actor);
  run(op, runnerId);
  return op;
}

export async function retry(opId, actor) {
  const runnerId = newRunnerId();
  const op = await db.reopenOperation(opId, actor, runnerId);
  if (!op) throw new ModelingError('Only a failed action can be retried.', 409);
  run(op, runnerId);
  return op;
}

async function run(op, runnerId) {
  const def = KINDS[op.kind];
  // Records always name the person who started the action; whoever
  // retried is kept on the operation (retried_by_email).
  const actor = { email: op.actorEmail, name: op.actorName };
  const ctx = { op, params: op.params, state: op.state || {}, actor, mem: {} };
  // ctx.mem is empty on a retry, so in-memory steps run again
  if (op.steps.some((s) => s.status !== 'done')) {
    op.steps.forEach((s) => { if (def.steps.find((d) => d.key === s.key)?.rerun) s.status = 'pending'; });
  }
  op.status = 'running';
  op.error = null;
  const announce = () => broadcastChange('modeling:operation', { id: op.id, status: op.status });
  const save = () => db.saveOperation({ ...op, state: ctx.state }, runnerId);
  const beat = setInterval(() => db.heartbeat(op.id, runnerId).catch(() => {}), HEARTBEAT_MS);
  let current = null;
  try {
    for (const step of op.steps) {
      if (step.status === 'done') continue;
      current = step;
      step.status = 'running';
      step.at = new Date().toISOString();
      await save(); // eslint-disable-line no-await-in-loop
      announce();
      const detail = await def.run[step.key](ctx); // eslint-disable-line no-await-in-loop
      step.status = 'done';
      step.detail = detail || null;
      step.finishedAt = new Date().toISOString();
      current = null;
      await save(); // eslint-disable-line no-await-in-loop
    }
    op.status = 'succeeded';
    await save();
  } catch (error) {
    if (error instanceof db.LostOwnershipError) {
      console.error(error.message, '- stopping this run');
      return;
    }
    const message = error instanceof ModelingError ? error.message : g.describeGoogleError(error);
    if (current) { current.status = 'failed'; current.detail = message; }
    op.status = 'failed';
    op.error = message;
    // Record the failure; if even that can't be saved, the heartbeat stops
    // and the action shows as interrupted within a couple of minutes.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { await save(); break; } catch (e) { // eslint-disable-line no-await-in-loop
        if (e instanceof db.LostOwnershipError) break;
        console.error(`Modeling op ${op.id}: couldn't record the failure:`, e.message);
        await new Promise((r) => { setTimeout(r, 2000); }); // eslint-disable-line no-await-in-loop
      }
    }
  } finally {
    clearInterval(beat);
    announce();
  }
}
