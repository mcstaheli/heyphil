import dotenv from 'dotenv';
import { readFileSync } from 'fs';
dotenv.config({ path: '../.env' });

import pool from './db.js';

async function migrate() {
  try {
    console.log('Running version column migration...');
    
    const sql = readFileSync('./add-version-column.sql', 'utf8');
    await pool.query(sql);
    
    console.log('✅ Version column migration complete!');
    console.log('   - Added version column to cards and actions');
    console.log('   - Created auto-increment triggers');
    console.log('   - Optimistic locking now active');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
