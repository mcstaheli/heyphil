// Follow-up dates on tasks (#44): the badge a task shows. A date is a plain
// "YYYY-MM-DD" in the viewer's own calendar - no time zones involved.
//   more than 3 days out  -> "Follow up Mon, Nov 18" (quiet)
//   1-3 days out          -> "Follow up in 2d"
//   today                 -> "Follow up today"
//   past                  -> "Follow up 2d overdue"
// Completed tasks show nothing.
export const FOLLOW_UP_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function followUpBadge(task, now = new Date()) {
  const on = task?.followUpOn;
  if (!on || !FOLLOW_UP_RE.test(on) || task.completedOn) return null;
  const days = dayNumber(on) - dayNumber(localToday(now));
  if (days < 0) return { days, level: 'overdue', label: `Follow up ${-days}d overdue` };
  if (days === 0) return { days, level: 'today', label: 'Follow up today' };
  if (days <= 3) return { days, level: 'soon', label: `Follow up in ${days}d` };
  const [y, m, d] = on.split('-').map(Number);
  const pretty = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return { days, level: 'later', label: `Follow up ${pretty}` };
}
