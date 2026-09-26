import express from 'express';
import { requireAuth } from '../auth-middleware.js';
import * as improvementsDb from '../improvements-db.js';
import { runClassificationSweep } from '../improvements-classify.js';

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const improvements = await improvementsDb.getAllImprovements();
    res.json({ improvements });
  } catch (error) {
    console.error('Failed to list improvements:', error.message);
    res.status(500).json({ error: 'Failed to list improvements' });
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
    const { title, note, screenshot, pageUrl } = req.body;
    if (!screenshot || typeof screenshot !== 'string' || !screenshot.startsWith('data:image/')) {
      return res.status(400).json({ error: 'screenshot must be a data:image/* URI' });
    }
    const trimmedNote = typeof note === 'string' ? note.trim() : '';
    const derivedTitle = (title && title.trim()) || trimmedNote.slice(0, 80) || 'Untitled report';
    const improvement = await improvementsDb.createImprovement({
      title: derivedTitle,
      note: trimmedNote,
      screenshot,
      pageUrl: typeof pageUrl === 'string' ? pageUrl.slice(0, 2000) : null,
      reporterEmail: req.user.email,
      reporterName: req.user.name,
    });
    res.status(201).json({ improvement });
  } catch (error) {
    console.error('Failed to create improvement:', error.message);
    res.status(500).json({ error: 'Failed to create improvement' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const improvement = await improvementsDb.updateImprovement(req.params.id, req.body || {});
    if (!improvement) return res.status(404).json({ error: 'Not found' });
    res.json({ improvement });
  } catch (error) {
    if (/^(kind|status) must be one of/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Failed to update improvement:', error.message);
    res.status(500).json({ error: 'Failed to update improvement' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await improvementsDb.softDeleteImprovement(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete improvement:', error.message);
    res.status(500).json({ error: 'Failed to delete improvement' });
  }
});

// Manual trigger - lets a person re-run triage on the current backlog
// without waiting for the next scheduled sweep (e.g. right after adding
// ANTHROPIC_API_KEY for the first time).
router.post('/classify-now', async (req, res) => {
  try {
    const result = await runClassificationSweep();
    res.json(result);
  } catch (error) {
    console.error('Failed to run classification sweep:', error.message);
    res.status(500).json({ error: 'Failed to run classification sweep' });
  }
});

export default router;
