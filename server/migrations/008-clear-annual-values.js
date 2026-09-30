// Migration: clear the old projects.annual_value numbers (set to NULL).
// The Deal Terms fields were removed and the Strategy Grid / board totals
// now take annual value from each project's Value ledger (grid-inputs.js),
// so these leftover numbers weren't shown anywhere - and were unwanted.
// Includes projects in the trash. Only annual_value changes; the column
// itself stays (dropping it would be a schema change).
//
// Dry run by default. Writes a backup of the cleared values to
// migrations/backups/ before applying. Idempotent: rows already NULL are
// skipped.
//
// Usage:
//   node server/migrations/008-clear-annual-values.js           # dry run
//   node server/migrations/008-clear-annual-values.js --apply

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';

const apply = process.argv.includes('--apply');

async function main() {
  const { rows } = await pool.query(
    `SELECT id, title, annual_value, deleted_at IS NOT NULL AS deleted
     FROM projects WHERE annual_value IS NOT NULL ORDER BY title`
  );

  if (rows.length === 0) {
    console.log('No annual values left to clear - nothing to do.');
    return;
  }

  console.log(`${apply ? 'Clearing' : 'Would clear'} annual_value on ${rows.length} project(s):`);
  rows.forEach((r) => console.log(`  ${r.title}${r.deleted ? ' (in trash)' : ''}: ${r.annual_value}`));

  if (!apply) {
    console.log('\nDry run - re-run with --apply to write.');
    return;
  }

  const backupDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `008-clear-annual-values-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(rows.map(({ id, title, annual_value }) => ({ id, title, annual_value })), null, 2));
  console.log(`\nBackup written: ${backupFile}`);

  const result = await pool.query(
    'UPDATE projects SET annual_value = NULL WHERE id = ANY($1::uuid[]) AND annual_value IS NOT NULL',
    [rows.map((r) => r.id)]
  );
  console.log(`Cleared ${result.rowCount} project(s).`);
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
