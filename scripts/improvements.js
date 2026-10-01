// Improvements board from the command line - what a Claude Code session
// uses for "triage" / "fix bug N" / "implement feature N" (see CLAUDE.md),
// instead of ad-hoc queries. Goes through server/improvements-db.js, so the
// same validation and resolved_at rules as the board apply.
//
//   npm run improvements -- list [open|all|<status>]
//   npm run improvements -- show <N>          (screenshot -> temp file path)
//   npm run improvements -- move <N> <status|-> [--kind] [--priority] [--note] [--commit] [--duplicate-of]
//
// Writes go straight to the database (DATABASE_URL), so an open board
// won't update live - refresh it.
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import pool from '../server/db.js';
import * as db from '../server/improvements-db.js';
import { CliUsageError, parseCliArgs, USAGE } from './lib/improvements-cli.js';

const RESOLVED = ['shipped', 'abandoned'];
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const HINT = { broken: 'Something is broken', idea: 'Idea or request', unsure: 'Not sure' };

function repoUrl() {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return url.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
  } catch (e) {
    return 'https://github.com/mcstaheli/heyphil';
  }
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');

function printList(items, filter) {
  const rows = items
    .filter((i) => (filter === 'all' ? true : filter === 'open' ? !RESOLVED.includes(i.status) : i.status === filter))
    .sort((a, b) => a.seqNum - b.seqNum);
  if (rows.length === 0) {
    console.log(`No cards (${filter}).`);
    return;
  }
  for (const i of rows) {
    const kind = i.kind || (i.reporterHint ? `hint:${i.reporterHint}` : 'unsorted');
    const dup = i.duplicateOf ? ` dup-of #${i.duplicateOf}` : '';
    console.log(`#${String(i.seqNum).padEnd(4)} ${i.status.padEnd(17)} ${i.priority.padEnd(6)} ${kind.padEnd(12)} ${i.hasScreenshot ? '📷' : '  '} ${i.title.slice(0, 70)}${dup}`);
  }
  console.log(`\n${rows.length} card(s) - ${filter}`);
}

async function show(seqNum) {
  const i = await db.getImprovementBySeqNum(seqNum);
  if (!i) throw new CliUsageError(`No card #${seqNum}`);
  const lines = [
    [`#${i.seqNum}`, i.title],
    ['status', i.status],
    ['kind', i.kind || '(unsorted)'],
    ['reporter hint', i.reporterHint ? HINT[i.reporterHint] : '-'],
    ['priority', i.priority],
    ['duplicate of', i.duplicateOf ? `#${i.duplicateOf}` : '-'],
    ['reported by', `${i.reporterName || '?'} <${i.reporterEmail || '?'}> on ${new Date(i.createdAt).toISOString()}`],
    ['page', i.pageUrl || '-'],
    ['commit (when reported)', i.commitSha || '-'],
    ['resolved at', i.resolvedAt ? new Date(i.resolvedAt).toISOString() : '-'],
    ['triage note', i.classificationNote || '-'],
    ['fix link', i.prUrl || '-'],
    ['id', i.id],
  ];
  for (const [k, v] of lines) console.log(`${k.padEnd(24)} ${v}`);
  console.log(`\nnote:\n${i.note || '(none)'}`);
  const ctx = i.context;
  if (ctx) {
    console.log(`\nviewport ${ctx.viewport ? `${ctx.viewport.width}x${ctx.viewport.height}` : '-'} · ${ctx.userAgent || '-'}`);
    const errs = ctx.errors || [];
    console.log(`JS errors before reporting: ${errs.length}`);
    for (const e of errs) console.log(`  [${e.time || '?'}] ${e.source || ''}: ${e.message}${e.stack ? `\n      ${e.stack.split('\n').slice(0, 3).join('\n      ')}` : ''}`);
  }
  if (i.hasScreenshot) {
    const shot = await db.getScreenshot(i.id);
    if (shot) {
      const file = path.join(os.tmpdir(), `heyphil-improvement-${i.seqNum}.${EXT[shot.type] || 'img'}`);
      fs.writeFileSync(file, shot.buffer);
      console.log(`\nscreenshot: ${file}`);
    }
  } else {
    console.log('\nscreenshot: (none)');
  }
}

async function move(seqNum, updates) {
  const before = await db.getImprovementBySeqNum(seqNum);
  if (!before) throw new CliUsageError(`No card #${seqNum}`);
  const after = await db.updateImprovement(before.id, updates);
  const changed = Object.keys(updates).map((k) => `${k}: ${JSON.stringify(before[k] ?? null)} -> ${JSON.stringify(after[k] ?? null)}`);
  console.log(`#${seqNum} updated\n  ${changed.join('\n  ')}`);
  if (before.resolvedAt?.toString() !== after.resolvedAt?.toString()) {
    console.log(`  resolvedAt: ${before.resolvedAt ? day(before.resolvedAt) : 'null'} -> ${after.resolvedAt ? day(after.resolvedAt) : 'null'}`);
  }
  console.log('(written to the database directly - refresh an open board to see it)');
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2), { repoUrl: repoUrl() });
  if (args.command === 'list') printList(await db.getAllImprovements(), args.filter);
  if (args.command === 'show') await show(args.seqNum);
  if (args.command === 'move') await move(args.seqNum, args.updates);
}

main()
  .catch((error) => {
    if (error instanceof CliUsageError || error instanceof db.ImprovementValidationError) {
      console.error(error.message === USAGE ? USAGE : `Error: ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error('Failed:', error);
      process.exitCode = 1;
    }
  })
  .finally(() => pool.end());
