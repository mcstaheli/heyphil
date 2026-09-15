// Database queries for the Cashflow Labs app
import pool, { transaction } from './db.js';

// ========== MIGRATIONS ==========

// Each statement is isolated: one table/index failing to create must not
// block sibling tables that don't depend on it (mirrors server/index.js's
// runMigrationStep - see CLAUDE.md).
async function step(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`⚠️  Cashflow migration warning (${label}, may be safe to ignore):`, error.message);
  }
}

export async function createTables() {
  await step('cashflow_divisions table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_divisions (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0
    )
  `));

  await step('cashflow_line_items table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_line_items (
      id SERIAL PRIMARY KEY,
      division_id VARCHAR(50) NOT NULL REFERENCES cashflow_divisions(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(20) NOT NULL DEFAULT 'operations' CHECK (category IN ('operations', 'investment')),
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `));

  await step('cashflow_entries table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_entries (
      line_item_id INT NOT NULL REFERENCES cashflow_line_items(id) ON DELETE CASCADE,
      week_ending DATE NOT NULL,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (line_item_id, week_ending)
    )
  `));

  await step('cashflow_lenders table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_lenders (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
      sort_order INT NOT NULL DEFAULT 0
    )
  `));

  await step('cashflow_debt_entries table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_debt_entries (
      lender_id INT NOT NULL REFERENCES cashflow_lenders(id) ON DELETE CASCADE,
      week_ending DATE NOT NULL,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      PRIMARY KEY (lender_id, week_ending)
    )
  `));

  await step('cashflow_weekly_anchor table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_weekly_anchor (
      week_ending DATE PRIMARY KEY,
      starting_cash NUMERIC(14, 2) NOT NULL
    )
  `));

  await step('cashflow_entries week index', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_cashflow_entries_week ON cashflow_entries(week_ending)`));
  await step('cashflow_debt_entries week index', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_cashflow_debt_entries_week ON cashflow_debt_entries(week_ending)`));
  await step('cashflow_line_items division index', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_cashflow_line_items_division ON cashflow_line_items(division_id)`));
}

const DEFAULT_DIVISIONS = [
  { id: 'studio', name: 'Studio', sort_order: 1 },
  { id: 'development', name: 'Development', sort_order: 2 },
  { id: 'hospitality', name: 'Hospitality', sort_order: 3 },
  { id: 'senior_living', name: 'Senior Living', sort_order: 4 },
  { id: 'managed_ventures', name: 'Managed Ventures', sort_order: 5 },
  { id: 'management', name: 'Management', sort_order: 6 },
];

export async function seedDivisions() {
  for (const d of DEFAULT_DIVISIONS) {
    await pool.query(
      `INSERT INTO cashflow_divisions (id, name, sort_order) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [d.id, d.name, d.sort_order]
    );
  }
}

// ========== DIVISIONS ==========

export async function getDivisions() {
  const result = await pool.query(`SELECT * FROM cashflow_divisions ORDER BY sort_order`);
  return result.rows;
}

// ========== LINE ITEMS ==========

export async function getLineItems({ divisionId, status } = {}) {
  const conditions = [];
  const params = [];
  if (divisionId) {
    params.push(divisionId);
    conditions.push(`division_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT * FROM cashflow_line_items ${where} ORDER BY division_id, sort_order, id`,
    params
  );
  return result.rows;
}

export async function createLineItem({ divisionId, name, category = 'operations', sortOrder = 0 }) {
  const result = await pool.query(
    `INSERT INTO cashflow_line_items (division_id, name, category, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [divisionId, name, category, sortOrder]
  );
  return result.rows[0];
}

export async function updateLineItem(id, { name, category, status, sortOrder }) {
  const result = await pool.query(
    `UPDATE cashflow_line_items
     SET name = COALESCE($2, name),
         category = COALESCE($3, category),
         status = COALESCE($4, status),
         sort_order = COALESCE($5, sort_order)
     WHERE id = $1
     RETURNING *`,
    [id, name ?? null, category ?? null, status ?? null, sortOrder ?? null]
  );
  return result.rows[0];
}

// ========== ENTRIES ==========

export async function getEntries({ startWeek, endWeek }) {
  const result = await pool.query(
    `SELECT e.line_item_id, e.week_ending, e.amount, li.division_id, li.category
     FROM cashflow_entries e
     JOIN cashflow_line_items li ON li.id = e.line_item_id
     WHERE e.week_ending BETWEEN $1 AND $2`,
    [startWeek, endWeek]
  );
  return result.rows;
}

export async function upsertEntries(entries) {
  return transaction(async (client) => {
    const results = [];
    for (const { lineItemId, weekEnding, amount } of entries) {
      const result = await client.query(
        `INSERT INTO cashflow_entries (line_item_id, week_ending, amount)
         VALUES ($1, $2, $3)
         ON CONFLICT (line_item_id, week_ending)
         DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
         RETURNING *`,
        [lineItemId, weekEnding, amount]
      );
      results.push(result.rows[0]);
    }
    return results;
  });
}

// ========== LENDERS ==========

export async function getLenders() {
  const result = await pool.query(`SELECT * FROM cashflow_lenders ORDER BY sort_order, id`);
  return result.rows;
}

export async function createLender({ name, sortOrder = 0 }) {
  const result = await pool.query(
    `INSERT INTO cashflow_lenders (name, sort_order) VALUES ($1, $2) RETURNING *`,
    [name, sortOrder]
  );
  return result.rows[0];
}

export async function updateLender(id, { name, status, sortOrder }) {
  const result = await pool.query(
    `UPDATE cashflow_lenders
     SET name = COALESCE($2, name),
         status = COALESCE($3, status),
         sort_order = COALESCE($4, sort_order)
     WHERE id = $1
     RETURNING *`,
    [id, name ?? null, status ?? null, sortOrder ?? null]
  );
  return result.rows[0];
}

// ========== DEBT ENTRIES ==========

export async function getDebtEntries({ startWeek, endWeek }) {
  const result = await pool.query(
    `SELECT lender_id, week_ending, amount
     FROM cashflow_debt_entries
     WHERE week_ending BETWEEN $1 AND $2`,
    [startWeek, endWeek]
  );
  return result.rows;
}

export async function upsertDebtEntry({ lenderId, weekEnding, amount }) {
  const result = await pool.query(
    `INSERT INTO cashflow_debt_entries (lender_id, week_ending, amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (lender_id, week_ending)
     DO UPDATE SET amount = EXCLUDED.amount
     RETURNING *`,
    [lenderId, weekEnding, amount]
  );
  return result.rows[0];
}

// ========== WEEKLY ANCHOR (manual starting-cash override) ==========

export async function setAnchor(weekEnding, startingCash) {
  const result = await pool.query(
    `INSERT INTO cashflow_weekly_anchor (week_ending, starting_cash)
     VALUES ($1, $2)
     ON CONFLICT (week_ending) DO UPDATE SET starting_cash = EXCLUDED.starting_cash
     RETURNING *`,
    [weekEnding, startingCash]
  );
  return result.rows[0];
}

export async function getAnchors({ startWeek, endWeek }) {
  const result = await pool.query(
    `SELECT week_ending, starting_cash FROM cashflow_weekly_anchor
     WHERE week_ending BETWEEN $1 AND $2`,
    [startWeek, endWeek]
  );
  return result.rows;
}

// ========== SUMMARY ==========

// Computes, for each week in `weekEndings` (chronological order), the
// division contribution totals, debt shift, starting cash and ending cash.
// Starting cash chains from the previous week's ending cash unless a manual
// anchor override exists for that week.
export async function getWeeklySummary(weekEndings) {
  if (weekEndings.length === 0) return [];
  const sorted = [...weekEndings].sort();
  const startWeek = sorted[0];
  const endWeek = sorted[sorted.length - 1];

  const [entries, debtEntries, anchors, divisions] = await Promise.all([
    getEntries({ startWeek, endWeek }),
    getDebtEntries({ startWeek, endWeek }),
    getAnchors({ startWeek, endWeek }),
    getDivisions(),
  ]);

  const anchorByWeek = new Map(anchors.map((a) => [toDateKey(a.week_ending), Number(a.starting_cash)]));

  const divisionTotalsByWeek = new Map(); // weekKey -> { divisionId -> total }
  for (const e of entries) {
    const weekKey = toDateKey(e.week_ending);
    if (!divisionTotalsByWeek.has(weekKey)) divisionTotalsByWeek.set(weekKey, {});
    const totals = divisionTotalsByWeek.get(weekKey);
    totals[e.division_id] = (totals[e.division_id] || 0) + Number(e.amount);
  }

  const debtShiftByWeek = new Map();
  for (const d of debtEntries) {
    const weekKey = toDateKey(d.week_ending);
    debtShiftByWeek.set(weekKey, (debtShiftByWeek.get(weekKey) || 0) + Number(d.amount));
  }

  let runningCash = 0;
  const summary = [];
  for (const weekEnding of sorted) {
    const weekKey = toDateKey(weekEnding);
    const startingCash = anchorByWeek.has(weekKey) ? anchorByWeek.get(weekKey) : runningCash;
    const divisionTotals = divisionTotalsByWeek.get(weekKey) || {};
    const contribution = divisions.reduce((sum, d) => sum + (divisionTotals[d.id] || 0), 0);
    const debtShift = debtShiftByWeek.get(weekKey) || 0;
    const endingCash = startingCash + contribution + debtShift;

    summary.push({
      weekEnding: weekKey,
      startingCash,
      divisionTotals,
      contribution,
      debtShift,
      endingCash,
    });

    runningCash = endingCash;
  }

  return summary;
}

function toDateKey(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
