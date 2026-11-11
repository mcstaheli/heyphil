// Fired by Settings after a team or app-access change, so the sidebar and
// the App access table refresh without a reload. (Its own module so
// Settings doesn't pull in the router.)
export const ACCESS_CHANGED = 'heyphil:access-changed';
