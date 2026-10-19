// Database queries for the Design board (Shared Service Tools -> Design):
// design requests, each a deliverable for a project, tracked from request
// to delivery, with a journal (comments, drafts, finals, stage moves,
// emails sent) and file attachments. Validation lives in design-rules.js.
import { randomUUID } from 'crypto';
import pool from './db.js';
import {
  DESIGN_COLUMNS,
  DESIGN_OPTION_LISTS,
  DesignValidationError,
  MAX_ATTACHMENTS_PER_REQUEST,
  MAX_ATTACHMENT_BYTES,
  cleanFilename,
  deliveredAtFor,
  stageAfterPosting,
  validateDate,
  validateDeliverable,
  validateJournalEntry,
  validateLink,
  validateOptionList,
  validatePriority,
  validateProjectId,
  validateStatus,
  validateText,
} from './design-rules.js';

export { DESIGN_COLUMNS, DesignValidationError };

// For a journal entry or attachment someone may not remove.
export class DesignForbiddenError extends Error {}

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

  // Deliverable type, output type and dimensions (#40, #41) and priority
  // (#42). Existing requests get no type and normal priority.
  await step('design_requests type/output/dimensions/priority columns', () => pool.query(`
    ALTER TABLE design_requests
      ADD COLUMN IF NOT EXISTS deliverable_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS output_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS dimensions VARCHAR(100),
      ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'normal'
  `));

  // The option lists the board's settings gear edits; a list that has
  // never been saved uses DESIGN_OPTION_LISTS.
  await step('design_settings table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS design_settings (
      key VARCHAR(50) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_by_email VARCHAR(255),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `));

  // Files on a request (#37), kept in the database, 25 MB each.
  await step('design_attachments table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS design_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id UUID NOT NULL REFERENCES design_requests(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      content_type VARCHAR(150),
      size_bytes INTEGER NOT NULL,
      data BYTEA NOT NULL,
      uploaded_by_email VARCHAR(255),
      uploaded_by_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    )
  `));
  await step('design_attachments request index', () => pool.query(`
    CREATE INDEX IF NOT EXISTS idx_design_attachments_request ON design_attachments(request_id) WHERE deleted_at IS NULL
  `));

  // The request's history (#43): comments, drafts and finals people post,
  // plus stage moves and emails sent, written by the server.
  await step('design_journal table', () => pool.query(`
    CREATE TABLE IF NOT EXISTS design_journal (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id UUID NOT NULL REFERENCES design_requests(id) ON DELETE CASCADE,
      kind VARCHAR(20) NOT NULL,
      body TEXT,
      link TEXT,
      attachment_id UUID REFERENCES design_attachments(id) ON DELETE SET NULL,
      author_email VARCHAR(255),
      author_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    )
  `));
  await step('design_journal request index', () => pool.query(`
    CREATE INDEX IF NOT EXISTS idx_design_journal_request ON design_journal(request_id, created_at) WHERE deleted_at IS NULL
  `));
}

// Joined to the project for its name; a soft-deleted project shows as none.
const SELECT = `
  SELECT d.id, d.seq_num, d.deliverable, d.project_id, d.status, d.requested_at,
         d.requester_email, d.requester_name, d.designer, d.due_date::text AS due_date,
         d.notes, d.link, d.delivered_at, d.created_at, d.updated_at,
         d.deliverable_type, d.output_type, d.dimensions, d.priority,
         p.title AS project_title,
         (SELECT COUNT(*)::int FROM design_journal j
           WHERE j.request_id = d.id AND j.deleted_at IS NULL AND j.kind IN ('comment', 'draft', 'final')) AS journal_count,
         (SELECT COUNT(*)::int FROM design_attachments a
           WHERE a.request_id = d.id AND a.deleted_at IS NULL) AS attachment_count
  FROM design_requests d
  LEFT JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
`;

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    seqNum: row.seq_num,
    deliverable: row.deliverable,
    deliverableType: row.deliverable_type,
    outputType: row.output_type,
    dimensions: row.dimensions,
    priority: row.priority || 'normal',
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
    journalCount: row.journal_count || 0,
    attachmentCount: row.attachment_count || 0,
  };
}

async function assertProjectExists(client, projectId) {
  if (!projectId) return;
  const { rows } = await client.query('SELECT 1 FROM projects WHERE id = $1 AND deleted_at IS NULL', [projectId]);
  if (rows.length === 0) throw new DesignValidationError('That project doesn\'t exist.');
}

// The requester is picked from People (#39); their email comes from
// there too, never from the browser. Returns { name, email }, or nulls
// to clear it.
async function resolveRequester(client, value) {
  const name = validateText(value, 'Requester', 255);
  if (!name) return { name: null, email: null };
  const { rows } = await client.query('SELECT name, email FROM people WHERE LOWER(name) = LOWER($1) LIMIT 1', [name]);
  if (rows.length === 0) throw new DesignValidationError(`"${name}" isn't in People.`);
  return { name: rows[0].name, email: rows[0].email || null };
}

export async function getAllRequests() {
  const { rows } = await pool.query(`${SELECT} WHERE d.deleted_at IS NULL ORDER BY d.requested_at ASC`);
  return rows.map(mapRow);
}

export async function getRequestById(id) {
  const { rows } = await pool.query(`${SELECT} WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  return mapRow(rows[0]);
}

const optionalText = (max, label) => (v) => validateText(v, label, max);

// actor is the signed-in person ({ email, name }); without a requester
// picked, they're the requester.
export async function createRequest(fields, actor = {}) {
  const values = {
    deliverable: validateDeliverable(fields.deliverable),
    deliverableType: optionalText(100, 'Deliverable type')(fields.deliverableType),
    outputType: optionalText(100, 'Output type')(fields.outputType),
    dimensions: optionalText(100, 'Dimensions')(fields.dimensions),
    priority: fields.priority === undefined || fields.priority === null || fields.priority === ''
      ? 'normal'
      : validatePriority(fields.priority),
    projectId: validateProjectId(fields.projectId),
    designer: validateText(fields.designer, 'Designer', 255),
    dueDate: validateDate(fields.dueDate, 'Due date'),
    notes: validateText(fields.notes, 'Notes', 5000),
    link: validateLink(fields.link),
  };
  await assertProjectExists(pool, values.projectId);
  const requester = fields.requesterName
    ? await resolveRequester(pool, fields.requesterName)
    : { name: actor.name || null, email: actor.email || null };
  const id = randomUUID();
  await pool.query(
    `INSERT INTO design_requests
       (id, deliverable, deliverable_type, output_type, dimensions, priority, project_id, designer,
        due_date, notes, link, requester_email, requester_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [id, values.deliverable, values.deliverableType, values.outputType, values.dimensions, values.priority,
      values.projectId, values.designer, values.dueDate, values.notes, values.link, requester.email, requester.name]
  );
  return getRequestById(id);
}

// Fields the update route may change, with their validator.
const PATCHABLE = {
  deliverable: ['deliverable', validateDeliverable],
  deliverableType: ['deliverable_type', optionalText(100, 'Deliverable type')],
  outputType: ['output_type', optionalText(100, 'Output type')],
  dimensions: ['dimensions', optionalText(100, 'Dimensions')],
  priority: ['priority', validatePriority],
  projectId: ['project_id', validateProjectId],
  status: ['status', validateStatus],
  designer: ['designer', (v) => validateText(v, 'Designer', 255)],
  dueDate: ['due_date', (v) => validateDate(v, 'Due date')],
  notes: ['notes', (v) => validateText(v, 'Notes', 5000)],
  link: ['link', validateLink],
};

const COLUMN_TITLES = {
  requested: 'Requested',
  scoping: 'Scoping',
  'in-design': 'In Design',
  'in-review': 'In Review',
  revisions: 'Revisions',
  delivered: 'Delivered',
  'on-hold': 'On Hold',
};

async function logJournal(client, requestId, kind, { body = null, link = null, attachmentId = null } = {}, actor = {}) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO design_journal (id, request_id, kind, body, link, attachment_id, author_email, author_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, requestId, kind, body, link, attachmentId, actor.email || null, actor.name || null]
  );
  return id;
}

// Applies a stage move inside an open transaction: the status, the
// delivered_at rule, and a journal line saying who moved it.
async function moveStage(client, requestId, fromStatus, toStatus, actor) {
  const deliveredAt = deliveredAtFor(fromStatus, toStatus);
  const sets = ['status = $1', 'updated_at = NOW()'];
  if (deliveredAt === 'now') sets.push('delivered_at = NOW()');
  else if (deliveredAt === null) sets.push('delivered_at = NULL');
  await client.query(`UPDATE design_requests SET ${sets.join(', ')} WHERE id = $2`, [toStatus, requestId]);
  await logJournal(client, requestId, 'status', {
    body: `Moved from ${COLUMN_TITLES[fromStatus] || fromStatus} to ${COLUMN_TITLES[toStatus] || toStatus}`,
  }, actor);
}

export async function updateRequest(id, updates, actor = {}) {
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

    let newStatus;
    for (const [key, [column, validate]] of Object.entries(PATCHABLE)) {
      if (updates[key] === undefined) continue;
      const value = validate(updates[key]);
      if (key === 'projectId') await assertProjectExists(client, value);
      if (key === 'status') {
        newStatus = value; // applied below, with its journal line
        continue;
      }
      add(column, value);
    }
    if (updates.requesterName !== undefined) {
      const requester = await resolveRequester(client, updates.requesterName);
      add('requester_name', requester.name);
      add('requester_email', requester.email);
    }

    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      values.push(id);
      await client.query(`UPDATE design_requests SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    }
    if (newStatus !== undefined && newStatus !== row.status) await moveStage(client, id, row.status, newStatus, actor);
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

// ---- Option lists (#40, #41) -------------------------------------------

export async function getOptionLists() {
  const { rows } = await pool.query('SELECT key, value FROM design_settings WHERE key = ANY($1)', [Object.keys(DESIGN_OPTION_LISTS)]);
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(Object.entries(DESIGN_OPTION_LISTS).map(([key, def]) => [key, Array.isArray(saved[key]) ? saved[key] : def]));
}

const OPTION_LABELS = { deliverableTypes: 'Deliverable types', outputTypes: 'Output types' };

// Saves whichever lists are given; unknown keys are refused.
export async function saveOptionLists(lists, actor = {}) {
  const entries = Object.entries(lists || {});
  for (const [key] of entries) {
    if (!(key in DESIGN_OPTION_LISTS)) throw new DesignValidationError(`Unknown list "${key}".`);
  }
  const cleaned = entries.map(([key, value]) => [key, validateOptionList(value, OPTION_LABELS[key])]);
  // All the lists save, or none do.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of cleaned) {
      await client.query(
        `INSERT INTO design_settings (key, value, updated_by_email, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by_email = EXCLUDED.updated_by_email, updated_at = NOW()`,
        [key, JSON.stringify(value), actor.email || null]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getOptionLists();
}

// ---- Journal (#43) --------------------------------------------------------

function mapJournal(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    kind: row.kind,
    body: row.body,
    link: row.link,
    attachmentId: row.attachment_id && row.attachment_filename ? row.attachment_id : null,
    attachmentName: row.attachment_filename || null,
    authorEmail: row.author_email,
    authorName: row.author_name,
    createdAt: row.created_at,
  };
}

export async function listJournal(requestId) {
  const { rows } = await pool.query(
    `SELECT j.*, a.filename AS attachment_filename
     FROM design_journal j
     LEFT JOIN design_attachments a ON a.id = j.attachment_id AND a.deleted_at IS NULL
     WHERE j.request_id = $1 AND j.deleted_at IS NULL
     ORDER BY j.created_at ASC`,
    [requestId]
  );
  return rows.map(mapJournal);
}

// Posts a comment, draft or final. A draft or final can also move the
// card (moveStage), see stageAfterPosting. Returns { request, entry } -
// the updated request and the entry just posted - or null if the request
// doesn't exist.
export async function addJournalEntry(requestId, fields, actor = {}, { moveStage: shouldMove = true } = {}) {
  const entry = validateJournalEntry(fields);
  const attachmentId = fields.attachmentId || null;
  if (!entry.body && !entry.link && !attachmentId) {
    throw new DesignValidationError('Add a note, a link or a file.');
  }
  const client = await pool.connect();
  let entryId;
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT status FROM design_requests WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [requestId]
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }
    if (attachmentId) {
      const att = await client.query(
        'SELECT 1 FROM design_attachments WHERE id = $1 AND request_id = $2 AND deleted_at IS NULL',
        [attachmentId, requestId]
      );
      if (att.rows.length === 0) throw new DesignValidationError('That file isn\'t on this request.');
    }
    entryId = await logJournal(client, requestId, entry.kind, { ...entry, attachmentId }, actor);
    const next = shouldMove ? stageAfterPosting(entry.kind, row.status) : null;
    if (next) await moveStage(client, requestId, row.status, next, actor);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const [request, journal] = await Promise.all([getRequestById(requestId), listJournal(requestId)]);
  return { request, entry: journal.find((j) => j.id === entryId) || null };
}

// A server-written record, e.g. that an email went out.
export async function logEvent(requestId, kind, body, actor = {}) {
  await logJournal(pool, requestId, kind, { body }, actor);
}

// Comments, drafts and finals can be removed by whoever posted them or an
// admin; stage moves and email records stay.
export async function deleteJournalEntry(requestId, entryId, actorEmail, actorIsAdmin) {
  const { rows } = await pool.query(
    'SELECT kind, author_email FROM design_journal WHERE id = $1 AND request_id = $2 AND deleted_at IS NULL',
    [entryId, requestId]
  );
  const row = rows[0];
  if (!row) return false;
  if (!['comment', 'draft', 'final'].includes(row.kind)) {
    throw new DesignForbiddenError('Stage moves and email records can\'t be removed.');
  }
  const own = row.author_email && actorEmail && row.author_email.toLowerCase() === actorEmail.toLowerCase();
  if (!own && !actorIsAdmin) throw new DesignForbiddenError('Only the person who posted this or an admin can remove it.');
  await pool.query('UPDATE design_journal SET deleted_at = NOW() WHERE id = $1', [entryId]);
  return true;
}

// ---- Attachments (#37) ------------------------------------------------

function mapAttachment(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedByEmail: row.uploaded_by_email,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

export async function listAttachments(requestId) {
  const { rows } = await pool.query(
    `SELECT id, request_id, filename, content_type, size_bytes, uploaded_by_email, uploaded_by_name, created_at
     FROM design_attachments WHERE request_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [requestId]
  );
  return rows.map(mapAttachment);
}

// data is a Buffer. Returns the attachment, or null if the request
// doesn't exist.
export async function addAttachment(requestId, { filename, contentType, data }, actor = {}) {
  if (!Buffer.isBuffer(data) || data.length === 0) throw new DesignValidationError('That file is empty.');
  if (data.length > MAX_ATTACHMENT_BYTES) {
    throw new DesignValidationError(`Files can be up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
  }
  const type = typeof contentType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(contentType) && contentType.length <= 150
    ? contentType.toLowerCase()
    : 'application/octet-stream';
  // The request row is locked while counting, so uploads in parallel
  // can't together go past the limit.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await client.query('SELECT 1 FROM design_requests WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [requestId]);
    if (request.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const count = await client.query(
      'SELECT COUNT(*)::int AS n FROM design_attachments WHERE request_id = $1 AND deleted_at IS NULL',
      [requestId]
    );
    if (count.rows[0].n >= MAX_ATTACHMENTS_PER_REQUEST) {
      throw new DesignValidationError(`A request can hold up to ${MAX_ATTACHMENTS_PER_REQUEST} files.`);
    }
    const { rows } = await client.query(
      `INSERT INTO design_attachments (id, request_id, filename, content_type, size_bytes, data, uploaded_by_email, uploaded_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, request_id, filename, content_type, size_bytes, uploaded_by_email, uploaded_by_name, created_at`,
      [randomUUID(), requestId, cleanFilename(filename), type, data.length, data, actor.email || null, actor.name || null]
    );
    await client.query('COMMIT');
    return mapAttachment(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getAttachmentFile(requestId, attachmentId) {
  const { rows } = await pool.query(
    `SELECT a.filename, a.content_type, a.data
     FROM design_attachments a
     JOIN design_requests d ON d.id = a.request_id AND d.deleted_at IS NULL
     WHERE a.id = $1 AND a.request_id = $2 AND a.deleted_at IS NULL`,
    [attachmentId, requestId]
  );
  return rows[0] ? { filename: rows[0].filename, contentType: rows[0].content_type, data: rows[0].data } : null;
}

export async function deleteAttachment(requestId, attachmentId, actorEmail, actorIsAdmin) {
  const { rows } = await pool.query(
    'SELECT uploaded_by_email FROM design_attachments WHERE id = $1 AND request_id = $2 AND deleted_at IS NULL',
    [attachmentId, requestId]
  );
  const row = rows[0];
  if (!row) return false;
  const own = row.uploaded_by_email && actorEmail && row.uploaded_by_email.toLowerCase() === actorEmail.toLowerCase();
  if (!own && !actorIsAdmin) throw new DesignForbiddenError('Only the person who added this file or an admin can remove it.');
  // The bytes are cleared too, so a removed file stops taking up space.
  await pool.query('UPDATE design_attachments SET deleted_at = NOW(), data = \'\'::bytea WHERE id = $1', [attachmentId]);
  return true;
}
