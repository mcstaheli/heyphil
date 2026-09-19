// Shared metric calculations for the Budget/Value ledgers and Timeline
// milestones - used by both the per-project detail view (LedgerModule,
// TimelineModule) and the cross-project Portfolio rollup, so the two are
// guaranteed to agree instead of risking two independent
// re-implementations quietly drifting apart.

// Milestone/lock dates are "yyyy-mm-dd" (date-only) strings. `new
// Date(iso)` parses those as UTC midnight, which in any US timezone is
// already the previous calendar day locally - so anything that floors to
// local midnight afterward (or compares against a real local Date) can
// silently land on the wrong day. Parsing as a local date first avoids it.
export function parseLocalDate(dateOnlyString) {
  const [year, month, day] = dateOnlyString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

// Signed day difference between two date-only strings - both get the
// same UTC-midnight parse, so the shift cancels and this stays correct
// without needing parseLocalDate itself.
export function daysBetween(fromIso, toIso) {
  const ms = new Date(toIso) - new Date(fromIso);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function todayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// Naming a lock is optional - unnamed ones just fall back to their timestamp.
export function lockLabel(lock) {
  return lock.name ? lock.name : `Locked ${formatDateTime(lock.lockedAt)}`;
}

function sumLeaf(items, field) {
  return (items || []).filter((i) => !i.isHeading).reduce((sum, i) => sum + (Number(i[field]) || 0), 0);
}

// The one place the expected/actual/delta math lives for Budget and
// Value alike - see LedgerModule for the UI that consumes it. `lock` is
// whichever lock the caller wants compared against; pass null/undefined
// to compare the live items against themselves (no baseline yet).
export function summarizeLedger(items, lock) {
  const totalExpected = lock ? sumLeaf(lock.items, 'amount') : sumLeaf(items, 'amount');
  const totalActual = sumLeaf(items, 'actual');
  const delta = totalActual - totalExpected;
  const deltaPct = totalExpected ? (delta / totalExpected) * 100 : null;
  return { totalExpected, totalActual, delta, deltaPct };
}

// Every locked milestone matched against its live counterpart by id (a
// milestone deleted since the lock has nothing to compare against, so
// it's dropped rather than shown as infinitely slipped).
function compareMilestones(lock, tasks) {
  if (!lock) return [];
  return lock.milestones
    .map((locked) => {
      const live = tasks.find((t) => t.id === locked.id && t.type === 'milestone');
      if (!live) return null;
      return { ...locked, liveDate: live.date, slippageDays: daysBetween(locked.date, live.date) };
    })
    .filter(Boolean);
}

// The one place Timeline's hero-stat math lives (Days Remaining,
// Slippage, Next Milestone, Milestones On Track, % Complete) - both
// TimelineModule's per-project tiles and Portfolio's rollup call this
// instead of each keeping their own copy.
export function computeTimelineMetrics(tasks, timelineLocks, selectedLockId = null) {
  const liveTasks = tasks || [];
  const locks = timelineLocks || [];
  const latestLock = locks.length ? locks[locks.length - 1] : null;
  const activeLock = selectedLockId ? locks.find((l) => l.id === selectedLockId) || latestLock : latestLock;
  const comparisons = compareMilestones(activeLock, liveTasks);

  // "The last milestone" = whichever one was locked in furthest out -
  // the project's ultimate completion point.
  const finalComparison = comparisons.length
    ? [...comparisons].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nowIso = todayIso();
  const nextMilestone = liveTasks
    .filter((t) => t.type === 'milestone' && t.date && parseLocalDate(t.date) >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;

  const onTrackCount = comparisons.filter((m) => m.slippageDays <= 0).length;

  // Days remaining counts down to the furthest-out LIVE milestone (the
  // project's current end target), not the locked one finalComparison
  // uses - this should move as the plan changes, even between locks.
  const liveMilestones = liveTasks.filter((t) => t.type === 'milestone' && t.date);
  const finalLiveMilestone = liveMilestones.length
    ? [...liveMilestones].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    : null;
  const daysRemaining = finalLiveMilestone ? daysBetween(nowIso, finalLiveMilestone.date) : null;

  const workTasks = liveTasks.filter((t) => t.type === 'task');
  const pctComplete = workTasks.length
    ? Math.round(workTasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0) / workTasks.length)
    : null;

  return {
    activeLock,
    latestLock,
    locks,
    comparisons,
    finalComparison,
    nextMilestone,
    onTrackCount,
    finalLiveMilestone,
    daysRemaining,
    pctComplete
  };
}
