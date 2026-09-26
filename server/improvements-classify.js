// Auto-triage for the Improvements board: every few hours, look at items
// still sitting in New with no kind set, ask Claude whether each is a bug
// report or a feature request, and move it to Triaged with that kind and a
// one-line reasoning note attached.
//
// Deliberately stops there. It does NOT touch code, open a PR, or push
// anything - even for items it classifies as bugs. Auto-fixing and
// deploying a live change to a shared production app on an unsupervised
// timer is a different order of risk than auto-labeling a card, and that
// step needs an explicit human go-ahead per report rather than a standing
// cron. A classified bug just sits in Triaged for a person (or a Claude
// Code session someone points at it) to pick up.
import Anthropic from '@anthropic-ai/sdk';
import * as improvementsDb from './improvements-db.js';

const MODEL = 'claude-haiku-4-5-20251001';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const CLASSIFY_TOOL = {
  name: 'classify_report',
  description: 'Classify a user-submitted improvement report as a bug or a feature request.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['bug', 'feature'] },
      reasoning: { type: 'string', description: 'One or two sentences on why this is a bug vs. a feature request.' },
    },
    required: ['kind', 'reasoning'],
  },
};

// Exported for unit testing - the one part of this file worth a fast,
// no-network test: pulling the tool_use block back out of the SDK's
// response shape is exactly the kind of thing that silently breaks if the
// SDK ever changes its content-block ordering.
export function extractClassification(message) {
  const toolUse = message?.content?.find((block) => block.type === 'tool_use' && block.name === 'classify_report');
  if (!toolUse) return null;
  const { kind, reasoning } = toolUse.input || {};
  if (kind !== 'bug' && kind !== 'feature') return null;
  return { kind, reasoning: reasoning || '' };
}

async function classifyOne(improvement) {
  const anthropic = getClient();
  if (!anthropic) return null;

  const content = [
    {
      type: 'text',
      text: [
        `Page: ${improvement.pageUrl || '(unknown)'}`,
        `Reporter's note: ${improvement.note || '(no note provided)'}`,
        '',
        'Is this a bug report (something in the app is broken or behaving incorrectly) or a feature request (something new or different the reporter wants)? Use the screenshot for context if one is attached.',
      ].join('\n'),
    },
  ];
  if (improvement.screenshot?.startsWith('data:image/')) {
    const [, mediaType, base64] = improvement.screenshot.match(/^data:(image\/[a-z]+);base64,(.+)$/s) || [];
    if (base64) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      });
    }
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: 'classify_report' },
    messages: [{ role: 'user', content }],
  });

  return extractClassification(message);
}

// Guards against the scheduled interval and a manual "Classify new items
// now" click overlapping in the same process: without it, both sides read
// the same unclassified rows before either writes back, so an item already
// mid-classification gets sent to Claude a second time (duplicate spend,
// not corruption - updateImprovement's last write still wins cleanly).
// In-process only - doesn't protect against two Railway instances running
// this at once, but that's the same residual risk autoMigrate's advisory
// lock exists to close for migrations, and this is much lower stakes.
let sweeping = false;

// Runs one sweep over the current backlog. Safe to call repeatedly (e.g.
// from a setInterval, or manually via POST /api/improvements/classify-now)
// - each item is only ever picked up while it's still unclassified in New.
export async function runClassificationSweep(limit = 20) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ℹ️  Improvements classification sweep skipped - no ANTHROPIC_API_KEY set.');
    return { classified: 0, failed: 0 };
  }
  if (sweeping) {
    console.log('ℹ️  Improvements classification sweep already running - skipping this trigger.');
    return { classified: 0, failed: 0 };
  }

  sweeping = true;
  try {
    return await sweepBacklog(limit);
  } finally {
    sweeping = false;
  }
}

async function sweepBacklog(limit) {
  const backlog = await improvementsDb.getUnclassified(limit);
  let classified = 0;
  let failed = 0;
  for (const item of backlog) {
    try {
      const result = await classifyOne(item);
      if (!result) {
        failed += 1;
        continue;
      }
      await improvementsDb.updateImprovement(item.id, {
        kind: result.kind,
        status: 'triaged',
        classificationNote: result.reasoning,
      });
      classified += 1;
    } catch (error) {
      failed += 1;
      console.error(`⚠️  Failed to classify improvement ${item.id}:`, error.message);
    }
  }
  if (backlog.length > 0) {
    console.log(`🏷️  Improvements classification sweep: ${classified} classified, ${failed} failed, ${backlog.length} total.`);
  }
  return { classified, failed };
}
