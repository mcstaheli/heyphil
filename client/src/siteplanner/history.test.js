import { changedKeys, createHistory } from './history';

test('undo and redo step through snapshots', () => {
  const h = createHistory({ mergeMs: 0 });
  const a = { n: 1 };
  const b = { n: 2 };
  const c = { n: 3 };
  h.record(a, 'n', 0);
  h.record(b, 'n', 10);
  expect(h.undo(c)).toBe(b);
  expect(h.undo(b)).toBe(a);
  expect(h.undo(a)).toBeNull();
  expect(h.redo(a)).toBe(b);
  expect(h.redo(b)).toBe(c);
  expect(h.canRedo()).toBe(false);
});

test('changes to the same thing close together are one step; a new change clears redo', () => {
  const h = createHistory({ mergeMs: 800 });
  h.record({ v: 0 }, 'len', 0);
  h.record({ v: 1 }, 'len', 300);
  h.record({ v: 2 }, 'len', 600);
  expect(h.undo({ v: 3 })).toEqual({ v: 0 });
  expect(h.canUndo()).toBe(false);
  h.record({ v: 0 }, 'a', 0);
  h.undo({ v: 1 });
  expect(h.canRedo()).toBe(true);
  h.record({ v: 0 }, 'b', 5000);
  expect(h.canRedo()).toBe(false);
});

test('history keeps the last steps only, and finds what changed', () => {
  const h = createHistory({ limit: 3, mergeMs: 0 });
  for (let i = 0; i < 10; i++) h.record({ i }, `k${i}`, i * 10);
  let n = 0;
  let cur = { i: 99 };
  for (;;) { const prev = h.undo(cur); if (!prev) break; cur = prev; n++; }
  expect(n).toBe(3);
  const s = [1];
  expect(changedKeys({ a: 1, b: s, c: 3 }, { a: 1, b: s, c: 4, d: 0 })).toEqual(['c', 'd']);
});
