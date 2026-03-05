// Database queries for Org Charts
import pool from './db.js';

// ========== CHARTS ==========

export async function getAllCharts(userEmail) {
  const result = await pool.query(`
    SELECT 
      id, name, owner, created_at, updated_at,
      (SELECT COUNT(*) FROM orgchart_nodes WHERE chart_id = orgcharts.id) as node_count,
      (SELECT COUNT(*) FROM orgchart_connections WHERE chart_id = orgcharts.id) as connection_count
    FROM orgcharts
    WHERE owner = $1
    ORDER BY updated_at DESC
  `, [userEmail]);
  return result.rows;
}

export async function getChartById(id, userEmail) {
  const result = await pool.query(
    'SELECT * FROM orgcharts WHERE id = $1 AND owner = $2',
    [id, userEmail]
  );
  return result.rows[0];
}

export async function createChart(id, name, owner) {
  const result = await pool.query(`
    INSERT INTO orgcharts (id, name, owner, created_at, updated_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    RETURNING *
  `, [id, name, owner]);
  return result.rows[0];
}

export async function updateChart(id, userEmail, updates) {
  await pool.query(
    'UPDATE orgcharts SET updated_at = NOW() WHERE id = $1 AND owner = $2',
    [id, userEmail]
  );
}

export async function deleteChart(id, userEmail) {
  // Delete nodes and connections first (cascading)
  await pool.query('DELETE FROM orgchart_nodes WHERE chart_id = $1', [id]);
  await pool.query('DELETE FROM orgchart_connections WHERE chart_id = $1', [id]);
  await pool.query('DELETE FROM orgcharts WHERE id = $1 AND owner = $2', [id, userEmail]);
}

// ========== NODES ==========

export async function getNodesByChartId(chartId) {
  const result = await pool.query(
    'SELECT * FROM orgchart_nodes WHERE chart_id = $1',
    [chartId]
  );
  return result.rows.map(row => ({
    id: row.node_id,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    text: row.text,
    color: row.color
  }));
}

export async function saveNodes(chartId, nodes) {
  // Delete all existing nodes for this chart
  await pool.query('DELETE FROM orgchart_nodes WHERE chart_id = $1', [chartId]);
  
  // Insert new nodes
  if (nodes.length > 0) {
    const values = [];
    const placeholders = [];
    let paramCount = 1;
    
    nodes.forEach((node, idx) => {
      placeholders.push(`($${paramCount}, $${paramCount+1}, $${paramCount+2}, $${paramCount+3}, $${paramCount+4}, $${paramCount+5}, $${paramCount+6}, $${paramCount+7})`);
      values.push(chartId, node.id, node.x, node.y, node.width, node.height, node.text, node.color);
      paramCount += 8;
    });
    
    await pool.query(
      `INSERT INTO orgchart_nodes (chart_id, node_id, x, y, width, height, text, color) 
       VALUES ${placeholders.join(', ')}`,
      values
    );
  }
}

// ========== CONNECTIONS ==========

export async function getConnectionsByChartId(chartId) {
  const result = await pool.query(
    'SELECT * FROM orgchart_connections WHERE chart_id = $1',
    [chartId]
  );
  return result.rows.map(row => {
    const conn = {
      id: row.connection_id,
      from: row.from_node,
      to: row.to_node,
      fromPort: row.from_port,
      toPort: row.to_port
    };
    if (row.label) conn.label = row.label;
    if (row.color) conn.color = row.color;
    if (row.style) conn.style = row.style;
    if (row.waypoints) conn.waypoints = row.waypoints;
    return conn;
  });
}

export async function saveConnections(chartId, connections) {
  // Delete all existing connections for this chart
  await pool.query('DELETE FROM orgchart_connections WHERE chart_id = $1', [chartId]);
  
  // Insert new connections
  if (connections.length > 0) {
    const values = [];
    const placeholders = [];
    let paramCount = 1;
    
    connections.forEach((conn, idx) => {
      placeholders.push(`($${paramCount}, $${paramCount+1}, $${paramCount+2}, $${paramCount+3}, $${paramCount+4}, $${paramCount+5}, $${paramCount+6}, $${paramCount+7}, $${paramCount+8})`);
      values.push(
        chartId, 
        conn.id, 
        conn.from, 
        conn.to, 
        conn.fromPort || null, 
        conn.toPort || null,
        conn.label || null,
        conn.color || null,
        conn.style || null
      );
      paramCount += 9;
    });
    
    await pool.query(
      `INSERT INTO orgchart_connections (chart_id, connection_id, from_node, to_node, from_port, to_port, label, color, style) 
       VALUES ${placeholders.join(', ')}`,
      values
    );
  }
}
