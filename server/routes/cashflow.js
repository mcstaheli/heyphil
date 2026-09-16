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

// Shared by the four PUT .../:id routes below (divisions, sections,
// line-items, lenders), which all patch the same name/status/sortOrder
// shape. Returns the normalized fields, or null after writing the error
// response itself.
function validatePatchFields(res, { name, status, sortOrder }) {
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ error: 'name cannot be blank' });
    return null;
  }
  if (status !== undefined && !['active', 'retired'].includes(status)) {
    res.status(400).json({ error: 'status must be active or retired' });
    return null;
  }
  if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
    res.status(400).json({ error: 'sortOrder must be numeric' });
    return null;
  }
  return { name: name !== undefined ? name.trim() : undefined, status, sortOrder };
}

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

// Shared "is this writable" checks - used everywhere a write needs the
// full ancestor chain active (creating a child, restoring a retired row
// to active, or writing an entry), so the invariant can't drift between
// routes the way it did when each one re-derived it ad hoc.
async function checkDivisionActive(divisionId) {
  const division = await cashflowDb.getDivisionById(divisionId);
  if (!division) return 'Referenced record does not exist';
  if (division.status !== 'active') return 'Department is retired';
  return null;
}

async function checkSectionActive(sectionId) {
  const section = await cashflowDb.getSectionById(sectionId);
  if (!section) return 'Referenced record does not exist';
  if (section.status !== 'active') return 'Section is retired';
  return checkDivisionActive(section.division_id);
}

async function checkLineItemsActive(ids) {
  const items = await cashflowDb.getLineItemsByIds(ids);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const sectionIds = new Set();
  for (const id of ids) {
    const item = itemsById.get(id);
    if (!item) return `Line item ${id} does not exist`;
    if (item.status !== 'active') return `Line item ${id} is retired`;
    sectionIds.add(item.section_id);
  }
  for (const sectionId of sectionIds) {
    const err = await checkSectionActive(sectionId);
    if (err) return err;
  }
  return null;
}

const CLIENT_ERROR_MESSAGES = {
  '23503': 'Referenced record does not exist', // foreign_key_violation
  '23514': 'Invalid value', // check_violation
  '22P02': 'Invalid value format', // invalid_text_representation (e.g. non-numeric :id)
  '22007': 'Invalid date format', // invalid_datetime_format
  '22008': 'Invalid date', // datetime_field_overflow (e.g. 2024-13-01)
  '23505': 'A section with that name already exists in this department', // unique_violation
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
    const { status } = req.query;
    res.json(await cashflowDb.getDivisions({ status }));
  } catch (error) {
    handleDbError(res, error);
  }
});

router.post('/divisions', async (req, res) => {
  try {
    const { name, sortOrder } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const division = await cashflowDb.createDivision({
      name: name.trim(),
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
    res.status(201).json(division);
  } catch (error) {
    handleDbError(res, error);
  }
});

router.put('/divisions/:id', async (req, res) => {
  try {
    const fields = validatePatchFields(res, req.body);
    if (!fields) return;
    const division = await cashflowDb.updateDivision(req.params.id, fields);
    if (!division) return res.status(404).json({ error: 'Not found' });
    res.json(division);
  } catch (error) {
    handleDbError(res, error);
  }
});

router.delete('/divisions/:id', async (req, res) => {
  try {
    const deleted = await cashflowDb.deleteDivision(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (error) {
    handleDbError(res, error);
  }
});

// ========== SECTIONS ==========

router.get('/sections', async (req, res) => {
  try {
    const { divisionId, status } = req.query;
    res.json(await cashflowDb.getSections({ divisionId, status }));
  } catch (error) {
    handleDbError(res, error);
  }
});

router.post('/sections', async (req, res) => {
  try {
    const { divisionId, name, sortOrder } = req.body;
    if (!divisionId || typeof divisionId !== 'string') {
      return res.status(400).json({ error: 'divisionId is required' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const divisionError = await checkDivisionActive(divisionId);
    if (divisionError) return res.status(400).json({ error: divisionError });
    const section = await cashflowDb.createSection({
      divisionId,
      name: name.trim(),
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
    res.status(201).json(section);
  } catch (error) {
    handleDbError(res, error);
  }
});

router.put('/sections/:id', async (req, res) => {
  try {
    const fields = validatePatchFields(res, req.body);
    if (!fields) return;
    if (fields.status === 'active') {
      const existing = await cashflowDb.getSectionById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const divisionError = await checkDivisionActive(existing.division_id);
      if (divisionError) return res.status(400).json({ error: `Cannot restore: ${divisionError.toLowerCase()}` });
    }
    const section = await cashflowDb.updateSection(req.params.id, fields);
    if (!section) return res.status(404).json({ error: 'Not found' });
    res.json(section);
  } catch (error) {
    handleDbError(res, error);
  }
});

router.delete('/sections/:id', async (req, res) => {
  try {
    const deleted = await cashflowDb.deleteSection(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (error) {
    handleDbError(res, error);
  }
});

// ========== LINE ITEMS ==========

router.get('/line-items', async (req, res) => {
  try {
    const { sectionId, status } = req.query;
    res.json(await cashflowDb.getLineItems({ sectionId, status }));
  } catch (error) {
    handleDbError(res, error);
  }
});

router.post('/line-items', async (req, res) => {
  try {
    const { sectionId, name, sortOrder } = req.body;
    if (!Number.isInteger(sectionId)) {
      return res.status(400).json({ error: 'sectionId is required' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const sectionError = await checkSectionActive(sectionId);
    if (sectionError) return res.status(400).json({ error: sectionError });
    const item = await cashflowDb.createLineItem({
      sectionId,
      name: name.trim(),
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
    res.status(201).json(item);
  } catch (error) {
    handleDbError(res, error);
  }
});

router.put('/line-items/:id', async (req, res) => {
  try {
    const fields = validatePatchFields(res, req.body);
    if (!fields) return;
    if (fields.status === 'active') {
      const existing = await cashflowDb.getLineItemsByIds([Number(req.params.id)]);
      if (!existing[0]) return res.status(404).json({ error: 'Not found' });
      const sectionError = await checkSectionActive(existing[0].section_id);
      if (sectionError) return res.status(400).json({ error: `Cannot restore: ${sectionError.toLowerCase()}` });
    }
    const item = await cashflowDb.updateLineItem(req.params.id, fields);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (error) {
    handleDbError(res, error);
  }
});

router.delete('/line-items/:id', async (req, res) => {
  try {
    const deleted = await cashflowDb.deleteLineItem(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
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
    // Defense-in-depth: the UI disables inputs for a retired item or any
    // retired ancestor, but a stale tab or direct API call could otherwise
    // still write to one.
    const lineItemIds = [...new Set(entries.map((e) => e.lineItemId))];
    const itemsError = await checkLineItemsActive(lineItemIds);
    if (itemsError) return res.status(400).json({ error: itemsError });
    res.json(await cashflowDb.upsertEntries(entries));
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
