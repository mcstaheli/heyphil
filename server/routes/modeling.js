// Labs -> Modeling: /api/modeling. Open to everyone who can sign in -
// releasing, activating, locking and exporting are governed by policy,
// not permissions (Chad's call). Long actions return an operation at once
// (202) and run in the background; the page polls /operations/:id.
import express from 'express';
import { requireAuth } from '../auth-middleware.js';
import { broadcastChange } from '../realtime.js';
import * as db from '../modeling/db.js';
import * as ops from '../modeling/operations.js';
import * as importer from '../modeling/import.js';
import * as g from '../modeling/drive-guard.js';
import { ModelingError, cleanName, cleanNote, suggestNextVersion } from '../modeling/rules.js';

const router = express.Router();
router.use(requireAuth);

const actorOf = (req) => ({ email: req.user.email, name: req.user.name || null });
const intParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ModelingError('Not found', 404);
  return n;
};

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

// ---------------------------------------------------------------- reads
router.get('/overview', handle('load Modeling', async (req, res) => {
  const [templates, deals] = await Promise.all([db.listTemplates(), db.listDeals()]);
  res.json({
    templates: templates.map((t) => ({ ...t, suggestedVersion: suggestNextVersion(t.releases.map((r) => r.version)) })),
    deals,
  });
}));

router.get('/deals/:id', handle('load the deal', async (req, res) => {
  const deal = await db.getDealDetail(intParam(req.params.id));
  if (!deal) throw new ModelingError('Not found', 404);
  res.json({ deal });
}));

router.get('/operations', handle('load activity', async (req, res) => {
  res.json({ operations: await db.listOperations(100) });
}));

router.get('/operations/:id', handle('load the action', async (req, res) => {
  const op = await db.getOperation(intParam(req.params.id));
  if (!op) throw new ModelingError('Not found', 404);
  res.json({ operation: op });
}));

// ---------------------------------------------------------------- templates
router.post('/templates/:id/release', handle('release the template', async (req, res) => {
  const template = await db.getTemplate(intParam(req.params.id));
  if (!template) throw new ModelingError('Not found', 404);
  const version = cleanName(req.body?.version, 'version number', 40);
  const all = await db.listTemplates();
  const releases = all.find((t) => t.id === template.id)?.releases || [];
  if (releases.some((r) => r.version.toLowerCase() === version.toLowerCase())) {
    throw new ModelingError(`${template.name} already has a release ${version}.`, 409);
  }
  await startOp(res, 'release', `template:${template.id}`, { templateId: template.id, version, note: cleanNote(req.body?.note), label: `${template.name} ${version}` }, actorOf(req));
}));

router.post('/releases/:id/activate', handle('mark the release Active', async (req, res) => {
  const rel = await db.getRelease(intParam(req.params.id));
  if (!rel) throw new ModelingError('Not found', 404);
  if (rel.locked) await ops.assertReleaseLockedInDrive(rel); // re-read from Drive, not just HeyPhil's record
  const result = await db.activateRelease(rel.id, actorOf(req));
  broadcastChange('modeling:changed', {});
  res.json(result);
}));

// ---------------------------------------------------------------- deals
router.post('/use-template', handle('start Use Template', async (req, res) => {
  const templateId = intParam(req.body?.templateId);
  const template = await db.getTemplate(templateId);
  if (!template) throw new ModelingError('Pick a template.');
  const release = await db.activeRelease(templateId);
  if (!release) throw new ModelingError(`${template.name} has no Active release yet.`);
  if (!release.locked) throw new ModelingError(`The Active release ${release.version} isn't locked.`);
  let params;
  if (req.body?.dealId) {
    const deal = await db.getDeal(intParam(req.body.dealId));
    if (!deal) throw new ModelingError('That deal no longer exists.', 404);
    if (deal.templateId !== templateId) throw new ModelingError(`"${deal.name}" uses the ${deal.templateName} template.`);
    if (await db.workingVersion(deal.id)) throw new ModelingError(`"${deal.name}" already has a working model.`, 409);
    params = { templateId, releaseId: release.id, dealId: deal.id, dealName: deal.name };
  } else {
    const dealName = cleanName(req.body?.dealName, 'deal name', 120);
    const existing = await db.findDealByName(dealName);
    if (existing) throw new ModelingError(`There's already a deal named "${existing.name}" - pick it from the list instead.`, 409);
    params = { templateId, releaseId: release.id, dealName };
  }
  // keyed by deal NAME for both new and existing deals, so a new-deal run
  // and an existing-deal run for the same deal can't overlap
  const target = `use-template:${params.dealName.toLowerCase()}`;
  await startOp(res, 'use-template', target, { ...params, label: params.dealName }, actorOf(req));
}));

router.post('/deals/:id/lock', handle('lock the version', async (req, res) => {
  const deal = await db.getDeal(intParam(req.params.id));
  if (!deal) throw new ModelingError('Not found', 404);
  if (!(await db.workingVersion(deal.id))) throw new ModelingError('This deal has no working model to lock.');
  if (!deal.fmFolderId) throw new ModelingError("This deal has no Financial Modeling folder recorded.");
  const name = cleanName(req.body?.name, 'version name', 60);
  const detail = await db.getDealDetail(deal.id);
  if (detail.versions.some((v) => v.status === 'locked' && v.name.toLowerCase() === name.toLowerCase())) {
    throw new ModelingError(`"${deal.name}" already has a version named ${name}.`, 409);
  }
  await startOp(res, 'lock-version', `deal:${deal.id}`, { dealId: deal.id, name, note: cleanNote(req.body?.note), label: `${deal.name} ${name}` }, actorOf(req));
}));

// Lock a registered release / locked version that isn't locked in Drive
// yet (found by Import).
router.post('/lock-file', handle('lock the file', async (req, res) => {
  const kind = req.body?.kind;
  const id = intParam(req.body?.id);
  const rec = kind === 'release' ? await db.getRelease(id) : kind === 'version' ? await db.getVersion(id) : null;
  if (!rec) throw new ModelingError('Not found', 404);
  if (kind === 'version' && rec.status !== 'locked') throw new ModelingError('A working model stays editable - use Lock Version to make a locked copy.');
  if (rec.locked) throw new ModelingError('Already locked.', 409);
  await startOp(res, 'lock-file', `file:${rec.fileId}`, { kind, id, label: rec.fileName }, actorOf(req));
}));

router.post('/export', handle('start the export', async (req, res) => {
  const kind = req.body?.kind;
  const id = intParam(req.body?.id);
  const rec = kind === 'release' ? await db.getRelease(id) : kind === 'version' ? await db.getVersion(id) : null;
  if (!rec) throw new ModelingError('Not found', 404);
  await startOp(res, 'export', `export:${kind}:${id}`, { kind, id, label: rec.fileName }, actorOf(req));
}));

router.get('/exports/:id/download', handle('download the export', async (req, res) => {
  const exp = await db.getExport(intParam(req.params.id));
  if (!exp) throw new ModelingError('Not found', 404);
  const buf = await g.downloadFile(exp.fileId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exp.fileName)}`);
  res.send(buf);
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
