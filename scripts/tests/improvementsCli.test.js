import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, CliUsageError } from '../lib/improvements-cli.js';

const REPO = 'https://github.com/mcstaheli/heyphil';
const parse = (s) => parseCliArgs(s.split(' ').filter(Boolean), { repoUrl: REPO });

test('list: open by default, or all, or a status (short names ok)', () => {
  assert.deepEqual(parse('list'), { command: 'list', filter: 'open' });
  assert.deepEqual(parse('list all'), { command: 'list', filter: 'all' });
  assert.deepEqual(parse('list shipped'), { command: 'list', filter: 'shipped' });
  assert.deepEqual(parse('list bugs'), { command: 'list', filter: 'triaged-bugs' });
  assert.throws(() => parse('list nonsense'), CliUsageError);
});

test('show: a card number, "#12" ok', () => {
  assert.deepEqual(parse('show 12'), { command: 'show', seqNum: 12 });
  assert.deepEqual(parse('show #12'), { command: 'show', seqNum: 12 });
  assert.throws(() => parse('show'), /card number/);
  assert.throws(() => parse('show abc'), /card number/);
});

test('move: status plus optional fields, both --flag value and --flag=value', () => {
  assert.deepEqual(parseCliArgs(['move', '33', 'bugs', '--kind', 'bug', '--priority=high', '--note', 'Broken on Safari'], { repoUrl: REPO }), {
    command: 'move',
    seqNum: 33,
    updates: { status: 'triaged-bugs', kind: 'bug', priority: 'high', classificationNote: 'Broken on Safari' },
  });
});

test('move: --commit takes a sha (-> commit link) or a full URL', () => {
  assert.equal(parse('move 5 shipped --commit 8f2e8e0').updates.prUrl, `${REPO}/commit/8f2e8e0`);
  assert.equal(parse('move 5 shipped --commit https://github.com/x/y/pull/3').updates.prUrl, 'https://github.com/x/y/pull/3');
  assert.throws(() => parse('move 5 shipped --commit nothex!'), /commit/);
});

test('move: --duplicate-of N, or none to clear; --kind none clears the kind', () => {
  assert.equal(parse('move 9 abandoned --duplicate-of 4').updates.duplicateOf, 4);
  assert.equal(parse('move 9 abandoned --duplicate-of #4').updates.duplicateOf, 4);
  assert.equal(parse('move 9 abandoned --duplicate-of none').updates.duplicateOf, null);
  assert.equal(parse('move 9 intake --kind none').updates.kind, null);
});

test('move: the status may be omitted only if some field is given ("-" keeps the status)', () => {
  assert.deepEqual(parse('move 9 - --priority low').updates, { priority: 'low' });
  assert.throws(() => parse('move 9 -'), /nothing to change/);
});

test('move: bad input is a usage error, not a half-applied change', () => {
  assert.throws(() => parse('move 9 limbo'), /status/);
  assert.throws(() => parse('move 9 bugs --kind epic'), /kind/);
  assert.throws(() => parse('move 9 bugs --priority urgent'), /priority/);
  assert.throws(() => parse('move 9 bugs --colour red'), /Unknown option --colour/);
  assert.throws(() => parse('move 9 bugs --note'), /needs a value/);
  assert.throws(() => parse('move 9 bugs extra'), /Unexpected argument/);
  assert.throws(() => parse('move'), /card number/);
});

test('unknown or missing command -> usage error', () => {
  assert.throws(() => parse(''), CliUsageError);
  assert.throws(() => parse('frobnicate'), /Unknown command/);
});

test('card numbers are plain digits only', () => {
  assert.throws(() => parse('show 0x10'), /card number/);
  assert.throws(() => parse('show 1e1'), /card number/);
  assert.throws(() => parse('move 9 abandoned --duplicate-of 0x4'), /card number/);
});

test('a note may start with "--" as long as it isn\'t an option name', () => {
  assert.equal(parseCliArgs(['move', '9', 'bugs', '--note', '--kind flag was wrong'], { repoUrl: REPO }).updates.classificationNote, '--kind flag was wrong');
  assert.throws(() => parseCliArgs(['move', '9', 'bugs', '--note', '--priority'], { repoUrl: REPO }), /needs a value/);
});
