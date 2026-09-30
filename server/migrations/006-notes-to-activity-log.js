// Migration: move each project's free-text Notes into its Activity Log, so
// the Notes field can come out of CardModal (Improvements #29) without that
// text becoming invisible.
//
// For every project with non-empty notes (soft-deleted ones too, so a later
// un-trash doesn't bring back a card whose notes can't be seen), inserts one
// activity_log row: action 'Notes (migrated)', details = the notes text.
// projects.notes itself is left untouched - nothing is deleted, so this is
// reversible by just deleting those log rows. Idempotent: a project that
// already has a 'Notes (migrated)' entry is skipped.
//
// Dry run by default (lists what it would do). Writes a backup of every
// project's notes to migrations/backups/ before applying.
//
// Usage:
//   node server/migrations/006-notes-to-activity-log.js           # dry run
//   node server/migrations/006-notes-to-activity-log.js --apply

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';

const ACTION = 'Notes (migrated)';
const apply = process.argv.includes('--apply');

async function main() {
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.notes, p.deleted_at IS NOT NULL AS deleted
     FROM projects p
     WHERE coalesce(trim(p.notes), '') <> ''
       AND NOT EXISTS (SELECT 1 FROM activity_log l WHERE l.project_id = p.id AND l.action = $1)
     ORDER BY p.title`,
    [ACTION]
  );

  if (rows.length === 0) {
    console.log('No projects with un-migrated notes - nothing to do.');
    return;
  }

  console.log(`${apply ? 'Migrating' : 'Would migrate'} notes for ${rows.length} project(s):`);
  rows.forEach((r) => console.log(`  ${r.title}${r.deleted ? ' (in trash)' : ''} - ${r.notes.length} chars`));

  if (!apply) {
    console.log('\nDry run - re-run with --apply to write.');
    return;
  }

  const backupDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `006-notes-to-activity-log-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(rows.map(({ id, title, notes }) => ({ id, title, notes })), null, 2));
  console.log(`\nBackup written: ${backupFile}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        'INSERT INTO activity_log (project_id, action, user_name, details) VALUES ($1, $2, NULL, $3)',
        [r.id, ACTION, r.notes]
      );
    }
    await client.query('COMMIT');
    console.log(`Inserted ${rows.length} '${ACTION}' activity log entr${rows.length === 1 ? 'y' : 'ies'}.`);
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
