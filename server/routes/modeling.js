// Labs -> Modeling: /api/modeling. Open to everyone who can sign in -
// copying, locking, making Active and exporting are governed by policy,
// not permissions (Chad's call). Long actions return an operation at once
// (202) and run in the background; the page polls /operations/:id.
//
// Operation params: `label` is the text shown in Activity; `modelLabel` is
// the optional description given to a new model ("Higher ADR case").
import express from 'express';
import { requireAuth } from '../auth-middleware.js';
import { requireAppAccess } from '../permissions.js';
import { broadcastChange } from '../realtime.js';
import * as db from '../modeling/db.js';
import * as ops from '../modeling/operations.js';
import * as importer from '../modeling/import.js';
import * as results from '../modeling/results.js';
import * as g from '../modeling/drive-guard.js';
import { ModelingError, cleanName, cleanNote, nextVersion, nextRootVersion, versionTitle } from '../modeling/rules.js';

const router = express.Router();
// Only people granted this app (Settings -> App access); admins always.
router.use(requireAuth, requireAppAccess('modeling'));

const actorOf = (req) => ({ email: req.user.email, name: req.user.name || null });
const intParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ModelingError('Not found', 404);
  return n;
};
const optionalLabel = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : cleanName(v, 'label', 80));

function handle(action, fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof ModelingError) return res.status(error.status).json({ error: error.message });
      console.error(`Modeling: failed to ${action}:`, error.message);
      return res.status(500).json({ error: `Couldn't ${action}: ${g.describeGoogleError(error)}` });
    }
  };
}

async function startOp(res, kind, targetKey, params, actor) {
  const op = await ops.start(kind, { targetKey, params }, actor);
  broadcastChange('modeling:changed', {});
  res.status(202).json({ operation: op });
}

async function modelOr404(id) {
  const m = await db.getModel(intParam(id));
  if (!m) throw new ModelingError('Not found', 404);
  return m;
}

// ---------------------------------------------------------------- reads
router.get('/overview', handle('load Modeling', async (req, res) => {
  const [templates, projects] = await Promise.all([db.listTemplates(), db.listProjects()]);
  res.json({ templates, projects });
}));

router.get('/projects/:id', handle('load the project', async (req, res) => {
  const project = await db.getProjectDetail(intParam(req.params.id));
  if (!project) throw new ModelingError('Not found', 404);
  res.json({ project });
}));

router.get('/templates/:id/exports', handle('load exports', async (req, res) => {
  res.json({ exports: await db.listTemplateExports(intParam(req.params.id)) });
}));

// The version number a copy of this model would get (shown before copying).
router.get('/models/:id/next-version', handle('work out the version', async (req, res) => {
  const m = await modelOr404(req.params.id);
  res.json({ version: nextVersion(m.version, await db.takenVersions({ templateId: m.templateId, projectId: m.projectId })) });
}));

// The version a Use Template into this project would get.
router.get('/projects/:id/next-version', handle('work out the version', async (req, res) => {
  res.json({ version: nextRootVersion(await db.takenVersions({ projectId: intParam(req.params.id) })) });
}));

// A model's results (outputs) as display groups + headline numbers.
router.get('/models/:id/results', handle('read the results', async (req, res) => {
  const m = await modelOr404(req.params.id);
  res.json({ results: await results.resultsFor(m.id, { refresh: req.query.refresh === '1' }) });
}));

// Results for several models of one project at once (the comparison):
// ?models=1,2,3 (default: the Active model and every starred one).
router.get('/projects/:id/results', handle('read the results', async (req, res) => {
  const project = await db.getProjectDetail(intParam(req.params.id));
  if (!project) throw new ModelingError('Not found', 404);
  const wanted = req.query.models
    ? String(req.query.models).split(',').map(Number).filter((n) => project.models.some((m) => m.id === n)).slice(0, 8)
    : project.models.filter((m) => m.isActive || (m.starredAt && !m.hiddenAt)).map((m) => m.id);
  const list = await Promise.all(wanted.map(async (id) => {
    try {
      return await results.resultsFor(id, { refresh: req.query.refresh === '1' });
    } catch (error) {
      return { modelId: id, error: g.describeGoogleError(error), groups: [], headline: [] };
    }
  }));
  res.json({ results: list });
}));

router.get('/operations', handle('load activity', async (req, res) => {
  res.json({ operations: await db.listOperations(100) });
}));

router.get('/operations/:id', handle('load the action', async (req, res) => {
  const op = await db.getOperation(intParam(req.params.id));
  if (!op) throw new ModelingError('Not found', 404);
  res.json({ operation: op });
}));

// ---------------------------------------------------------------- model actions
router.post('/models/:id/copy', handle('make the copy', async (req, res) => {
  const m = await modelOr404(req.params.id);
  const modelLabel = optionalLabel(req.body?.label);
  await startOp(res, 'copy', ops.ownerKey(m), {
    modelId: m.id, modelLabel, note: cleanNote(req.body?.note), label: `copy of ${versionTitle(m)}`,
  }, actorOf(req));
}));

// Lock in place; with activate=true, also make it the Active model.
router.post('/models/:id/lock', handle('lock the model', async (req, res) => {
  const m = await modelOr404(req.params.id);
  const activate = !!req.body?.activate;
  if (m.hiddenAt) throw new ModelingError('Unhide the model first.');
  if (activate && m.isActive) throw new ModelingError(`${m.version} is already the Active model.`, 409);
  if (!activate && m.locked) throw new ModelingError(`${m.version} is already locked.`, 409);
  const current = activate ? await db.activeModel({ templateId: m.templateId, projectId: m.projectId }) : null;
  await startOp(res, 'lock', ops.ownerKey(m), { modelId: m.id, activate, previousActiveId: current?.id || null, label: versionTitle(m) }, actorOf(req));
}));

router.post('/models/:id/hide', handle('hide the model', async (req, res) => {
  const m = await modelOr404(req.params.id);
  await db.setHidden(m.id, req.body?.hidden !== false, actorOf(req));
  broadcastChange('modeling:changed', {});
  res.json({ ok: true });
}));

router.post('/models/:id/star', handle('star the model', async (req, res) => {
  const m = await modelOr404(req.params.id);
  await db.setStarred(m.id, req.body?.starred !== false, actorOf(req));
  broadcastChange('modeling:changed', {});
  res.json({ ok: true });
}));

router.post('/models/:id/export', handle('start the export', async (req, res) => {
  const m = await modelOr404(req.params.id);
  await startOp(res, 'export', `export:${m.id}`, { modelId: m.id, label: versionTitle(m) }, actorOf(req));
}));

router.get('/exports/:id/download', handle('download the export', async (req, res) => {
  const exp = await db.getExport(intParam(req.params.id));
  if (!exp) throw new ModelingError('Not found', 404);
  const buf = await g.downloadFile(exp.fileId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exp.fileName)}`);
  res.send(buf);
}));

// ---------------------------------------------------------------- Use Template
router.post('/use-template', handle('start Use Template', async (req, res) => {
  const templateId = intParam(req.body?.templateId);
  const template = await db.getTemplate(templateId);
  if (!template) throw new ModelingError('Pick a template.');
  const source = await db.activeModel({ templateId });
  if (!source) throw new ModelingError(`${template.name} has no Active model yet.`);
  const modelLabel = optionalLabel(req.body?.label);
  let params;
  let target;
  if (req.body?.projectId) {
    const project = await db.getProject(intParam(req.body.projectId));
    if (!project) throw new ModelingError('That project no longer exists.', 404);
    params = { templateId, sourceModelId: source.id, projectId: project.id, projectName: project.name, modelLabel };
    target = `project:${project.id}`;
  } else {
    const projectName = cleanName(req.body?.projectName, 'project name', 120);
    const existing = await db.findProjectByName(projectName);
    if (existing) throw new ModelingError(`There's already a project named "${existing.name}" - pick it from the list instead.`, 409);
    params = { templateId, sourceModelId: source.id, projectName, modelLabel };
    target = `new-project:${projectName.toLowerCase()}`;
  }
  await startOp(res, 'use-template', target, { ...params, label: `${params.projectName} from ${template.name} ${source.version}` }, actorOf(req));
}));

router.post('/operations/:id/retry', handle('retry the action', async (req, res) => {
  const op = await ops.retry(intParam(req.params.id), actorOf(req));
  broadcastChange('modeling:changed', {});
  res.status(202).json({ operation: op });
}));

// ---------------------------------------------------------------- import
router.get('/import/scan', handle('scan the HeyPhil folder', async (req, res) => {
  res.json(await importer.scan());
}));

router.post('/import/apply', handle('import', async (req, res) => {
  const done = await importer.apply(req.body || {}, actorOf(req));
  broadcastChange('modeling:changed', {});
  res.json({ done });
}));

export default router;
