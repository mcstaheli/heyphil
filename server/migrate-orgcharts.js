// Migration: Create org charts tables
import pool from './db.js';

async function migrate() {
  try {
    console.log('Creating org charts tables...');
    
    // Create orgcharts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orgcharts (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        owner VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created orgcharts table');
    
    // Create orgchart_nodes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orgchart_nodes (
        id SERIAL PRIMARY KEY,
        chart_id VARCHAR(255) REFERENCES orgcharts(id) ON DELETE CASCADE,
        node_id BIGINT NOT NULL,
        x FLOAT NOT NULL,
        y FLOAT NOT NULL,
        width FLOAT NOT NULL,
        height FLOAT NOT NULL,
        text TEXT,
        color VARCHAR(50)
      )
    `);
    console.log('✅ Created orgchart_nodes table');
    
    // Create orgchart_connections table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orgchart_connections (
        id SERIAL PRIMARY KEY,
        chart_id VARCHAR(255) REFERENCES orgcharts(id) ON DELETE CASCADE,
        connection_id BIGINT NOT NULL,
        from_node BIGINT NOT NULL,
        to_node BIGINT NOT NULL,
        from_port VARCHAR(50),
        to_port VARCHAR(50),
        label TEXT,
        color VARCHAR(50),
        style VARCHAR(50)
      )
    `);
    console.log('✅ Created orgchart_connections table');
    
    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orgchart_nodes_chart_id ON orgchart_nodes(chart_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orgchart_connections_chart_id ON orgchart_connections(chart_id)
    `);
    console.log('✅ Created indexes');
    
    console.log('✅ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
