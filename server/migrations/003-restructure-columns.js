// Migration: restructure the origination board's Kanban columns onto the
// new pipeline (Stage 1 of the board restructure).
//
//   ideation        -> on-deck
//   backlog         -> on-deck       (found live in the DB, not in any
//                                     rendered column today - same bucket
//                                     as ideation: pre-pipeline)
//   on-deck         -> on-deck
//   due-diligence   -> diligence
//   ic-diligence    -> diligence     (found on one trashed project - a
//                                     diligence variant, same target)
//   capitalization  -> capitalize
//   development     -> build
//   operations      -> operate
//   assets          -> assets
//   abandoned       -> exited
//   closed          -> exited
//
// Studio-board statuses (studio-*) and anything else not listed above are
// left untouched - this only rewrites the origination pipeline's values.
//
// Usage:
//   node server/migrations/003-restructure-columns.js            # apply
//   node server/migrations/003-restructure-columns.js --rollback <backup-file>
//
// Every apply run writes a timestamped backup of every affected row's
// (id, status) to migrations/backups/ BEFORE changing anything - that file
// is the rollback's only input, so don't delete it once you've applied.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, 'backups');

const STATUS_MAP = {
  ideation: 'on-deck',
  backlog: 'on-deck',
  'on-deck': 'on-deck',
  'due-diligence': 'diligence',
  'ic-diligence': 'diligence',
  capitalization: 'capitalize',
  development: 'build',
  operations: 'operate',
  assets: 'assets',
  abandoned: 'exited',
  closed: 'exited'
};

async function apply() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the rows we're about to touch for the duration of this
    // transaction - this migration runs once, by hand, but the app keeps
    // serving traffic while it does, and a card being dragged mid-migration
    // shouldn't be able to interleave with this write.
    const affected = await client.query(
      `SELECT id, status FROM projects WHERE status = ANY($1::text[]) FOR UPDATE`,
      [Object.keys(STATUS_MAP)]
    );

    if (affected.rows.length === 0) {
      console.log('No projects have a status this migration maps - nothing to do.');
      await client.query('ROLLBACK');
      return;
    }

    const backupFile = path.join(BACKUP_DIR, `003-restructure-columns-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(affected.rows, null, 2));
    console.log(`Backed up ${affected.rows.length} row(s) to ${backupFile}`);

    const beforeCounts = countBy(affected.rows, 'status');

    // Group the LOCKED rows' ids by their old status, and update by id -
    // not by re-scanning "WHERE status = oldStatus" - so this only ever
    // touches exactly the rows the FOR UPDATE above locked and the backup
    // file above recorded. A row that transitions into one of these
    // statuses from a concurrent request after the lock was taken (so it
    // was never backed up) is left alone for a future run instead of being
    // silently migrated with no way to roll it back.
    const idsByOldStatus = {};
    for (const row of affected.rows) {
      (idsByOldStatus[row.status] = idsByOldStatus[row.status] || []).push(row.id);
    }

    for (const [oldStatus, newStatus] of Object.entries(STATUS_MAP)) {
      if (oldStatus === newStatus) continue; // 'on-deck' -> 'on-deck', 'assets' -> 'assets': no-op
      const ids = idsByOldStatus[oldStatus];
      if (!ids || ids.length === 0) continue;
      const result = await client.query(
        `UPDATE projects SET status = $2 WHERE id = ANY($1::uuid[])`,
        [ids, newStatus]
      );
      if (result.rowCount > 0) {
        console.log(`  ${oldStatus} -> ${newStatus}: ${result.rowCount} row(s)`);
      }
    }

    await client.query('COMMIT');

    console.log('\nBefore:', beforeCounts);
    const after = await pool.query(
      `SELECT status, count(*) FROM projects WHERE id = ANY($1::uuid[]) GROUP BY status`,
      [affected.rows.map((r) => r.id)]
    );
    console.log('After: ', countBy(after.rows.map((r) => ({ status: r.status, count: Number(r.count) })), null, true));
    console.log(`\nDone. Rollback with: node server/migrations/003-restructure-columns.js --rollback ${backupFile}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function rollback(backupFile) {
  const rows = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Backup file is empty or malformed: ${backupFile}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let restored = 0;
    const skipped = [];
    for (const row of rows) {
      const expectedCurrent = STATUS_MAP[row.status];
      // Only restore a row if it's still sitting exactly where this
      // migration left it - if a real card move happened since (someone
      // dragged it forward through the new pipeline), blindly overwriting
      // status back to the pre-migration value would silently discard that
      // real progress with no warning.
      const result = await client.query(
        `UPDATE projects SET status = $2 WHERE id = $1 AND status = $3`,
        [row.id, row.status, expectedCurrent]
      );
      if (result.rowCount > 0) {
        restored += result.rowCount;
      } else {
        skipped.push(row.id);
      }
    }
    await client.query('COMMIT');
    console.log(`Restored ${restored} of ${rows.length} row(s) from ${backupFile}`);
    if (skipped.length > 0) {
      console.log(`Skipped ${skipped.length} row(s) that have since moved (left as-is):`, skipped);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function countBy(rows, key, alreadyCounted = false) {
  const counts = {};
  for (const row of rows) {
    if (alreadyCounted) {
      counts[row.status] = row.count;
    } else {
      counts[row[key]] = (counts[row[key]] || 0) + 1;
    }
  }
  return counts;
}

async function main() {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--rollback') {
      if (!args[1]) throw new Error('Usage: --rollback <backup-file>');
      await rollback(args[1]);
    } else {
      await apply();
    }
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

main();
