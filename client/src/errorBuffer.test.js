import { recordError, getRecentErrors, clearRecentErrors, installErrorBuffer } from './errorBuffer';

beforeEach(() => clearRecentErrors());

test('keeps only the last 20, capped at 500 chars', () => {
  for (let i = 0; i < 25; i += 1) recordError('test', `e${i}`.padEnd(900, '.'), 's'.repeat(900));
  const errs = getRecentErrors();
  expect(errs).toHaveLength(20);
  expect(errs[0].message.startsWith('e5')).toBe(true);
  expect(errs[0].message).toHaveLength(500);
  expect(errs[0].stack).toHaveLength(500);
});

test('console.error is recorded and still reaches the original console', () => {
  const calls = [];
  const fakeWin = { addEventListener: jest.fn(), console: { error: (...a) => calls.push(a) } };
  installErrorBuffer(fakeWin);
  fakeWin.console.error('Boom', new Error('bad thing'));
  expect(calls).toHaveLength(1);
  const last = getRecentErrors().pop();
  expect(last.source).toBe('console.error');
  expect(last.message).toContain('Boom');
  expect(last.message).toContain('bad thing');
  expect(last.stack).toContain('bad thing');
  // window error + unhandledrejection listeners registered
  expect(fakeWin.addEventListener.mock.calls.map((c) => c[0])).toEqual(['error', 'unhandledrejection']);
});
