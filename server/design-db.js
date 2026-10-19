// Database queries for the Design board (Shared Service Tools -> Design):
// design requests, each a deliverable for a project, tracked from request
// to delivery. Validation lives in design-rules.js.
import { randomUUID } from 'crypto';
import pool from './db.js';
import {
  DESIGN_COLUMNS,
  DesignValidationError,
  deliveredAtFor,
  validateDate,
  validateDeliverable,
  validateLink,
  validateProjectId,
  validateStatus,
  validateText,
} from './design-rules.js';

export { DESIGN_COLUMNS, DesignValidationError };

async function step(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`⚠️  Design migration warning (${label}, may be safe to ignore):`, error.message);
  }
}

export async function createTables() {
  // seq_num gives each request a number people can say ("design 12").
  // project_id is a soft link: deleting a project leaves the request with
  // no project rather than deleting the design history.
  await step('design_requests table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS design_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      seq_num SERIAL,
      deliverable VARCHAR(300) NOT NULL,
      project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'requested',
      requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
      requester_email VARCHAR(255),
      requester_name VARCHAR(255),
      designer VARCHAR(255),
      due_date DATE,
      notes TEXT,
      link TEXT,
      delivered_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    )
  `));

  await step('design_requests status index', () => pool.query(`
    CREATE INDEX IF NOT EXISTS idx_design_requests_status ON design_requests(status) WHERE deleted_at IS NULL
  `));
}

// Joined to the project for its name; a soft-deleted project shows as none.
const SELECT = `
  SELECT d.id, d.seq_num, d.deliverable, d.project_id, d.status, d.requested_at,
         d.requester_email, d.requester_name, d.designer, d.due_date::text AS due_date,
         d.notes, d.link, d.delivered_at, d.created_at, d.updated_at,
         p.title AS project_title
  FROM design_requests d
  LEFT JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
`;

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    seqNum: row.seq_num,
    deliverable: row.deliverable,
    projectId: row.project_title ? row.project_id : null,
    projectTitle: row.project_title || null,
    status: row.status,
    requestedAt: row.requested_at,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name,
    designer: row.designer,
    dueDate: row.due_date,
    notes: row.notes,
    link: row.link,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertProjectExists(client, projectId) {
  if (!projectId) return;
  const { rows } = await client.query('SELECT 1 FROM projects WHERE id = $1 AND deleted_at IS NULL', [projectId]);
  if (rows.length === 0) throw new DesignValidationError('That project doesn\'t exist.');
}

export async function getAllRequests() {
  const { rows } = await pool.query(`${SELECT} WHERE d.deleted_at IS NULL ORDER BY d.requested_at ASC`);
  return rows.map(mapRow);
}

export async function getRequestById(id) {
  const { rows } = await pool.query(`${SELECT} WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  return mapRow(rows[0]);
}

export async function createRequest({ deliverable, projectId, designer, dueDate, notes, link, requesterEmail, requesterName }) {
  const values = {
    deliverable: validateDeliverable(deliverable),
    projectId: validateProjectId(projectId),
    designer: validateText(designer, 'Designer', 255),
    dueDate: validateDate(dueDate, 'Due date'),
    notes: validateText(notes, 'Notes', 5000),
    link: validateLink(link),
  };
  await assertProjectExists(pool, values.projectId);
  const id = randomUUID();
  await pool.query(
    `INSERT INTO design_requests
       (id, deliverable, project_id, designer, due_date, notes, link, requester_email, requester_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, values.deliverable, values.projectId, values.designer, values.dueDate, values.notes, values.link,
      requesterEmail || null, requesterName || null]
  );
  return getRequestById(id);
}

// Fields the update route may change, with their validator.
const PATCHABLE = {
  deliverable: ['deliverable', validateDeliverable],
  projectId: ['project_id', validateProjectId],
  status: ['status', validateStatus],
  designer: ['designer', (v) => validateText(v, 'Designer', 255)],
  dueDate: ['due_date', (v) => validateDate(v, 'Due date')],
  notes: ['notes', (v) => validateText(v, 'Notes', 5000)],
  link: ['link', validateLink],
};

export async function updateRequest(id, updates) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT status FROM design_requests WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
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

    for (const [key, [column, validate]] of Object.entries(PATCHABLE)) {
      if (updates[key] === undefined) continue;
      const value = validate(updates[key]);
      if (key === 'projectId') await assertProjectExists(client, value);
      add(column, value);
    }

    const deliveredAt = deliveredAtFor(row.status, updates.status);
    if (deliveredAt === 'now') sets.push('delivered_at = NOW()');
    else if (deliveredAt !== undefined) add('delivered_at', deliveredAt);

    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      values.push(id);
      await client.query(`UPDATE design_requests SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getRequestById(id);
}

export async function softDeleteRequest(id) {
  const { rows } = await pool.query(
    'UPDATE design_requests SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
    [id]
  );
  return rows.length > 0;
}
