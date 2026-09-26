// Database queries for Project Board (unified projects table)
import { randomUUID } from 'crypto';
import pool from './db.js';

// Origination pipeline stage order (board restructure Stage 1): a card may
// only move to an equal-or-higher rank. Build is deliberately skippable -
// Handoff -> Operate just skips a rank, which "rank must not decrease"
// already allows without needing to special-case it. Ideation (an early
// idea, not yet decided) sits before On Deck ("identified and worth
// pursuing") - initially folded into On Deck by the Stage 1 restructure,
// restored as its own stage afterward (see migrations/004-restore-ideation-column.js).
//
// Studio-board statuses (studio-*) and anything else not in this list are
// outside this ordering entirely and keep moving freely, same as before -
// see assertForwardMove below.
export const ORIGINATION_STAGE_ORDER = [
  'ideation', 'on-deck', 'diligence', 'capitalize', 'handoff', 'build', 'operate', 'assets', 'exited'
];

export class ForwardOnlyViolationError extends Error {
  constructor(fromStatus, toStatus) {
    super(`Cards move forward only: cannot move from "${fromStatus}" back to "${toStatus}"`);
    this.name = 'ForwardOnlyViolationError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

function assertForwardMove(fromStatus, toStatus) {
  if (!fromStatus || !toStatus || fromStatus === toStatus) return;
  const fromIsOrigination = ORIGINATION_STAGE_ORDER.includes(fromStatus);
  const toIsOrigination = ORIGINATION_STAGE_ORDER.includes(toStatus);
  // Neither side is one of ours (both Studio, or both some other unranked
  // value) - not ours to police, let it through untouched.
  if (!fromIsOrigination && !toIsOrigination) return;
  // Exactly one side is in the origination pipeline: this is either
  // jumping INTO it from Studio/unknown, or OUT of it to Studio/unknown -
  // neither is a valid "forward" move, and letting an origination card's
  // target rank come back as -1 (unranked) would silently bypass the
  // whole check below, so this has to be its own explicit rejection.
  if (fromIsOrigination !== toIsOrigination) {
    throw new ForwardOnlyViolationError(fromStatus, toStatus);
  }
  const fromRank = ORIGINATION_STAGE_ORDER.indexOf(fromStatus);
  const toRank = ORIGINATION_STAGE_ORDER.indexOf(toStatus);
  if (toRank < fromRank) {
    throw new ForwardOnlyViolationError(fromStatus, toStatus);
  }
}

// ========== PROJECTS (unified with board cards) ==========

export async function getAllProjects() {
  const result = await pool.query(`
    SELECT
      id, title, description, status, owner, notes, project_type,
      annual_value, target_close, date_created, deleted_at,
      budget, budget_locks, value, value_locks, timeline, timeline_locks, team, files, tasks, links, needs_ic,
      handoff, capital_committed, months_to_first_cash, metric_snapshots,
      created_at, updated_at
    FROM projects
    WHERE deleted_at IS NULL
    ORDER BY date_created DESC
  `);
  return result.rows;
}

export async function getProjectById(id) {
  const result = await pool.query(`
    SELECT
      id, title, description, status, owner, notes, project_type,
      annual_value, target_close, date_created, deleted_at,
      budget, budget_locks, value, value_locks, timeline, timeline_locks, team, files, tasks, links, needs_ic,
      handoff, capital_committed, months_to_first_cash, metric_snapshots,
      created_at, updated_at
    FROM projects
    WHERE id = $1
  `, [id]);
  return result.rows[0];
}

export async function createProject(project) {
  const initialStatus = project.status || project.column || 'on-deck';
  // A card created directly into Handoff (the "New Card" flow lets you pick
  // any initial column) needs the same fresh checklist/enteredAt stamp a
  // normal transition into Handoff gets - this is the one creation path,
  // separate from updateProjectWithStatusCheck's own entering-Handoff hook.
  const initialHandoff = initialStatus === 'handoff' ? (project.handoff || freshHandoff()) : (project.handoff || null);

  const result = await pool.query(`
    INSERT INTO projects (
      title, description, status, owner, notes, project_type,
      annual_value, target_close, date_created, budget, timeline, team, files, tasks, links,
      capital_committed, months_to_first_cash, handoff
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
    RETURNING *
  `, [
    project.title,
    project.description || null,
    initialStatus,
    project.owner || null,
    project.notes || null,
    project.projectType || null,
    project.annualValue || null,
    project.targetClose || null,
    project.dateCreated || new Date(),
    project.budget ? JSON.stringify(project.budget) : null,
    project.timeline ? JSON.stringify(project.timeline) : null,
    project.team ? JSON.stringify(project.team) : null,
    project.files ? JSON.stringify(project.files) : null,
    project.tasks ? JSON.stringify(project.tasks) : '[]',
    project.links ? JSON.stringify(project.links) : '[]',
    // Both use an explicit null/undefined/'' check (not `|| null`) so an
    // intentional 0 is stored as 0, not silently coerced to "never set" -
    // and '' (an empty form field left untouched, since months-to-first-
    // cash isn't required outside the origination/Handoff stages) can't
    // reach the INTEGER column and crash the insert.
    project.capitalCommitted !== undefined && project.capitalCommitted !== null && project.capitalCommitted !== ''
      ? project.capitalCommitted : null,
    project.monthsToFirstCash !== undefined && project.monthsToFirstCash !== null && project.monthsToFirstCash !== ''
      ? project.monthsToFirstCash : null,
    initialHandoff ? JSON.stringify(initialHandoff) : null
  ]);
  return result.rows[0];
}

export async function updateProject(id, updates) {
  // 'column' is the board's alias for 'status' - either one moving the
  // card needs the same forward-only check against whatever status is
  // currently committed. Reading that status and checking it has to happen
  // on the same locked row as the write itself (see below), or two
  // concurrent moves on the same card can each read a stale pre-move
  // status and both pass a check that, applied in sequence, wouldn't have.
  const newStatus = updates.status !== undefined ? updates.status
    : (updates.column !== undefined ? updates.column : undefined);

  if (newStatus !== undefined) {
    return updateProjectWithStatusCheck(id, updates, newStatus);
  }
  return updateProjectFields(id, updates);
}

// Locks the row for the duration of the check-then-write, same pattern as
// lockProjectLedger/lockProjectTimeline elsewhere in this file - without
// it, two concurrent requests moving the same card could each read the
// status before the other's write commits, letting a combined backward
// move slip through even though neither request individually violated
// "forward only".
async function updateProjectWithStatusCheck(id, updates, newStatus) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT status, annual_value, capital_committed, months_to_first_cash, metric_snapshots FROM projects WHERE id = $1 FOR UPDATE',
      [id]
    );
    const currentRow = current.rows[0];
    if (currentRow) {
      assertForwardMove(currentRow.status, newStatus);
    }

    // The generic status/column update (this path) is also how drag-and-drop
    // and the Status dropdown move a card - without this check, either one
    // could carry a card straight out of Handoff without ever naming an
    // operator or completing the checklist, since neither goes through
    // acceptHandoff. The only way out of Handoff is Accept Handoff.
    if (currentRow?.status === 'handoff' && newStatus !== 'handoff') {
      throw new HandoffNotReadyError(
        'Leaving Handoff requires accepting it - name an operator and complete the checklist, then use Accept Handoff.'
      );
    }

    // Newly entering Handoff (not already there - editing operator/checklist
    // while sitting in Handoff re-sends the same status, which skips this)
    // always starts a fresh checklist and stamps enteredAt, the source of
    // the "how long has this card been sitting in Handoff" alarm - this
    // unconditionally overrides any handoff value the caller sent, same
    // reasoning as the months-to-first-cash override below: a drag-and-drop
    // move (moveCard) spreads the ENTIRE card back at the server, including
    // whatever handoff/monthsToFirstCash it already had, so "only fill in
    // if the caller omitted it" would never actually fire for that path.
    if (newStatus === 'handoff' && currentRow?.status !== 'handoff') {
      updates = { ...updates, handoff: freshHandoff() };
    }

    // Assets is "producing now" - months to first cash is always 0 there,
    // not something to keep asking for. Unconditionally forced on entering
    // Assets (see the handoff comment above for why "only if omitted"
    // wouldn't reliably fire).
    if (newStatus === 'assets' && currentRow?.status !== 'assets') {
      updates = { ...updates, monthsToFirstCash: 0 };
    }

    // Snapshot annual value / capital committed / months to first cash on
    // every stage change - same "append, never overwrite" pattern as
    // budget_locks/value_locks/timeline_locks, so a project's numbers over
    // its life stay visible even as they change. Uses the EFFECTIVE values
    // (this same request's own updates, if it's changing a number and the
    // stage together, else whatever's already committed).
    if (currentRow && newStatus !== currentRow.status) {
      const snapshot = buildMetricSnapshot(newStatus, {
        annualValue: updates.annualValue !== undefined ? updates.annualValue : currentRow.annual_value,
        capitalCommitted: updates.capitalCommitted !== undefined ? updates.capitalCommitted : currentRow.capital_committed,
        monthsToFirstCash: updates.monthsToFirstCash !== undefined ? updates.monthsToFirstCash : currentRow.months_to_first_cash
      });
      updates = { ...updates, metricSnapshots: [...(currentRow.metric_snapshots || []), snapshot] };
    }

    const project = await updateProjectFields(id, updates, client);
    await client.query('COMMIT');
    return project;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Single source of truth for the four exit-criteria keys - freshHandoff's
// blank checklist and acceptHandoff's completeness check both derive from
// this instead of each hand-listing the four keys separately.
const HANDOFF_CHECKLIST_KEYS = ['operatorAccepted', 'budgetTimelineRestated', 'diligenceTransferred', 'first90DaysAgreed'];

function freshHandoff() {
  return {
    operator: null,
    checklist: Object.fromEntries(HANDOFF_CHECKLIST_KEYS.map((key) => [key, false])),
    enteredAt: new Date().toISOString()
  };
}

// Shared by both places a stage transition happens (the generic path in
// updateProjectWithStatusCheck, and acceptHandoff, which bypasses it) - a
// single place to keep the snapshot shape and, critically, the numeric
// coercion consistent. Without the explicit Number(...) here, a value that
// came from a fresh `updates` payload (a JS number) and one read back from
// a DECIMAL(15,2) column (node-pg returns those as strings, e.g. "500000.00")
// would end up with different JS types for the same logical field depending
// on which transition produced the snapshot entry.
function buildMetricSnapshot(status, { annualValue, capitalCommitted, monthsToFirstCash }) {
  return {
    status,
    annualValue: annualValue === null || annualValue === undefined ? null : Number(annualValue),
    capitalCommitted: capitalCommitted === null || capitalCommitted === undefined ? null : Number(capitalCommitted),
    monthsToFirstCash: monthsToFirstCash === null || monthsToFirstCash === undefined ? null : Number(monthsToFirstCash),
    at: new Date().toISOString()
  };
}

// The actual dynamic UPDATE, shared by both the status-checked and
// unchecked paths - `client` defaults to the shared pool for callers with
// no transaction of their own to run it in.
async function updateProjectFields(id, updates, client = pool) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  if (updates.title !== undefined) {
    fields.push(`title = $${paramCount++}`);
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    fields.push(`description = $${paramCount++}`);
    values.push(updates.description);
  }
  if (updates.status !== undefined) {
    fields.push(`status = $${paramCount++}`);
    values.push(updates.status);
  }
  // Support 'column' as alias for 'status' (for board compatibility)
  if (updates.column !== undefined && updates.status === undefined) {
    fields.push(`status = $${paramCount++}`);
    values.push(updates.column);
  }
  if (updates.owner !== undefined) {
    fields.push(`owner = $${paramCount++}`);
    values.push(updates.owner);
  }
  if (updates.notes !== undefined) {
    fields.push(`notes = $${paramCount++}`);
    values.push(updates.notes);
  }
  if (updates.projectType !== undefined) {
    fields.push(`project_type = $${paramCount++}`);
    values.push(updates.projectType);
  }
  if (updates.annualValue !== undefined) {
    fields.push(`annual_value = $${paramCount++}`);
    values.push(updates.annualValue);
  }
  if (updates.capitalCommitted !== undefined) {
    fields.push(`capital_committed = $${paramCount++}`);
    values.push(updates.capitalCommitted);
  }
  if (updates.monthsToFirstCash !== undefined) {
    fields.push(`months_to_first_cash = $${paramCount++}`);
    values.push(updates.monthsToFirstCash);
  }
  if (updates.metricSnapshots !== undefined) {
    fields.push(`metric_snapshots = $${paramCount++}::jsonb`);
    values.push(JSON.stringify(updates.metricSnapshots));
  }
  if (updates.targetClose !== undefined) {
    fields.push(`target_close = $${paramCount++}`);
    values.push(updates.targetClose);
  }
  if (updates.budget !== undefined) {
    fields.push(`budget = $${paramCount++}`);
    values.push(JSON.stringify(updates.budget));
  }
  if (updates.timeline !== undefined) {
    fields.push(`timeline = $${paramCount++}`);
    values.push(JSON.stringify(updates.timeline));
  }
  if (updates.team !== undefined) {
    fields.push(`team = $${paramCount++}`);
    values.push(JSON.stringify(updates.team));
  }
  if (updates.files !== undefined) {
    fields.push(`files = $${paramCount++}`);
    values.push(JSON.stringify(updates.files));
  }
  if (updates.tasks !== undefined) {
    fields.push(`tasks = $${paramCount++}`);
    values.push(JSON.stringify(updates.tasks));
  }
  if (updates.links !== undefined) {
    fields.push(`links = $${paramCount++}`);
    values.push(JSON.stringify(updates.links));
  }
  if (updates.needsIc !== undefined) {
    fields.push(`needs_ic = $${paramCount++}`);
    values.push(!!updates.needsIc);
  }
  if (updates.handoff !== undefined) {
    fields.push(`handoff = $${paramCount++}::jsonb`);
    values.push(updates.handoff === null ? null : JSON.stringify(updates.handoff));
  }

  if (fields.length === 0) {
    return getProjectById(id);
  }

  values.push(id);
  const result = await client.query(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  return result.rows[0];
}

export class HandoffNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HandoffNotReadyError';
  }
}

// Partial update of the operator/checklist while a card sits in Handoff -
// merges onto whatever's already there rather than requiring the caller to
// resend the whole object (checklist keys not mentioned stay as they were).
// Locked the same way acceptHandoff is - without it, two edits landing
// close together (two checklist boxes ticked in quick succession, or this
// racing an in-flight acceptHandoff) each read the pre-edit handoff and
// whichever write commits last wins, silently reverting the other one.
export async function updateProjectHandoff(id, { operator, checklist } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT status, handoff FROM projects WHERE id = $1 FOR UPDATE', [id]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    if (current.rows[0].status !== 'handoff') {
      await client.query('ROLLBACK');
      throw new HandoffNotReadyError('This project is not in Handoff.');
    }

    const existing = current.rows[0].handoff || freshHandoff();
    const updated = {
      ...existing,
      operator: operator !== undefined ? operator : existing.operator,
      checklist: checklist !== undefined ? { ...existing.checklist, ...checklist } : existing.checklist
    };

    const result = await client.query(
      'UPDATE projects SET handoff = $2::jsonb WHERE id = $1 RETURNING *',
      [id, JSON.stringify(updated)]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// The compound "Accept Handoff" action: operator becomes the sole owner,
// the card advances out of Handoff (to Build or Operate - forward-only
// still applies, so a caller can't use this to sneak a backward move past
// the check), and the handoff object clears. Requires an operator named
// and all four checklist items done - same rule the card's own UI gates
// the Accept button on, enforced again here since this is the one place
// that actually performs the transition.
// Handoff only ever exits to Build or Operate (Build is skippable) - not
// straight to Assets/Exited, even though those rank higher and would pass
// assertForwardMove on their own.
const HANDOFF_NEXT_STATUSES = ['build', 'operate'];

export async function acceptHandoff(id, acceptedBy, nextStatus) {
  if (!HANDOFF_NEXT_STATUSES.includes(nextStatus)) {
    throw new HandoffNotReadyError(`Handoff can only advance to Build or Operate, not "${nextStatus}".`);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT status, owner, handoff, annual_value, capital_committed, months_to_first_cash, metric_snapshots FROM projects WHERE id = $1 FOR UPDATE',
      [id]
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }
    if (row.status !== 'handoff') {
      await client.query('ROLLBACK');
      throw new HandoffNotReadyError('This project is not in Handoff.');
    }
    assertForwardMove('handoff', nextStatus);

    const handoff = row.handoff || {};
    const checklist = handoff.checklist || {};
    if (!handoff.operator) {
      await client.query('ROLLBACK');
      throw new HandoffNotReadyError('Name an operator before accepting the handoff.');
    }
    if (!HANDOFF_CHECKLIST_KEYS.every((key) => checklist[key])) {
      await client.query('ROLLBACK');
      throw new HandoffNotReadyError('The handoff checklist is not complete yet.');
    }

    const originator = row.owner;
    const operator = handoff.operator;
    // Same snapshot-on-transition as the generic path (updateProjectWithStatusCheck)
    // - this route bypasses that path entirely, so it has to do it here too.
    const snapshot = buildMetricSnapshot(nextStatus, {
      annualValue: row.annual_value,
      capitalCommitted: row.capital_committed,
      monthsToFirstCash: row.months_to_first_cash
    });
    const metricSnapshots = [...(row.metric_snapshots || []), snapshot];
    const result = await client.query(
      'UPDATE projects SET status = $2, owner = $3, handoff = NULL, metric_snapshots = $4::jsonb WHERE id = $1 RETURNING *',
      [id, nextStatus, operator, JSON.stringify(metricSnapshots)]
    );
    await client.query('COMMIT');
    return { project: result.rows[0], originator, operator };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Sum of a heading's direct child line items, for both budget and actual.
// Headings never carry their own amount - it's always derived from their
// children, so this is the one place that math has to happen.
function resolveBudgetHeadingTotals(items) {
  const childrenByParent = {};
  for (const item of items) {
    if (!item.isHeading && item.parentId) {
      (childrenByParent[item.parentId] = childrenByParent[item.parentId] || []).push(item);
    }
  }
  return items.map((item) => {
    if (!item.isHeading) return item;
    const kids = childrenByParent[item.id] || [];
    return {
      ...item,
      amount: kids.reduce((sum, k) => sum + (Number(k.amount) || 0), 0),
      actual: kids.reduce((sum, k) => sum + (Number(k.actual) || 0), 0)
    };
  });
}

// Budget and Value are two independent ledgers with identical shape and
// identical live/locked-history behavior - only the column names differ.
// This allowlist is the only thing ever interpolated into the SQL below
// (bind parameters can't stand in for identifiers); keeping it a fixed,
// hardcoded map - never built from a request - is what makes that safe.
const LEDGER_COLUMNS = {
  budget: { liveCol: 'budget', locksCol: 'budget_locks' },
  value: { liveCol: 'value', locksCol: 'value_locks' }
};

function ledgerColumns(ledger) {
  const cols = LEDGER_COLUMNS[ledger];
  if (!cols) throw new Error(`Unknown ledger: ${ledger}`);
  return cols;
}

// Overwrites the live line items wholesale (matches the existing
// tasks/links/timeline pattern - the client sends the full array back,
// there's no partial/id-targeted update). Returns the full row (or
// undefined if the project doesn't exist) so the caller can 404 and
// broadcast consistently with every other project mutation.
export async function updateProjectLedger(ledger, id, items) {
  const { liveCol } = ledgerColumns(ledger);
  const result = await pool.query(
    `UPDATE projects SET ${liveCol} = $2::jsonb WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(items || [])]
  );
  return result.rows[0];
}

// Appends a frozen snapshot to the ledger's locks column. Never overwrites
// a prior lock - that history is the whole point (see the migration
// comment in index.js): if the plan changes enough that the story needs
// resetting, the old locked state is still there to look back on.
//
// Two things that make this safe to call concurrently (e.g. a double
// click, or two teammates locking the same project seconds apart):
// - `SELECT ... FOR UPDATE` inside a transaction serializes concurrent
//   lock calls on the same row, so the second one appends onto the
//   first's result instead of racing it and silently dropping a lock.
// - `items`, when the caller passes what's currently on screen, is what
//   actually gets locked and persisted - not whatever the DB happens to
//   have committed, which could still be behind an in-flight edit's save.
export async function lockProjectLedger(ledger, id, lockedBy, items, name) {
  const { liveCol, locksCol } = ledgerColumns(ledger);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT ${liveCol}, ${locksCol} FROM projects WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const liveItems = Array.isArray(items) ? items : (current.rows[0][liveCol] || []);
    const locks = current.rows[0][locksCol] || [];
    const lock = {
      id: `lock_${randomUUID()}`,
      name: (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 200) : null,
      lockedAt: new Date().toISOString(),
      lockedBy: lockedBy || null,
      items: resolveBudgetHeadingTotals(liveItems)
    };

    const result = await client.query(
      `UPDATE projects SET ${liveCol} = $2::jsonb, ${locksCol} = $3::jsonb WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(liveItems), JSON.stringify([...locks, lock])]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Same shape and same concurrency handling as lockProjectLedger (see its
// comment): FOR UPDATE serializes concurrent locks on the row, and the
// caller's own on-screen `tasks` (not whatever's last committed) is what
// gets locked and persisted. Snapshots the full task list (not just
// milestones) so slippage can be reported per task/section, not just at
// milestones - `milestones` is kept alongside as a lighter-weight,
// already-filtered view for the existing hero-stat comparison code.
export async function lockProjectTimeline(id, lockedBy, tasks, name) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT timeline, timeline_locks FROM projects WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const liveTasks = Array.isArray(tasks) ? tasks : (current.rows[0].timeline || []);
    const locks = current.rows[0].timeline_locks || [];
    const lock = {
      id: `lock_${randomUUID()}`,
      name: (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 200) : null,
      lockedAt: new Date().toISOString(),
      lockedBy: lockedBy || null,
      milestones: liveTasks
        .filter((t) => t.type === 'milestone')
        .map((t) => ({ id: t.id, name: t.name, date: t.date })),
      tasks: liveTasks
    };

    const result = await client.query(
      `UPDATE projects SET timeline = $2::jsonb, timeline_locks = $3::jsonb WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(liveTasks), JSON.stringify([...locks, lock])]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteProject(id) {
  // Soft delete
  await pool.query('UPDATE projects SET deleted_at = NOW() WHERE id = $1', [id]);
}

export async function getDeletedProjects() {
  const result = await pool.query(`
    SELECT 
      id, title, description, status, owner, notes, project_type,
      annual_value, date_created, deleted_at,
      created_at, updated_at
    FROM projects
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `);
  return result.rows;
}

export async function restoreProject(id) {
  await pool.query('UPDATE projects SET deleted_at = NULL WHERE id = $1', [id]);
}

// ========== TASKS (JSONB in projects.tasks) ==========

export async function addTask(projectId, text) {
  // Same bare-parameter bug as toggleTask/updateTask: jsonb_build_object's
  // variadic "any" args can't resolve $2's type without a cast. This broke
  // adding ANY new checklist item to ANY card - not a latent/edge-case bug,
  // a fully broken feature, verified directly against the DB before this
  // fix (every call raised "could not determine data type of parameter $2").
  const result = await pool.query(`
    UPDATE projects
    SET tasks = tasks || jsonb_build_array(
      jsonb_build_object(
        'id', (SELECT COALESCE(MAX((task->>'id')::int), 0) + 1 FROM projects, jsonb_array_elements(tasks) task WHERE id = $1),
        'text', $2::text,
        'completed', false,
        'completedOn', null,
        'completedBy', null,
        'starred', false
      )
    )
    WHERE id = $1
    RETURNING tasks
  `, [projectId, text]);
  return result.rows[0];
}

export async function toggleTask(projectId, taskId, completed, userName) {
  // Two things were wrong here, both silent until a real (non-undefined)
  // cardId actually reached this query for the first time:
  // - `$5` had no cast at all inside jsonb_build_object's variadic "any"
  //   args, so Postgres couldn't determine its type ("could not determine
  //   data type of parameter $5").
  // - `$4::text::jsonb` casts a bare ISO date string straight to jsonb,
  //   but an unquoted string isn't valid JSON on its own ("invalid input
  //   syntax for type json"). And when $4 is SQL NULL (unchecking a task),
  //   jsonb_set is strict on its replacement-value argument - a NULL there
  //   makes the WHOLE jsonb_set call return NULL, which jsonb_agg then
  //   stores as a bare `null` in place of the task, destroying it.
  await pool.query(`
    UPDATE projects
    SET tasks = (
      SELECT jsonb_agg(
        CASE
          WHEN (task->>'id')::int = $2
          THEN jsonb_set(
            jsonb_set(task, '{completed}', to_jsonb($3::boolean)),
            '{completedOn}', COALESCE(to_jsonb($4::text), 'null'::jsonb)
          ) || jsonb_build_object('completedBy', $5::text)
          ELSE task
        END
      )
      FROM jsonb_array_elements(tasks) task
    )
    WHERE id = $1
  `, [projectId, taskId, completed, completed ? new Date().toISOString() : null, completed ? userName : null]);
}

export async function toggleTaskStar(projectId, taskId, starred) {
  await pool.query(`
    UPDATE projects
    SET tasks = (
      SELECT jsonb_agg(
        CASE
          WHEN (task->>'id')::int = $2
          THEN jsonb_set(task, '{starred}', to_jsonb($3::boolean))
          ELSE task
        END
      )
      FROM jsonb_array_elements(tasks) task
    )
    WHERE id = $1
  `, [projectId, taskId, starred]);
}

export async function updateTask(projectId, taskId, text) {
  // Same bug as toggleTask: to_jsonb($3) with no cast leaves Postgres
  // unable to resolve the polymorphic function's argument type.
  await pool.query(`
    UPDATE projects
    SET tasks = (
      SELECT jsonb_agg(
        CASE
          WHEN (task->>'id')::int = $2
          THEN jsonb_set(task, '{text}', to_jsonb($3::text))
          ELSE task
        END
      )
      FROM jsonb_array_elements(tasks) task
    )
    WHERE id = $1
  `, [projectId, taskId, text]);
}

export async function deleteTask(projectId, taskId) {
  // jsonb_agg over zero rows (deleting the last remaining task) returns SQL
  // NULL, not an empty array. That NULL then poisons every future addTask
  // for this project - `tasks || jsonb_build_array(...)` is itself NULL
  // the moment either side is NULL, so the "add" silently no-ops forever
  // after the "delete" of the last item. Verified directly: reproduced,
  // then confirmed the COALESCE below fixes it.
  await pool.query(`
    UPDATE projects
    SET tasks = COALESCE((
      SELECT jsonb_agg(task)
      FROM jsonb_array_elements(tasks) task
      WHERE (task->>'id')::int != $2
    ), '[]'::jsonb)
    WHERE id = $1
  `, [projectId, taskId]);
}

// ========== LINKS (JSONB in projects.links) ==========

export async function addLink(projectId, title, url) {
  // Same bare-parameter bug as addTask - broke adding ANY new link to ANY
  // card (verified directly before this fix).
  const result = await pool.query(`
    UPDATE projects
    SET links = links || jsonb_build_array(
      jsonb_build_object(
        'id', (SELECT COALESCE(MAX((link->>'id')::int), 0) + 1 FROM projects, jsonb_array_elements(links) link WHERE id = $1),
        'title', $2::text,
        'url', $3::text
      )
    )
    WHERE id = $1
    RETURNING links
  `, [projectId, title, url]);
  return result.rows[0];
}

export async function deleteLink(projectId, linkId) {
  // Same NULL-poisoning bug as deleteTask - see its comment.
  await pool.query(`
    UPDATE projects
    SET links = COALESCE((
      SELECT jsonb_agg(link)
      FROM jsonb_array_elements(links) link
      WHERE (link->>'id')::int != $2
    ), '[]'::jsonb)
    WHERE id = $1
  `, [projectId, linkId]);
}

// ========== ACTIVITY LOG ==========

export async function getLogsByProjectId(projectId) {
  const result = await pool.query(
    'SELECT * FROM activity_log WHERE project_id = $1 ORDER BY timestamp DESC',
    [projectId]
  );
  return result.rows.map(row => ({
    timestamp: row.timestamp,
    action: row.action,
    user: row.user_name,
    details: row.details,
    projectId: row.project_id
  }));
}

export async function addLog(projectId, action, userName, details) {
  await pool.query(
    'INSERT INTO activity_log (project_id, action, user_name, details) VALUES ($1, $2, $3, $4)',
    [projectId, action, userName, details]
  );
}

// ========== PEOPLE ==========

export async function getAllPeople() {
  const result = await pool.query('SELECT * FROM people');
  const people = {};
  const ownerColors = {};
  
  result.rows.forEach(row => {
    if (row.photo_url) people[row.name] = row.photo_url;
    if (row.border_color) ownerColors[row.name] = row.border_color;
  });
  
  return { people, ownerColors };
}

export async function createPerson(name, photoUrl, borderColor) {
  await pool.query(
    'INSERT INTO people (name, photo_url, border_color) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET photo_url = $2, border_color = $3',
    [name, photoUrl, borderColor]
  );
}

// ========== PROJECT TYPES ==========

export async function getAllProjectTypes() {
  const result = await pool.query('SELECT * FROM project_types');
  const projectTypeColors = {};
  
  result.rows.forEach(row => {
    projectTypeColors[row.name] = row.color;
  });
  
  return projectTypeColors;
}

export async function createProjectType(name, color) {
  await pool.query(
    'INSERT INTO project_types (name, color) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET color = $2',
    [name, color]
  );
}

// ========== BOARD AGGREGATED DATA ==========

export async function getBoardData() {
  // Get all data in parallel
  const [projectsResult, logsResult, peopleData, projectTypeColors] = await Promise.all([
    getAllProjects(),
    pool.query('SELECT * FROM activity_log WHERE project_id IS NOT NULL ORDER BY timestamp DESC'),
    getAllPeople(),
    getAllProjectTypes()
  ]);
  
  // Group logs by project
  const logsByProject = {};
  logsResult.rows.forEach(log => {
    const projectId = log.project_id;
    if (projectId) {
      if (!logsByProject[projectId]) logsByProject[projectId] = [];
      logsByProject[projectId].push({
        timestamp: log.timestamp,
        action: log.action,
        user: log.user_name,
        details: log.details,
        projectId: log.project_id
      });
    }
  });
  
  // Build complete projects with embedded tasks, links, and logs
  // Convert to board card format for compatibility
  const cards = projectsResult.map(project => ({
    id: project.id,
    title: project.title,
    description: project.description,
    column: project.status,  // Map status -> column for board
    owner: project.owner,
    notes: project.notes,
    annualValue: parseFloat(project.annual_value) || 0,
    dateCreated: project.date_created,
    projectType: project.project_type,
    needsIc: project.needs_ic || false,
    project_id: project.id,  // Self-reference (every card IS a project now)
    // Condensed Value/Budget/Timeline chips on the mini card use these -
    // same JSONB columns the Project Detail page reads, just surfaced here
    // too so the board doesn't need a second round-trip per card.
    budget: project.budget || [],
    budgetLocks: project.budget_locks || [],
    value: project.value || [],
    valueLocks: project.value_locks || [],
    timeline: project.timeline || [],
    timelineLocks: project.timeline_locks || [],
    // Dual-avatar/checklist/enteredAt state while a card sits in Handoff -
    // null the rest of the time (see acceptHandoff/freshHandoff).
    handoff: project.handoff || null,
    capitalCommitted: parseFloat(project.capital_committed) || 0,
    monthsToFirstCash: project.months_to_first_cash !== null && project.months_to_first_cash !== undefined
      ? project.months_to_first_cash
      : null,
    metricSnapshots: project.metric_snapshots || [],
    // Tasks are stored in the projects.tasks JSONB column without a cardId of
    // their own (see addTask) - inject it here so the client's toggle/rename/
    // delete-action calls (which all key off action.cardId) have it to send.
    actions: (project.tasks || []).map(task => ({ ...task, cardId: project.id })),
    // Same gap as tasks: links carry no cardId of their own (see addLink),
    // but the client's deleteLink call needs one.
    links: (project.links || []).map(link => ({ ...link, cardId: project.id })),
    log: logsByProject[project.id] || []
  }));
  
  return {
    cards,
    people: peopleData.people,
    ownerColors: peopleData.ownerColors,
    projectTypeColors
  };
}
