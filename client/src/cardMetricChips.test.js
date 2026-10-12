import { getCardMetricChips } from './cardMetricChips';
import { todayIso } from './projectMetrics';

function isoDaysFromToday(n) {
  const [y, m, d] = todayIso().split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const chip = (card, key) => getCardMetricChips(card).find((c) => c.key === key);

describe('budget chip', () => {
  test('a budget cut to $0 after locking reads as drift from plan, not spend progress (#33)', () => {
    const card = {
      budget: [{ id: 1, amount: 0, actual: 0 }],
      budgetLocks: [{ items: [{ id: 1, amount: 5550000 }] }]
    };
    expect(chip(card, 'budget')).toMatchObject({ text: '-$5.5M vs plan', className: 'over' });
  });

  test('unchanged since the lock reads "on plan", whatever has been spent', () => {
    const card = {
      budget: [{ id: 1, amount: 100000, actual: 40000 }],
      budgetLocks: [{ items: [{ id: 1, amount: 100000 }] }]
    };
    expect(chip(card, 'budget')).toMatchObject({ text: 'on plan', className: '' });
  });

  test('growth over the lock is flagged with a plus sign', () => {
    const card = {
      budget: [{ id: 1, amount: 150000 }, { id: 2, isHeading: true, amount: 999 }],
      budgetLocks: [{ items: [{ id: 1, amount: 100000 }] }]
    };
    expect(chip(card, 'budget')).toMatchObject({ text: '+$50K vs plan', className: 'over' });
  });

  test('no lock yet shows the planned total', () => {
    expect(chip({ budget: [{ id: 1, amount: 250000 }] }, 'budget')).toMatchObject({ text: '$250K plan' });
  });
});

describe('timeline chip', () => {
  test('a slipped middle milestone shows even when the final one is on time (#33)', () => {
    const card = {
      timeline: [
        { id: 'a', type: 'milestone', name: 'Lobby Turnover', date: isoDaysFromToday(17) },
        { id: 'b', type: 'milestone', name: 'Full Handoff', date: isoDaysFromToday(50) }
      ],
      timelineLocks: [{ milestones: [
        { id: 'a', name: 'Lobby Turnover', date: isoDaysFromToday(14) },
        { id: 'b', name: 'Full Handoff', date: isoDaysFromToday(50) }
      ] }]
    };
    expect(chip(card, 'timeline')).toMatchObject({ text: '+3d late', className: 'over' });
    expect(chip(card, 'timeline').title).toMatch(/Lobby Turnover/);
  });

  test('on time against the lock shows days left, labeled', () => {
    const card = {
      timeline: [{ id: 'b', type: 'milestone', name: 'Full Handoff', date: isoDaysFromToday(50) }],
      timelineLocks: [{ milestones: [{ id: 'b', date: isoDaysFromToday(50) }] }]
    };
    expect(chip(card, 'timeline')).toMatchObject({ text: '50d left', className: '' });
  });

  test('no lock: days left to the last dated milestone; undated ones are ignored', () => {
    const card = {
      timeline: [
        { id: 'a', type: 'milestone', name: 'Operations Turnover', date: isoDaysFromToday(7) },
        { id: 'b', type: 'milestone', name: 'Full Turnover' }
      ]
    };
    expect(chip(card, 'timeline')).toMatchObject({ text: '7d left' });
  });

  test('past the last milestone reads overdue', () => {
    const card = { timeline: [{ id: 'a', type: 'milestone', date: isoDaysFromToday(-4) }] };
    expect(chip(card, 'timeline')).toMatchObject({ text: '4d overdue', className: 'over' });
  });
});
