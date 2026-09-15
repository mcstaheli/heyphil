// Database queries for the Cashflow Labs app
import { randomUUID } from 'crypto';
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
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
      sort_order INT NOT NULL DEFAULT 0
    )
  `));

  await step('cashflow_divisions status column (existing rows)', () => pool.query(`
    ALTER TABLE cashflow_divisions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
  `));

  // Postgres has no "ADD CONSTRAINT IF NOT EXISTS", and - unlike the other
  // steps here - this isn't only a repeat-boot concern: Postgres names an
  // inline column CHECK the same way (<table>_<column>_check), so even a
  // brand-new database already has this exact name from the CREATE TABLE
  // above. Check pg_constraint explicitly rather than relying on step()'s
  // swallow-and-log, which would otherwise warn on every single boot.
  await step('cashflow_divisions status check constraint', async () => {
    const existing = await pool.query(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'cashflow_divisions_status_check' AND conrelid = 'cashflow_divisions'::regclass
    `);
    if (existing.rows.length === 0) {
      await pool.query(`ALTER TABLE cashflow_divisions ADD CONSTRAINT cashflow_divisions_status_check CHECK (status IN ('active', 'retired'))`);
    }
  });

  await step('cashflow_sections table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_sections (
      id SERIAL PRIMARY KEY,
      division_id VARCHAR(50) NOT NULL REFERENCES cashflow_divisions(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
      sort_order INT NOT NULL DEFAULT 0
    )
  `));

  // Guards the "General" backfill below against two boots racing to create
  // it (e.g. a rolling deploy briefly running two instances). Partial (only
  // active rows) so retiring a section frees up its name for reuse - a
  // retired "Payroll" shouldn't permanently block creating a new one.
  await step('cashflow_sections division+name uniqueness', () => pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cashflow_sections_division_name_active
    ON cashflow_sections(division_id, name) WHERE status = 'active'
  `));
  await step('cashflow_sections drop old non-partial uniqueness', () => pool.query(`
    DROP INDEX IF EXISTS idx_cashflow_sections_division_name
  `));

  // CREATE TABLE IF NOT EXISTS only applies to a brand-new database - this
  // table already existed in production with an older division_id/category
  // shape, so the ALTER/backfill/DROP steps below are what actually migrate
  // real rows. Safe to run every boot: each becomes a no-op once applied.
  await step('cashflow_line_items table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_line_items (
      id SERIAL PRIMARY KEY,
      section_id INT NOT NULL REFERENCES cashflow_sections(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `));

  await step('cashflow_line_items section_id column (existing rows)', () => pool.query(`
    ALTER TABLE cashflow_line_items ADD COLUMN IF NOT EXISTS section_id INT REFERENCES cashflow_sections(id) ON DELETE CASCADE
  `));

  await step('cashflow_line_items section_id backfill', () => migrateLineItemsToSections());

  // Only proceed to NOT NULL + dropping the legacy columns if the backfill
  // actually finished: those columns are the only way to recover an
  // orphaned row's division, so dropping them while any row is still
  // unbackfilled would make it permanently unrecoverable.
  const stillOrphaned = await pool.query(`
    SELECT count(*)::int AS n FROM cashflow_line_items WHERE section_id IS NULL
  `).catch(() => ({ rows: [{ n: 0 }] })); // column already gone = already migrated
  if (stillOrphaned.rows[0].n === 0) {
    await step('cashflow_line_items section_id NOT NULL', () => pool.query(`
      ALTER TABLE cashflow_line_items ALTER COLUMN section_id SET NOT NULL
    `));

    await step('cashflow_line_items drop legacy columns', async () => {
      await pool.query(`ALTER TABLE cashflow_line_items DROP COLUMN IF EXISTS division_id`);
      await pool.query(`ALTER TABLE cashflow_line_items DROP COLUMN IF EXISTS category`);
    });
  } else {
    console.error(`⚠️  Cashflow migration: ${stillOrphaned.rows[0].n} line item(s) still missing section_id - skipping NOT NULL/column drop this boot to avoid data loss`);
  }

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
  await step('cashflow_line_items section index', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_cashflow_line_items_section ON cashflow_line_items(section_id)`));
  await step('cashflow_sections division index', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_cashflow_sections_division ON cashflow_sections(division_id)`));
}

// One-time backfill for line items created before sections existed: gives
// each affected division a "General" section and attaches its orphaned
// items there. No-ops once the old division_id/category columns are gone.
async function migrateLineItemsToSections() {
  const columnCheck = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cashflow_line_items' AND column_name = 'division_id'
  `);
  if (columnCheck.rows.length === 0) return; // already migrated

  const orphans = await pool.query(`
    SELECT DISTINCT division_id FROM cashflow_line_items WHERE section_id IS NULL
  `);

  for (const { division_id: divisionId } of orphans.rows) {
    // One division's failure (e.g. a dangling division_id with no matching
    // cashflow_divisions row) must not abort the rest of this batch - each
    // gets its own isolated attempt, retried on the next boot if it fails.
    try {
      // Atomic upsert (relies on the partial unique index on
      // division_id+name added above) so two boots racing to create
      // "General" can't both succeed.
      const created = await pool.query(
        `INSERT INTO cashflow_sections (division_id, name) VALUES ($1, 'General')
         ON CONFLICT (division_id, name) WHERE status = 'active' DO NOTHING
         RETURNING id`,
        [divisionId]
      );
      let sectionId = created.rows[0]?.id;
      if (!sectionId) {
        const existing = await pool.query(
          `SELECT id FROM cashflow_sections WHERE division_id = $1 AND name = 'General' AND status = 'active'`,
          [divisionId]
        );
        sectionId = existing.rows[0].id;
      }
      await pool.query(
        `UPDATE cashflow_line_items SET section_id = $1 WHERE division_id = $2 AND section_id IS NULL`,
        [sectionId, divisionId]
      );
    } catch (error) {
      console.error(`⚠️  Cashflow migration: failed to backfill division "${divisionId}" (may be safe to ignore):`, error.message);
    }
  }
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

export async function getDivisions({ status } = {}) {
  const where = status ? `WHERE status = $1` : '';
  const result = await pool.query(
    `SELECT * FROM cashflow_divisions ${where} ORDER BY sort_order, id`,
    status ? [status] : []
  );
  return result.rows;
}

export async function getDivisionById(id) {
  const result = await pool.query(`SELECT * FROM cashflow_divisions WHERE id = $1`, [id]);
  return result.rows[0];
}

export async function createDivision({ name, sortOrder = 0 }) {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO cashflow_divisions (id, name, sort_order) VALUES ($1, $2, $3) RETURNING *`,
    [id, name, sortOrder]
  );
  return result.rows[0];
}

export async function updateDivision(id, { name, status, sortOrder }) {
  const result = await pool.query(
    `UPDATE cashflow_divisions
     SET name = COALESCE($2, name),
         status = COALESCE($3, status),
         sort_order = COALESCE($4, sort_order)
     WHERE id = $1
     RETURNING *`,
    [id, name ?? null, status ?? null, sortOrder ?? null]
  );
  return result.rows[0];
}

// ========== SECTIONS ==========

export async function getSections({ divisionId, status } = {}) {
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
    `SELECT * FROM cashflow_sections ${where} ORDER BY division_id, sort_order, id`,
    params
  );
  return result.rows;
}

export async function getSectionById(id) {
  const result = await pool.query(`SELECT * FROM cashflow_sections WHERE id = $1`, [id]);
  return result.rows[0];
}

export async function createSection({ divisionId, name, sortOrder = 0 }) {
  const result = await pool.query(
    `INSERT INTO cashflow_sections (division_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *`,
    [divisionId, name, sortOrder]
  );
  return result.rows[0];
}

export async function updateSection(id, { name, status, sortOrder }) {
  const result = await pool.query(
    `UPDATE cashflow_sections
     SET name = COALESCE($2, name),
         status = COALESCE($3, status),
         sort_order = COALESCE($4, sort_order)
     WHERE id = $1
     RETURNING *`,
    [id, name ?? null, status ?? null, sortOrder ?? null]
  );
  return result.rows[0];
}

// ========== LINE ITEMS ==========

export async function getLineItems({ sectionId, status } = {}) {
  const conditions = [];
  const params = [];
  if (sectionId) {
    params.push(sectionId);
    conditions.push(`section_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT * FROM cashflow_line_items ${where} ORDER BY section_id, sort_order, id`,
    params
  );
  return result.rows;
}

export async function getLineItemsByIds(ids) {
  if (ids.length === 0) return [];
  const result = await pool.query(`SELECT * FROM cashflow_line_items WHERE id = ANY($1)`, [ids]);
  return result.rows;
}

export async function createLineItem({ sectionId, name, sortOrder = 0 }) {
  const result = await pool.query(
    `INSERT INTO cashflow_line_items (section_id, name, sort_order)
     VALUES ($1, $2, $3) RETURNING *`,
    [sectionId, name, sortOrder]
  );
  return result.rows[0];
}

export async function updateLineItem(id, { name, status, sortOrder }) {
  const result = await pool.query(
    `UPDATE cashflow_line_items
     SET name = COALESCE($2, name),
         status = COALESCE($3, status),
         sort_order = COALESCE($4, sort_order)
     WHERE id = $1
     RETURNING *`,
    [id, name ?? null, status ?? null, sortOrder ?? null]
  );
  return result.rows[0];
}

// ========== ENTRIES ==========

export async function getEntries({ startWeek, endWeek }) {
  const result = await pool.query(
    `SELECT e.line_item_id, e.week_ending, e.amount, li.section_id, s.division_id
     FROM cashflow_entries e
     JOIN cashflow_line_items li ON li.id = e.line_item_id
     JOIN cashflow_sections s ON s.id = li.section_id
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

export async function getLenderById(id) {
  const result = await pool.query(`SELECT * FROM cashflow_lenders WHERE id = $1`, [id]);
  return result.rows[0];
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
