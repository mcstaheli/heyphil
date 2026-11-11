// HeyPhil's apps under their sidebar headings - the unit of access
// (Settings -> App access). Mirrors server/app-catalog.js; a test keeps the
// two in sync (scripts/tests/appCatalog.test.js).
export const APP_GROUPS = [
  { id: 'labs', label: 'Labs', icon: '🧪', apps: [
    { key: 'board', path: '/labs/board', label: 'Project Board' },
    { key: 'portfolio', path: '/labs/portfolio', label: 'Portfolio' },
    { key: 'strategy-grid', path: '/labs/strategy-grid', label: 'Strategy Grid' },
    { key: 'studio', path: '/labs/studio', label: 'Studio Board' },
    { key: 'orgcharts', path: '/labs/orgcharts', label: 'Org Charts' },
    { key: 'cashflow', path: '/labs/cashflow', label: 'Cashflow' },
    { key: 'improvements', path: '/labs/improvements', label: 'Improvements' },
    { key: 'modeling', path: '/labs/modeling', label: 'Modeling' },
  ] },
  { id: 'shared', label: 'Shared Service Tools', icon: '🤝', apps: [
    { key: 'design', path: '/shared/design', label: 'Design' },
  ] },
  { id: 'dev', label: 'Dev Tools', icon: '🏗️', apps: [
    { key: 'site-planner', path: '/dev/site-planner', label: 'Site Planner' },
  ] },
];

export const ALL_APPS = APP_GROUPS.flatMap((g) => g.apps);

// The first app this person can open (where "/" sends them), or null.
export function firstAllowedPath(apps) {
  const a = ALL_APPS.find((x) => apps.includes(x.key));
  return a ? a.path : null;
}
