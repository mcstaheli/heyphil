// Database queries for Project Board
import pool from './db.js';

// ========== CARDS ==========

export async function getAllCards() {
  const result = await pool.query(`
    SELECT 
      id, title, description, column_name as column, owner, notes,
      deal_value, date_created, project_type,
      created_at, updated_at
    FROM cards
    WHERE deleted_at IS NULL
    ORDER BY date_created DESC
  `);
  return result.rows;
}

export async function getCardById(id) {
  const result = await pool.query(`
    SELECT 
      id, title, description, column_name as column, owner, notes,
      deal_value, date_created, project_type,
      created_at, updated_at, deleted_at
    FROM cards 
    WHERE id = $1
  `, [id]);
  return result.rows[0];
}

export async function createCard(card) {
  const result = await pool.query(`
    INSERT INTO cards (id, title, description, column_name, owner, notes, deal_value, date_created, project_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    card.id,
    card.title,
    card.description || null,
    card.column || 'backlog',
    card.owner || null,
    card.notes || null,
    card.dealValue || null,
    card.dateCreated || new Date(),
    card.projectType || null
  ]);
  return result.rows[0];
}

export async function updateCard(id, updates) {
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
  if (updates.column !== undefined) {
    fields.push(`column_name = $${paramCount++}`);
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
  if (updates.dealValue !== undefined) {
    fields.push(`deal_value = $${paramCount++}`);
    values.push(updates.dealValue);
  }
  if (updates.projectType !== undefined) {
    fields.push(`project_type = $${paramCount++}`);
    values.push(updates.projectType);
  }
  
  if (fields.length === 0) return null;
  
  values.push(id);
  const result = await pool.query(
    `UPDATE cards SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function deleteCard(id) {
  // Soft delete - mark as deleted
  await pool.query('UPDATE cards SET deleted_at = NOW() WHERE id = $1', [id]);
}

export async function getDeletedCards() {
  const result = await pool.query(`
    SELECT 
      id, title, description, column_name as column, owner, notes,
      deal_value, date_created, project_type,
      deleted_at, created_at, updated_at
    FROM cards
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `);
  return result.rows;
}

export async function restoreCard(id) {
  await pool.query('UPDATE cards SET deleted_at = NULL WHERE id = $1', [id]);
}

// ========== ACTIONS ==========

export async function getActionsByCardId(cardId) {
  const result = await pool.query(
    'SELECT * FROM actions WHERE card_id = $1 ORDER BY id',
    [cardId]
  );
  return result.rows;
}

export async function getAllActions() {
  const result = await pool.query('SELECT * FROM actions ORDER BY id');
  return result.rows;
}

export async function createAction(cardId, cardTitle, text) {
  const result = await pool.query(
    'INSERT INTO actions (card_id, card_title, text) VALUES ($1, $2, $3) RETURNING *',
    [cardId, cardTitle, text]
  );
  return result.rows[0];
}

export async function toggleAction(actionId, completed, userName) {
  const result = await pool.query(
    `UPDATE actions 
     SET completed_on = $1, completed_by = $2 
     WHERE id = $3 
     RETURNING *`,
    [completed ? new Date() : null, completed ? userName : null, actionId]
  );
  return result.rows[0];
}

export async function updateAction(actionId, text) {
  const result = await pool.query(
    `UPDATE actions 
     SET text = $1 
     WHERE id = $2 
     RETURNING *`,
    [text, actionId]
  );
  return result.rows[0];
}

export async function deleteAction(actionId) {
  await pool.query('DELETE FROM actions WHERE id = $1', [actionId]);
}

// ========== LINKS ==========

export async function getLinksByCardId(cardId) {
  const result = await pool.query(
    'SELECT * FROM links WHERE card_id = $1 ORDER BY id',
    [cardId]
  );
  return result.rows;
}

export async function getAllLinks() {
  const result = await pool.query('SELECT * FROM links ORDER BY id');
  return result.rows;
}

export async function createLink(cardId, title, url) {
  const result = await pool.query(
    'INSERT INTO links (card_id, title, url) VALUES ($1, $2, $3) RETURNING *',
    [cardId, title, url]
  );
  return result.rows[0];
}

export async function deleteLink(linkId) {
  await pool.query('DELETE FROM links WHERE id = $1', [linkId]);
}

// ========== ACTIVITY LOG ==========

export async function getLogsByCardId(cardId) {
  const result = await pool.query(
    'SELECT * FROM activity_log WHERE card_id = $1 ORDER BY timestamp DESC',
    [cardId]
  );
  return result.rows.map(row => ({
    timestamp: row.timestamp,
    cardTitle: row.card_title,
    action: row.action,
    user: row.user_name,
    details: row.details,
    cardId: row.card_id
  }));
}

export async function addLog(cardId, cardTitle, action, userName, details) {
  await pool.query(
    'INSERT INTO activity_log (card_id, card_title, action, user_name, details) VALUES ($1, $2, $3, $4, $5)',
    [cardId, cardTitle, action, userName, details]
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
  const [cardsResult, actionsResult, linksResult, logsResult, peopleData, projectTypeColors] = await Promise.all([
    getAllCards(),
    getAllActions(),
    getAllLinks(),
    pool.query('SELECT * FROM activity_log ORDER BY timestamp DESC'),
    getAllPeople(),
    getAllProjectTypes()
  ]);
  
  // Group actions by card
  const actionsByCard = {};
  actionsResult.forEach(action => {
    if (!actionsByCard[action.card_id]) actionsByCard[action.card_id] = [];
    actionsByCard[action.card_id].push({
      id: action.id,
      cardId: action.card_id,
      cardTitle: action.card_title,
      text: action.text,
      completedOn: action.completed_on,
      completedBy: action.completed_by
    });
  });
  
  // Group links by card
  const linksByCard = {};
  linksResult.forEach(link => {
    if (!linksByCard[link.card_id]) linksByCard[link.card_id] = [];
    linksByCard[link.card_id].push({
      id: link.id,
      cardId: link.card_id,
      title: link.title,
      url: link.url
    });
  });
  
  // Group logs by card
  const logsByCard = {};
  logsResult.rows.forEach(log => {
    const cardId = log.card_id || log.card_title;
    if (cardId) {
      if (!logsByCard[cardId]) logsByCard[cardId] = [];
      logsByCard[cardId].push({
        timestamp: log.timestamp,
        cardTitle: log.card_title,
        action: log.action,
        user: log.user_name,
        details: log.details,
        cardId: log.card_id
      });
    }
  });
  
  // Build complete cards with actions, links, and logs
  const cards = cardsResult.map(card => ({
    id: card.id,
    title: card.title,
    description: card.description,
    column: card.column,
    owner: card.owner,
    notes: card.notes,
    dealValue: parseFloat(card.deal_value) || 0,
    dateCreated: card.date_created,
    projectType: card.project_type,
    actions: actionsByCard[card.id] || [],
    links: linksByCard[card.id] || [],
    log: logsByCard[card.id] || []
  }));
  
  return {
    cards,
    people: peopleData.people,
    ownerColors: peopleData.ownerColors,
    projectTypeColors
  };
}
