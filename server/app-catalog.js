// Which apps HeyPhil has, under which sidebar heading - the unit of access.
// Each person sees only the apps they're granted (app_access rows);
// admins see everything. Mirrored in client/src/appCatalog.js (tested to
// stay in sync: scripts/tests/appCatalog.test.js).
export const APP_GROUPS = [
  { id: 'labs', label: 'Labs', apps: [
    { key: 'board', label: 'Project Board' },
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'strategy-grid', label: 'Strategy Grid' },
    { key: 'studio', label: 'Studio Board' },
    { key: 'orgcharts', label: 'Org Charts' },
    { key: 'cashflow', label: 'Cashflow' },
    { key: 'improvements', label: 'Improvements' },
    { key: 'modeling', label: 'Modeling' },
  ] },
  { id: 'shared', label: 'Shared Service Tools', apps: [{ key: 'design', label: 'Design' }] },
  { id: 'dev', label: 'Dev Tools', apps: [{ key: 'site-planner', label: 'Site Planner' }] },
];

export const APP_KEYS = APP_GROUPS.flatMap((g) => g.apps.map((a) => a.key));

// What everyone (but admins, who have it all) starts with on the one-time
// seed - Chad's call, 2026-11-11. New people start with nothing.
export const SEED_APPS = ['board', 'design'];

export function isAppKey(key) {
  return APP_KEYS.includes(key);
}
