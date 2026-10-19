import { compareRequests, defaultDesigner, defaultRequester, formatBytes, stageAfterPosting, withCurrent } from './designOptions';

const people = [
  { name: 'Chad', email: 'chad@philo.ventures' },
  { name: 'Kallie Lowery', email: 'kallie@philo.ventures' },
  { name: 'Brett', email: null },
];

test('cards sort by priority, then oldest first', () => {
  const list = [
    { id: 'a', priority: 'normal', requestedAt: '2026-10-01' },
    { id: 'b', priority: 'urgent', requestedAt: '2026-10-05' },
    { id: 'c', priority: 'normal', requestedAt: '2026-09-01' },
    { id: 'd', priority: 'low', requestedAt: '2026-08-01' },
    { id: 'e', requestedAt: '2026-09-15' }, // no priority yet counts as normal
  ];
  expect([...list].sort(compareRequests).map((r) => r.id)).toEqual(['b', 'c', 'e', 'a', 'd']);
});

test('designer defaults to Kallie as she appears in People', () => {
  expect(defaultDesigner(people)).toBe('Kallie Lowery');
  expect(defaultDesigner([])).toBe('Kallie');
});

test('requester defaults to the signed-in person, matched by email then name', () => {
  expect(defaultRequester(people, { email: 'CHAD@philo.ventures', name: 'Chad Staheli' })).toBe('Chad');
  expect(defaultRequester(people, { email: 'other@x.com', name: 'Brett Smith' })).toBe('Brett'); // People has just "Brett"
  expect(defaultRequester(people, { email: 'other@x.com', name: 'Zed' })).toBe('');
  expect(defaultRequester(people, null)).toBe('');
});

test('withCurrent keeps a value that left the list', () => {
  expect(withCurrent(['A', 'B'], 'C')).toEqual(['A', 'B', 'C']);
  expect(withCurrent(['A', 'B'], 'A')).toEqual(['A', 'B']);
  expect(withCurrent(['A'], '')).toEqual(['A']);
});

test('formatBytes', () => {
  expect(formatBytes(500)).toBe('500 B');
  expect(formatBytes(2048)).toBe('2 KB');
  expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
});

test('stageAfterPosting: draft to In Review, final to Delivered', () => {
  expect(stageAfterPosting('draft', 'in-design')).toBe('in-review');
  expect(stageAfterPosting('draft', 'in-review')).toBeNull();
  expect(stageAfterPosting('draft', 'on-hold')).toBeNull();
  expect(stageAfterPosting('final', 'in-review')).toBe('delivered');
  expect(stageAfterPosting('comment', 'requested')).toBeNull();
});

test('requester never defaults to someone who only shares a first name', () => {
  const ppl = [{ name: 'Chad Smith', email: 'smith@x.com' }, { name: 'Greg', email: null }];
  expect(defaultRequester(ppl, { email: 'chad@philo.ventures', name: 'Chad Staheli' })).toBe('');
  expect(defaultRequester(ppl, { email: 'g@x.com', name: 'Greg Jones' })).toBe('Greg');
  expect(defaultRequester([{ name: 'Chad Staheli', email: null }], { email: 'c@x.com', name: 'chad staheli' })).toBe('Chad Staheli');
});
