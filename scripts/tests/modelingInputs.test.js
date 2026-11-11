import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGridSpec, cellsFor, coerce, planWrites, targetAdjustment, serialToMonth, toFieldLayout, a1, nextGuess, closeEnough } from '../../server/modeling/inputs.js';
import { ModelingError } from '../../server/modeling/rules.js';

const def = (sheet, startRow, endRow, startCol, endCol) => ({ sheet, startRow, endRow, startCol, endCol });

test('parseGridSpec: columns, types and choice lists that contain "|"', () => {
  const s = parseGridSpec('C:Category:choice:Rooms|F&B|Other|D:Line item:text|N:Hard or soft:choice:Hard|Soft');
  assert.deepEqual(s.map((c) => [c.col, c.label, c.type]), [['C', 'Category', 'choice'], ['D', 'Line item', 'text'], ['N', 'Hard or soft', 'choice']]);
  assert.deepEqual(s[0].choices, ['Rooms', 'F&B', 'Other']);
  assert.deepEqual(s[2].choices, ['Hard', 'Soft']);
});

test('cellsFor: single cell, a column list, a one-row list, and only a grid\'s input columns', () => {
  assert.deepEqual(cellsFor({ kind: 'input' }, def('Financial Model', 15, 16, 4, 5)).map((c) => c.range), ["'Financial Model'!E16"]);
  const list = cellsFor({ kind: 'list' }, def('Financial Model', 33, 45, 5, 6));
  assert.equal(list.length, 12);
  assert.equal(list[0].range, "'Financial Model'!F34");
  const row = cellsFor({ kind: 'list' }, def('Operations', 48, 49, 4, 12));
  assert.deepEqual([row[0].range, row[7].range], ["'Operations'!E49", "'Operations'!L49"]);
  const grid = cellsFor({ kind: 'grid', options: 'C:Category:label|D:Method:choice:a|b|E:Value:number' }, def('Operations', 26, 28, 2, 7));
  assert.equal(grid.length, 6);
  assert.deepEqual(grid.filter((c) => c.writable).map((c) => c.range), ["'Operations'!D27", "'Operations'!E27", "'Operations'!D28", "'Operations'!E28"]);
  assert.equal(a1("O'Brien", 0, 0), "'O''Brien'!A1");
});

test('coerce: numbers, whole numbers, percents, months, choices, text', () => {
  assert.equal(coerce('currency', '$7,000,000'), 7000000);
  assert.equal(coerce('integer', '51'), 51);
  assert.throws(() => coerce('integer', '51.5'), ModelingError);
  assert.equal(coerce('percent', 0.25), 0.25);
  assert.equal(coerce('percent', '25%'), 0.25);
  assert.equal(coerce('month', '2027-05'), '2027-05-01');
  assert.throws(() => coerce('month', '2027-13'), /month/);
  assert.equal(coerce('choice', 'Target Loan-to-Cost', { choices: ['Loan Amount (manual)', 'Target Loan-to-Cost'] }), 'Target Loan-to-Cost');
  assert.throws(() => coerce('choice', 'Nope', { choices: ['A'] }), /one of/);
  assert.equal(coerce('text', '=IMPORTXML(1)'), "'=IMPORTXML(1)"); // never a formula
  assert.equal(coerce('currency', ''), '');
  assert.throws(() => coerce('currency', 'abc'), /number/);
});

test('targetAdjustment: scales today\'s curve to hit the target', () => {
  assert.ok(Math.abs(targetAdjustment(176.15, 0, 160.14) - 0.1) < 0.001); // +10%
  assert.ok(Math.abs(targetAdjustment(176.15, 0.1, 176.15) - 0.1) < 0.001); // already there: unchanged
  assert.ok(Math.abs(targetAdjustment(160.14, 0.1, 176.15) - 0) < 0.001); // back to the base curve
  assert.throws(() => targetAdjustment(0, 0, 160), ModelingError);
  assert.throws(() => targetAdjustment(170, 0, null), /can't be read/);
});

test('serialToMonth / toFieldLayout', () => {
  assert.equal(serialToMonth(46327), '2026-11-01'); // Nov 2026
  assert.equal(serialToMonth('x'), 'x');
  const gridField = { kind: 'grid', options: 'D:Phase:text|F:Start:month' };
  assert.deepEqual(toFieldLayout(gridField, def('FM', 23, 25, 3, 7), [['A', null, 46327], ['B']]), [['A', '2026-11-01'], ['B', null]]);
  assert.deepEqual(toFieldLayout({ kind: 'list' }, def('Ops', 48, 49, 4, 7), [[0.06, 0.07, 0.08]]), [[0.06], [0.07], [0.08]]);
  assert.equal(toFieldLayout({ kind: 'input', type: 'month' }, def('FM', 7, 8, 4, 5), 46327), '2026-11-01');
});

test('planWrites: only changed cells, formulas kept unless overridden, tables write their input cells', () => {
  const fields = [
    { key: 'in_price', kind: 'input', type: 'currency', question: 'Price', cells: [{ range: "'FM'!E185", row: 0, col: 0, writable: true }], raw: 7000000, display: '$7,000,000', formula: false },
    { key: 'in_busy', kind: 'input', type: 'percent', question: 'Busy nights', cells: [{ range: "'FM'!E20", row: 0, col: 0, writable: true }], raw: 0.286, formula: true },
    { key: 'in_season', kind: 'list', type: 'percent', question: 'Season', cells: [0, 1, 2].map((r) => ({ range: `'FM'!E${34 + r}`, row: r, col: 0, writable: true })), raw: [[0.6], [0.7], [0.8]], formula: [[false], [false], [false]] },
    { key: 'in_grid', kind: 'grid', options: 'C:Cat:label|D:Value:number', question: 'Grid',
      cells: [{ range: "'O'!C27", row: 0, col: 0, writable: false }, { range: "'O'!D27", row: 0, col: 1, writable: true }, { range: "'O'!C28", row: 1, col: 0, writable: false }, { range: "'O'!D28", row: 1, col: 1, writable: true }],
      raw: [['Rooms', 1], ['F&B', 2]], formula: [[false, false], [false, true]] },
  ];
  const p = planWrites(fields, { in_price: '7,500,000', in_season: { cells: { '1,0': 0.75 } }, in_grid: { cells: { '0,1': 5, '0,0': 'X' } } });
  assert.deepEqual(p.cells, [
    { range: "'FM'!E185", value: 7500000 },
    { range: "'FM'!E35", value: 0.75 },
    { range: "'O'!D27", value: 5 }, // the label column is never written
  ]);
  assert.equal(p.changes.length, 3);
  assert.deepEqual(p.changes[1].cells, [{ row: 1, col: 0, from: null, to: 0.75 }]);
  // a changed formula cell in a table is refused, not silently skipped
  assert.throws(() => planWrites(fields, { in_grid: { cells: { '1,1': 9 } } }), /calculated by the model/);
  assert.deepEqual(planWrites(fields, { in_grid: { cells: { '1,1': 9 } } }, { in_grid: true }).cells, [{ range: "'O'!D28", value: 9 }]);
  // untouched cells aren't sent, so nothing else is rewritten
  assert.deepEqual(planWrites(fields, { in_season: { cells: {} } }).cells, []);
  assert.throws(() => planWrites(fields, { in_busy: 0.3 }), /calculated by the model/);
  assert.deepEqual(planWrites(fields, { in_busy: 0.3 }, { in_busy: true }).cells, [{ range: "'FM'!E20", value: 0.3 }]);
  assert.deepEqual(planWrites(fields, { in_price: 7000000 }).cells, []); // unchanged -> nothing
  assert.throws(() => planWrites(fields, { nope: 1 }), /isn't an input/);
});

test('cellsFor: a grid column outside the named range is never a cell', () => {
  const cells = cellsFor({ kind: 'grid', options: 'D:A:text|G:Outside:text' }, def('FM', 9, 11, 3, 6));
  assert.deepEqual([...new Set(cells.map((c) => c.range.replace(/\d+$/, '')))], ["'FM'!D"]);
});

test('toFieldLayout: month lists convert serials; tables are padded to the range', () => {
  assert.deepEqual(toFieldLayout({ kind: 'list', type: 'month' }, def('FM', 0, 3, 0, 1), [[46327]]), [['2026-11-01'], [null], [null]]);
  assert.deepEqual(toFieldLayout({ kind: 'grid', options: 'A:x:text|B:y:text' }, def('FM', 0, 2, 0, 2), [['a']]), [['a', null], [null, null]]);
});

test('goal seek: converges on a capped, non-linear model', () => {
  // occupancy that saturates: out = min-ish curve, like busy months capping at 100%
  const model = (adj) => 0.8 * (1 + adj) - 0.25 * Math.max(0, adj) ** 1.5;
  const target = 0.82;
  const points = [{ adj: 0, out: model(0) }];
  let adj = targetAdjustment(target, 0, model(0));
  for (let i = 0; i < 8; i += 1) {
    points.push({ adj, out: model(adj) });
    if (closeEnough(target, model(adj))) break;
    adj = nextGuess(target, points);
  }
  assert.ok(closeEnough(target, model(adj)), `ended at ${model(adj)}`);
  // within 0.05% of the target (0.82 -> +/-0.00041)
  assert.equal(closeEnough(0.82, 0.819), false);
  assert.equal(closeEnough(0.82, 0.8198), true);
  assert.equal(closeEnough(175, 175.05), true);
  assert.equal(closeEnough(175, 175.2), false);
});
