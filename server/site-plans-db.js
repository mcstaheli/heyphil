// Database queries for the Site Planner (Dev Tools -> Site Planner): one
// row per site - its boundary, where the map was looking, and the schemes
// tested on it. Validation lives in site-plan-rules.js.
import { randomUUID } from 'crypto';
import pool from './db.js';
import {
  SitePlanValidationError,
  defaultSchemes,
  validateBoundary,
  validateMapView,
  validateName,
  validatePreset,
  validateProjectId,
  validateSchemes,
} from './site-plan-rules.js';

export { SitePlanValidationError };

// Thrown when a save was based on an older copy than the one stored, so
// it doesn't silently undo someone else's edit.
export class SitePlanConflictError extends Error {}

async function step(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`⚠️  Site plan migration warning (${label}, may be safe to ignore):`, error.message);
  }
}

export async function createTables() {
  // project_id is a soft link: deleting a project leaves the site with no
  // project rather than deleting it.
  await step('site_plans table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS site_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(200) NOT NULL,
      project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      boundary JSONB,
      map_view JSONB,
      schemes JSONB NOT NULL,
      created_by_email VARCHAR(255),
      created_by_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    )
  `));

  // Presets (#4): an asset type and its settings, saved to reuse on
  // other sites.
  await step('site_plan_presets table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS site_plan_presets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      asset_type VARCHAR(40) NOT NULL,
      overrides JSONB NOT NULL,
      created_by_email VARCHAR(255),
      created_by_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    )
  `));
}

// Joined to the project for its name; a soft-deleted project shows as none.
const SELECT = `
  SELECT s.id, s.name, s.project_id, s.boundary, s.map_view, s.schemes,
         s.created_by_email, s.created_by_name, s.created_at, s.updated_at,
         p.title AS project_title
  FROM site_plans s
  LEFT JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
`;

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_title ? row.project_id : null,
    projectTitle: row.project_title || null,
    boundary: row.boundary,
    mapView: row.map_view,
    schemes: row.schemes,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    // Sent as an ISO string and compared exactly on save (see updatePlan).
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

async function assertProjectExists(client, projectId) {
  if (!projectId) return;
  const { rows } = await client.query('SELECT 1 FROM projects WHERE id = $1 AND deleted_at IS NULL', [projectId]);
  if (rows.length === 0) throw new SitePlanValidationError('That project doesn\'t exist.');
}

export async function getAllPlans() {
  const { rows } = await pool.query(`${SELECT} WHERE s.deleted_at IS NULL ORDER BY s.updated_at DESC`);
  return rows.map(mapRow);
}

export async function getPlanById(id) {
  const { rows } = await pool.query(`${SELECT} WHERE s.id = $1 AND s.deleted_at IS NULL`, [id]);
  return mapRow(rows[0]);
}

export async function createPlan({ name, projectId, createdByEmail, createdByName }) {
  const values = {
    name: validateName(name),
    projectId: validateProjectId(projectId),
  };
  await assertProjectExists(pool, values.projectId);
  const id = randomUUID();
  // updated_at is truncated to milliseconds so the ISO string the client
  // gets back matches the stored value exactly.
  await pool.query(
    `INSERT INTO site_plans (id, name, project_id, schemes, created_by_email, created_by_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, date_trunc('milliseconds', clock_timestamp()))`,
    [id, values.name, values.projectId, JSON.stringify(defaultSchemes()), createdByEmail || null, createdByName || null]
  );
  return getPlanById(id);
}

// Fields the update route may change, with their validator.
const PATCHABLE = {
  name: ['name', validateName, false],
  projectId: ['project_id', validateProjectId, false],
  boundary: ['boundary', validateBoundary, true],
  mapView: ['map_view', validateMapView, true],
  schemes: ['schemes', validateSchemes, true],
};

// expectedUpdatedAt (optional) is the updatedAt the editor last loaded or
// saved; if the row has moved on since, nothing is written.
export async function updatePlan(id, updates, expectedUpdatedAt) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT updated_at FROM site_plans WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [id]
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }
    const expected = expectedUpdatedAt ? new Date(expectedUpdatedAt).getTime() : null;
    if (expectedUpdatedAt && Number.isNaN(expected)) {
      throw new SitePlanValidationError('expectedUpdatedAt must be a date.');
    }
    if (expectedUpdatedAt && expected !== row.updated_at.getTime()) {
      throw new SitePlanConflictError('Someone else changed this site since you opened it. Reload to see their changes.');
    }

    const sets = [];
    const values = [];
    for (const [key, [column, validate, json]] of Object.entries(PATCHABLE)) {
      if (updates[key] === undefined) continue;
      const value = validate(updates[key]);
      if (key === 'projectId') await assertProjectExists(client, value);
      values.push(json && value !== null ? JSON.stringify(value) : value);
      sets.push(`${column} = $${values.length}`);
    }

    if (sets.length > 0) {
      sets.push('updated_at = date_trunc(\'milliseconds\', clock_timestamp())');
      values.push(id);
      await client.query(`UPDATE site_plans SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getPlanById(id);
}

export async function softDeletePlan(id) {
  const { rows } = await pool.query(
    'UPDATE site_plans SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
    [id]
  );
  return rows.length > 0;
}

// ---- Presets (#4) --------------------------------------------------------

function mapPreset(row) {
  return {
    id: row.id,
    name: row.name,
    assetType: row.asset_type,
    overrides: row.overrides,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

export async function listPresets() {
  const { rows } = await pool.query('SELECT * FROM site_plan_presets WHERE deleted_at IS NULL ORDER BY name');
  return rows.map(mapPreset);
}

export async function createPreset(fields, actor = {}) {
  const p = validatePreset(fields);
  const { rows } = await pool.query(
    `INSERT INTO site_plan_presets (id, name, asset_type, overrides, created_by_email, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [randomUUID(), p.name, p.assetType, JSON.stringify(p.overrides), actor.email || null, actor.name || null]
  );
  return mapPreset(rows[0]);
}

export async function getPreset(id) {
  const { rows } = await pool.query('SELECT * FROM site_plan_presets WHERE id = $1 AND deleted_at IS NULL', [id]);
  return rows[0] ? mapPreset(rows[0]) : null;
}

export async function softDeletePreset(id) {
  const { rows } = await pool.query(
    'UPDATE site_plan_presets SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
    [id]
  );
  return rows.length > 0;
}
