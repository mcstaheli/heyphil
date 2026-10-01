// Migration: Improvements board upgrade, one-time data step.
//   1. Copy each card's screenshot from the old `screenshot` TEXT column
//      (a data:image/...;base64, URI) into `screenshot_data` (BYTEA) +
//      `screenshot_type`. Bytes are moved as-is (no re-encoding) and must
//      really be the image type they claim. The old column is NOT touched -
//      the app reads screenshot_data first and falls back to it, so this is
//      reversible; dropping the old column is a separate, later change.
//   2. Backfill resolved_at = updated_at for cards already in Shipped or
//      Abandoned (the closest record of when they closed).
//
// Needs the new columns, which improvements-db.js createTables() adds at
// server startup - run after deploying the board upgrade.
// Dry run by default; --apply to write, in one transaction. Idempotent.
//
// Usage:
//   node server/migrations/011-improvements-screenshots-to-bytea.js           # dry run
//   node server/migrations/011-improvements-screenshots-to-bytea.js --apply

import 'dotenv/config';
import pool from '../db.js';
import { sniffImageType } from '../improvement-rules.js';

const apply = process.argv.includes('--apply');

async function main() {
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'improvements' AND column_name IN ('screenshot_data', 'screenshot_type', 'resolved_at')`
  );
  if (cols.rows.length < 3) {
    console.error('The new improvements columns are not there yet - deploy the board upgrade first (the server adds them at startup).');
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      SELECT id, seq_num, screenshot FROM improvements
      WHERE screenshot IS NOT NULL AND screenshot_data IS NULL
      ORDER BY seq_num FOR UPDATE
    `);
    let converted = 0;
    let bytes = 0;
    const skipped = [];
    for (const row of rows) {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/s.exec(row.screenshot);
      const buffer = m ? Buffer.from(m[2], 'base64') : null;
      const type = buffer ? sniffImageType(buffer) : null;
      if (!type) {
        skipped.push(`#${row.seq_num} (${m ? `declared ${m[1]}, bytes aren't JPEG/PNG/WebP` : 'not a data:image URI'})`);
        continue;
      }
      if (apply) {
        await client.query('UPDATE improvements SET screenshot_data = $2, screenshot_type = $3 WHERE id = $1', [row.id, buffer, type]);
      }
      converted += 1;
      bytes += buffer.length;
    }

    const resolved = await client.query(`
      ${apply ? 'UPDATE improvements SET resolved_at = updated_at' : 'SELECT id FROM improvements'}
      WHERE status IN ('shipped', 'abandoned') AND resolved_at IS NULL
      ${apply ? 'RETURNING id' : ''}
    `);

    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    const verb = apply ? '' : 'would be ';
    console.log(`Screenshots ${verb}copied to screenshot_data: ${converted} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
    if (skipped.length) console.log(`Skipped (left as-is): ${skipped.join(', ')}`);
    console.log(`resolved_at ${verb}backfilled from updated_at: ${resolved.rowCount} card(s)`);
    if (!apply) console.log('\nDry run - re-run with --apply to write.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
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
