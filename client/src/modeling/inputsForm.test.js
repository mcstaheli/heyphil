import { visibleFields, isShown, toEditValue, fromEditValue, parseGridSpec, answerFor, sheetValues } from './inputsForm';

const F = (key, level, kind = 'input', extra = {}) => ({ key, level, kind, type: 'currency', ...extra });

test('levels: Quick = quick only (incl. targets); Standard adds standard; Everything = all but the targets', () => {
  const fields = [F('a', 'quick'), F('t', 'quick', 'target'), F('b', 'standard'), F('c', 'detail')];
  expect(visibleFields(fields, 'quick').map((f) => f.key)).toEqual(['a', 't']);
  expect(visibleFields(fields, 'standard').map((f) => f.key)).toEqual(['a', 'b']);
  expect(visibleFields(fields, 'detail').map((f) => f.key)).toEqual(['a', 'b', 'c']);
});

test('show-if rules: =, != and numbers', () => {
  const fields = [F('in_method'), F('in_keys')];
  const cur = { in_method: 'Target Loan-to-Cost', in_keys: 0 };
  expect(isShown({ showIf: 'in_method=Target Loan-to-Cost' }, cur, fields)).toBe(true);
  expect(isShown({ showIf: 'in_method=Loan Amount (manual)' }, cur, fields)).toBe(false);
  expect(isShown({ showIf: 'in_keys!=0' }, cur, fields)).toBe(false);
  expect(isShown({ showIf: 'in_keys!=0' }, { ...cur, in_keys: 12 }, fields)).toBe(true);
  // sheet units: a percent rule is written as the sheet holds it
  expect(isShown({ showIf: 'in_keys=0.65' }, { in_keys: 0.65 }, fields)).toBe(true);
  expect(isShown({ showIf: 'in_keys=2026-03-01' }, { in_keys: '2026-03-01' }, fields)).toBe(true);
  expect(isShown({ showIf: 'unknown=1' }, cur, fields)).toBe(true);
  expect(isShown({}, cur, fields)).toBe(true);
});

test('edit values: percents as 25, months as YYYY-MM, tables by column type - and back', () => {
  expect(toEditValue({ kind: 'input', type: 'percent', raw: 0.0375 })).toBe('3.75');
  expect(fromEditValue({ kind: 'input', type: 'percent' }, '3.75')).toBeCloseTo(0.0375);
  expect(toEditValue({ kind: 'input', type: 'month', raw: '2026-11-01' })).toBe('2026-11');
  expect(toEditValue({ kind: 'input', type: 'currency', raw: 7000000 })).toBe('7000000');
  expect(toEditValue({ kind: 'input', type: 'currency', raw: null })).toBe('');
  const list = { kind: 'list', type: 'percent', raw: [[0.6], [0.725]] };
  expect(toEditValue(list)).toEqual([['60'], ['72.5']]);
  expect(fromEditValue(list, [['60'], ['75']])).toEqual([0.6, 0.75]);
  const grid = { kind: 'grid', options: 'C:Cat:label|D:Method:choice:A|B|E:Value:percent', raw: [['Rooms', 'A', 0.27]] };
  expect(toEditValue(grid)).toEqual([['Rooms', 'A', '27']]);
  expect(fromEditValue(grid, [['Rooms', 'B', '30']])).toEqual([['Rooms', 'B', 0.3]]);
});

test('grid spec parsing matches the server', () => {
  const s = parseGridSpec('C:Category:choice:Rooms|F&B|D:Line item:text');
  expect(s.map((c) => c.col)).toEqual(['C', 'D']);
  expect(s[0].choices).toEqual(['Rooms', 'F&B']);
});

test('answerFor: tables send only changed cells; single inputs send their value', () => {
  const list = { kind: 'list', type: 'percent', raw: [[0.123456789], [0.5]] };
  const edit = toEditValue(list);
  expect(answerFor(list, edit)).toBeNull(); // untouched -> nothing (no rounding rewrite)
  edit[1] = ['55'];
  expect(answerFor(list, edit)).toEqual({ cells: { '1,0': 0.55 } });
  const grid = { kind: 'grid', options: 'C:Cat:label|D:Value:number', raw: [['Rooms', 1], ['F&B', 2]] };
  const g = toEditValue(grid);
  g[1][1] = '3';
  expect(answerFor(grid, g)).toEqual({ cells: { '1,1': '3' } });
  expect(answerFor({ kind: 'input', type: 'percent' }, '25')).toBeCloseTo(0.25);
});

test('sheetValues: edits applied in sheet units', () => {
  const fields = [{ key: 'a', kind: 'input', type: 'percent', raw: 0.1 }, { key: 'b', kind: 'input', type: 'currency', raw: 5 }];
  expect(sheetValues(fields, { a: '65' })).toEqual({ a: 0.65, b: 5 });
});
