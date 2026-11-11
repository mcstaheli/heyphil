import { outputDelta, readAtLabel } from './resultsFormat';

test('outputDelta matches the server rules', () => {
  expect(outputDelta('percent', 0.159, 0.172).label).toBe('+1.3 pts');
  expect(outputDelta('multiple', 2.0, 1.85).label).toBe('−0.15x');
  expect(outputDelta('currency', 10000000, 10450000).label).toBe('+$450K');
  expect(outputDelta('currency', 10000000, 12500000).label).toBe('+$2.50M');
  expect(outputDelta('percent', 0.1, 0.1).label).toBe('-');
  expect(outputDelta('percent', '15.9%', 0.1)).toBeNull();
});

test('readAtLabel says where the numbers came from', () => {
  expect(readAtLabel({ source: 'live', readAt: '2026-11-11T21:31:00Z' })).toMatch(/^Live from Google Sheets, read /);
  expect(readAtLabel({ source: 'snapshot', readAt: '2026-11-11T21:31:00Z' })).toMatch(/^Snapshot saved when it was locked/);
  expect(readAtLabel(null)).toBe('');
});
