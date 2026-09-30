// Board restructure Stage 4: pure math behind the Strategy Grid, split out
// so it can be unit-tested with plain node --test (no React/JSX here) -
// see scripts/tests/strategyGridMath.test.js.

import { summarizeLedger } from './projectMetrics.js';

export const MONTHS_SPLIT = 24;
export const YIELD_SPLIT = 0.08; // 8%

// null (not a number) when there's nothing committed yet - can't divide by
// zero/nothing, and a project with no capital committed has no yield to
// plot, not a 0% one.
export function computeYield(annualValue, capitalCommitted) {
  if (!capitalCommitted || capitalCommitted <= 0) return null;
  return (Number(annualValue) || 0) / capitalCommitted;
}

// Strictly greater than the split on both axes - a card sitting exactly on
// either line reads as "in mandate" rather than tipping into the flagged
// side, matching "split at" as a boundary a card must clear, not meet.
export function classifyQuadrant(months, yieldRatio) {
  const isLong = months > MONTHS_SPLIT;
  const isHigh = yieldRatio > YIELD_SPLIT;
  if (isLong && isHigh) return 'upper-right';
  if (!isLong && isHigh) return 'upper-left';
  if (isLong && !isHigh) return 'lower-right';
  return 'lower-left';
}

export function isOutOfMandate(months, yieldRatio) {
  return classifyQuadrant(months, yieldRatio) === 'upper-right';
}

export function isRightSide(months) {
  return months > MONTHS_SPLIT;
}

// The right side is acceptable only for passive (Assets) cards - this is
// its own exported/tested function rather than inlined at the call site,
// so a future rename of the terminal "producing now" stage id has to
// touch (and re-verify) one place, not silently break un-tested inline logic.
export const ASSETS_STAGE = 'assets';

export function isFlagged(months, status) {
  return isRightSide(months) && status !== ASSETS_STAGE;
}

// % of total capital committed (across every plotted point) that sits in
// projects at or under the months-to-first-cash split - the one headline
// number the grid surfaces. null with nothing plotted (nothing to be a
// percent of), not 0 or 100.
export function percentCapitalInLeftHalf(points) {
  const total = points.reduce((sum, p) => sum + (Number(p.capitalCommitted) || 0), 0);
  if (total <= 0) return null;
  const left = points
    .filter((p) => !isRightSide(p.monthsToFirstCash))
    .reduce((sum, p) => sum + (Number(p.capitalCommitted) || 0), 0);
  return (left / total) * 100;
}

// The grid's three inputs, derived from what a project already tracks
// (the old Annual Value / Capital Committed / Months to First Cash fields
// on Project Detail duplicated these and were removed):
//   annualValue      = Value ledger's planned total
//   capitalCommitted = Budget ledger's planned total
//   monthsToFirstCash = whole months from today to the Timeline milestone
//                       flagged "First cash" (0 once in Assets)
// "Planned total" is summarizeLedger's totalExpected against the latest
// lock - the same number the board's Value chip shows - so a project's
// numbers agree everywhere. Anything missing is null (not plotted), never
// 0. Accepts a board card (column, valueLocks...) or a projects row
// (status, value_locks...). server/grid-inputs.js mirrors this for the
// stage-change snapshots; scripts/tests/gridInputs.test.js checks they agree.
export function deriveGridInputs(project, today = new Date()) {
  const p = project || {};
  const status = p.column !== undefined ? p.column : p.status;
  return {
    annualValue: plannedTotal(p.value, p.valueLocks || p.value_locks),
    capitalCommitted: plannedTotal(p.budget, p.budgetLocks || p.budget_locks),
    monthsToFirstCash: status === ASSETS_STAGE ? 0 : monthsUntil(firstCashDate(p.timeline), today),
  };
}

function plannedTotal(items, locks) {
  const leaves = (items || []).filter((i) => i && !i.isHeading);
  if (leaves.length === 0) return null;
  const allLocks = locks || [];
  const latestLock = allLocks.length ? allLocks[allLocks.length - 1] : null;
  return summarizeLedger(items, latestLock).totalExpected;
}

function firstCashDate(timeline) {
  const milestone = (timeline || []).find((t) => t && t.type === 'milestone' && t.firstCash && t.date);
  return milestone ? milestone.date : null;
}

// Whole calendar months from `today` to a "yyyy-mm-dd" date, dropping a
// partial month (Sep 30 -> Mar 15 is 5), never negative (a first-cash date
// already past reads as 0, i.e. due now). null for a missing/bad date.
export function monthsUntil(dateOnly, today = new Date()) {
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const [y, m, d] = dateOnly.split('-').map(Number);
  let months = (y - today.getFullYear()) * 12 + (m - 1 - today.getMonth());
  if (d < today.getDate()) months -= 1;
  return Math.max(0, months);
}

// A project has at most one "First cash" milestone. Called by
// CustomTimeline's updateTask after `changedId` is edited: if that task is
// now a first-cash milestone, every other task loses the flag; if it's no
// longer a milestone at all, it loses the flag itself. Returns a new array.
export function enforceSingleFirstCash(tasks, changedId) {
  const changed = tasks.find((t) => t.id === changedId);
  if (!changed || !changed.firstCash) return tasks;
  if (changed.type !== 'milestone') {
    return tasks.map((t) => (t.id === changedId ? { ...t, firstCash: false } : t));
  }
  return tasks.map((t) => (t.id !== changedId && t.firstCash ? { ...t, firstCash: false } : t));
}
