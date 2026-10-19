import express from 'express';
import { requireAuth } from '../auth-middleware.js';
import * as sitePlansDb from '../site-plans-db.js';
import { isAdmin } from '../permissions.js';
import { SitePlanValidationError, isUuid } from '../site-plan-rules.js';

const router = express.Router();

// Everyone who can sign in can create and edit sites; deleting is for the
// person who created the site or an admin.
router.use(requireAuth);

// A malformed id can't match a site; answer 404 before Postgres refuses it.
router.param('id', (req, res, next, id) => (isUuid(id) ? next() : res.status(404).json({ error: 'Not found' })));

function handleError(res, error, action) {
  if (error instanceof SitePlanValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof sitePlansDb.SitePlanConflictError) {
    return res.status(409).json({ error: error.message });
  }
  console.error(`Failed to ${action}:`, error.message);
  return res.status(500).json({ error: `Failed to ${action}` });
}

async function canDelete(req, plan) {
  const email = (req.user.email || '').toLowerCase();
  if (plan.createdByEmail && plan.createdByEmail.toLowerCase() === email) return true;
  return isAdmin(email).catch(() => false);
}

// Presets come before /:id so "presets" is never read as a site id.
router.get('/presets', async (req, res) => {
  try {
    res.json({ presets: await sitePlansDb.listPresets() });
  } catch (error) {
    handleError(res, error, 'list presets');
  }
});

router.post('/presets', async (req, res) => {
  try {
    const preset = await sitePlansDb.createPreset(req.body || {}, { email: req.user.email, name: req.user.name });
    res.status(201).json({ preset });
  } catch (error) {
    handleError(res, error, 'save the preset');
  }
});

router.delete('/presets/:presetId', async (req, res) => {
  try {
    if (!isUuid(req.params.presetId)) return res.status(404).json({ error: 'Not found' });
    const preset = await sitePlansDb.getPreset(req.params.presetId);
    if (!preset) return res.status(404).json({ error: 'Not found' });
    if (!(await canDelete(req, preset))) {
      return res.status(403).json({ error: 'Only the person who saved this preset or an admin can delete it.' });
    }
    await sitePlansDb.softDeletePreset(req.params.presetId);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'delete the preset');
  }
});

router.get('/', async (req, res) => {
  try {
    const plans = await sitePlansDb.getAllPlans();
    res.json({ plans });
  } catch (error) {
    handleError(res, error, 'list site plans');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const plan = await sitePlansDb.getPlanById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Not found' });
    res.json({ plan, canDelete: await canDelete(req, plan) });
  } catch (error) {
    handleError(res, error, 'load site plan');
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, projectId } = req.body || {};
    const plan = await sitePlansDb.createPlan({
      name,
      projectId,
      createdByEmail: req.user.email,
      createdByName: req.user.name,
    });
    res.status(201).json({ plan });
  } catch (error) {
    handleError(res, error, 'create site plan');
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { expectedUpdatedAt, ...updates } = req.body || {};
    const plan = await sitePlansDb.updatePlan(req.params.id, updates, expectedUpdatedAt);
    if (!plan) return res.status(404).json({ error: 'Not found' });
    res.json({ plan });
  } catch (error) {
    handleError(res, error, 'update site plan');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const plan = await sitePlansDb.getPlanById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Not found' });
    if (!(await canDelete(req, plan))) {
      return res.status(403).json({ error: 'Only the person who created this site or an admin can delete it.' });
    }
    await sitePlansDb.softDeletePlan(req.params.id);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'delete site plan');
  }
});

export default router;
