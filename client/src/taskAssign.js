// Pure helpers behind the "@" task-assignment picker (AssigneeInput in
// App.js): typing "@" in an add-task box, at the start or after a space,
// opens a list of team members; picking one assigns the task to them and
// strips the "@query" text back out. Tested in scripts/tests/taskAssign.test.js.

const MAX_MENTION_LENGTH = 30;

// The "@query" being typed right before the caret, or null. The @ must
// start the text or follow whitespace, so an email address like
// chad@philo.ventures isn't mistaken for a mention.
export function findMentionQuery(text, caret = text.length) {
  const before = (text || '').slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_MENTION_LENGTH || /[@\n]/.test(query)) return null;
  return { start: at, query };
}

// Team members matching the query: case-insensitive prefix of the full
// name or of any word in it ("jo" finds "Brett Jones").
export function matchPeople(people, query, limit = 6) {
  const q = (query || '').trim().toLowerCase();
  return (people || [])
    .filter((name) => {
      if (!q) return true;
      const lower = name.toLowerCase();
      return lower.startsWith(q) || lower.split(/\s+/).some((word) => word.startsWith(q));
    })
    .slice(0, limit);
}

// Remove the "@query" a mention was picked from, tidying the spaces it
// leaves behind. Returns the new text and where the caret should go.
export function applyMention(text, mention) {
  const end = mention.start + 1 + mention.query.length;
  let before = text.slice(0, mention.start);
  let after = text.slice(end);
  if (!before.trim()) {
    before = '';
    after = after.trimStart();
  } else if (before.endsWith(' ') && after.startsWith(' ')) {
    after = after.slice(1);
  }
  const result = after === '' ? before.trimEnd() : before + after;
  return { text: result, caret: Math.min(before.length, result.length) };
}

// Where to draw the "@" list: it's rendered on top of the page
// (position: fixed, portalled to <body>) because the add-task boxes sit
// inside scrolling containers (the card modal's Next Actions column, the
// board's card lists) that would otherwise clip it. Below the input when
// it fits, else above it. rect = the input's getBoundingClientRect().
export function mentionListPosition(rect, viewportHeight, listHeight, gap = 4) {
  const base = { left: rect.left, minWidth: Math.max(rect.width, 180) };
  if (viewportHeight - rect.bottom >= listHeight + gap * 2) {
    return { left: base.left, top: rect.bottom + gap, minWidth: base.minWidth };
  }
  return { left: base.left, bottom: viewportHeight - rect.top + gap, minWidth: base.minWidth };
}
