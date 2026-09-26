// Board restructure Stage 1: origination pipeline stages, in display/ramp
// order. No forward-only enforcement (removed per request: "don't force
// cards not to move back anymore") - this is just which statuses belong to
// the origination board at all, used by StrategyGrid.js (which cards are
// even in scope for the grid - Studio board statuses are never in this
// list). Mirrors board-db.js's ORIGINATION_STAGE_ORDER server-side; keep
// both copies in sync.
export const ORIGINATION_STAGE_ORDER = [
  'ideation', 'on-deck', 'diligence', 'capitalize', 'handoff', 'build', 'operate', 'assets',
  'abandoned', 'exited'
];

// Every "condensed card" stage - minimized by default, gets the small-
// avatar/no-chips/no-actions card-prepost styling, and excluded from
// active-project metrics. Single source of truth so a future add/remove
// of a pre/post-style stage only has to change one place instead of the
// default-minimized set, both isPrePost checks, and the metrics filter
// separately (which is exactly how this list used to be hand-duplicated
// four times over in App.js).
export const PRE_POST_COLUMN_IDS = [
  'ideation', 'abandoned', 'exited', 'studio-ideation', 'studio-exited', 'studio-abandoned'
];
