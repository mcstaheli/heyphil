import express from 'express';
import { requireAuth, makeRequireAdmin } from '../auth-middleware.js';
import * as designDb from '../design-db.js';
import { isAdmin } from '../permissions.js';
import { DesignValidationError, isUuid } from '../design-rules.js';
import { broadcastChange } from '../realtime.js';

const router = express.Router();

// Everyone who can sign in can request, edit and move design cards;
// deleting is admin-only.
router.use(requireAuth);
const requireDesignAdmin = makeRequireAdmin(isAdmin, 'Only admins can delete design requests.');

// A malformed id can't match a card; answer 404 before Postgres refuses it.
router.param('id', (req, res, next, id) => (isUuid(id) ? next() : res.status(404).json({ error: 'Not found' })));

function handleError(res, error, action) {
  if (error instanceof DesignValidationError) {
    return res.status(400).json({ error: error.message });
  }
  console.error(`Failed to ${action}:`, error.message);
  return res.status(500).json({ error: `Failed to ${action}` });
}

router.get('/', async (req, res) => {
  try {
    const [requests, canDelete] = await Promise.all([
      designDb.getAllRequests(),
      isAdmin((req.user.email || '').toLowerCase()).catch(() => false),
    ]);
    res.json({ requests, canDelete });
  } catch (error) {
    handleError(res, error, 'list design requests');
  }
});

router.post('/', async (req, res) => {
  try {
    const { deliverable, projectId, designer, dueDate, notes, link } = req.body || {};
    const request = await designDb.createRequest({
      deliverable, projectId, designer, dueDate, notes, link,
      requesterEmail: req.user.email,
      requesterName: req.user.name,
    });
    broadcastChange('design:created', { request });
    res.status(201).json({ request });
  } catch (error) {
    handleError(res, error, 'create design request');
  }
});

router.put('/:id', async (req, res) => {
  try {
    const request = await designDb.updateRequest(req.params.id, req.body || {});
    if (!request) return res.status(404).json({ error: 'Not found' });
    broadcastChange('design:updated', { request });
    res.json({ request });
  } catch (error) {
    handleError(res, error, 'update design request');
  }
});

router.delete('/:id', requireDesignAdmin, async (req, res) => {
  try {
    const ok = await designDb.softDeleteRequest(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    broadcastChange('design:deleted', { requestId: req.params.id });
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'delete design request');
  }
});

export default router;
