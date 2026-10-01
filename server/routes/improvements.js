import express from 'express';
import { requireAuth, requireImprovementsAdmin } from '../auth-middleware.js';
import * as improvementsDb from '../improvements-db.js';
import { isAdmin } from '../permissions.js';
import {
  ImprovementValidationError,
  parseScreenshotDataUri,
  sanitizeContext,
  validateReporterHint,
} from '../improvement-rules.js';
import { broadcastChange } from '../realtime.js';

const router = express.Router();

// Reporting and viewing are open to everyone who can sign in; moving,
// editing and deleting cards is admin-only (requireImprovementsAdmin,
// checked against the database per request).
router.use(requireAuth);

// No screenshot bytes here (each card has hasScreenshot; the image is
// GET /:id/screenshot). canManage tells the board whether to offer the
// admin-only controls - the server enforces it regardless.
router.get('/', async (req, res) => {
  try {
    const [improvements, canManage] = await Promise.all([
      improvementsDb.getAllImprovements(),
      isAdmin((req.user.email || '').toLowerCase()).catch(() => false),
    ]);
    res.json({ improvements, canManage });
  } catch (error) {
    console.error('Failed to list improvements:', error.message);
    res.status(500).json({ error: 'Failed to list improvements' });
  }
});

router.get('/:id/screenshot', async (req, res) => {
  try {
    const shot = await improvementsDb.getScreenshot(req.params.id);
    if (!shot) return res.status(404).json({ error: 'No screenshot' });
    res.set('Content-Type', shot.type);
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(shot.buffer);
  } catch (error) {
    console.error('Failed to load screenshot:', error.message);
    res.status(500).json({ error: 'Failed to load screenshot' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const improvement = await improvementsDb.getImprovementById(req.params.id);
    if (!improvement) return res.status(404).json({ error: 'Not found' });
    res.json({ improvement });
  } catch (error) {
    console.error('Failed to load improvement:', error.message);
    res.status(500).json({ error: 'Failed to load improvement' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, note, pageUrl } = req.body;
    // Screenshot is optional (the text-only path sends none) - but if one
    // IS provided it must be a real JPEG/PNG/WebP within the size cap
    // (improvement-rules.js), and a report with neither a screenshot nor a
    // note is just an empty card with nothing to triage.
    const screenshot = req.body.screenshot ? parseScreenshotDataUri(req.body.screenshot) : null;
    const reporterHint = validateReporterHint(req.body.reporterHint);
    const trimmedNote = typeof note === 'string' ? note.trim() : '';
    if (!screenshot && !trimmedNote) {
      return res.status(400).json({ error: 'A report needs a screenshot, a note, or both.' });
    }
    const derivedTitle = (title && title.trim()) || trimmedNote.slice(0, 80) || 'Untitled report';
    const improvement = await improvementsDb.createImprovement({
      title: derivedTitle,
      note: trimmedNote,
      screenshot,
      pageUrl: typeof pageUrl === 'string' ? pageUrl.slice(0, 2000) : null,
      reporterEmail: req.user.email,
      reporterName: req.user.name,
      reporterHint,
      context: sanitizeContext(req.body.context),
      // Which build the reporter was looking at (set by Railway on deploy)
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    });
    broadcastChange('improvement:created', { improvement });
    res.status(201).json({ improvement });
  } catch (error) {
    if (error instanceof ImprovementValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Failed to create improvement:', error.message);
    res.status(500).json({ error: 'Failed to create improvement' });
  }
});

router.put('/:id', requireImprovementsAdmin, async (req, res) => {
  try {
    const improvement = await improvementsDb.updateImprovement(req.params.id, req.body || {});
    if (!improvement) return res.status(404).json({ error: 'Not found' });
    broadcastChange('improvement:updated', { improvement });
    res.json({ improvement });
  } catch (error) {
    if (error instanceof ImprovementValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Failed to update improvement:', error.message);
    res.status(500).json({ error: 'Failed to update improvement' });
  }
});

router.delete('/:id', requireImprovementsAdmin, async (req, res) => {
  try {
    const ok = await improvementsDb.softDeleteImprovement(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    broadcastChange('improvement:deleted', { improvementId: req.params.id });
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete improvement:', error.message);
    res.status(500).json({ error: 'Failed to delete improvement' });
  }
});

export default router;
