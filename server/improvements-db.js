// Database queries for the Improvements Labs app - user-submitted bug
// reports / feature requests, each with an annotated screenshot, moving
// through their own Kanban board: Intake (new submissions, untouched) ->
// Triaged - Bugs / Triaged - Features (sorted by a person asking a Claude
// Code session to "triage", which reads each Intake item's note+screenshot
// and moves it) -> Shipped, or Abandoned at any point. No forward-only
// restriction here, same as the origination board post-restructure - see
// board-db.js's assertSameBoardFamily comment for why that was removed.
//
// Deliberately no automated classification or auto-fix in this codebase -
// both "triage" and "fix bugs N"/"implement feature N" are things a person
// asks an interactive Claude Code session to do (see CLAUDE.md's
// Improvements board section), not a scheduled job. An earlier version of
// this board had a 3-hourly auto-classify sweep and a scheduled GitHub
// Actions auto-fix pipeline; both were removed in favor of this - see git
// history if reviving either is ever worth it.
import { randomUUID } from 'crypto';
import pool from './db.js';
import {
  IMPROVEMENT_COLUMNS,
  ImprovementValidationError,
  parseDuplicateOf,
  resolvedAtFor,
  screenshotFromLegacyText,
  sniffImageType,
  validatePriority,
} from './improvement-rules.js';

export { IMPROVEMENT_COLUMNS, ImprovementValidationError };

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

  // Stable, human-friendly reference number ("bug 3", "feature 5") - the
  // id (UUID) isn't something a person can say out loud, and a card's
  // position in a list shifts as items move/get added, which is exactly
  // what this needs to NOT do for "current and future reference" to mean
  // anything. SERIAL backfills existing rows too (in roughly insertion
  // order for a table this size, which is all "current" reference needs).
  await step('improvements seq_num column', () => pool.query(`
    ALTER TABLE improvements ADD COLUMN IF NOT EXISTS seq_num SERIAL
  `));

  // Board upgrade: screenshots as bytes (the old `screenshot` TEXT column of
  // data: URIs is kept, read as a fallback, until
  // migrations/011-improvements-screenshots-to-bytea.js has copied every row
  // across - dropping it is a separate, later change), plus report context
  // and triage fields.
  const columns = [
    ['screenshot_data', 'BYTEA'],
    ['screenshot_type', 'VARCHAR(20)'],        // image/jpeg | image/png | image/webp
    ['reporter_hint', 'VARCHAR(20)'],          // broken | idea | unsure
    ['priority', "VARCHAR(10) NOT NULL DEFAULT 'normal'"],
    ['duplicate_of', 'INTEGER'],               // another card's seq_num
    ['resolved_at', 'TIMESTAMP'],
    ['context', 'JSONB'],                      // { viewport, userAgent, errors[] }
    ['commit_sha', 'VARCHAR(64)'],
  ];
  for (const [name, type] of columns) {
    await step(`improvements ${name} column`, () => pool.query(
      `ALTER TABLE improvements ADD COLUMN IF NOT EXISTS ${name} ${type}`
    ));
  }
}

const VALID_KINDS = ['bug', 'feature'];

// Every column except the screenshot bytes - the list and every broadcast
// carry hasScreenshot instead; the image itself is GET /:id/screenshot.
const ROW_COLUMNS = `
  id, seq_num, title, note, kind, status, page_url, reporter_email, reporter_name,
  classification_note, pr_url, created_at, updated_at, reporter_hint, priority,
  duplicate_of, resolved_at, context, commit_sha, screenshot_type,
  (screenshot_data IS NOT NULL
    OR screenshot ~ '^data:image/(png|jpeg|webp);base64,') AS has_screenshot
`;

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    seqNum: row.seq_num,
    title: row.title,
    note: row.note,
    kind: row.kind,
    status: row.status,
    hasScreenshot: !!row.has_screenshot,
    pageUrl: row.page_url,
    reporterEmail: row.reporter_email,
    reporterName: row.reporter_name,
    reporterHint: row.reporter_hint || null,
    classificationNote: row.classification_note,
    prUrl: row.pr_url,
    priority: row.priority || 'normal',
    duplicateOf: row.duplicate_of ?? null,
    resolvedAt: row.resolved_at,
    context: row.context || null,
    commitSha: row.commit_sha || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// screenshot: { buffer, type } from parseScreenshotDataUri, or null.
export async function createImprovement({
  title, note, screenshot, pageUrl, reporterEmail, reporterName, reporterHint, context, commitSha,
}) {
  const id = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO improvements
       (id, title, note, screenshot_data, screenshot_type, page_url, reporter_email, reporter_name,
        reporter_hint, context, commit_sha, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'intake')
     RETURNING ${ROW_COLUMNS}`,
    [
      id, title, note || '',
      screenshot ? screenshot.buffer : null, screenshot ? screenshot.type : null,
      pageUrl || null, reporterEmail || null, reporterName || null,
      reporterHint || null, context ? JSON.stringify(context) : null, commitSha || null,
    ]
  );
  return mapRow(rows[0]);
}

export async function getAllImprovements() {
  const { rows } = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM improvements WHERE deleted_at IS NULL ORDER BY created_at DESC`
  );
  return rows.map(mapRow);
}

export async function getImprovementById(id) {
  const { rows } = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM improvements WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return mapRow(rows[0]);
}

export async function getImprovementBySeqNum(seqNum) {
  const { rows } = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM improvements WHERE seq_num = $1 AND deleted_at IS NULL`,
    [seqNum]
  );
  return mapRow(rows[0]);
}

// The image for one card: { buffer, type } or null. Prefers the BYTEA
// column; falls back to decoding the old data: URI for rows the 011
// conversion hasn't reached yet.
export async function getScreenshot(id) {
  const { rows } = await pool.query(
    `SELECT screenshot_data, screenshot_type, screenshot FROM improvements WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.screenshot_data) {
    // Only ever written after parseScreenshotDataUri / the 011 sniff, but
    // type it by the bytes regardless.
    const type = sniffImageType(row.screenshot_data);
    return type ? { buffer: row.screenshot_data, type } : null;
  }
  return screenshotFromLegacyText(row.screenshot);
}

// Fields a caller may patch through the generic update route.
const PATCHABLE_FIELDS = {
  title: 'title',
  note: 'note',
  kind: 'kind',
  status: 'status',
  classificationNote: 'classification_note',
  prUrl: 'pr_url',
  priority: 'priority',
  duplicateOf: 'duplicate_of',
};

// Validates every field first (throwing ImprovementValidationError), then
// writes under a row lock so resolved_at is computed from the status the
// card actually had: set on moving into Shipped/Abandoned, cleared if it's
// reopened (improvement-rules.js resolvedAtFor).
export async function updateImprovement(id, updates) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT seq_num, status, resolved_at FROM improvements WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [id]
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    const sets = [];
    const values = [];
    const add = (column, value) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    for (const [key, column] of Object.entries(PATCHABLE_FIELDS)) {
      if (updates[key] === undefined) continue;
      let value = updates[key];
      if (key === 'kind' && value !== null && !VALID_KINDS.includes(value)) {
        throw new ImprovementValidationError(`kind must be one of ${VALID_KINDS.join(', ')}`);
      }
      if (key === 'status' && !IMPROVEMENT_COLUMNS.includes(value)) {
        throw new ImprovementValidationError(`status must be one of ${IMPROVEMENT_COLUMNS.join(', ')}`);
      }
      if (key === 'priority') value = validatePriority(value);
      if (key === 'duplicateOf') {
        value = parseDuplicateOf(value, row.seq_num);
        if (value !== null) {
          const exists = await client.query('SELECT 1 FROM improvements WHERE seq_num = $1 AND deleted_at IS NULL', [value]);
          if (exists.rows.length === 0) {
            throw new ImprovementValidationError(`there's no card #${value}`);
          }
        }
      }
      add(column, value);
    }

    const resolvedAt = resolvedAtFor(row.status, updates.status, row.resolved_at);
    if (resolvedAt !== undefined) add('resolved_at', resolvedAt);

    if (sets.length === 0) {
      await client.query('ROLLBACK');
      return getImprovementById(id);
    }
    sets.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await client.query(
      `UPDATE improvements SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${ROW_COLUMNS}`,
      values
    );
    await client.query('COMMIT');
    return mapRow(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function softDeleteImprovement(id) {
  const { rows } = await pool.query(
    `UPDATE improvements SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  return rows.length > 0;
}
