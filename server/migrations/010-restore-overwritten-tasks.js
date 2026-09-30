// Migration: restore task text overwritten by the board inline-edit bug
// fixed in 8f2e8e0 (editing task #N on one card saved the typed text onto
// task #N of every visible card). Originals come from the board as it
// looked in the Improvements #32 snapshot, taken before the overwrite;
// each task's starred flag was untouched by the bug and matches.
//
// Only rewrites a task if it STILL has the overwritten text, so a task
// someone has since fixed by hand is left alone. Wasatch (Christensen)
// task #1 was also overwritten, but its original isn't visible in any
// snapshot - not restored here.
//
// Dry run by default; --apply to write. Idempotent.
//
// Usage:
//   node server/migrations/010-restore-overwritten-tasks.js           # dry run
//   node server/migrations/010-restore-overwritten-tasks.js --apply

import 'dotenv/config';
import pool from '../db.js';

const apply = process.argv.includes('--apply');

const RESTORES = [
  { title: 'Addax Outdoors', taskId: 1, overwritten: 'Button up equity raise', original: '1MM in Trailers sold this week' },
  { title: 'Hospitality Fund', taskId: 1, overwritten: 'Button up equity raise', original: 'Call Braiden and give an update' },
  { title: 'Hospitality Management', taskId: 1, overwritten: 'Button up equity raise', original: 'Cash position confidence by property' },
  { title: 'Kiwi Clean', taskId: 1, overwritten: 'Button up equity raise', original: 'Exercise Philo option' },
  { title: 'Red Lion', taskId: 2, overwritten: 'Lock up series brand', original: 'Hyatt pitch deck completed' },
  { title: 'Stillbrook Management', taskId: 1, overwritten: 'Button up equity raise', original: 'Draft Proposal for SV' },
  { title: 'Stillbrook Management', taskId: 2, overwritten: 'Lock up series brand', original: 'Conduct talent conversations' },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let changed = 0;
    for (const r of RESTORES) {
      const { rows } = await client.query(
        'SELECT id, tasks FROM projects WHERE title = $1 AND deleted_at IS NULL FOR UPDATE',
        [r.title]
      );
      if (rows.length !== 1) {
        console.log(`  SKIP ${r.title} #${r.taskId}: expected 1 live project with that title, found ${rows.length}`);
        continue;
      }
      const task = (rows[0].tasks || []).find((t) => Number(t.id) === r.taskId);
      if (!task || task.text !== r.overwritten) {
        console.log(`  SKIP ${r.title} #${r.taskId}: now "${task ? task.text : '(no such task)'}" - not the overwritten text`);
        continue;
      }
      console.log(`  ${apply ? 'RESTORE' : 'would restore'} ${r.title} #${r.taskId}: "${r.overwritten}" -> "${r.original}"`);
      if (apply) {
        await client.query(`
          UPDATE projects
          SET tasks = (
            SELECT jsonb_agg(
              CASE WHEN (task->>'id')::int = $2
                THEN jsonb_set(task, '{text}', to_jsonb($3::text))
                ELSE task END
            )
            FROM jsonb_array_elements(tasks) task
          )
          WHERE id = $1
        `, [rows[0].id, r.taskId, r.original]);
      }
      changed += 1;
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(apply ? `\nRestored ${changed} task(s).` : `\nDry run - ${changed} task(s) would be restored. Re-run with --apply to write.`);
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
