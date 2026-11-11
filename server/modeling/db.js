// Modeling (Labs) - tables and queries. All tables are new and prefixed
// modeling_; nothing here reads or writes any other HeyPhil table.
import pool from '../db.js';
import { ModelingError } from './rules.js';

export async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS modeling_templates (
      id SERIAL PRIMARY KEY,
      key VARCHAR(80) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      folder_id VARCHAR(100) NOT NULL UNIQUE,
      draft_file_id VARCHAR(100) NOT NULL,
      releases_folder_id VARCHAR(100) NOT NULL,
      exports_folder_id VARCHAR(100),
      stamp_cell VARCHAR(100) NOT NULL DEFAULT '''Financial Model''!B4',
      versions_range VARCHAR(100) NOT NULL DEFAULT 'VERSIONS!B5:I',
      export_sheet VARCHAR(100) NOT NULL DEFAULT 'Financial Model',
      created_by_email VARCHAR(255),
      created_by_name VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS modeling_operations (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(40) NOT NULL,
      target_key VARCHAR(200) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'running',
      params JSONB NOT NULL DEFAULT '{}',
      state JSONB NOT NULL DEFAULT '{}',
      steps JSONB NOT NULL DEFAULT '[]',
      error TEXT,
      actor_email VARCHAR(255) NOT NULL,
      actor_name VARCHAR(255),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      retried_by_email VARCHAR(255),
      retried_at TIMESTAMPTZ,
      -- which server process is running it, and its last sign of life:
      -- during a deploy two instances overlap, so "running" alone doesn't
      -- mean "stuck"
      runner_id VARCHAR(64),
      heartbeat_at TIMESTAMPTZ
    );
    -- one running action per deal/template at a time
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_operations_one_running
      ON modeling_operations (target_key) WHERE status = 'running';

    CREATE TABLE IF NOT EXISTS modeling_template_releases (
      id SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES modeling_templates(id),
      version VARCHAR(80) NOT NULL,
      file_id VARCHAR(100) NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active')),
      locked BOOLEAN NOT NULL DEFAULT false,
      note TEXT,
      source VARCHAR(20) NOT NULL DEFAULT 'heyphil',
      released_by_email VARCHAR(255),
      released_by_name VARCHAR(255),
      released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      activated_by_email VARCHAR(255),
      activated_by_name VARCHAR(255),
      activated_at TIMESTAMPTZ,
      locked_by_email VARCHAR(255),
      locked_at TIMESTAMPTZ,
      operation_id INTEGER REFERENCES modeling_operations(id)
    );
    -- exactly one Active release per template
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_releases_one_active
      ON modeling_template_releases (template_id) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS modeling_deals (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      template_id INTEGER NOT NULL REFERENCES modeling_templates(id),
      deal_folder_id VARCHAR(100),
      fm_folder_id VARCHAR(100),
      versions_folder_id VARCHAR(100),
      exports_folder_id VARCHAR(100),
      source VARCHAR(20) NOT NULL DEFAULT 'heyphil',
      created_by_email VARCHAR(255),
      created_by_name VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_deals_name ON modeling_deals (LOWER(name));

    CREATE TABLE IF NOT EXISTS modeling_versions (
      id SERIAL PRIMARY KEY,
      deal_id INTEGER NOT NULL REFERENCES modeling_deals(id),
      status VARCHAR(20) NOT NULL CHECK (status IN ('working', 'locked')),
      name VARCHAR(200) NOT NULL,
      file_id VARCHAR(100) NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      from_release_id INTEGER REFERENCES modeling_template_releases(id),
      from_version_id INTEGER REFERENCES modeling_versions(id),
      locked BOOLEAN NOT NULL DEFAULT false,
      note TEXT,
      source VARCHAR(20) NOT NULL DEFAULT 'heyphil',
      created_by_email VARCHAR(255),
      created_by_name VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_by_email VARCHAR(255),
      locked_by_name VARCHAR(255),
      locked_at TIMESTAMPTZ,
      operation_id INTEGER REFERENCES modeling_operations(id)
    );
    -- one working model per deal
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_versions_one_working
      ON modeling_versions (deal_id) WHERE status = 'working';

    -- room for later steps: inputs/outputs captured with a version
    CREATE TABLE IF NOT EXISTS modeling_version_snapshots (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES modeling_versions(id),
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('inputs', 'outputs')),
      data JSONB NOT NULL,
      captured_by_email VARCHAR(255),
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS modeling_exports (
      id SERIAL PRIMARY KEY,
      version_id INTEGER REFERENCES modeling_versions(id),
      release_id INTEGER REFERENCES modeling_template_releases(id),
      file_id VARCHAR(100) NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      folder_id VARCHAR(100) NOT NULL,
      exported_by_email VARCHAR(255),
      exported_by_name VARCHAR(255),
      exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      operation_id INTEGER REFERENCES modeling_operations(id)
    );
  `);
  await failStaleOperations();
}

// An action whose runner stopped sending heartbeats (server restarted or
// crashed) is marked failed so it can be retried from where it stopped.
// One still heart-beating - e.g. on the old instance during a deploy - is
// left alone.
export const STALE_AFTER_SECONDS = 120;
export async function failStaleOperations() {
  await pool.query(`
    UPDATE modeling_operations SET status = 'failed', finished_at = NOW(), runner_id = NULL,
      error = 'Interrupted (HeyPhil restarted or lost track of it). Retry to finish the remaining steps.'
    WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - make_interval(secs => $1))`, [STALE_AFTER_SECONDS]);
}

// ---------------------------------------------------------------- reads
const camel = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));

export async function listTemplates() {
  const { rows: templates } = await pool.query('SELECT * FROM modeling_templates ORDER BY name');
  const { rows: releases } = await pool.query('SELECT * FROM modeling_template_releases ORDER BY released_at DESC, id DESC');
  return templates.map((t) => ({
    ...camel(t),
    releases: releases.filter((r) => r.template_id === t.id).map(camel),
  }));
}

export async function getTemplate(id) {
  const { rows } = await pool.query('SELECT * FROM modeling_templates WHERE id = $1', [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function getRelease(id) {
  const { rows } = await pool.query('SELECT * FROM modeling_template_releases WHERE id = $1', [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function activeRelease(templateId) {
  const { rows } = await pool.query("SELECT * FROM modeling_template_releases WHERE template_id = $1 AND status = 'active'", [templateId]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function listDeals() {
  const { rows } = await pool.query(`
    SELECT d.*, t.name AS template_name,
      w.id AS working_id, w.name AS working_name, w.file_id AS working_file_id,
      (SELECT COUNT(*)::int FROM modeling_versions v WHERE v.deal_id = d.id AND v.status = 'locked') AS locked_count,
      (SELECT MAX(v.locked_at) FROM modeling_versions v WHERE v.deal_id = d.id AND v.status = 'locked') AS last_locked_at
    FROM modeling_deals d
    JOIN modeling_templates t ON t.id = d.template_id
    LEFT JOIN modeling_versions w ON w.deal_id = d.id AND w.status = 'working'
    ORDER BY d.name
  `);
  return rows.map(camel);
}

export async function getDeal(id) {
  const { rows } = await pool.query(`
    SELECT d.*, t.name AS template_name FROM modeling_deals d
    JOIN modeling_templates t ON t.id = d.template_id WHERE d.id = $1`, [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function findDealByName(name) {
  const { rows } = await pool.query('SELECT * FROM modeling_deals WHERE LOWER(name) = LOWER($1)', [name]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function getDealDetail(id) {
  const deal = await getDeal(id);
  if (!deal) return null;
  const { rows: versions } = await pool.query(`
    SELECT v.*, r.version AS from_release_version, pv.name AS from_version_name
    FROM modeling_versions v
    LEFT JOIN modeling_template_releases r ON r.id = v.from_release_id
    LEFT JOIN modeling_versions pv ON pv.id = v.from_version_id
    WHERE v.deal_id = $1 ORDER BY (v.status = 'working') DESC, COALESCE(v.locked_at, v.created_at) DESC, v.id DESC`, [id]);
  const { rows: exports } = await pool.query(`
    SELECT e.* FROM modeling_exports e JOIN modeling_versions v ON v.id = e.version_id
    WHERE v.deal_id = $1 ORDER BY e.exported_at DESC LIMIT 50`, [id]);
  return { ...deal, versions: versions.map(camel), exports: exports.map(camel) };
}

export async function getVersion(id) {
  const { rows } = await pool.query('SELECT * FROM modeling_versions WHERE id = $1', [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function workingVersion(dealId) {
  const { rows } = await pool.query("SELECT * FROM modeling_versions WHERE deal_id = $1 AND status = 'working'", [dealId]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function getExport(id) {
  const { rows } = await pool.query('SELECT * FROM modeling_exports WHERE id = $1', [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function knownFileIds() {
  const { rows } = await pool.query(`
    SELECT file_id FROM modeling_versions UNION SELECT file_id FROM modeling_template_releases
    UNION SELECT draft_file_id FROM modeling_templates`);
  return new Set(rows.map((r) => r.file_id));
}

// ---------------------------------------------------------------- writes
export async function insertTemplate(t, actor) {
  const { rows } = await pool.query(`
    INSERT INTO modeling_templates (key, name, folder_id, draft_file_id, releases_folder_id, exports_folder_id, created_by_email, created_by_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
  [t.key, t.name, t.folderId, t.draftFileId, t.releasesFolderId, t.exportsFolderId || null, actor.email, actor.name || null]);
  return camel(rows[0]);
}

export async function insertRelease(r) {
  const { rows } = await pool.query(`
    INSERT INTO modeling_template_releases (template_id, version, file_id, file_name, status, locked, note, source,
      released_by_email, released_by_name, released_at, locked_by_email, locked_at, operation_id)
    VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, COALESCE($10, NOW()), $11, $12, $13)
    ON CONFLICT (file_id) DO UPDATE SET file_id = EXCLUDED.file_id RETURNING *`,
  [r.templateId, r.version, r.fileId, r.fileName, !!r.locked, r.note || null, r.source || 'heyphil',
    r.releasedByEmail, r.releasedByName || null, r.releasedAt || null, r.locked ? (r.lockedByEmail !== undefined ? r.lockedByEmail : r.releasedByEmail) : null,
    r.locked ? r.lockedAt || new Date() : null, r.operationId || null]);
  return camel(rows[0]);
}

export async function markReleaseLocked(id, actor) {
  await pool.query('UPDATE modeling_template_releases SET locked = true, locked_by_email = $2, locked_at = NOW() WHERE id = $1', [id, actor.email]);
}

export async function markReleaseUnlocked(id) {
  await pool.query('UPDATE modeling_template_releases SET locked = false WHERE id = $1', [id]);
}

export async function markVersionLocked(id, actor) {
  await pool.query('UPDATE modeling_versions SET locked = true, locked_by_email = COALESCE(locked_by_email, $2), locked_by_name = COALESCE(locked_by_name, $3), locked_at = COALESCE(locked_at, NOW()) WHERE id = $1', [id, actor.email, actor.name || null]);
}

// Mark Active: in one transaction, the previous Active release goes back
// to Draft and this one becomes Active.
export async function activateRelease(releaseId, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the template row first - every activation of this template
    // queues here, so two at once can't deadlock on the release rows.
    const { rows: t } = await client.query(`SELECT t.id FROM modeling_templates t
      JOIN modeling_template_releases r ON r.template_id = t.id WHERE r.id = $1 FOR UPDATE OF t`, [releaseId]);
    if (!t[0]) throw new ModelingError('That release no longer exists.', 404);
    const { rows } = await client.query('SELECT * FROM modeling_template_releases WHERE id = $1', [releaseId]);
    const rel = rows[0];
    if (!rel.locked) throw new ModelingError('Lock this release before making it Active.');
    const { rows: prev } = await client.query(
      "UPDATE modeling_template_releases SET status = 'draft' WHERE template_id = $1 AND status = 'active' AND id <> $2 RETURNING version", [rel.template_id, releaseId]);
    await client.query(`UPDATE modeling_template_releases SET status = 'active', activated_by_email = $2, activated_by_name = $3, activated_at = NOW()
      WHERE id = $1`, [releaseId, actor.email, actor.name || null]);
    await client.query('COMMIT');
    return { previous: prev[0]?.version || null, version: rel.version };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function insertDeal(d, actor) {
  try {
    const { rows } = await pool.query(`
      INSERT INTO modeling_deals (name, template_id, deal_folder_id, fm_folder_id, versions_folder_id, exports_folder_id, source, created_by_email, created_by_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [d.name, d.templateId, d.dealFolderId || null, d.fmFolderId || null, d.versionsFolderId || null, d.exportsFolderId || null,
      d.source || 'heyphil', actor.email, actor.name || null]);
    return camel(rows[0]);
  } catch (error) {
    if (error.code === '23505') throw new ModelingError(`There's already a deal named "${d.name}".`, 409);
    throw error;
  }
}

export async function setDealFolders(id, f) {
  await pool.query(`UPDATE modeling_deals SET deal_folder_id = COALESCE($2, deal_folder_id), fm_folder_id = COALESCE($3, fm_folder_id),
    versions_folder_id = COALESCE($4, versions_folder_id), exports_folder_id = COALESCE($5, exports_folder_id) WHERE id = $1`,
  [id, f.dealFolderId || null, f.fmFolderId || null, f.versionsFolderId || null, f.exportsFolderId || null]);
}

export async function insertVersion(v) {
  try {
    const { rows } = await pool.query(`
      INSERT INTO modeling_versions (deal_id, status, name, file_id, file_name, from_release_id, from_version_id, locked, note, source,
        created_by_email, created_by_name, created_at, locked_by_email, locked_by_name, locked_at, operation_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, NOW()), $14, $15, $16, $17)
      ON CONFLICT (file_id) DO UPDATE SET file_id = EXCLUDED.file_id RETURNING *`,
    [v.dealId, v.status, v.name, v.fileId, v.fileName, v.fromReleaseId || null, v.fromVersionId || null, !!v.locked, v.note || null,
      v.source || 'heyphil', v.createdByEmail, v.createdByName || null, v.createdAt || null,
      // who locked it: given, else whoever made the version - except
      // imports pass null (the person importing didn't lock it)
      v.status === 'locked' ? (v.lockedByEmail !== undefined ? v.lockedByEmail : v.createdByEmail) : null,
      v.status === 'locked' ? (v.lockedByEmail !== undefined ? v.lockedByName || null : v.createdByName || null) : null,
      v.status === 'locked' ? v.lockedAt || new Date() : null, v.operationId || null]);
    return camel(rows[0]);
  } catch (error) {
    if (error.code === '23505') throw new ModelingError('That deal already has a working model.', 409);
    throw error;
  }
}

export async function insertExport(e) {
  const { rows } = await pool.query(`
    INSERT INTO modeling_exports (version_id, release_id, file_id, file_name, folder_id, exported_by_email, exported_by_name, operation_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (file_id) DO UPDATE SET file_id = EXCLUDED.file_id RETURNING *`,
  [e.versionId || null, e.releaseId || null, e.fileId, e.fileName, e.folderId, e.email, e.name || null, e.operationId || null]);
  return camel(rows[0]);
}

// ---------------------------------------------------------------- operations
export async function startOperation({ kind, targetKey, params, steps, runnerId }, actor) {
  await failStaleOperations();
  try {
    const { rows } = await pool.query(`
      INSERT INTO modeling_operations (kind, target_key, params, steps, actor_email, actor_name, runner_id, heartbeat_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
    [kind, targetKey, JSON.stringify(params || {}), JSON.stringify(steps), actor.email, actor.name || null, runnerId]);
    return camel(rows[0]);
  } catch (error) {
    if (error.code === '23505') throw new ModelingError('Another action is already running on this - wait for it to finish.', 409);
    throw error;
  }
}

export class LostOwnershipError extends Error {}

// Saves progress - only while this runner still owns the operation.
export async function saveOperation(op, runnerId) {
  const { rowCount } = await pool.query(`UPDATE modeling_operations SET status = $2, state = $3, steps = $4, error = $5,
    finished_at = CASE WHEN $2 = 'running' THEN NULL ELSE NOW() END, heartbeat_at = NOW()
    WHERE id = $1 AND runner_id = $6`,
  [op.id, op.status, JSON.stringify(op.state || {}), JSON.stringify(op.steps || []), op.error || null, runnerId]);
  if (!rowCount) throw new LostOwnershipError(`Operation ${op.id} is no longer run by ${runnerId}`);
}

export async function heartbeat(id, runnerId) {
  await pool.query("UPDATE modeling_operations SET heartbeat_at = NOW() WHERE id = $1 AND runner_id = $2 AND status = 'running'", [id, runnerId]);
}

export async function reopenOperation(id, actor, runnerId) {
  await failStaleOperations();
  try {
    const { rows } = await pool.query(`UPDATE modeling_operations SET status = 'running', error = NULL, finished_at = NULL,
      retried_by_email = $2, retried_at = NOW(), runner_id = $3, heartbeat_at = NOW()
      WHERE id = $1 AND status = 'failed' RETURNING *`, [id, actor.email, runnerId]);
    return rows[0] ? camel(rows[0]) : null;
  } catch (error) {
    if (error.code === '23505') throw new ModelingError('Another action is already running on this - wait for it to finish.', 409);
    throw error;
  }
}

export async function getOperation(id) {
  await failStaleOperations();
  const { rows } = await pool.query('SELECT * FROM modeling_operations WHERE id = $1', [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function listOperations(limit = 50) {
  const { rows } = await pool.query('SELECT * FROM modeling_operations ORDER BY started_at DESC, id DESC LIMIT $1', [limit]);
  return rows.map(camel);
}
