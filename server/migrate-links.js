import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import pool from './db.js';

async function migrate() {
  try {
    console.log('Creating links table...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS links (
        id SERIAL PRIMARY KEY,
        card_id VARCHAR(255) NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('Creating index on card_id...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_links_card_id ON links(card_id);
    `);
    
    console.log('Creating trigger for updated_at...');
    await pool.query(`
      DROP TRIGGER IF EXISTS update_links_updated_at ON links;
    `);
    await pool.query(`
      CREATE TRIGGER update_links_updated_at BEFORE UPDATE ON links
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    
    console.log('✅ Links table migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
