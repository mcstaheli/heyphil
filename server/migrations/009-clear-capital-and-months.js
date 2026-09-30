// Migration: clear the old projects.capital_committed and
// months_to_first_cash numbers (set to NULL) - same reasoning as
// 008-clear-annual-values.js: the Strategy Grid now derives both from
// Budget and the Timeline's "First cash" milestone (grid-inputs.js), and
// nothing writes or shows these columns anymore. Includes projects in the
// trash. The columns themselves stay (dropping them would be a schema
// change).
//
// Dry run by default. Writes a backup of the cleared values to
// migrations/backups/ before applying. Idempotent: rows already NULL are
// skipped.
//
// Usage:
//   node server/migrations/009-clear-capital-and-months.js           # dry run
//   node server/migrations/009-clear-capital-and-months.js --apply

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';

const apply = process.argv.includes('--apply');

async function main() {
  const { rows } = await pool.query(
    `SELECT id, title, capital_committed, months_to_first_cash, deleted_at IS NOT NULL AS deleted
     FROM projects WHERE capital_committed IS NOT NULL OR months_to_first_cash IS NOT NULL ORDER BY title`
  );

  if (rows.length === 0) {
    console.log('No capital committed / months to first cash values left to clear - nothing to do.');
    return;
  }

  console.log(`${apply ? 'Clearing' : 'Would clear'} capital_committed / months_to_first_cash on ${rows.length} project(s):`);
  rows.forEach((r) => console.log(`  ${r.title}${r.deleted ? ' (in trash)' : ''}: capital ${r.capital_committed}, months ${r.months_to_first_cash}`));

  if (!apply) {
    console.log('\nDry run - re-run with --apply to write.');
    return;
  }

  const backupDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `009-clear-capital-and-months-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(rows.map(({ id, title, capital_committed, months_to_first_cash }) => ({ id, title, capital_committed, months_to_first_cash })), null, 2));
  console.log(`\nBackup written: ${backupFile}`);

  const result = await pool.query(
    `UPDATE projects SET capital_committed = NULL, months_to_first_cash = NULL
     WHERE id = ANY($1::uuid[]) AND (capital_committed IS NOT NULL OR months_to_first_cash IS NOT NULL)`,
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
