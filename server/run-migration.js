// Migration runner script
import pool from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration(filename) {
  const migrationPath = path.join(__dirname, 'migrations', filename);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  console.log(`\n📋 Running migration: ${filename}`);
  console.log('─'.repeat(60));
  
  try {
    await pool.query(sql);
    console.log(`✅ Migration completed successfully`);
    return true;
  } catch (error) {
    console.error(`❌ Migration failed:`, error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('\n🚀 Starting database migration...\n');
    
    // Get migration file from command line arg, or run all
    const targetMigration = process.argv[2];
    
    if (targetMigration) {
      // Run specific migration
      await runMigration(targetMigration);
    } else {
      // Run all migrations in order
      await runMigration('001-add-projects-table.sql');
      await runMigration('002-backfill-projects-from-cards.sql');
    }
    
    console.log('\n✅ All migrations completed!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

main();
