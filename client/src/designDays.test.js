import { designDaysBadge, calendarDaysBetween } from './designDays';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

test('counts calendar days, so late yesterday is 1d', () => {
  expect(calendarDaysBetween(at(2026, 10, 18, 23), at(2026, 10, 19, 8))).toBe(1);
  expect(calendarDaysBetween(at(2026, 10, 19, 1), at(2026, 10, 19, 23))).toBe(0);
});

test('open requests: ok, then amber at 7 days, red at 14', () => {
  const now = at(2026, 10, 19);
  expect(designDaysBadge({ status: 'requested', requestedAt: at(2026, 10, 15) }, now)).toMatchObject({ text: '4d', level: 'ok' });
  expect(designDaysBadge({ status: 'in-design', requestedAt: at(2026, 10, 12) }, now)).toMatchObject({ text: '7d', level: 'amber' });
  expect(designDaysBadge({ status: 'on-hold', requestedAt: at(2026, 10, 5) }, now)).toMatchObject({ text: '14d', level: 'red' });
});

test('delivered requests stop counting and show how long they took', () => {
  const badge = designDaysBadge(
    { status: 'delivered', requestedAt: at(2026, 10, 1), deliveredAt: at(2026, 10, 6) },
    at(2026, 10, 19)
  );
  expect(badge).toMatchObject({ days: 5, text: 'Delivered in 5d', level: 'done' });
});

test('no request date, no badge', () => {
  expect(designDaysBadge({ status: 'requested' })).toBeNull();
});
