// Modeling (Labs) - the long actions, run step by step in the background:
//   copy         - a named, Unlocked copy of any model, in its owner's
//                  Models folder (the source is only read)
//   use-template - a copy of a template's Active model into a project
//   lock         - lock a model in place (Drive Lock), optionally then
//                  Make Active
//   export       - Excel export of any model
// Every step is saved as it finishes, with what it created, so:
//   - the page shows live progress and a clear result,
//   - a failure stops the action and records which steps were and
//     weren't done (with links to anything already created),
//   - Retry resumes from the first unfinished step. Steps are safe to
//     repeat: copies are found again by the operation id stamped on them,
//     folders are found by name before being created, rows are keyed by
//     Drive file id, and a VERSIONS row is only added if it isn't there.
// Nothing is ever deleted, moved, renamed or overwritten.
import * as g from './drive-guard.js';
import * as db from './db.js';
import { broadcastChange } from '../realtime.js';
import { financialModelOnly } from './export-xlsx.js';
import {
  ModelingError, exportFileName, releaseStamp, workingStamp, versionStamp, copyStamp, versionsRow, sheetUrl,
  hasAnyReadOnly, isLockedRestriction, modelFileName, nextVersion, nextRootVersion, versionTitle,
} from './rules.js';

const FM_FOLDER = 'Financial Modeling';

// ---------------------------------------------------------------- owners
// A model belongs to a template or a project; this is where its copies and
// exports go (folders made if missing, inside the owner's folder only).
export async function ownerOf(model) {
  if (model.templateId) {
    const template = await db.getTemplate(model.templateId);
    return { kind: 'template', id: template.id, key: `template:${template.id}`, template, name: template.name };
  }
  const project = await db.getProject(model.projectId);
  return { kind: 'project', id: project.id, key: `project:${project.id}`, project, name: project.name };
}

export const ownerKey = (model) => (model.templateId ? `template:${model.templateId}` : `project:${model.projectId}`);

async function ensureProjectFolders(project, opId) {
  const app = { heyphilOp: String(opId) };
  let fmId = project.fmFolderId;
  if (!fmId) {
    const dealFolder = project.dealFolderId ? await g.getFile(project.dealFolderId) : await g.findOrCreateFolder(g.MODELING_PROJECTS_FOLDER_ID, project.name, app);
    fmId = (await g.findOrCreateFolder(dealFolder.id, FM_FOLDER, app)).id;
    await db.setProjectFolders(project.id, { dealFolderId: dealFolder.id, fmFolderId: fmId });
  }
  const models = project.modelsFolderId ? await g.getFile(project.modelsFolderId) : await g.findOrCreateFolder(fmId, 'Models', app);
  const exportsF = project.exportsFolderId ? await g.getFile(project.exportsFolderId) : await g.findOrCreateFolder(fmId, 'Exports', app);
  await db.setProjectFolders(project.id, { modelsFolderId: models.id, exportsFolderId: exportsF.id });
  return { fmFolderId: fmId, modelsFolderId: models.id, exportsFolderId: exportsF.id };
}

async function ownerFolders(owner, opId) {
  if (owner.kind === 'project') return ensureProjectFolders(await db.getProject(owner.id), opId);
  const t = owner.template;
  if (!t.modelsFolderId) throw new ModelingError(`${t.name} has no models folder registered.`);
  const exportsF = t.exportsFolderId ? await g.getFile(t.exportsFolderId) : await g.findOrCreateFolder(t.folderId, 'Exports', { heyphilOp: String(opId) });
  return { modelsFolderId: t.modelsFolderId, exportsFolderId: exportsF.id };
}

// The template a model's family started from (walks up the tree).
export async function rootTemplate(model) {
  let m = model;
  for (let i = 0; i < 50 && m; i += 1) {
    if (m.templateId) return db.getTemplate(m.templateId);
    m = m.parentModelId ? await db.getModel(m.parentModelId) : null; // eslint-disable-line no-await-in-loop
  }
  return null;
}

// The Drive name for a new model of this owner.
async function newFileName(owner, sourceModel, version, label) {
  if (owner.kind === 'template') {
    const src = await g.getFile(sourceModel.fileId);
    return modelFileName({ templateFileName: src.name, version, label });
  }
  const t = await rootTemplate(sourceModel);
  return modelFileName({ projectName: owner.name, templateName: t?.name, version, label });
}

// ---------------------------------------------------------------- sheet writes
// Sheet writes happen only on copies HeyPhil made (the guard refuses
// anything else); files registered by Import are left exactly as they are.
async function stampCopy(fileId, template, { stamp, row, removeProtections = false }) {
  const updates = [{ range: template.stampCell, values: [[stamp]] }];
  let appends = row ? [{ range: template.versionsRange, values: [row] }] : [];
  if (row) {
    // a retry must not add the row twice: the file's own link (column G) is unique to it
    const [existing] = await g.readCells(fileId, [template.versionsRange]);
    if (existing.some((r) => r[5] === row[5])) appends = [];
  }
  let deleteProtectedRangeIds = [];
  if (removeProtections) {
    const sheets = await g.readSheetMeta(fileId);
    deleteProtectedRangeIds = sheets.flatMap((s) => s.protectedRanges || []).map((r) => r.protectedRangeId);
  }
  try {
    await g.writeCells(fileId, { updates, appends, deleteProtectedRangeIds });
  } catch (error) {
    if (deleteProtectedRangeIds.length && [400, 403].includes(error.code || error.response?.status)) {
      throw new ModelingError("The copy was made, but it carries sheet protections from the old script that HeyPhil can't remove, so parts of it stay read-only.");
    }
    throw error;
  }
}

// A locked model's lock is re-read from Drive (a Manager could have
// unlocked it by hand); HeyPhil's record is corrected if so.
export async function assertLockedInDrive(model) {
  const meta = await g.getFile(model.fileId);
  if (!isLockedRestriction(meta.contentRestrictions)) {
    await db.markUnlocked(model.id);
    throw new ModelingError(`${model.version} is no longer locked in Drive (someone unlocked it by hand). Lock it again first.`);
  }
}

// A brand-new copy: unlock it if it inherited its source's Drive Lock,
// then stamp it (and drop any sheet protections it inherited).
async function prepareNewCopy(fileId, template, stamp) {
  const meta = await g.getFile(fileId);
  if (hasAnyReadOnly(meta.contentRestrictions)) await g.unlockNewCopy(fileId);
  if (template) await stampCopy(fileId, template, { stamp, removeProtections: true });
}

// ---------------------------------------------------------------- kinds
// Each kind: steps [{ key, label, rerun? }] and run[key](ctx). ctx.state is
// saved after every step; ctx.mem lives only for this run (rerun steps
// rebuild it on retry).
export const KINDS = {
  copy: {
    title: (p) => `Copy ${p.label}`,
    steps: [
      { key: 'reserve', label: 'Assign the version number' },
      { key: 'copy', label: 'Copy the file into Models' },
      { key: 'register', label: 'Record the copy in HeyPhil' },
      { key: 'prepare', label: 'Make the copy editable and stamp it' },
    ],
    run: {
      // saved before anything is copied, so the file's name and its record
      // always carry the same number, even across a retry
      async reserve(ctx) {
        const source = await db.getModel(ctx.params.modelId);
        ctx.state.version = await db.reserveVersion(ctx.op.id, { templateId: source.templateId, projectId: source.projectId },
          (taken) => nextVersion(source.version, taken));
        Object.assign(ctx.state, { templateId: source.templateId || null, projectId: source.projectId || null });
        return ctx.state.version;
      },
      async copy(ctx) {
        const source = await db.getModel(ctx.params.modelId);
        const owner = await ownerOf(source);
        const { modelsFolderId } = await ownerFolders(owner, ctx.op.id);
        const name = await newFileName(owner, source, ctx.state.version, ctx.params.modelLabel);
        const copy = await g.copyFile(source.fileId, modelsFolderId, name, { opId: ctx.op.id, step: 'copy' });
        Object.assign(ctx.state, { fileId: copy.id, fileName: copy.name });
        return `${ctx.state.version}: created "${copy.name}"`;
      },
      async register(ctx) {
        const source = await db.getModel(ctx.params.modelId);
        const m = await db.insertModel({
          templateId: source.templateId, projectId: source.projectId, version: ctx.state.version, label: ctx.params.modelLabel, fileId: ctx.state.fileId, fileName: ctx.state.fileName,
          parentModelId: source.id, origin: 'copy', note: ctx.params.note,
          createdByEmail: ctx.actor.email, createdByName: ctx.actor.name, operationId: ctx.op.id,
        });
        ctx.state.modelId = m.id;
      },
      async prepare(ctx) {
        const source = await db.getModel(ctx.params.modelId);
        const template = await rootTemplate(source);
        await prepareNewCopy(ctx.state.fileId, template, copyStamp({ sourceName: versionTitle(source), email: ctx.actor.email }));
      },
    },
  },

  'use-template': {
    title: (p) => `Use Template for ${p.projectName}`,
    steps: [
      { key: 'check', label: "Check the template's Active model", rerun: true },
      { key: 'project', label: 'Record the project in HeyPhil' },
      { key: 'folders', label: 'Find or create the project folders' },
      { key: 'reserve', label: 'Assign the version number' },
      { key: 'copy', label: 'Copy the Active model into the project' },
      { key: 'register', label: 'Record the new model in HeyPhil' },
      { key: 'prepare', label: 'Make it editable and stamp it' },
    ],
    run: {
      // Runs again on every retry: things may have changed since.
      async check(ctx) {
        const source = await db.getModel(ctx.params.sourceModelId);
        if (!source || !source.isActive) throw new ModelingError("The template's Active model changed - start Use Template again.");
        await assertLockedInDrive(source);
        const sheets = await g.readSheetMeta(source.fileId);
        if (sheets.some((s) => (s.protectedRanges || []).length)) {
          throw new ModelingError(`${source.version} has sheet protections made by the old script that HeyPhil can't remove, so a copy would stay read-only. Make a copy of the template's Draft master, lock it and make it Active, then try again.`);
        }
        return source.version;
      },
      async project(ctx) {
        if (ctx.params.projectId) { ctx.state.projectId = ctx.params.projectId; return 'Existing project'; }
        const existing = await db.findProjectByName(ctx.params.projectName);
        const madeByThisAction = existing && existing.createdByEmail === ctx.op.actorEmail && new Date(existing.createdAt) >= new Date(ctx.op.startedAt);
        if (existing && !madeByThisAction) throw new ModelingError(`Someone else has since created a project named "${existing.name}" - use Use Template on it instead.`, 409);
        const p = existing || await db.insertProject({ name: ctx.params.projectName }, ctx.actor);
        ctx.state.projectId = p.id;
        return 'New project';
      },
      async folders(ctx) {
        const project = await db.getProject(ctx.state.projectId);
        const reusedDeal = !project.dealFolderId && await g.findChildFolder(g.MODELING_PROJECTS_FOLDER_ID, project.name);
        const f = await ensureProjectFolders(project, ctx.op.id);
        ctx.state.modelsFolderId = f.modelsFolderId;
        return reusedDeal ? `Used the existing "${project.name}" folder` : `"${project.name}/${FM_FOLDER}/Models"`;
      },
      async reserve(ctx) {
        ctx.state.version = await db.reserveVersion(ctx.op.id, { projectId: ctx.state.projectId }, (taken) => nextRootVersion(taken));
        return ctx.state.version;
      },
      async copy(ctx) {
        const project = await db.getProject(ctx.state.projectId);
        const source = await db.getModel(ctx.params.sourceModelId);
        const template = await db.getTemplate(source.templateId);
        const name = modelFileName({ projectName: project.name, templateName: template.name, version: ctx.state.version, label: ctx.params.modelLabel });
        const copy = await g.copyFile(source.fileId, ctx.state.modelsFolderId, name, { opId: ctx.op.id, step: 'copy' });
        Object.assign(ctx.state, { fileId: copy.id, fileName: copy.name });
        return `${ctx.state.version}: created "${copy.name}"`;
      },
      async register(ctx) {
        const m = await db.insertModel({
          projectId: ctx.state.projectId, version: ctx.state.version, label: ctx.params.modelLabel, fileId: ctx.state.fileId, fileName: ctx.state.fileName,
          parentModelId: ctx.params.sourceModelId, origin: 'template-use', createdByEmail: ctx.actor.email, createdByName: ctx.actor.name, operationId: ctx.op.id,
        });
        ctx.state.modelId = m.id;
      },
      async prepare(ctx) {
        const source = await db.getModel(ctx.params.sourceModelId);
        const template = await db.getTemplate(source.templateId);
        await prepareNewCopy(ctx.state.fileId, template, workingStamp({ releaseVersion: source.version }));
      },
    },
  },

  // Lock in place (and optionally Make Active). The model's sheet gets the
  // LOCKED stamp and a VERSIONS row first - only if HeyPhil made the file -
  // then Drive's Lock (only drive Managers can remove it).
  lock: {
    title: (p) => `${p.activate ? 'Make Active' : 'Lock'} ${p.label}`,
    steps: [
      { key: 'stamp', label: 'Stamp it LOCKED in the sheet' },
      { key: 'lock', label: 'Lock it in Drive (view-only)' },
      { key: 'snapshot', label: 'Save a snapshot of its inputs and results' },
      { key: 'activate', label: 'Make it the Active model' },
    ],
    run: {
      async stamp(ctx) {
        const m = await db.getModel(ctx.params.modelId);
        const meta = await g.getFile(m.fileId);
        // decided by Drive, not HeyPhil's record: a file locked by hand (or
        // by an earlier attempt) can't be written, and needs no stamp
        if (hasAnyReadOnly(meta.contentRestrictions)) return 'Already locked in Drive';
        if (meta.appProperties?.heyphilCreated !== 'true') return 'Not stamped (a file HeyPhil didn\'t make is left as it is)';
        const template = await rootTemplate(m);
        if (!template) return 'Not stamped (no template)';
        const parent = m.parentModelId ? await db.getModel(m.parentModelId) : null;
        const isTemplate = !!m.templateId;
        await stampCopy(m.fileId, template, {
          stamp: isTemplate
            ? releaseStamp({ version: versionTitle(m), email: ctx.actor.email, note: m.note })
            : versionStamp({ versionName: versionTitle(m), email: ctx.actor.email, note: m.note }),
          row: versionsRow({
            version: versionTitle(m), type: isTemplate ? 'Template release' : 'Deal snapshot', email: ctx.actor.email, note: m.note,
            copyUrl: sheetUrl(m.fileId), sourceUrl: parent ? sheetUrl(parent.fileId) : '',
          }),
        });
      },
      async lock(ctx) {
        const m = await db.getModel(ctx.params.modelId);
        const meta = await g.getFile(m.fileId);
        if (!isLockedRestriction(meta.contentRestrictions)) await g.lockFile(m.fileId);
        await db.markLocked(m.id, ctx.actor);
      },
      // a record of what this locked version says - never stops the lock
      async snapshot(ctx) {
        const m = await db.getModel(ctx.params.modelId);
        // one snapshot per lock: a model locked before this action (e.g.
        // Make Active on a locked model) keeps the snapshot it already has
        const existing = await db.latestSnapshot(m.id, 'outputs');
        if (existing && m.lockedAt && new Date(m.lockedAt) < new Date(ctx.op.startedAt)) return 'Already has its snapshot';
        try {
          const { captureSnapshot } = await import('./results.js');
          return await captureSnapshot(m, ctx.actor.email);
        } catch (error) {
          // never stops the lock; the results panel reads the locked file live instead
          return `Snapshot not saved (${error instanceof ModelingError ? error.message : g.describeGoogleError(error)}) - results will be read live`;
        }
      },
      async activate(ctx) {
        if (!ctx.params.activate) return 'Not requested';
        const m = await db.getModel(ctx.params.modelId);
        // a retry must not undo a newer choice: the Active model has to be
        // the one it was when this action was started
        const current = await db.activeModel({ templateId: m.templateId, projectId: m.projectId });
        if ((current?.id || null) !== (ctx.params.previousActiveId ?? null) && current?.id !== m.id) {
          throw new ModelingError(`${current ? current.version : 'Another model'} was made Active after this action started - nothing changed. Start Make Active again if ${m.version} should replace it.`);
        }
        await assertLockedInDrive(m);
        const r = await db.activateModel(m.id, ctx.actor);
        return r.previous ? `${m.version} is Active (was ${r.previous})` : `${m.version} is Active`;
      },
    },
  },

  // Save answers into a model's input cells (step 2). Only an Unlocked
  // model registered in HeyPhil; only its mapped input cells; formulas
  // kept unless overridden. Records each change and the results before and
  // after, so the page can show what moved.
  'set-inputs': {
    title: (p) => `Update inputs on ${p.label}`,
    steps: [
      { key: 'check', label: 'Check the model is editable', rerun: true },
      { key: 'write', label: 'Write the changed inputs' },
      { key: 'results', label: 'Read the new results' },
    ],
    run: {
      async check(ctx) {
        const m = await db.getModel(ctx.params.modelId);
        if (!m) throw new ModelingError('That model no longer exists.', 404);
        if (m.locked) throw new ModelingError(`${m.version} is locked - make a copy to change it.`, 409);
        if (m.hiddenAt) throw new ModelingError(`${m.version} is hidden - unhide it first.`, 409);
        const meta = await g.getFile(m.fileId);
        if (hasAnyReadOnly(meta.contentRestrictions)) throw new ModelingError(`${m.version} is locked in Drive - make a copy to change it.`, 409);
        if (!ctx.state.before) {
          try {
            const { resultsFor } = await import('./results.js');
            const r = await resultsFor(m.id, { refresh: true });
            ctx.state.before = r.headline.map((h) => ({ key: h.key, label: h.label, display: h.display, raw: h.raw, type: h.type }));
          } catch { ctx.state.before = []; }
        }
        return m.version;
      },
      // Planned once and kept: a retry writes exactly the same cells again
      // (harmless) and keeps the record of what changed from what.
      async write(ctx) {
        const m = await db.getModel(ctx.params.modelId);
        if (!ctx.state.plan) {
          const { readInputs } = await import('./model-inputs.js');
          const { planWrites, targetAdjustment, closeEnough } = await import('./inputs.js');
          const { fields } = await readInputs(m);
          const answers = ctx.params.answers || {};
          const overrides = ctx.params.overrides || {};
          const plan = planWrites(fields, answers, overrides);
          // the Quick targets: the adjustment that makes the average hit the answer
          for (const f of fields.filter((x) => x.kind === 'target' && answers[x.key] !== undefined && answers[x.key] !== '')) {
            const raw = fields.find((x) => x.kind === 'input' && x.target === f.target);
            if (raw && answers[raw.key] !== undefined) {
              throw new ModelingError(`Set either "${f.question}" or "${raw.question}" - they change the same cell.`);
            }
            if (f.adjIsFormula && !overrides[f.key]) throw new ModelingError(`${f.question}: the adjustment it sets is calculated by the model.`);
            const target = Number(answers[f.key]);
            if (closeEnough(target, Number(f.raw)) && !Object.keys(answers).some((k) => k !== f.key)) continue;
            const adj = targetAdjustment(target, f.adjRaw, f.raw);
            plan.cells.push({ range: f.cells[0].range, value: adj });
            plan.changes.push({ key: f.key, label: f.question, from: f.display, to: answers[f.key] });
            plan.targets = [...(plan.targets || []), {
              key: f.key, label: f.question, target, range: f.cells[0].range, outName: f.options,
              adjBefore: Number(f.adjRaw) || 0, outBefore: Number(f.raw), firstAdj: adj,
            }];
          }
          ctx.state.plan = plan;
        }
        const { cells, changes } = ctx.state.plan;
        await g.writeInputCells(m.fileId, cells);
        // Quick targets: the model isn't linear, so goal-seek the adjustment
        // until the average lands within 0.05% (a few writes to that one cell)
        const notes = [];
        const { nextGuess, closeEnough } = await import('./inputs.js');
        for (const t of ctx.state.plan.targets || []) {
          const points = [{ adj: t.adjBefore, out: t.outBefore }];
          let adj = t.firstAdj;
          let out = null;
          for (let i = 0; i < 8; i += 1) {
            const v = await g.readNamedValues(m.fileId, [t.outName]); // eslint-disable-line no-await-in-loop
            out = Number(v[t.outName].raw);
            points.push({ adj, out });
            if (!Number.isFinite(out) || closeEnough(t.target, out)) break;
            const next = nextGuess(t.target, points);
            if (!Number.isFinite(next) || Math.abs(next - adj) < 1e-9) break;
            adj = next;
            await g.writeInputCells(m.fileId, [{ range: t.range, value: adj }]); // eslint-disable-line no-await-in-loop
          }
          // the result didn't respond to the adjustment at all: this map's
          // target doesn't drive that cell - put the adjustment back
          const moved = points.some((p) => Number.isFinite(p.out) && Math.abs(p.out - t.outBefore) > Math.max(Math.abs(t.outBefore) * 1e-6, 1e-9));
          if (!moved) {
            await g.writeInputCells(m.fileId, [{ range: t.range, value: t.adjBefore }]);
            const i = changes.findIndex((c) => c.key === t.key);
            if (i >= 0) changes.splice(i, 1);
            notes.push(`${t.label}: not applied - this model's map doesn't connect that target to its result (the adjustment was put back)`);
            continue;
          }
          const change = changes.find((c) => c.key === t.key);
          if (change) change.adjustment = adj;
          if (out !== null && !closeEnough(t.target, out)) notes.push(`${t.label}: got as close as ${out} (the model can't reach ${t.target} by scaling the curve)`);
        }
        ctx.state.changes = changes;
        const msg = cells.length ? `${changes.length} input${changes.length === 1 ? '' : 's'} changed (${cells.length} cell${cells.length === 1 ? '' : 's'})` : 'Nothing changed';
        return notes.length ? `${msg}. ${notes.join('; ')}` : msg;
      },
      async results(ctx) {
        try {
          const { resultsFor } = await import('./results.js');
          const r = await resultsFor(ctx.params.modelId, { refresh: true });
          ctx.state.after = r.headline.map((h) => ({ key: h.key, label: h.label, display: h.display, raw: h.raw, type: h.type }));
          return 'Results updated';
        } catch (error) {
          ctx.state.after = [];
          return `Saved, but the new results couldn't be read (${g.describeGoogleError(error)}) - refresh to see them`;
        }
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
        const m = await db.getModel(ctx.params.modelId);
        ctx.mem.xlsx = await g.exportXlsx(m.fileId);
        return `${Math.round(ctx.mem.xlsx.length / 1024)} KB`;
      },
      async trim(ctx) {
        if (ctx.state.exportFileId) return 'Already saved';
        const m = await db.getModel(ctx.params.modelId);
        const template = await rootTemplate(m);
        const { buffer, frozen } = await financialModelOnly(ctx.mem.xlsx, template?.exportSheet || 'Financial Model');
        ctx.mem.out = buffer;
        return `${frozen} cells frozen to values`;
      },
      async save(ctx) {
        const m = await db.getModel(ctx.params.modelId);
        const owner = await ownerOf(m);
        const { exportsFolderId } = await ownerFolders(owner, ctx.op.id);
        const current = await g.getFile(m.fileId); // the file's name in Drive now
        const file = await g.uploadFile(exportsFolderId, exportFileName(current.name), ctx.mem.out, { opId: ctx.op.id, step: 'save' });
        Object.assign(ctx.state, { exportFileId: file.id, exportFileName: file.name, folderId: exportsFolderId });
        return `Saved "${file.name}"`;
      },
      async register(ctx) {
        const e = await db.insertExport({
          modelId: ctx.params.modelId, fileId: ctx.state.exportFileId, fileName: ctx.state.exportFileName, folderId: ctx.state.folderId,
          email: ctx.actor.email, name: ctx.actor.name, operationId: ctx.op.id,
        });
        ctx.state.exportId = e.id;
      },
    },
  },
};

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
  const existing = await db.getOperation(opId);
  // step-1 actions share some kind names (copy, use-template, export) but
  // not their shape - they can't be resumed by this code
  const SHAPE = { copy: 'modelId', 'use-template': 'sourceModelId', lock: 'modelId', export: 'modelId', 'set-inputs': 'modelId' };
  if (existing && (!KINDS[existing.kind] || existing.params?.[SHAPE[existing.kind]] === undefined)) {
    throw new ModelingError('This action is from the earlier version of Modeling and can\'t be retried - start it again from the page.', 409);
  }
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
