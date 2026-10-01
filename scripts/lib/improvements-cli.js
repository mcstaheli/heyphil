// Argument parsing for scripts/improvements.js (`npm run improvements`).
// Pure - tested in scripts/tests/improvementsCli.test.js.
import { IMPROVEMENT_COLUMNS, PRIORITIES } from '../../server/improvement-rules.js';

export class CliUsageError extends Error {}

export const USAGE = `Usage: npm run improvements -- <command>

  list [open|all|<status>]     open (default) = not Shipped/Abandoned
  show <N>                     every field; writes the screenshot to a temp file
  move <N> <status|-> [--kind bug|feature|none] [--priority high|normal|low]
                      [--note "..."] [--commit <sha|url>] [--duplicate-of <N|none>]

Statuses: ${IMPROVEMENT_COLUMNS.join(', ')} (or: bugs, features). "-" keeps the status.`;

const STATUS_ALIASES = { bugs: 'triaged-bugs', features: 'triaged-features' };
const OPTIONS = ['kind', 'priority', 'note', 'commit', 'duplicate-of'];

function resolveStatus(value) {
  const s = STATUS_ALIASES[value] || value;
  return IMPROVEMENT_COLUMNS.includes(s) ? s : null;
}

function parseSeq(value) {
  const raw = String(value || '').replace(/^#/, '');
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN; // plain digits - no 0x10 / 1e1
  if (!Number.isInteger(n) || n <= 0) throw new CliUsageError('Give a card number, e.g. 12');
  return n;
}

// "--kind" / "--kind=bug" is an option; "--kind flag was wrong" (a note
// that happens to start with --) is a value.
const looksLikeOption = (v) => {
  const m = /^--([a-z-]+)(=.*)?$/s.exec(v || '');
  return !!m && OPTIONS.includes(m[1]);
};

export function parseCliArgs(argv, { repoUrl = '' } = {}) {
  const [command, ...rest] = argv;
  if (!command) throw new CliUsageError(USAGE);

  if (command === 'list') {
    if (rest.length > 1) throw new CliUsageError(`Unexpected argument "${rest[1]}"`);
    const f = rest[0] || 'open';
    if (f === 'open' || f === 'all') return { command, filter: f };
    const status = resolveStatus(f);
    if (!status) throw new CliUsageError(`Unknown filter "${f}" - use open, all, or a status`);
    return { command, filter: status };
  }

  if (command === 'show') {
    if (rest.length > 1) throw new CliUsageError(`Unexpected argument "${rest[1]}"`);
    return { command, seqNum: parseSeq(rest[0]) };
  }

  if (command === 'move') {
    const seqNum = parseSeq(rest[0]);
    const statusArg = rest[1];
    const updates = {};
    if (statusArg === undefined) throw new CliUsageError('Give a status (or "-" to keep it)');
    if (statusArg !== '-') {
      const status = resolveStatus(statusArg);
      if (!status) throw new CliUsageError(`Unknown status "${statusArg}" - one of ${IMPROVEMENT_COLUMNS.join(', ')}, bugs, features`);
      updates.status = status;
    }

    const opts = {};
    for (let i = 2; i < rest.length; i += 1) {
      const arg = rest[i];
      if (!arg.startsWith('--')) throw new CliUsageError(`Unexpected argument "${arg}"`);
      const eq = arg.indexOf('=');
      const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      if (!OPTIONS.includes(name)) throw new CliUsageError(`Unknown option --${name}`);
      let value;
      if (eq >= 0) value = arg.slice(eq + 1);
      else {
        value = rest[i + 1];
        if (value === undefined || looksLikeOption(value)) throw new CliUsageError(`--${name} needs a value`);
        i += 1;
      }
      opts[name] = value;
    }

    if (opts.kind !== undefined) {
      if (!['bug', 'feature', 'none'].includes(opts.kind)) throw new CliUsageError('--kind must be bug, feature or none');
      updates.kind = opts.kind === 'none' ? null : opts.kind;
    }
    if (opts.priority !== undefined) {
      if (!PRIORITIES.includes(opts.priority)) throw new CliUsageError(`--priority must be one of ${PRIORITIES.join(', ')}`);
      updates.priority = opts.priority;
    }
    if (opts.note !== undefined) updates.classificationNote = opts.note;
    if (opts.commit !== undefined) {
      if (/^https?:\/\//.test(opts.commit)) updates.prUrl = opts.commit;
      else if (/^[0-9a-f]{7,40}$/i.test(opts.commit)) updates.prUrl = `${repoUrl.replace(/\/$/, '')}/commit/${opts.commit}`;
      else throw new CliUsageError('--commit must be a commit sha or a URL');
    }
    if (opts['duplicate-of'] !== undefined) {
      updates.duplicateOf = opts['duplicate-of'] === 'none' ? null : parseSeq(opts['duplicate-of']);
    }
    if (Object.keys(updates).length === 0) throw new CliUsageError('nothing to change - give a status or an option');
    return { command, seqNum, updates };
  }

  throw new CliUsageError(`Unknown command "${command}"\n\n${USAGE}`);
}
