// Database queries for Project Board (unified projects table)
import pool from './db.js';

// ========== PROJECTS (unified with board cards) ==========

export async function getAllProjects() {
  const result = await pool.query(`
    SELECT
      id, title, description, status, owner, notes, project_type,
      deal_value, target_close, date_created, deleted_at,
      budget, timeline, team, files, tasks, links, needs_ic,
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
      deal_value, target_close, date_created, deleted_at,
      budget, timeline, team, files, tasks, links, needs_ic,
      created_at, updated_at
    FROM projects
    WHERE id = $1
  `, [id]);
  return result.rows[0];
}

export async function createProject(project) {
  const result = await pool.query(`
    INSERT INTO projects (
      title, description, status, owner, notes, project_type,
      deal_value, target_close, date_created, budget, timeline, team, files, tasks, links
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `, [
    project.title,
    project.description || null,
    project.status || project.column || 'ideation',
    project.owner || null,
    project.notes || null,
    project.projectType || null,
    project.dealValue || null,
    project.targetClose || null,
    project.dateCreated || new Date(),
    project.budget ? JSON.stringify(project.budget) : null,
    project.timeline ? JSON.stringify(project.timeline) : null,
    project.team ? JSON.stringify(project.team) : null,
    project.files ? JSON.stringify(project.files) : null,
    project.tasks ? JSON.stringify(project.tasks) : '[]',
    project.links ? JSON.stringify(project.links) : '[]'
  ]);
  return result.rows[0];
}

export async function updateProject(id, updates) {
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
  if (updates.dealValue !== undefined) {
    fields.push(`deal_value = $${paramCount++}`);
    values.push(updates.dealValue);
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

  if (fields.length === 0) {
    return getProjectById(id);
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function deleteProject(id) {
  // Soft delete
  await pool.query('UPDATE projects SET deleted_at = NOW() WHERE id = $1', [id]);
}

export async function getDeletedProjects() {
  const result = await pool.query(`
    SELECT 
      id, title, description, status, owner, notes, project_type,
      deal_value, date_created, deleted_at,
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
    dealValue: parseFloat(project.deal_value) || 0,
    dateCreated: project.date_created,
    projectType: project.project_type,
    needsIc: project.needs_ic || false,
    project_id: project.id,  // Self-reference (every card IS a project now)
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
