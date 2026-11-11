// npm run check:modeling-sql - needs DATABASE_URL. The unit tests run
// without a database, so this is what catches SQL type errors before a push.
// Type-checks every SQL statement in server/modeling/db.js with PREPARE
// (parse + plan, never executed) and DEALLOCATE. No data is read or written.
import 'dotenv/config';
import fs from 'fs';
const { default: pool } = await import('../server/db.js');
const src = fs.readFileSync(new URL('../server/modeling/db.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('// ---------------------------------------------------------------- reads'));
// shared fragments used inside other statements, e.g. ${MODEL_SELECT}
const fragments = Object.fromEntries([...src.matchAll(/const (\w+) = `([\s\S]*?)`;/g)].map((m) => [m[1], m[2]]));
const expand = (sql) => sql.replace(/\$\{(\w+)\}/g, (all, name) => fragments[name] ?? all);
const stmts = [...body.matchAll(/(?:query|\.query)\(\s*(`[\s\S]*?`|'[^']*'|"[^"]*")/g)].map((m) => expand(m[1].slice(1, -1)));
const failStale = src.match(/(UPDATE modeling_operations SET status = 'failed'[\s\S]*?)`, \[STALE/)[1];
let bad = 0, n = 0;
const client = await pool.connect();
// Check against the schema as it will be AFTER this code's startup
// migration: apply SCHEMA_SQL inside a transaction that is always rolled
// back (Postgres DDL is transactional - nothing persists). Never wait for
// a lock: if the app is busy, fail and rerun.
const { SCHEMA_SQL } = await import('../server/modeling/db.js');
await client.query('BEGIN');
await client.query("SET LOCAL lock_timeout = '2s'");
await client.query(SCHEMA_SQL);
for (const sql of [...new Set(stmts), failStale]) {
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/.test(sql)) continue;
  n += 1;
  try {
    await client.query('SAVEPOINT s');
    await client.query(`PREPARE chk AS ${sql}`);
    await client.query('DEALLOCATE chk');
    await client.query('RELEASE SAVEPOINT s');
  } catch (e) {
    bad += 1;
    console.log('BAD:', e.message, '\n   ', sql.replace(/\s+/g, ' ').slice(0, 140));
    await client.query('ROLLBACK TO SAVEPOINT s');
  }
}
await client.query('ROLLBACK');
client.release(); await pool.end();
console.log(`${n} statements checked (against the new schema, applied and rolled back), ${bad} bad`);
process.exit(bad ? 1 : 0);
