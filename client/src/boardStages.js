// Board restructure Stage 1: origination pipeline order, shared by App.js
// (Kanban board - forward-only checks, Status dropdown filtering) and
// StrategyGrid.js (which cards are even in scope for the grid - Studio
// board statuses are never in this list). Mirrors board-db.js's
// ORIGINATION_STAGE_ORDER server-side; keep both copies in sync.
export const ORIGINATION_STAGE_ORDER = [
  'on-deck', 'diligence', 'capitalize', 'handoff', 'build', 'operate', 'assets', 'exited'
];
