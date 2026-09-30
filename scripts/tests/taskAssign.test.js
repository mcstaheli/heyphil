import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMentionQuery, matchPeople, applyMention, mentionListPosition } from '../../client/src/taskAssign.js';
import { groupReminderRecipients } from '../../server/reminder-recipients.js';

const PEOPLE = ['Chad', 'Greg', 'Tracy', 'Scott', 'Brett Jones'];

test('findMentionQuery: @ at the start or after a space, up to the caret', () => {
  assert.deepEqual(findMentionQuery('Call bank @gr'), { start: 10, query: 'gr' });
  assert.deepEqual(findMentionQuery('@'), { start: 0, query: '' });
  assert.deepEqual(findMentionQuery('@Brett J'), { start: 0, query: 'Brett J' });
  // caret in the middle: only text before the caret counts
  assert.deepEqual(findMentionQuery('Call @gr and more', 8), { start: 5, query: 'gr' });
});

test('findMentionQuery: not a mention', () => {
  assert.equal(findMentionQuery('email chad@philo.ventures'), null); // @ inside a word
  assert.equal(findMentionQuery('no mention here'), null);
  assert.equal(findMentionQuery(''), null);
  assert.equal(findMentionQuery('@' + 'x'.repeat(40)), null); // too long to be a name
});

test('matchPeople: case-insensitive prefix of the name or any word in it', () => {
  assert.deepEqual(matchPeople(PEOPLE, 'gr'), ['Greg']);
  assert.deepEqual(matchPeople(PEOPLE, 'jo'), ['Brett Jones']);
  assert.deepEqual(matchPeople(PEOPLE, ''), PEOPLE);
  assert.deepEqual(matchPeople(PEOPLE, 'zz'), []);
  assert.equal(matchPeople([...PEOPLE, 'A', 'B', 'C'], '', 6).length, 6);
});

test('applyMention: removes the @query and tidies spacing', () => {
  assert.deepEqual(applyMention('Call bank @gr', { start: 10, query: 'gr' }), { text: 'Call bank', caret: 9 });
  assert.deepEqual(applyMention('@gr call bank', { start: 0, query: 'gr' }), { text: 'call bank', caret: 0 });
  assert.deepEqual(applyMention('Call @gr the bank', { start: 5, query: 'gr' }), { text: 'Call the bank', caret: 5 });
});

// ---- reminder recipients ----
const people = [
  { name: 'Chad', email: 'chad@x.com' },
  { name: 'Greg', email: 'greg@x.com' },
  { name: 'Tracy', email: null },
];
const task = (id, text, extra = {}) => ({ id, text, starred: false, completedOn: null, ...extra });

test('groupReminderRecipients: leads get all open tasks, with assignees shown', () => {
  const projects = [
    { title: 'Zion', owner: 'Chad', tasks: [task(1, 'Lock brand'), task(2, 'Equity raise', { assignee: 'Greg' }), task(3, 'Done', { completedOn: '2026-09-01' })] },
  ];
  const { recipients } = groupReminderRecipients(projects, people);
  const chad = recipients.find((r) => r.name === 'Chad');
  assert.deepEqual(chad.projects, [{
    title: 'Zion', lead: 'Chad', role: 'lead',
    tasks: [{ text: 'Lock brand', starred: false, assignee: null }, { text: 'Equity raise', starred: false, assignee: 'Greg' }],
  }]);
});

test('groupReminderRecipients: an assignee on someone else\'s project gets only their tasks', () => {
  const projects = [
    { title: 'Zion', owner: 'Chad', tasks: [task(1, 'Lock brand'), task(2, 'Equity raise', { assignee: 'Greg' })] },
    { title: 'Willow', owner: 'Greg', tasks: [task(1, 'Bond strategy')] },
  ];
  const { recipients } = groupReminderRecipients(projects, people);
  const greg = recipients.find((r) => r.name === 'Greg');
  assert.equal(greg.email, 'greg@x.com');
  // own projects first, then assigned ones
  assert.deepEqual(greg.projects.map((p) => [p.title, p.role]), [['Willow', 'lead'], ['Zion', 'assigned']]);
  assert.deepEqual(greg.projects[1].tasks, [{ text: 'Equity raise', starred: false, assignee: 'Greg' }]);
  assert.equal(greg.projects[1].lead, 'Chad');
});

test('groupReminderRecipients: a task assigned to the lead themselves is not duplicated', () => {
  const projects = [{ title: 'Zion', owner: 'Chad', tasks: [task(1, 'Mine', { assignee: 'Chad' })] }];
  const chad = groupReminderRecipients(projects, people).recipients.find((r) => r.name === 'Chad');
  assert.equal(chad.projects.length, 1);
  assert.equal(chad.projects[0].role, 'lead');
});

test('groupReminderRecipients: skipped - no email, or a lead with nothing open', () => {
  const projects = [
    { title: 'A', owner: 'Tracy', tasks: [task(1, 'x')] },               // lead, no email
    { title: 'B', owner: 'Chad', tasks: [task(1, 'y', { assignee: 'Tracy' })] }, // assignee, no email
    { title: 'C', owner: 'Greg', tasks: [task(1, 'z', { completedOn: '2026-09-01' })] }, // nothing open
  ];
  const { recipients, skipped } = groupReminderRecipients(projects, people);
  assert.deepEqual(recipients.map((r) => r.name).sort(), ['Chad']);
  assert.deepEqual(skipped.sort((a, b) => a.name.localeCompare(b.name)), [
    { name: 'Greg', reason: 'no open items' },
    { name: 'Tracy', reason: 'no email on file' },
  ]);
});

test('groupReminderRecipients: unowned projects still notify their assignees', () => {
  const projects = [{ title: 'Orphan', owner: null, tasks: [task(1, 'Do it', { assignee: 'Greg' })] }];
  const greg = groupReminderRecipients(projects, people).recipients.find((r) => r.name === 'Greg');
  assert.deepEqual(greg.projects.map((p) => [p.title, p.role, p.lead]), [['Orphan', 'assigned', null]]);
});

test('mentionListPosition: below the input when it fits, flips above when it would run off-screen', () => {
  const rect = { left: 100, top: 200, bottom: 230, width: 300 };
  // plenty of room below
  assert.deepEqual(mentionListPosition(rect, 800, 150), { left: 100, top: 234, minWidth: 300 });
  // input near the bottom of the window (e.g. the card modal's add box) -> above
  const low = { left: 100, top: 700, bottom: 730, width: 300 };
  assert.deepEqual(mentionListPosition(low, 800, 150), { left: 100, bottom: 104, minWidth: 300 });
});
