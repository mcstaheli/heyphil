import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGridInputs, monthsUntil, enforceSingleFirstCash } from '../../client/src/strategyGridMath.js';
import * as server from '../../server/grid-inputs.js';

// Fixed "today" so month math is deterministic: Sep 30, 2026 (local).
const TODAY = new Date(2026, 8, 30);

const budget = [
  { id: 1, isHeading: true, name: 'Hard costs' },
  { id: 2, amount: 1500000, actual: 0 },
  { id: 3, amount: 500000, actual: 0 },
];
const value = [{ id: 1, amount: 240000, actual: 0 }];

test('monthsUntil: whole calendar months, partial month dropped, never negative', () => {
  assert.equal(monthsUntil('2027-03-15', TODAY), 5);  // Sep 30 -> Mar 15
  assert.equal(monthsUntil('2027-03-30', TODAY), 6);
  assert.equal(monthsUntil('2026-10-29', TODAY), 0);
  assert.equal(monthsUntil('2026-10-30', TODAY), 1);
  assert.equal(monthsUntil('2026-01-01', TODAY), 0);  // already past
  assert.equal(monthsUntil(null, TODAY), null);
  assert.equal(monthsUntil('not-a-date', TODAY), null);
});

test('deriveGridInputs: Budget total, Value total, flagged milestone', () => {
  const card = {
    column: 'build',
    budget, value,
    timeline: [
      { id: 'a', type: 'milestone', date: '2026-12-01', name: 'Permits' },
      { id: 'b', type: 'milestone', date: '2027-09-30', name: 'Open', firstCash: true },
    ],
  };
  assert.deepEqual(deriveGridInputs(card, TODAY), {
    annualValue: 240000,
    capitalCommitted: 2000000, // heading row ignored
    monthsToFirstCash: 12,
  });
});

test('deriveGridInputs: planned totals come from the latest lock when there is one', () => {
  const card = {
    column: 'build',
    budget: [{ id: 2, amount: 2500000 }], // live plan drifted up
    budgetLocks: [
      { lockedAt: '2026-01-01', items: [{ id: 2, amount: 1000000 }] },
      { lockedAt: '2026-06-01', items: [{ id: 2, amount: 1800000 }] },
    ],
    value: [{ id: 1, amount: 300000 }],
    valueLocks: [{ lockedAt: '2026-06-01', items: [{ id: 1, amount: 200000 }] }],
    timeline: [],
  };
  const r = deriveGridInputs(card, TODAY);
  assert.equal(r.capitalCommitted, 1800000);
  assert.equal(r.annualValue, 200000);
});

test('deriveGridInputs: missing pieces are null, not 0', () => {
  const r = deriveGridInputs({ column: 'build', budget: [], value: [{ id: 1, isHeading: true }], timeline: [
    { id: 'a', type: 'milestone', date: '2027-01-01' }, // no firstCash flag
    { id: 'b', type: 'task', start: '2027-01-01', end: '2027-02-01', firstCash: true }, // not a milestone
  ] }, TODAY);
  assert.deepEqual(r, { annualValue: null, capitalCommitted: null, monthsToFirstCash: null });
  assert.deepEqual(deriveGridInputs({}, TODAY), { annualValue: null, capitalCommitted: null, monthsToFirstCash: null });
});

test('deriveGridInputs: Assets is producing now - always 0 months', () => {
  const r = deriveGridInputs({ column: 'assets', budget, value, timeline: [] }, TODAY);
  assert.equal(r.monthsToFirstCash, 0);
});

test('deriveGridInputs: accepts the server row shape (status + snake_case locks)', () => {
  const row = {
    status: 'operate',
    budget, value,
    budget_locks: [], value_locks: [],
    timeline: [{ id: 'b', type: 'milestone', date: '2027-03-30', firstCash: true }],
  };
  assert.deepEqual(deriveGridInputs(row, TODAY), { annualValue: 240000, capitalCommitted: 2000000, monthsToFirstCash: 6 });
});

test('server and client grid inputs agree', () => {
  const cards = [
    { column: 'build', budget, value, timeline: [{ id: 'b', type: 'milestone', date: '2027-09-30', firstCash: true }] },
    { column: 'assets', budget, value, timeline: [] },
    { status: 'operate', budget, value, budget_locks: [{ items: [{ id: 2, amount: 7 }] }], timeline: [] },
    { column: 'build', budget: [{ id: 2, amount: 5 }], budgetLocks: [{ items: [{ id: 2, amount: 9 }] }] },
    {},
  ];
  for (const c of cards) {
    assert.deepEqual(server.deriveGridInputs(c, TODAY), deriveGridInputs(c, TODAY), JSON.stringify(c));
  }
  for (const d of ['2027-03-15', '2026-10-29', '2026-01-01', null, 'bad']) {
    assert.equal(server.monthsUntil(d, TODAY), monthsUntil(d, TODAY), String(d));
  }
});

test('enforceSingleFirstCash: flagging one milestone unflags the others', () => {
  const tasks = [
    { id: 'a', type: 'milestone', date: '2027-01-01', firstCash: true },
    { id: 'b', type: 'milestone', date: '2027-06-01', firstCash: true },
    { id: 'c', type: 'task', start: '2027-01-01', end: '2027-02-01' },
  ];
  const out = enforceSingleFirstCash(tasks, 'b');
  assert.equal(out.find((t) => t.id === 'a').firstCash, false);
  assert.equal(out.find((t) => t.id === 'b').firstCash, true);
  assert.equal(out.find((t) => t.id === 'c').firstCash, undefined); // untouched
  assert.equal(tasks[0].firstCash, true); // input not mutated
});

test('enforceSingleFirstCash: a task that is no longer a milestone loses the flag', () => {
  const tasks = [
    { id: 'a', type: 'milestone', date: '2027-01-01', firstCash: true },
    { id: 'b', type: 'event', date: '2027-06-01', firstCash: true },
  ];
  const out = enforceSingleFirstCash(tasks, 'b');
  assert.equal(out.find((t) => t.id === 'b').firstCash, false);
  assert.equal(out.find((t) => t.id === 'a').firstCash, true); // b isn't a first-cash milestone, so a keeps it
});

test('enforceSingleFirstCash: unflagged edit changes nothing', () => {
  const tasks = [{ id: 'a', type: 'milestone', firstCash: true }, { id: 'b', type: 'milestone' }];
  assert.deepEqual(enforceSingleFirstCash(tasks, 'b'), tasks);
});

test('businessToday: the calendar day in Denver, whatever the server clock zone', () => {
  // 03:00 UTC on Oct 1 is still Sep 30 (9pm MDT) in Denver
  const d = server.businessToday(new Date('2026-10-01T03:00:00Z'));
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 8, 30]);
  // 18:00 UTC on Oct 1 is Oct 1 in Denver
  const e = server.businessToday(new Date('2026-10-01T18:00:00Z'));
  assert.deepEqual([e.getFullYear(), e.getMonth(), e.getDate()], [2026, 9, 1]);
});
