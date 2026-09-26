// Migration: restore the "Abandoned" column that Stage 1's board
// restructure (003-restructure-columns.js) folded into Exited. Abandoned
// returns as its own terminal stage, ranked just before Exited (see
// ORIGINATION_STAGE_ORDER in both board-db.js and client/src/boardStages.js) -
// same "restore exactly what moved, only if nothing's changed since"
// approach as migrations/004-restore-ideation-column.js.
//
// Uses 003's own backup file as input - every project whose PRE-migration
// status was 'abandoned' moves back to 'abandoned' now, but ONLY if it's
// still sitting exactly at 'exited' where 003 left it, and isn't
// soft-deleted (a trashed project shouldn't be pulled back into an active
// stage - restoreProject() only clears deleted_at and never touches
// status, so this avoids resurrecting a stale status on a later un-trash).
//
// Usage:
//   node server/migrations/005-restore-abandoned-column.js <path-to-003-backup-file>

import 'dotenv/config';
import fs from 'fs';
import pool from '../db.js';

async function main() {
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error('Usage: node server/migrations/005-restore-abandoned-column.js <path-to-003-backup-file>');
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  if (!Array.isArray(rows) || !rows.every((r) => r && typeof r.id === 'string' && typeof r.status === 'string')) {
    console.error(`${backupFile} doesn't look like a 003 backup file (expected an array of {id, status}).`);
    process.exit(1);
  }
  const abandonedIds = rows.filter((r) => r.status === 'abandoned').map((r) => r.id);
  if (abandonedIds.length === 0) {
    console.log('No abandoned rows found in that backup file - nothing to do.');
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE projects SET status = 'abandoned' WHERE id = ANY($1::uuid[]) AND status = 'exited' AND deleted_at IS NULL RETURNING id, title`,
      [abandonedIds]
    );
    await client.query('COMMIT');
    console.log(`Restored ${result.rowCount} of ${abandonedIds.length} project(s) to Abandoned:`);
    result.rows.forEach((r) => console.log(`  ${r.title}`));

    const skippedIds = abandonedIds.filter((id) => !result.rows.some((r) => r.id === id));
    if (skippedIds.length > 0) {
      console.log(`Skipped ${skippedIds.length} (no longer at exited, or soft-deleted):`, skippedIds);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
