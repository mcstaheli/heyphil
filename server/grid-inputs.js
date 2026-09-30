// Server copy of deriveGridInputs/monthsUntil (client/src/strategyGridMath.js)
// for the metric snapshots taken on every stage change (board-db.js), so
// the snapshot history records the same numbers the Strategy Grid plots.
// Kept as a copy because importing client/src from the server makes Node
// warn on every boot; scripts/tests/gridInputs.test.js checks the two agree.
//   annualValue       = Value ledger's planned total (vs latest lock)
//   capitalCommitted  = Budget ledger's planned total (vs latest lock)
//   monthsToFirstCash = whole months to the "First cash" milestone, 0 in Assets
// Missing pieces are null.

const ASSETS_STAGE = 'assets';

// "Today" for month counting, in the team's time zone - the server runs in
// UTC, so near midnight or a month boundary its own date can differ from
// what everyone's browser (and so the Strategy Grid) is using. Returned as
// a local-midnight Date for that calendar day, which is all monthsUntil reads.
export const BUSINESS_TIME_ZONE = 'America/Denver';

export function businessToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return new Date(get('year'), get('month') - 1, get('day'));
}

function sumLeaf(items, field) {
  return (items || []).filter((i) => !i.isHeading).reduce((sum, i) => sum + (Number(i[field]) || 0), 0);
}

function plannedTotal(items, locks) {
  const leaves = (items || []).filter((i) => i && !i.isHeading);
  if (leaves.length === 0) return null;
  const allLocks = locks || [];
  const latestLock = allLocks.length ? allLocks[allLocks.length - 1] : null;
  return latestLock ? sumLeaf(latestLock.items, 'amount') : sumLeaf(items, 'amount');
}

function firstCashDate(timeline) {
  const milestone = (timeline || []).find((t) => t && t.type === 'milestone' && t.firstCash && t.date);
  return milestone ? milestone.date : null;
}

export function monthsUntil(dateOnly, today = businessToday()) {
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const [y, m, d] = dateOnly.split('-').map(Number);
  let months = (y - today.getFullYear()) * 12 + (m - 1 - today.getMonth());
  if (d < today.getDate()) months -= 1;
  return Math.max(0, months);
}

export function deriveGridInputs(project, today = businessToday()) {
  const p = project || {};
  const status = p.column !== undefined ? p.column : p.status;
  return {
    annualValue: plannedTotal(p.value, p.valueLocks || p.value_locks),
    capitalCommitted: plannedTotal(p.budget, p.budgetLocks || p.budget_locks),
    monthsToFirstCash: status === ASSETS_STAGE ? 0 : monthsUntil(firstCashDate(p.timeline), today),
  };
}
