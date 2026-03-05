// Migration: Add deleted_at column to cards table
import pool from './db.js';

async function migrate() {
  try {
    console.log('Adding deleted_at column to cards table...');
    
    await pool.query(`
      ALTER TABLE cards 
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL
    `);
    
    console.log('✅ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
