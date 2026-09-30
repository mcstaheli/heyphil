// Migration: re-date the 'Notes (migrated)' activity log entries that
// 006-notes-to-activity-log.js inserted. 006 left them at the time the
// migration ran, so every card's old notes sorted above newer real activity
// (logs are shown ORDER BY timestamp DESC).
//
// Each entry moves to when that card's notes were last edited - the newest
// log entry whose details mention "Notes updated" - falling back to the
// project's created_at when there's no such entry. Only the timestamp column
// changes. Idempotent: rows already at their target time are skipped.
//
// Dry run by default. Writes a backup of the original timestamps to
// migrations/backups/ before applying.
//
// Usage:
//   node server/migrations/007-redate-migrated-notes.js           # dry run
//   node server/migrations/007-redate-migrated-notes.js --apply

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';

const apply = process.argv.includes('--apply');

async function main() {
  const { rows } = await pool.query(`
    SELECT m.id, p.title, m.timestamp AS old_timestamp,
           coalesce(
             (SELECT max(l.timestamp) FROM activity_log l
               WHERE l.project_id = p.id AND l.details ILIKE '%Notes updated%'),
             p.created_at
           ) AS new_timestamp
    FROM activity_log m
    JOIN projects p ON p.id = m.project_id
    WHERE m.action = 'Notes (migrated)'
    ORDER BY p.title
  `);
  const changes = rows.filter((r) => r.new_timestamp && r.old_timestamp.getTime() !== r.new_timestamp.getTime());

  if (changes.length === 0) {
    console.log(`All ${rows.length} 'Notes (migrated)' entries are already at their target time - nothing to do.`);
    return;
  }

  console.log(`${apply ? 'Re-dating' : 'Would re-date'} ${changes.length} of ${rows.length} entries:`);
  changes.forEach((r) => console.log(`  #${r.id} ${r.title}: ${r.old_timestamp.toISOString()} -> ${r.new_timestamp.toISOString()}`));

  if (!apply) {
    console.log('\nDry run - re-run with --apply to write.');
    return;
  }

  const backupDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `007-redate-migrated-notes-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(changes.map(({ id, old_timestamp }) => ({ id, timestamp: old_timestamp })), null, 2));
  console.log(`\nBackup written: ${backupFile}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of changes) {
      await client.query('UPDATE activity_log SET timestamp = $1 WHERE id = $2', [r.new_timestamp, r.id]);
    }
    await client.query('COMMIT');
    console.log(`Updated ${changes.length} entr${changes.length === 1 ? 'y' : 'ies'}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
