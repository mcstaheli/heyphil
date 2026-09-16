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

    // step() swallows errors, so the NOT NULL ALTER above could have failed
    // silently - re-check directly rather than assuming it worked before
    // running the irreversible column drop.
    const notNullConfirmed = await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'cashflow_line_items' AND column_name = 'section_id'
    `);
    if (notNullConfirmed.rows[0]?.is_nullable === 'NO') {
      await step('cashflow_line_items drop legacy columns', async () => {
        await pool.query(`ALTER TABLE cashflow_line_items DROP COLUMN IF EXISTS division_id`);
        await pool.query(`ALTER TABLE cashflow_line_items DROP COLUMN IF EXISTS category`);
      });
    } else {
      console.error('⚠️  Cashflow migration: section_id NOT NULL constraint not confirmed - skipping column drop this boot to avoid data loss');
    }
  } else {
    console.error(`⚠️  Cashflow migration: ${stillOrphaned.rows[0].n} line item(s) still missing section_id - skipping NOT NULL/column drop this boot to avoid data loss`);
  }

  // Lets a line item itself hold nested items (unlimited depth) - NULL
  // means top-level within its section. Self-referencing FK, so deleting a
  // parent item cascades to its whole nested subtree automatically.
  await step('cashflow_line_items parent_item_id column', () => pool.query(`
    ALTER TABLE cashflow_line_items ADD COLUMN IF NOT EXISTS parent_item_id INT REFERENCES cashflow_line_items(id) ON DELETE CASCADE
  `));
  await step('cashflow_line_items parent index', () => pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cashflow_line_items_parent ON cashflow_line_items(parent_item_id)
  `));

  // Granularity moved from weekly to monthly - period_start always holds
  // the 1st of the month. No real entries existed under the old weekly
  // column, so this is a straight rename rather than a data migration.
  await step('cashflow_entries rename week_ending to period_start', async () => {
    const col = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'cashflow_entries' AND column_name = 'week_ending'
    `);
    if (col.rows.length > 0) {
      await pool.query(`ALTER TABLE cashflow_entries RENAME COLUMN week_ending TO period_start`);
    }
  });

  await step('cashflow_entries table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_entries (
      line_item_id INT NOT NULL REFERENCES cashflow_line_items(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (line_item_id, period_start)
    )
  `));

  // Debt/lenders was a separate parallel system (a lender wasn't a normal
  // department/section/item, just a flat list with its own entries table).
  // Folded away: debt now lives as a normal department like anything else,
  // through the same divisions/sections/line-items/entries tables. Dropped
  // outright rather than left dormant since it never held any real rows.
  await step('cashflow_debt_entries drop', () => pool.query(`DROP TABLE IF EXISTS cashflow_debt_entries`));
  await step('cashflow_lenders drop', () => pool.query(`DROP TABLE IF EXISTS cashflow_lenders`));

  // The old weekly anchor table only ever held one leftover row from manual
  // testing (a week-ending date, not aligned to any month boundary) - not
  // real user data, so dropped outright rather than carried forward under a
  // new column that would misrepresent it as a monthly anchor.
  await step('cashflow_weekly_anchor drop', () => pool.query(`DROP TABLE IF EXISTS cashflow_weekly_anchor`));

  await step('cashflow_anchor table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_anchor (
      period_start DATE PRIMARY KEY,
      starting_cash NUMERIC(14, 2) NOT NULL
    )
  `));

  await step('cashflow_entries drop old week index', () => pool.query(`DROP INDEX IF EXISTS idx_cashflow_entries_week`));
  await step('cashflow_entries period index', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_cashflow_entries_period ON cashflow_entries(period_start)`));
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

// Only seeds a genuinely-empty table (a fresh database). Per-row
// ON CONFLICT DO NOTHING would otherwise resurrect a starter division on
// the next boot after a user deletes it - deleted must stay deleted.
export async function seedDivisions() {
  const existing = await pool.query(`SELECT 1 FROM cashflow_divisions LIMIT 1`);
  if (existing.rows.length > 0) return;
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

// Hard delete, cascading to sections -> line items -> entries via the
// existing ON DELETE CASCADE foreign keys. Deliberately not a status flip:
// removed data must actually be gone, not silently keep counting toward
// totals from a hidden row (that was a real bug, not the intended design).
export async function deleteDivision(id) {
  const result = await pool.query(`DELETE FROM cashflow_divisions WHERE id = $1 RETURNING id`, [id]);
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

export async function deleteSection(id) {
  const result = await pool.query(`DELETE FROM cashflow_sections WHERE id = $1 RETURNING id`, [id]);
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

// Given a set of item ids, returns which of them currently have at least
// one ACTIVE child - a parent item is a computed total, never a
// direct-entry target, mirroring how sections/divisions already work.
// Must agree with the client's itemChildren (which also filters to active
// children) on what counts as a "leaf" - an item whose only child was
// retired needs to be writable again, on both sides alike.
export async function getItemsWithChildren(ids) {
  if (ids.length === 0) return [];
  const result = await pool.query(
    `SELECT DISTINCT parent_item_id FROM cashflow_line_items WHERE parent_item_id = ANY($1) AND status = 'active'`,
    [ids]
  );
  return result.rows.map((r) => r.parent_item_id);
}

// Walks the parent_item_id chain from `itemId` up to its top-level
// ancestor (the base row in the CTE is the item itself), so a write can be
// rejected if ANY ancestor - not just the immediate parent - is retired.
// Includes section_id since every item in a nested chain shares the same
// section as its top-level ancestor.
export async function getItemAncestors(itemId) {
  const result = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_item_id, status, section_id FROM cashflow_line_items WHERE id = $1
      UNION ALL
      SELECT li.id, li.parent_item_id, li.status, li.section_id
      FROM cashflow_line_items li
      JOIN ancestors a ON li.id = a.parent_item_id
    )
    SELECT * FROM ancestors
  `, [itemId]);
  return result.rows;
}

// A top-level item takes an explicit sectionId. A nested item instead
// takes parentItemId and inherits its section from the parent - passing a
// mismatched sectionId for a nested item isn't possible by construction.
// Creating a nested item auto-clears the parent's own entries in the same
// transaction: once an item has a child it becomes a computed total, never
// also a manual value (the user was warned client-side before this call).
export async function createLineItem({ sectionId, parentItemId = null, name, sortOrder = 0 }) {
  if (parentItemId) {
    return transaction(async (client) => {
      await client.query(`DELETE FROM cashflow_entries WHERE line_item_id = $1`, [parentItemId]);
      const result = await client.query(
        `INSERT INTO cashflow_line_items (section_id, parent_item_id, name, sort_order)
         SELECT section_id, $1, $2, $3 FROM cashflow_line_items WHERE id = $1
         RETURNING *`,
        [parentItemId, name, sortOrder]
      );
      // The route validates the parent exists just before calling this,
      // but if it was deleted in between (or ever passed in bad), the
      // SELECT matches zero rows and the INSERT silently inserts nothing -
      // surface that as a real error rather than returning an undefined
      // "item" the caller would otherwise push straight into state.
      if (!result.rows[0]) throw new Error(`Parent line item ${parentItemId} no longer exists`);
      return result.rows[0];
    });
  }
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

export async function deleteLineItem(id) {
  const result = await pool.query(`DELETE FROM cashflow_line_items WHERE id = $1 RETURNING id`, [id]);
  return result.rows[0];
}

// ========== ENTRIES ==========

export async function getEntries({ startPeriod, endPeriod }) {
  const result = await pool.query(
    `SELECT e.line_item_id, e.period_start, e.amount, li.section_id, s.division_id
     FROM cashflow_entries e
     JOIN cashflow_line_items li ON li.id = e.line_item_id
     JOIN cashflow_sections s ON s.id = li.section_id
     WHERE e.period_start BETWEEN $1 AND $2`,
    [startPeriod, endPeriod]
  );
  return result.rows;
}

export async function upsertEntries(entries) {
  return transaction(async (client) => {
    const results = [];
    for (const { lineItemId, periodStart, amount } of entries) {
      const result = await client.query(
        `INSERT INTO cashflow_entries (line_item_id, period_start, amount)
         VALUES ($1, $2, $3)
         ON CONFLICT (line_item_id, period_start)
         DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
         RETURNING *`,
        [lineItemId, periodStart, amount]
      );
      results.push(result.rows[0]);
    }
    return results;
  });
}

// ========== ANCHOR (manual starting-cash override) ==========

export async function setAnchor(periodStart, startingCash) {
  const result = await pool.query(
    `INSERT INTO cashflow_anchor (period_start, starting_cash)
     VALUES ($1, $2)
     ON CONFLICT (period_start) DO UPDATE SET starting_cash = EXCLUDED.starting_cash
     RETURNING *`,
    [periodStart, startingCash]
  );
  return result.rows[0];
}

export async function getAnchors({ startPeriod, endPeriod }) {
  const result = await pool.query(
    `SELECT period_start, starting_cash FROM cashflow_anchor
     WHERE period_start BETWEEN $1 AND $2`,
    [startPeriod, endPeriod]
  );
  return result.rows;
}

// ========== SUMMARY ==========

// Computes, for each month in `periodStarts` (chronological order), the
// division contribution totals, starting cash and ending cash. Starting
// cash chains from the previous month's ending cash unless a manual anchor
// override exists for that month.
export async function getMonthlySummary(periodStarts) {
  if (periodStarts.length === 0) return [];
  const sorted = [...periodStarts].sort();
  const startPeriod = sorted[0];
  const endPeriod = sorted[sorted.length - 1];

  const [entries, anchors, divisions] = await Promise.all([
    getEntries({ startPeriod, endPeriod }),
    getAnchors({ startPeriod, endPeriod }),
    getDivisions(),
  ]);

  const anchorByPeriod = new Map(anchors.map((a) => [toDateKey(a.period_start), Number(a.starting_cash)]));

  const divisionTotalsByPeriod = new Map(); // periodKey -> { divisionId -> total }
  for (const e of entries) {
    const periodKey = toDateKey(e.period_start);
    if (!divisionTotalsByPeriod.has(periodKey)) divisionTotalsByPeriod.set(periodKey, {});
    const totals = divisionTotalsByPeriod.get(periodKey);
    totals[e.division_id] = (totals[e.division_id] || 0) + Number(e.amount);
  }

  let runningCash = 0;
  const summary = [];
  for (const periodStart of sorted) {
    const periodKey = toDateKey(periodStart);
    const startingCash = anchorByPeriod.has(periodKey) ? anchorByPeriod.get(periodKey) : runningCash;
    const divisionTotals = divisionTotalsByPeriod.get(periodKey) || {};
    const contribution = divisions.reduce((sum, d) => sum + (divisionTotals[d.id] || 0), 0);
    const endingCash = startingCash + contribution;

    summary.push({
      periodStart: periodKey,
      startingCash,
      divisionTotals,
      contribution,
      endingCash,
    });

    runningCash = endingCash;
  }

  return summary;
}

function toDateKey(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
