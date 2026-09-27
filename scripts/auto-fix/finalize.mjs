#!/usr/bin/env node
// Applies the auto-fix workflow's outcome to the improvement record it
// targeted. Called once, at the end of .github/workflows/auto-fix-bugs.yml,
// after the implement/smoke-test/verify steps have all run - having one
// place that writes the final DB state means that logic isn't duplicated
// (and doesn't drift) across every possible outcome branch in the workflow
// YAML.
//
// Usage: node scripts/auto-fix/finalize.mjs <improvementId> shipped <commitUrl>
//        node scripts/auto-fix/finalize.mjs <improvementId> rejected <reason>
import * as db from '../../server/improvements-db.js';

// Exported for unit testing - the append-not-overwrite behavior here is
// exactly the kind of thing that silently regresses to "overwrite" (losing
// a prior run's reasoning) if someone simplifies this later.
export function buildRejectionNote(existingNote, reason) {
  const prefix = existingNote ? `${existingNote}\n\n` : '';
  return `${prefix}Auto-fix attempt declined: ${reason}`;
}

async function main() {
  const [, , improvementId, outcome, detail] = process.argv;

  if (!improvementId || improvementId === 'null' || improvementId === 'undefined') {
    console.log('No improvement was targeted this run - nothing to finalize.');
    return;
  }

  if (outcome === 'shipped') {
    await db.updateImprovement(improvementId, { status: 'shipped', prUrl: detail });
    console.log(`Marked ${improvementId} shipped -> ${detail}`);
  } else if (outcome === 'rejected') {
    const current = await db.getImprovementById(improvementId);
    const note = buildRejectionNote(current?.classificationNote, detail);
    await db.updateImprovement(improvementId, { classificationNote: note });
    console.log(`Left ${improvementId} in triaged - ${detail}`);
  } else {
    console.error(`Unknown outcome: "${outcome}" (expected "shipped" or "rejected")`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('finalize.mjs failed:', error.message);
  process.exitCode = 1;
});
