import express from 'express';
import { requireAuth } from '../auth-middleware.js';
import { requireAppAccess } from '../permissions.js';
import * as cashflowDb from '../cashflow-db.js';

const router = express.Router();

router.use(requireAuth, requireAppAccess('cashflow'));

router.get('/ping', (req, res) => {
  res.json({ ok: true });
});

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidWeek = (w) => typeof w === 'string' && WEEK_RE.test(w);
const isFiniteAmount = (a) => typeof a === 'number' && Number.isFinite(a);

function validateWeekRange(res, startWeek, endWeek) {
  if (!isValidWeek(startWeek) || !isValidWeek(endWeek)) {
    res.status(400).json({ error: 'startWeek and endWeek must be YYYY-MM-DD' });
    return false;
  }
  if (startWeek > endWeek) {
    res.status(400).json({ error: 'startWeek must not be after endWeek' });
    return false;
  }
  return true;
}

const CLIENT_ERROR_MESSAGES = {
  '23503': 'Referenced record does not exist', // foreign_key_violation
  '23514': 'Invalid value', // check_violation
  '22P02': 'Invalid value format', // invalid_text_representation (e.g. non-numeric :id)
  '22007': 'Invalid date format', // invalid_datetime_format
  '22008': 'Invalid date', // datetime_field_overflow (e.g. 2024-13-01)
};

function handleDbError(res, error) {
  const message = CLIENT_ERROR_MESSAGES[error.code];
  if (message) {
    return res.status(400).json({ error: message });
  }
  console.error('Cashflow DB error:', error.message);
  return res.status(500).json({ error: 'Server error' });
}

// ========== DIVISIONS ==========

router.get('/divisions', async (req, res) => {
  try {
    res.json(await cashflowDb.getDivisions());
  } catch (error) {
    handleDbError(res, error);
  }
});

// ========== LINE ITEMS ==========

router.get('/line-items', async (req, res) => {
  try {
    const { divisionId, status } = req.query;
    res.json(await cashflowDb.getLineItems({ divisionId, status }));
  } catch (error) {
    handleDbError(res, error);
  }
});

router.post('/line-items', async (req, res) => {
  try {
    const { divisionId, name, category, sortOrder } = req.body;
    if (!divisionId || typeof divisionId !== 'string') {
      return res.status(400).json({ error: 'divisionId is required' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (category && !['operations', 'investment'].includes(category)) {
      return res.status(400).json({ error: 'category must be operations or investment' });
    }
    const item = await cashflowDb.createLineItem({
      divisionId,
      name: name.trim(),
      category,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
    res.status(201).json(item);
  } catch (error) {
    handleDbError(res, error);
  }
});

router.put('/line-items/:id', async (req, res) => {
  try {
    const { name, category, status, sortOrder } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'name cannot be blank' });
    }
    if (category && !['operations', 'investment'].includes(category)) {
      return res.status(400).json({ error: 'category must be operations or investment' });
    }
    if (status && !['active', 'retired'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or retired' });
    }
    if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
      return res.status(400).json({ error: 'sortOrder must be numeric' });
    }
    const item = await cashflowDb.updateLineItem(req.params.id, {
      name: name !== undefined ? name.trim() : undefined,
      category,
      status,
      sortOrder,
    });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (error) {
    handleDbError(res, error);
  }
});

// ========== ENTRIES ==========

router.get('/entries', async (req, res) => {
  try {
    const { startWeek, endWeek } = req.query;
    if (!validateWeekRange(res, startWeek, endWeek)) return;
    res.json(await cashflowDb.getEntries({ startWeek, endWeek }));
  } catch (error) {
    handleDbError(res, error);
  }
});

router.put('/entries', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries must be a non-empty array' });
    }
    for (const e of entries) {
      if (!Number.isInteger(e.lineItemId)) {
        return res.status(400).json({ error: 'each entry needs an integer lineItemId' });
      }
      if (!isValidWeek(e.weekEnding)) {
        return res.status(400).json({ error: 'each entry needs weekEnding as YYYY-MM-DD' });
      }
      if (!isFiniteAmount(e.amount)) {
        return res.status(400).json({ error: 'each entry needs a numeric amount' });
      }
    }
    res.json(await cashflowDb.upsertEntries(entries));
  } catch (error) {
    handleDbError(res, error);
  }
});

// ========== LENDERS ==========

router.get('/lenders', async (req, res) => {
  try {
    res.json(await cashflowDb.getLenders());
  } catch (error) {
    handleDbError(res, error);
  }
});

router.post('/lenders', async (req, res) => {
  try {
    const { name, sortOrder } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const lender = await cashflowDb.createLender({ name: name.trim(), sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0 });
    res.status(201).json(lender);
  } catch (error) {
    handleDbError(res, error);
  }
});

router.put('/lenders/:id', async (req, res) => {
  try {
    const { name, status, sortOrder } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'name cannot be blank' });
    }
    if (status && !['active', 'retired'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or retired' });
    }
    if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
      return res.status(400).json({ error: 'sortOrder must be numeric' });
    }
    const lender = await cashflowDb.updateLender(req.params.id, {
      name: name !== undefined ? name.trim() : undefined,
      status,
      sortOrder,
    });
    if (!lender) return res.status(404).json({ error: 'Not found' });
    res.json(lender);
  } catch (error) {
    handleDbError(res, error);
  }
});

// ========== DEBT ENTRIES ==========

router.get('/debt-entries', async (req, res) => {
  try {
    const { startWeek, endWeek } = req.query;
    if (!validateWeekRange(res, startWeek, endWeek)) return;
    res.json(await cashflowDb.getDebtEntries({ startWeek, endWeek }));
  } catch (error) {
    handleDbError(res, error);
  }
});

router.put('/debt-entries', async (req, res) => {
  try {
    const { lenderId, weekEnding, amount } = req.body;
    if (!Number.isInteger(lenderId)) {
      return res.status(400).json({ error: 'lenderId must be an integer' });
    }
    if (!isValidWeek(weekEnding)) {
      return res.status(400).json({ error: 'weekEnding must be YYYY-MM-DD' });
    }
    if (!isFiniteAmount(amount)) {
      return res.status(400).json({ error: 'amount must be numeric' });
    }
    res.json(await cashflowDb.upsertDebtEntry({ lenderId, weekEnding, amount }));
  } catch (error) {
    handleDbError(res, error);
  }
});

// ========== ANCHOR (manual starting-cash override) ==========

router.put('/anchor', async (req, res) => {
  try {
    const { weekEnding, startingCash } = req.body;
    if (!isValidWeek(weekEnding)) {
      return res.status(400).json({ error: 'weekEnding must be YYYY-MM-DD' });
    }
    if (!isFiniteAmount(startingCash)) {
      return res.status(400).json({ error: 'startingCash must be numeric' });
    }
    res.json(await cashflowDb.setAnchor(weekEnding, startingCash));
  } catch (error) {
    handleDbError(res, error);
  }
});

// ========== SUMMARY ==========

router.get('/summary', async (req, res) => {
  try {
    const weeksParam = req.query.weeks;
    if (!weeksParam || typeof weeksParam !== 'string') {
      return res.status(400).json({ error: 'weeks is required (comma-separated YYYY-MM-DD list)' });
    }
    const weeks = weeksParam.split(',');
    if (weeks.length === 0 || !weeks.every(isValidWeek)) {
      return res.status(400).json({ error: 'weeks must be a comma-separated list of YYYY-MM-DD dates' });
    }
    res.json(await cashflowDb.getWeeklySummary(weeks));
  } catch (error) {
    handleDbError(res, error);
  }
});

export default router;
