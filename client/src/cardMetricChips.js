import { summarizeLedger, computeTimelineMetrics } from './projectMetrics';
import { formatCompactMoney } from './formatMoney';

function hasLeafItems(items) {
  return (items || []).some((i) => !i.isHeading);
}

function latest(locks) {
  return locks && locks.length ? locks[locks.length - 1] : null;
}

// The board's mini-card chips. Value shows the goal (what we're aiming
// for) since that's motivating on its own. Budget and Timeline each say
// what their number is ("vs plan", "left", "late") - bare "-$5.5M" or
// "0d" chips read as spend progress or a countdown when they were
// neither (#33).
export function getCardMetricChips(card) {
  const chips = [];

  if (hasLeafItems(card.value)) {
    const { totalExpected } = summarizeLedger(card.value, latest(card.valueLocks));
    chips.push({ key: 'value', icon: '💰', text: formatCompactMoney(totalExpected), className: '', title: 'Target value' });
  }

  // Budget: the live plan against the last locked plan. Before a lock
  // there's no plan to drift from, so it just shows the planned total.
  // Any drift is flagged, down as well as up - a budget that quietly
  // shrank after locking is as worth a look as one that grew.
  if (hasLeafItems(card.budget)) {
    const lock = latest(card.budgetLocks);
    const { totalExpected: planned } = summarizeLedger(card.budget, null);
    if (lock) {
      const { totalExpected: locked } = summarizeLedger(lock.items, null);
      const drift = planned - locked;
      chips.push({
        key: 'budget',
        icon: '🎯',
        text: drift === 0 ? 'on plan' : `${drift > 0 ? '+' : ''}${formatCompactMoney(drift)} vs plan`,
        className: drift === 0 ? '' : 'over',
        title: `Budget ${formatCompactMoney(planned)} now, ${formatCompactMoney(locked)} when locked`
      });
    } else {
      chips.push({ key: 'budget', icon: '🎯', text: `${formatCompactMoney(planned)} plan`, className: '', title: 'Planned budget (not locked yet)' });
    }
  }

  // Timeline: the worst-slipped locked milestone if any has slipped,
  // otherwise the days left to the furthest-out live milestone.
  const hasTimeline = (card.timeline || []).some((t) => t.type === 'milestone' && t.date);
  if (hasTimeline) {
    const { comparisons, daysRemaining, finalLiveMilestone } = computeTimelineMetrics(card.timeline, card.timelineLocks);
    const worst = comparisons.length
      ? comparisons.reduce((a, b) => (b.slippageDays > a.slippageDays ? b : a))
      : null;
    if (worst && worst.slippageDays > 0) {
      chips.push({
        key: 'timeline',
        icon: '📅',
        text: `+${worst.slippageDays}d late`,
        className: 'over',
        title: `${worst.name || 'A milestone'} is ${worst.slippageDays} day${worst.slippageDays === 1 ? '' : 's'} later than locked`
      });
    } else if (daysRemaining !== null) {
      const target = finalLiveMilestone && finalLiveMilestone.name ? finalLiveMilestone.name : 'the last milestone';
      chips.push({
        key: 'timeline',
        icon: '📅',
        text: daysRemaining < 0 ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d left`,
        className: daysRemaining < 0 ? 'over' : '',
        title: daysRemaining < 0 ? `${target} was ${Math.abs(daysRemaining)} days ago` : `${daysRemaining} days to ${target}`
      });
    }
  }

  return chips;
}
