// Database queries for the Improvements Labs app - user-submitted bug
// reports / feature requests, each with an annotated screenshot, moving
// through their own Kanban board (New -> Triaged -> Queued/In Progress ->
// Shipped, or Abandoned at any point). No forward-only restriction here,
// same as the origination board post-restructure - see board-db.js's
// assertSameBoardFamily comment for why that was removed.
import { randomUUID } from 'crypto';
import pool from './db.js';

async function step(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`⚠️  Improvements migration warning (${label}, may be safe to ignore):`, error.message);
  }
}

export async function createTables() {
  await step('improvements table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS improvements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(500) NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      kind VARCHAR(20),
      status VARCHAR(30) NOT NULL DEFAULT 'new',
      screenshot TEXT,
      page_url TEXT,
      reporter_email VARCHAR(255),
      reporter_name VARCHAR(255),
      classification_note TEXT,
      pr_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    )
  `));

  await step('improvements status index', () => pool.query(`
    CREATE INDEX IF NOT EXISTS idx_improvements_status ON improvements(status) WHERE deleted_at IS NULL
  `));
}

const VALID_KINDS = ['bug', 'feature'];
export const IMPROVEMENT_COLUMNS = ['new', 'triaged', 'queued', 'in-progress', 'shipped', 'abandoned'];

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    kind: row.kind,
    status: row.status,
    screenshot: row.screenshot,
    pageUrl: row.page_url,
    reporterEmail: row.reporter_email,
    reporterName: row.reporter_name,
    classificationNote: row.classification_note,
    prUrl: row.pr_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createImprovement({ title, note, screenshot, pageUrl, reporterEmail, reporterName }) {
  const id = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO improvements (id, title, note, screenshot, page_url, reporter_email, reporter_name, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'new')
     RETURNING *`,
    [id, title, note || '', screenshot || null, pageUrl || null, reporterEmail || null, reporterName || null]
  );
  return mapRow(rows[0]);
}

export async function getAllImprovements() {
  const { rows } = await pool.query(
    `SELECT * FROM improvements WHERE deleted_at IS NULL ORDER BY created_at DESC`
  );
  return rows.map(mapRow);
}

export async function getImprovementById(id) {
  const { rows } = await pool.query(
    `SELECT * FROM improvements WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return mapRow(rows[0]);
}

// Fields a caller may patch through the generic update route. kind/status
// are also the fields the classification sweep writes - same column set,
// different caller.
const PATCHABLE_FIELDS = {
  title: 'title',
  note: 'note',
  kind: 'kind',
  status: 'status',
  classificationNote: 'classification_note',
  prUrl: 'pr_url',
};

export async function updateImprovement(id, updates) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [key, column] of Object.entries(PATCHABLE_FIELDS)) {
    if (updates[key] === undefined) continue;
    if (key === 'kind' && updates.kind !== null && !VALID_KINDS.includes(updates.kind)) {
      throw new Error(`kind must be one of ${VALID_KINDS.join(', ')}`);
    }
    if (key === 'status' && !IMPROVEMENT_COLUMNS.includes(updates.status)) {
      throw new Error(`status must be one of ${IMPROVEMENT_COLUMNS.join(', ')}`);
    }
    sets.push(`${column} = $${i}`);
    values.push(updates[key]);
    i += 1;
  }
  if (sets.length === 0) return getImprovementById(id);
  sets.push(`updated_at = NOW()`);
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE improvements SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
    values
  );
  return mapRow(rows[0]);
}

export async function softDeleteImprovement(id) {
  const { rows } = await pool.query(
    `UPDATE improvements SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

// Picked up by the classification sweep (server/improvements-classify.js) -
// unclassified items sitting in New, oldest first so a backlog drains in
// order instead of the newest items jumping the queue.
export async function getUnclassified(limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM improvements WHERE status = 'new' AND kind IS NULL AND deleted_at IS NULL ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );
  return rows.map(mapRow);
}
