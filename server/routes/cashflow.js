import express from 'express';
import { requireAuth } from '../auth-middleware.js';
import { requireAppAccess } from '../permissions.js';

const router = express.Router();

router.use(requireAuth, requireAppAccess('cashflow'));

// Placeholder route to verify the access-control chain end-to-end.
// Real cashflow data endpoints land here in the next phase.
router.get('/ping', (req, res) => {
  res.json({ ok: true });
});

export default router;
