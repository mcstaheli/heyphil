import { darkenHex } from './colorUtils';

test('mixes a 6-digit hex 80% with black as plain rgb() (#34)', () => {
  expect(darkenHex('#48bb78')).toBe('rgb(58, 150, 96)');
  expect(darkenHex('#ffffff')).toBe('rgb(204, 204, 204)');
});

test('accepts 3-digit hex, no # and a custom amount', () => {
  expect(darkenHex('#fff')).toBe('rgb(204, 204, 204)');
  expect(darkenHex('f59e0b', 0.5)).toBe('rgb(123, 79, 6)');
});

test('never returns a CSS color function html2canvas cannot parse', () => {
  expect(darkenHex('#e5e7eb')).not.toMatch(/color\(|color-mix/);
});

test('leaves non-hex values untouched', () => {
  expect(darkenHex('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  expect(darkenHex(undefined)).toBe(undefined);
});
