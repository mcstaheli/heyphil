// Undo / redo for the Site Planner: snapshots of the whole plan (edits
// replace objects rather than change them, so a snapshot is cheap). A run
// of changes to the same thing close together - a drag, typing in a
// field - is one step.

export const HISTORY_LIMIT = 100;
export const MERGE_MS = 800;

export function createHistory({ limit = HISTORY_LIMIT, mergeMs = MERGE_MS } = {}) {
  let past = []; // [{ snapshot, key, at }] - the plan before each step
  let future = [];
  return {
    // Call before a change to `key` lands, with the plan as it was.
    record(before, key, at = Date.now()) {
      const last = past[past.length - 1];
      future = [];
      if (last && last.key === key && at - last.at < mergeMs) {
        last.at = at; // the same step goes on
        return;
      }
      past.push({ snapshot: before, key, at });
      if (past.length > limit) past = past.slice(-limit);
    },
    // The plan to go back to (current goes on the redo list), or null.
    undo(current) {
      const step = past.pop();
      if (!step) return null;
      future.push({ snapshot: current, key: step.key, at: 0 });
      return step.snapshot;
    },
    redo(current) {
      const step = future.pop();
      if (!step) return null;
      past.push({ snapshot: current, key: step.key, at: 0 });
      return step.snapshot;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past = [];
      future = [];
    },
  };
}

// The top-level fields that differ between two plans (what to save).
export const changedKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => a?.[k] !== b?.[k]);
