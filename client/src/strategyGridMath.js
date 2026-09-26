// Board restructure Stage 4: pure math behind the Strategy Grid, split out
// so it can be unit-tested with plain node --test (no React/JSX here) -
// see scripts/tests/strategyGridMath.test.js.

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
