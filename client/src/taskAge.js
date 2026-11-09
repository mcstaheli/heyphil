// How long a task has been open, in whole weeks, colored by weeks
// (Improvements #55). New tasks carry createdAt (set by the server in
// addTask); tasks from before that have no date, so they count from the
// day tracking started and read as a minimum ("2w+") rather than inventing
// a date. Tested in scripts/tests/boardTasks.test.js.

export const TASK_AGE_TRACKED_SINCE = '2026-11-10T00:00:00Z';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// level: 0 = under a week (no color), 1 = 1 week, 2 = 2-3 weeks, 3 = 4+ weeks
function levelFor(weeks) {
  if (weeks >= 4) return 3;
  if (weeks >= 2) return 2;
  if (weeks >= 1) return 1;
  return 0;
}

// { weeks, known, level } for an open task; null once it's completed.
export function taskAge(task, now = new Date()) {
  if (!task || task.completedOn) return null;
  const created = task.createdAt ? new Date(task.createdAt) : null;
  const known = !!created && !Number.isNaN(created.getTime());
  const start = known ? created : new Date(TASK_AGE_TRACKED_SINCE);
  const weeks = Math.max(0, Math.floor((now - start) / WEEK_MS));
  return { weeks, known, level: levelFor(weeks) };
}
