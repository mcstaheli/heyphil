// "Days since request" for a Design board card. Whole calendar days in the
// viewer's timezone, so a request made late yesterday reads 1d, not 0d.
// Open requests turn amber at a week and red at two; a delivered one
// stops counting and shows how long it took.
export const DESIGN_AMBER_DAYS = 7;
export const DESIGN_RED_DAYS = 14;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function calendarDaysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}

export function designDaysBadge(request, now = new Date()) {
  if (!request || !request.requestedAt) return null;
  if (request.status === 'delivered' && request.deliveredAt) {
    const days = Math.max(0, calendarDaysBetween(request.requestedAt, request.deliveredAt));
    return { days, text: `Delivered in ${days}d`, level: 'done', title: `Delivered ${days} day${days === 1 ? '' : 's'} after it was requested` };
  }
  const days = Math.max(0, calendarDaysBetween(request.requestedAt, now));
  const level = days >= DESIGN_RED_DAYS ? 'red' : days >= DESIGN_AMBER_DAYS ? 'amber' : 'ok';
  return { days, text: `${days}d`, level, title: `${days} day${days === 1 ? '' : 's'} since requested` };
}
