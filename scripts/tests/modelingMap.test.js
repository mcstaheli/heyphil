import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMap, groupOutputs, outputDelta } from '../../server/modeling/map.js';
import { buildRows } from '../modeling/hospitality-map.mjs';

const H = ['Key', 'Kind', 'Target', 'Step', 'Level', 'Order', 'Question', 'Help', 'Type', 'Options', 'Show if', 'Notes'];

test('parseMap: the real Hospitality map parses cleanly', () => {
  const m = parseMap(buildRows());
  assert.deepEqual(m.problems, []);
  assert.equal(m.steps.length, 12);
  assert.equal(m.steps[0].key, 'basics');
  assert.ok(m.inputs.length >= 80);
  assert.equal(m.outputs.length, 44);
  assert.equal(m.inputs[0].step, 'basics'); // inputs follow step order
  assert.equal(m.outputs.filter((o) => o.level === 'headline').length, 13);
  assert.deepEqual([...new Set(m.outputs.map((o) => o.group))], ['Returns', 'Capital', 'Operations', 'Debt', 'Exit', 'Checks']);
  const target = m.inputs.find((i) => i.kind === 'target' && i.key === 'target_adr');
  assert.equal(target.target, 'in_adr_adjustment');
  assert.equal(target.options, 'out_stab_adr');
});

test('parseMap: blank rows skipped; bad kinds, bad targets and duplicates reported', () => {
  const m = parseMap([H,
    ['s1', 'step', '', 's1', '', '100', 'Basics', 'intro'],
    [],
    ['x', 'banana', 'in_x', 's1', 'quick', '10', 'Q'],
    ['in_a', 'input', 'in_a', 's1', 'quick', '10', 'A?'],
    ['in_a', 'input', 'in_a', 's1', 'quick', '20', 'A again?'],
    ['in_b', 'input', 'not a name!', 's1', 'quick', '30', 'B?'],
    ['out_c', 'output', 'out_c', 'Returns', 'headline', '10', 'C', '', 'percent'],
  ]);
  assert.equal(m.inputs.length, 1);
  assert.equal(m.outputs.length, 1);
  assert.equal(m.problems.length, 3);
  assert.match(m.problems.join(' '), /unknown kind/);
  assert.match(m.problems.join(' '), /appears twice/);
  assert.match(m.problems.join(' '), /no valid named range/);
});

test('parseMap: empty tab or missing columns', () => {
  assert.match(parseMap([]).problems[0], /empty/);
  assert.match(parseMap([['Key', 'Kind']]).problems[0], /empty/);
  assert.match(parseMap([['Key', 'Kind'], ['a', 'input']]).problems[0], /missing columns/);
});

test('groupOutputs: keeps map order, skips names the file lacks', () => {
  const outputs = [
    { key: 'a', name: 'out_a', group: 'Returns', level: 'headline', label: 'A', type: 'percent' },
    { key: 'b', name: 'out_b', group: 'Returns', level: 'detail', label: 'B', type: 'percent' },
    { key: 'c', name: 'out_c', group: 'Debt', level: 'headline', label: 'C', type: 'multiple' },
  ];
  const g = groupOutputs(outputs, { out_a: { display: '15.9%', raw: 0.159 }, out_c: { display: '1.30x', raw: 1.3 } });
  assert.deepEqual(g.map((x) => [x.name, x.items.map((i) => i.key)]), [['Returns', ['a']], ['Debt', ['c']]]);
  assert.equal(g[0].items[0].display, '15.9%');
});

test('outputDelta: points for percents, turns for multiples, short dollars', () => {
  assert.equal(outputDelta('percent', 0.159, 0.172).label, '+1.3 pts');
  assert.equal(outputDelta('multiple', 2.0, 1.85).label, '−0.15x');
  assert.equal(outputDelta('currency', 10000000, 10450000).label, '+$450K');
  assert.equal(outputDelta('currency', 10000000, 12500000).label, '+$2.50M');
  assert.equal(outputDelta('percent', 0.1, 0.1).label, '-');
  assert.equal(outputDelta('percent', 'n/a', 0.1), null);
});

test('outputDelta: no "$1000" or "$1000K" at the rounding edges', () => {
  assert.equal(outputDelta('currency', 0, 999.6).label, '+$1K');
  assert.equal(outputDelta('currency', 0, 999999).label, '+$1.00M');
  assert.equal(outputDelta('currency', 0, 999.4).label, '+$999');
});

test('server and client delta rules are the same code', async () => {
  const fs = await import('fs');
  const pick = (src) => src.slice(src.indexOf('  if (Math.abs(d) < 1e-9)'), src.indexOf('  return { value: d, label: `${sign}${abs.toLocaleString'));
  const server = fs.readFileSync(new URL('../../server/modeling/map.js', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../../client/src/modeling/resultsFormat.js', import.meta.url), 'utf8');
  assert.equal(pick(client), pick(server));
});
