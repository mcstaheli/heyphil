// Modeling (Labs) - tables and queries. All tables are prefixed
// modeling_; nothing here reads or writes any other HeyPhil table.
//
// The schema (approved 2026-11-11):
//   templates  - stand on their own
//   projects   - records that may or may not use a template
//   models     - every spreadsheet: owned by a template OR a project,
//                Unlocked or Locked, at most one Active per owner (and an
//                Active model is always Locked), with parent_model_id =
//                the model it was copied from (the family tree). Hidden
//                instead of deleted.
//   exports, operations (the audit trail of every action).
// The earlier step-1 tables (modeling_deals, _template_releases,
// _versions, _version_snapshots) are migrated once and then left
// untouched until Chad approves dropping them.
import pool from '../db.js';
import { ModelingError, parseVersion, nextRootVersion } from './rules.js';

export async function createTables() {
  await pool.query(SCHEMA_SQL);
  await migrateStepOne();
  await failStaleOperations();
}

export const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS modeling_templates (
      id SERIAL PRIMARY KEY,
      key VARCHAR(80) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      folder_id VARCHAR(100) NOT NULL UNIQUE,
      models_folder_id VARCHAR(100),
      exports_folder_id VARCHAR(100),
      stamp_cell VARCHAR(100) NOT NULL DEFAULT '''Financial Model''!B4',
      versions_range VARCHAR(100) NOT NULL DEFAULT 'VERSIONS!B5:I',
      export_sheet VARCHAR(100) NOT NULL DEFAULT 'Financial Model',
      created_by_email VARCHAR(255),
      created_by_name VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- from the step-1 shape: the Draft master is now a model, and the
    -- Releases folder is the template's models folder
    ALTER TABLE modeling_templates ADD COLUMN IF NOT EXISTS models_folder_id VARCHAR(100);
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'modeling_templates'
                 AND column_name = 'draft_file_id' AND is_nullable = 'NO') THEN
        ALTER TABLE modeling_templates ALTER COLUMN draft_file_id DROP NOT NULL;
        ALTER TABLE modeling_templates ALTER COLUMN releases_folder_id DROP NOT NULL;
      END IF;
    END $$;

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
    -- one running action per template/project at a time
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_operations_one_running
      ON modeling_operations (target_key) WHERE status = 'running';

    CREATE TABLE IF NOT EXISTS modeling_projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      deal_folder_id VARCHAR(100),
      fm_folder_id VARCHAR(100),
      models_folder_id VARCHAR(100),
      exports_folder_id VARCHAR(100),
      source VARCHAR(20) NOT NULL DEFAULT 'heyphil',
      created_by_email VARCHAR(255),
      created_by_name VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_projects_name ON modeling_projects (LOWER(name));

    CREATE TABLE IF NOT EXISTS modeling_models (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES modeling_templates(id),
      project_id INTEGER REFERENCES modeling_projects(id),
      -- forced version number (v1, v1.2, v2.1.1...), unique per owner; the
      -- label is an optional description ("Higher ADR case")
      version VARCHAR(40) NOT NULL,
      label VARCHAR(200),
      file_id VARCHAR(100) NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      parent_model_id INTEGER REFERENCES modeling_models(id),
      origin VARCHAR(20) NOT NULL CHECK (origin IN ('copy', 'template-use', 'import')),
      locked BOOLEAN NOT NULL DEFAULT false,
      locked_by_email VARCHAR(255),
      locked_by_name VARCHAR(255),
      locked_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT false,
      activated_by_email VARCHAR(255),
      activated_by_name VARCHAR(255),
      activated_at TIMESTAMPTZ,
      hidden_at TIMESTAMPTZ,
      hidden_by_email VARCHAR(255),
      hidden_by_name VARCHAR(255),
      -- starred: "being worked with right now" (any number, shared by the team)
      starred_at TIMESTAMPTZ,
      starred_by_email VARCHAR(255),
      starred_by_name VARCHAR(255),
      note TEXT,
      created_by_email VARCHAR(255),
      created_by_name VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      operation_id INTEGER REFERENCES modeling_operations(id),
      CONSTRAINT modeling_models_one_owner CHECK ((template_id IS NULL) <> (project_id IS NULL)),
      CONSTRAINT modeling_models_active_is_locked CHECK (NOT is_active OR locked),
      CONSTRAINT modeling_models_active_not_hidden CHECK (NOT (is_active AND hidden_at IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_models_one_active_template
      ON modeling_models (template_id) WHERE is_active AND template_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_models_one_active_project
      ON modeling_models (project_id) WHERE is_active AND project_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS modeling_models_parent ON modeling_models (parent_model_id);
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_models_version_template
      ON modeling_models (template_id, LOWER(version)) WHERE template_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS modeling_models_version_project
      ON modeling_models (project_id, LOWER(version)) WHERE project_id IS NOT NULL;

    -- room for later steps: inputs/outputs captured with a model
    CREATE TABLE IF NOT EXISTS modeling_model_snapshots (
      id SERIAL PRIMARY KEY,
      model_id INTEGER NOT NULL REFERENCES modeling_models(id),
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('inputs', 'outputs')),
      data JSONB NOT NULL,
      captured_by_email VARCHAR(255),
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS modeling_exports (
      id SERIAL PRIMARY KEY,
      model_id INTEGER REFERENCES modeling_models(id),
      file_id VARCHAR(100) NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      folder_id VARCHAR(100) NOT NULL,
      exported_by_email VARCHAR(255),
      exported_by_name VARCHAR(255),
      exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      operation_id INTEGER REFERENCES modeling_operations(id)
    );
    ALTER TABLE modeling_exports ADD COLUMN IF NOT EXISTS model_id INTEGER REFERENCES modeling_models(id);
`;

// Copies step-1 records (modeling_template_releases / _deals / _versions)
// into the new shape. Runs on every boot as a catch-up, keyed by Drive
// file id: a record already in modeling_models is skipped, so it's safe to
// repeat, and rows the OLD server instance writes during a deploy overlap
// are picked up on the next boot. The old tables are only read.
// Version numbers are assigned here so they're unique per owner:
//   Draft master -> v1 (label "Draft master"); a release keeps its number
//   (v1.0, v1.1...); a project's models get the next free top-level
//   number in creation order. Anything taken gets the next free number.
export async function migrateStepOne(client0 = null) {
  const client = client0 || await pool.connect();
  const q = (sql, params) => client.query(sql, params);
  try {
    if (!client0) await q('BEGIN');
    const { rows: [{ old }] } = await q("SELECT to_regclass('modeling_template_releases') IS NOT NULL AS old");
    if (!old) { if (!client0) await q('ROLLBACK'); return null; }
    await q('LOCK TABLE modeling_models IN EXCLUSIVE MODE');
    const known = new Set((await q('SELECT file_id FROM modeling_models')).rows.map((r) => r.file_id));
    const taken = new Map(); // owner key -> [versions]
    const takenFor = async (key, col, id) => {
      if (!taken.has(key)) taken.set(key, (await q(`SELECT version FROM modeling_models WHERE ${col} = $1`, [id])).rows.map((r) => r.version));
      return taken.get(key);
    };
    const claim = async (key, col, id, wanted) => {
      const list = await takenFor(key, col, id);
      const ok = wanted && parseVersion(wanted) && !list.some((v) => v.toLowerCase() === wanted.toLowerCase());
      const v = ok ? wanted.toLowerCase() : nextRootVersion(list);
      list.push(v);
      return v;
    };
    const insert = async (m) => {
      const { rows: [row] } = await q(`
        INSERT INTO modeling_models (template_id, project_id, version, label, file_id, file_name, parent_model_id, origin, locked,
          locked_by_email, locked_by_name, locked_at, is_active, activated_by_email, activated_by_name, activated_at, note,
          created_by_email, created_by_name, created_at, operation_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [m.templateId || null, m.projectId || null, m.version, m.label || null, m.fileId, m.fileName, m.parentModelId || null, m.origin, !!m.locked,
        m.lockedByEmail || null, m.lockedByName || null, m.lockedAt || null, !!m.isActive, m.activatedByEmail || null, m.activatedByName || null,
        m.activatedAt || null, m.note || null, m.createdByEmail || null, m.createdByName || null, m.createdAt || new Date(), m.operationId || null]);
      known.add(m.fileId);
      return row.id;
    };
    let added = 0;

    // templates: the Releases folder becomes the models folder; the Draft
    // master becomes an Unlocked model with no parent
    await q('UPDATE modeling_templates SET models_folder_id = COALESCE(models_folder_id, releases_folder_id)');
    const templates = (await q('SELECT * FROM modeling_templates ORDER BY id')).rows;
    const draftModel = new Map();
    for (const t of templates) {
      if (!t.draft_file_id) continue;
      if (known.has(t.draft_file_id)) {
        draftModel.set(t.id, (await q('SELECT id FROM modeling_models WHERE file_id = $1', [t.draft_file_id])).rows[0].id);
        continue;
      }
      const version = await claim(`t${t.id}`, 'template_id', t.id, 'v1');
      draftModel.set(t.id, await insert({ templateId: t.id, version, label: 'Draft master', fileId: t.draft_file_id, fileName: 'Draft master',
        origin: 'import', createdByEmail: t.created_by_email, createdByName: t.created_by_name, createdAt: t.created_at }));
      added += 1;
    }
    // releases -> template models (parent = the Draft master); Active only
    // if locked and the template has no Active model yet
    for (const r of (await q('SELECT * FROM modeling_template_releases ORDER BY id')).rows) {
      if (known.has(r.file_id)) continue;
      const version = await claim(`t${r.template_id}`, 'template_id', r.template_id, r.version);
      const hasActive = (await q('SELECT 1 FROM modeling_models WHERE template_id = $1 AND is_active', [r.template_id])).rowCount > 0;
      await insert({
        templateId: r.template_id, version, fileId: r.file_id, fileName: r.file_name, parentModelId: draftModel.get(r.template_id),
        origin: r.source === 'imported' ? 'import' : 'copy', locked: r.locked, lockedByEmail: r.locked_by_email, lockedAt: r.locked_at,
        isActive: r.status === 'active' && r.locked && !hasActive, activatedByEmail: r.activated_by_email, activatedByName: r.activated_by_name,
        activatedAt: r.activated_at, note: r.note, createdByEmail: r.released_by_email, createdByName: r.released_by_name,
        createdAt: r.released_at, operationId: r.operation_id,
      });
      added += 1;
    }
    // deals -> projects (matched by name; created if missing)
    const projectFor = new Map();
    for (const d of (await q('SELECT * FROM modeling_deals ORDER BY id')).rows) {
      const existing = (await q('SELECT id FROM modeling_projects WHERE LOWER(name) = LOWER($1)', [d.name])).rows[0];
      if (existing) { projectFor.set(d.id, existing.id); continue; }
      const { rows: [p] } = await q(`INSERT INTO modeling_projects (name, deal_folder_id, fm_folder_id, models_folder_id, exports_folder_id, source,
          created_by_email, created_by_name, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [d.name, d.deal_folder_id, d.fm_folder_id, d.copies_folder_id, d.exports_folder_id, d.source, d.created_by_email, d.created_by_name, d.created_at]);
      projectFor.set(d.id, p.id);
      added += 1;
    }
    // versions -> project models, then their parents
    const versions = (await q('SELECT * FROM modeling_versions ORDER BY id')).rows;
    for (const v of versions) {
      if (known.has(v.file_id) || !projectFor.has(v.deal_id)) continue;
      const projectId = projectFor.get(v.deal_id);
      const version = await claim(`p${projectId}`, 'project_id', projectId, v.name);
      await insert({
        projectId, version, label: v.name === 'Working model' || parseVersion(v.name) ? null : v.name, fileId: v.file_id, fileName: v.file_name,
        origin: v.source === 'imported' ? 'import' : v.from_release_id ? 'template-use' : 'copy', locked: v.locked,
        lockedByEmail: v.locked_by_email, lockedByName: v.locked_by_name, lockedAt: v.locked_at, note: v.note,
        createdByEmail: v.created_by_email, createdByName: v.created_by_name, createdAt: v.created_at, operationId: v.operation_id,
      });
      added += 1;
    }
    await q(`
      UPDATE modeling_models m SET parent_model_id = COALESCE(
        (SELECT pm.id FROM modeling_versions v JOIN modeling_versions pv ON pv.id = v.from_version_id
           JOIN modeling_models pm ON pm.file_id = pv.file_id WHERE v.file_id = m.file_id),
        (SELECT pm.id FROM modeling_versions v JOIN modeling_template_releases r ON r.id = v.from_release_id
           JOIN modeling_models pm ON pm.file_id = r.file_id WHERE v.file_id = m.file_id))
      WHERE m.project_id IS NOT NULL AND m.parent_model_id IS NULL
        AND EXISTS (SELECT 1 FROM modeling_versions v WHERE v.file_id = m.file_id)`);
    // exports -> point at the model
    await q(`
      UPDATE modeling_exports e SET model_id = m.id FROM modeling_models m
      WHERE e.model_id IS NULL AND (
        m.file_id = (SELECT v.file_id FROM modeling_versions v WHERE v.id = e.version_id)
        OR m.file_id = (SELECT r.file_id FROM modeling_template_releases r WHERE r.id = e.release_id))`);
    const { rows: [counts] } = await q(`SELECT
      (SELECT COUNT(*)::int FROM modeling_models WHERE template_id IS NOT NULL) AS template_models,
      (SELECT COUNT(*)::int FROM modeling_models WHERE project_id IS NOT NULL) AS project_models,
      (SELECT COUNT(*)::int FROM modeling_models WHERE is_active) AS active_models,
      (SELECT COUNT(*)::int FROM modeling_projects) AS projects,
      (SELECT COUNT(*)::int FROM modeling_exports WHERE model_id IS NOT NULL) AS exports`);
    if (!client0) await q('COMMIT');
    if (added) console.log(`Modeling: brought ${added} step-1 record(s) into the new registry:`, JSON.stringify(counts));
    return { added, ...counts };
  } catch (error) {
    if (!client0) await q('ROLLBACK');
    throw error;
  } finally {
    if (!client0) client.release();
  }
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

const MODEL_SELECT = `
  SELECT m.*, p.version AS parent_version, p.label AS parent_label, p.template_id AS parent_template_id, p.project_id AS parent_project_id,
    pt.name AS parent_template_name,
    (SELECT COUNT(*)::int FROM modeling_models c WHERE c.parent_model_id = m.id) AS child_count
  FROM modeling_models m
  LEFT JOIN modeling_models p ON p.id = m.parent_model_id
  LEFT JOIN modeling_templates pt ON pt.id = p.template_id`;

export async function listTemplates() {
  const { rows: templates } = await pool.query('SELECT * FROM modeling_templates ORDER BY name');
  const { rows: models } = await pool.query(`${MODEL_SELECT} WHERE m.template_id IS NOT NULL ORDER BY m.created_at, m.id`);
  return templates.map((t) => ({ ...camel(t), models: models.filter((m) => m.template_id === t.id).map(camel) }));
}

export async function getTemplate(id) {
  const { rows } = await pool.query('SELECT * FROM modeling_templates WHERE id = $1', [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function listProjects() {
  const { rows } = await pool.query(`
    SELECT p.*,
      a.id AS active_id, a.version AS active_version, a.label AS active_label, a.file_id AS active_file_id, a.activated_at,
      (SELECT COUNT(*)::int FROM modeling_models m WHERE m.project_id = p.id AND m.hidden_at IS NULL) AS model_count,
      (SELECT COUNT(*)::int FROM modeling_models m WHERE m.project_id = p.id AND m.hidden_at IS NULL AND NOT m.locked) AS unlocked_count,
      (SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('id', m.id, 'version', m.version, 'label', m.label, 'fileId', m.file_id) ORDER BY m.starred_at), '[]')
         FROM modeling_models m WHERE m.project_id = p.id AND m.starred_at IS NOT NULL AND m.hidden_at IS NULL) AS starred,
      (SELECT STRING_AGG(DISTINCT t.name, ', ') FROM modeling_models m
         JOIN modeling_models src ON src.id = m.parent_model_id JOIN modeling_templates t ON t.id = src.template_id
         WHERE m.project_id = p.id) AS template_names
    FROM modeling_projects p
    LEFT JOIN modeling_models a ON a.project_id = p.id AND a.is_active
    ORDER BY p.name`);
  return rows.map(camel);
}

export async function getProject(id) {
  const { rows } = await pool.query('SELECT * FROM modeling_projects WHERE id = $1', [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function findProjectByName(name) {
  const { rows } = await pool.query('SELECT * FROM modeling_projects WHERE LOWER(name) = LOWER($1)', [name]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function getProjectDetail(id) {
  const project = await getProject(id);
  if (!project) return null;
  const { rows: models } = await pool.query(`${MODEL_SELECT} WHERE m.project_id = $1 ORDER BY m.created_at, m.id`, [id]);
  const { rows: exports } = await pool.query(`
    SELECT e.*, m.version AS model_version FROM modeling_exports e JOIN modeling_models m ON m.id = e.model_id
    WHERE m.project_id = $1 ORDER BY e.exported_at DESC LIMIT 50`, [id]);
  return { ...project, models: models.map(camel), exports: exports.map(camel) };
}

export async function getModel(id) {
  const { rows } = await pool.query(`${MODEL_SELECT} WHERE m.id = $1`, [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function activeModel({ templateId, projectId }) {
  const { rows } = templateId
    ? await pool.query('SELECT * FROM modeling_models WHERE template_id = $1 AND is_active', [templateId])
    : await pool.query('SELECT * FROM modeling_models WHERE project_id = $1 AND is_active', [projectId]);
  return rows[0] ? camel(rows[0]) : null;
}

// Version numbers in use by an owner: its models', plus those reserved by
// copy / Use Template actions that haven't finished (a Retry would still
// register them) - whatever key the action runs under.
const TAKEN_SQL = `
  SELECT version FROM modeling_models WHERE (template_id = $1 OR project_id = $2)
  UNION ALL
  SELECT state->>'version' FROM modeling_operations
  WHERE kind IN ('copy', 'use-template') AND status <> 'succeeded' AND state ? 'version'
    AND ((state->>'templateId')::int = $1 OR (state->>'projectId')::int = $2)`;

export async function takenVersions({ templateId, projectId }, client = pool) {
  const { rows } = await client.query(TAKEN_SQL, [templateId || null, projectId || null]);
  return rows.map((r) => r.version).filter(Boolean);
}

// Picks this action's version number and saves it on the operation in
// the same transaction, under a per-owner lock - so two actions can never
// pick the same number, and a retry reuses the number its file was named
// with. `pick(taken)` returns the version.
export async function reserveVersion(opId, { templateId, projectId }, pick) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`modeling-version:${templateId ? `t${templateId}` : `p${projectId}`}`]);
    const { rows: [op] } = await client.query('SELECT state FROM modeling_operations WHERE id = $1 FOR UPDATE', [opId]);
    if (op.state?.version) { await client.query('COMMIT'); return op.state.version; }
    const version = pick(await takenVersions({ templateId, projectId }, client));
    await client.query(`UPDATE modeling_operations SET state = state || $2::jsonb WHERE id = $1`,
      [opId, JSON.stringify({ version, templateId: templateId || null, projectId: projectId || null })]);
    await client.query('COMMIT');
    return version;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Holds the same per-owner version lock for a caller's own transaction
// (Import registering several models at once).
export async function withVersionLock({ templateId, projectId }, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`modeling-version:${templateId ? `t${templateId}` : `p${projectId}`}`]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getModelIdByFileId(fileId) {
  const { rows } = await pool.query('SELECT id FROM modeling_models WHERE file_id = $1', [fileId]);
  return rows[0]?.id || null;
}

export async function getExport(id) {
  const { rows } = await pool.query('SELECT * FROM modeling_exports WHERE id = $1', [id]);
  return rows[0] ? camel(rows[0]) : null;
}

export async function listTemplateExports(templateId) {
  const { rows } = await pool.query(`SELECT e.*, m.version AS model_version FROM modeling_exports e JOIN modeling_models m ON m.id = e.model_id
    WHERE m.template_id = $1 ORDER BY e.exported_at DESC LIMIT 50`, [templateId]);
  return rows.map(camel);
}

export async function knownFileIds() {
  const { rows } = await pool.query('SELECT file_id FROM modeling_models');
  return new Set(rows.map((r) => r.file_id));
}

// ---------------------------------------------------------------- writes
export async function insertTemplate(t, actor) {
  const { rows } = await pool.query(`
    INSERT INTO modeling_templates (key, name, folder_id, models_folder_id, exports_folder_id, created_by_email, created_by_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
  [t.key, t.name, t.folderId, t.modelsFolderId, t.exportsFolderId || null, actor.email, actor.name || null]);
  return camel(rows[0]);
}

export async function insertProject(p, actor) {
  try {
    const { rows } = await pool.query(`
      INSERT INTO modeling_projects (name, deal_folder_id, fm_folder_id, models_folder_id, exports_folder_id, source, created_by_email, created_by_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [p.name, p.dealFolderId || null, p.fmFolderId || null, p.modelsFolderId || null, p.exportsFolderId || null, p.source || 'heyphil', actor.email, actor.name || null]);
    return camel(rows[0]);
  } catch (error) {
    if (error.code === '23505') throw new ModelingError(`There's already a project named "${p.name}".`, 409);
    throw error;
  }
}

export async function setProjectFolders(id, f) {
  await pool.query(`UPDATE modeling_projects SET deal_folder_id = COALESCE($2, deal_folder_id), fm_folder_id = COALESCE($3, fm_folder_id),
    models_folder_id = COALESCE($4, models_folder_id), exports_folder_id = COALESCE($5, exports_folder_id) WHERE id = $1`,
  [id, f.dealFolderId || null, f.fmFolderId || null, f.modelsFolderId || null, f.exportsFolderId || null]);
}

// A new model row. ON CONFLICT (file_id) returns the existing row, so a
// retried step never registers a file twice.
export async function insertModel(m, client = pool) {
  const { rows } = await client.query(`
    INSERT INTO modeling_models (template_id, project_id, version, label, file_id, file_name, parent_model_id, origin, locked,
      locked_by_email, locked_by_name, locked_at, note, created_by_email, created_by_name, created_at, operation_id)
    VALUES ($1, $2, $3, $17, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, NOW()), $16)
    ON CONFLICT (file_id) DO UPDATE SET file_id = EXCLUDED.file_id RETURNING *`,
  [m.templateId || null, m.projectId || null, m.version, m.fileId, m.fileName, m.parentModelId || null, m.origin, !!m.locked,
    m.locked ? m.lockedByEmail || null : null, m.locked ? m.lockedByName || null : null, m.locked ? m.lockedAt || null : null,
    m.note || null, m.createdByEmail || null, m.createdByName || null, m.createdAt || null, m.operationId || null, m.label || null]);
  return camel(rows[0]);
}

export async function markLocked(id, actor) {
  await pool.query(`UPDATE modeling_models SET locked = true, locked_by_email = COALESCE(locked_by_email, $2),
    locked_by_name = COALESCE(locked_by_name, $3), locked_at = COALESCE(locked_at, NOW()) WHERE id = $1`, [id, actor.email, actor.name || null]);
}

// HeyPhil's record said locked but Drive says not (someone unlocked it by
// hand): correct the record. An Active model must be locked, so it stops
// being Active too.
export async function markUnlocked(id) {
  await pool.query(`UPDATE modeling_models SET locked = false, is_active = false, locked_by_email = NULL, locked_by_name = NULL, locked_at = NULL
    WHERE id = $1`, [id]);
}

// Make Active: in one transaction the owner's previous Active model stops
// being Active (it stays Locked) and this one becomes Active.
export async function activateModel(modelId, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [m0] } = await client.query('SELECT template_id, project_id FROM modeling_models WHERE id = $1', [modelId]);
    if (!m0) throw new ModelingError('That model no longer exists.', 404);
    // the owner row first, so two activations for one owner queue here
    if (m0.template_id) await client.query('SELECT id FROM modeling_templates WHERE id = $1 FOR UPDATE', [m0.template_id]);
    else await client.query('SELECT id FROM modeling_projects WHERE id = $1 FOR UPDATE', [m0.project_id]);
    const { rows: [m] } = await client.query('SELECT * FROM modeling_models WHERE id = $1', [modelId]);
    if (m.is_active) { await client.query('COMMIT'); return { previous: null, alreadyActive: true }; }
    if (!m.locked) throw new ModelingError('Lock the model before making it Active.');
    if (m.hidden_at) throw new ModelingError('Unhide the model before making it Active.');
    const { rows: prev } = await client.query(`UPDATE modeling_models SET is_active = false
      WHERE is_active AND id <> $1 AND (template_id = $2 OR project_id = $3) RETURNING version`, [modelId, m.template_id, m.project_id]);
    await client.query(`UPDATE modeling_models SET is_active = true, activated_by_email = $2, activated_by_name = $3, activated_at = NOW()
      WHERE id = $1`, [modelId, actor.email, actor.name || null]);
    await client.query('COMMIT');
    return { previous: prev[0]?.version || null, version: m.version };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setHidden(modelId, hidden, actor) {
  const { rows: [m] } = await pool.query('SELECT * FROM modeling_models WHERE id = $1', [modelId]);
  if (!m) throw new ModelingError('Not found', 404);
  if (hidden && m.is_active) throw new ModelingError("The Active model can't be hidden - make another model Active first.");
  if (hidden) {
    // hiding also drops the star
    await pool.query(`UPDATE modeling_models SET hidden_at = NOW(), hidden_by_email = $2, hidden_by_name = $3,
      starred_at = NULL, starred_by_email = NULL, starred_by_name = NULL WHERE id = $1 AND NOT is_active`,
      [modelId, actor.email, actor.name || null]);
  } else {
    await pool.query('UPDATE modeling_models SET hidden_at = NULL, hidden_by_email = NULL, hidden_by_name = NULL WHERE id = $1', [modelId]);
  }
}

export async function setStarred(modelId, starred, actor) {
  const { rows: [m] } = await pool.query('SELECT hidden_at FROM modeling_models WHERE id = $1', [modelId]);
  if (!m) throw new ModelingError('Not found', 404);
  if (starred && m.hidden_at) throw new ModelingError('Unhide the model before starring it.');
  if (starred) {
    await pool.query(`UPDATE modeling_models SET starred_at = COALESCE(starred_at, NOW()),
      starred_by_email = COALESCE(starred_by_email, $2), starred_by_name = COALESCE(starred_by_name, $3) WHERE id = $1`,
    [modelId, actor.email, actor.name || null]);
  } else {
    await pool.query('UPDATE modeling_models SET starred_at = NULL, starred_by_email = NULL, starred_by_name = NULL WHERE id = $1', [modelId]);
  }
}

export async function insertExport(e) {
  const { rows } = await pool.query(`
    INSERT INTO modeling_exports (model_id, file_id, file_name, folder_id, exported_by_email, exported_by_name, operation_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (file_id) DO UPDATE SET file_id = EXCLUDED.file_id RETURNING *`,
  [e.modelId, e.fileId, e.fileName, e.folderId, e.email, e.name || null, e.operationId || null]);
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
  // $2 is cast: used both as the column value and in the CASE, Postgres
  // can't infer one type for it otherwise
  const { rowCount } = await pool.query(`UPDATE modeling_operations SET status = $2::varchar, state = $3, steps = $4, error = $5,
    finished_at = CASE WHEN $2::varchar = 'running' THEN NULL ELSE NOW() END, heartbeat_at = NOW()
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
