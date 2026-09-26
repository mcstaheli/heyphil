// Migration: restore the "Ideation" column that Stage 1's board restructure
// (003-restructure-columns.js) folded into On Deck. Ideation returns as its
// own stage, ranked before On Deck (see ORIGINATION_STAGE_ORDER in both
// board-db.js and client/src/boardStages.js).
//
// Uses 003's own backup file as input - every project whose PRE-migration
// status was 'ideation' moves back to 'ideation' now, but ONLY if it's
// still sitting exactly at 'on-deck' where 003 left it. A project someone's
// since moved forward for real is left alone - this restores a structural
// mistake, it doesn't undo genuine progress.
//
// Usage:
//   node server/migrations/004-restore-ideation-column.js <path-to-003-backup-file>

import 'dotenv/config';
import fs from 'fs';
import pool from '../db.js';

async function main() {
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error('Usage: node server/migrations/004-restore-ideation-column.js <path-to-003-backup-file>');
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  if (!Array.isArray(rows) || !rows.every((r) => r && typeof r.id === 'string' && typeof r.status === 'string')) {
    console.error(`${backupFile} doesn't look like a 003 backup file (expected an array of {id, status}).`);
    process.exit(1);
  }
  const ideationIds = rows.filter((r) => r.status === 'ideation').map((r) => r.id);
  if (ideationIds.length === 0) {
    console.log('No ideation rows found in that backup file - nothing to do.');
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // deleted_at IS NULL - a project already in the trash before 003 ever
    // ran shouldn't be pulled back into an active stage just because it
    // happens to match on id and status; restoreProject() only clears
    // deleted_at and never touches status, so a later un-trash would
    // otherwise resurrect it at 'ideation' with no one having decided that.
    const result = await client.query(
      `UPDATE projects SET status = 'ideation' WHERE id = ANY($1::uuid[]) AND status = 'on-deck' AND deleted_at IS NULL RETURNING id, title`,
      [ideationIds]
    );
    await client.query('COMMIT');
    console.log(`Restored ${result.rowCount} of ${ideationIds.length} project(s) to Ideation:`);
    result.rows.forEach((r) => console.log(`  ${r.title}`));

    const skippedIds = ideationIds.filter((id) => !result.rows.some((r) => r.id === id));
    if (skippedIds.length > 0) {
      console.log(`Skipped ${skippedIds.length} (no longer at on-deck - moved forward for real since):`, skippedIds);
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
