import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesPersonFilter, tasksShownFor } from '../../client/src/boardFilters.js';
import { taskAge, TASK_AGE_TRACKED_SINCE } from '../../client/src/taskAge.js';

const card = {
  owner: 'Greg',
  actions: [
    { id: 1, text: 'Call county', assignee: null, completedOn: null },
    { id: 2, text: 'Room punch', assignee: 'Tracy', completedOn: null },
    { id: 3, text: 'Old one', assignee: 'Scott', completedOn: '2026-10-01' },
  ],
};

test('matchesPersonFilter: owner, or someone with an OPEN @-assigned task', () => {
  assert.equal(matchesPersonFilter(card, ''), true);            // no filter
  assert.equal(matchesPersonFilter(card, 'Greg'), true);        // owner
  assert.equal(matchesPersonFilter(card, 'Tracy'), true);       // open assigned task
  assert.equal(matchesPersonFilter(card, 'Scott'), false);      // only a completed one
  assert.equal(matchesPersonFilter(card, 'Jon'), false);
  assert.equal(matchesPersonFilter({ owner: 'Jon' }, 'Tracy'), false); // no actions
});

test('tasksShownFor: on a card the person does not own, only their assigned tasks', () => {
  assert.deepEqual(tasksShownFor(card, 'Tracy').map((a) => a.id), [2]);
  assert.deepEqual(tasksShownFor(card, 'Greg').map((a) => a.id), [1, 2, 3]);
  assert.deepEqual(tasksShownFor(card, '').map((a) => a.id), [1, 2, 3]);
});

const NOW = new Date('2026-12-01T12:00:00Z');

test('taskAge: whole weeks since createdAt, colored by weeks', () => {
  assert.deepEqual(taskAge({ createdAt: '2026-11-28T00:00:00Z' }, NOW), { weeks: 0, known: true, level: 0 });
  assert.deepEqual(taskAge({ createdAt: '2026-11-20T00:00:00Z' }, NOW), { weeks: 1, known: true, level: 1 });
  assert.deepEqual(taskAge({ createdAt: '2026-11-10T00:00:00Z' }, NOW), { weeks: 3, known: true, level: 2 });
  assert.deepEqual(taskAge({ createdAt: '2026-10-01T00:00:00Z' }, NOW), { weeks: 8, known: true, level: 3 });
});

test('taskAge: tasks from before dates were recorded count from the tracking start, as a minimum', () => {
  const age = taskAge({}, NOW);
  assert.equal(age.known, false);
  assert.equal(age.weeks, Math.floor((NOW - new Date(TASK_AGE_TRACKED_SINCE)) / (7 * 86400000)));
  assert.equal(taskAge({ createdAt: 'nonsense' }, NOW).known, false);
});

test('taskAge: completed tasks have no age chip', () => {
  assert.equal(taskAge({ createdAt: '2026-10-01T00:00:00Z', completedOn: '2026-11-01' }, NOW), null);
});

test('person filter ignores case/extra spaces (same as the server\'s LOWER(name) match)', () => {
  const c = { owner: 'Greg', actions: [{ id: 1, assignee: 'tracy smith', completedOn: null }] };
  assert.equal(matchesPersonFilter(c, 'Tracy Smith'), true);
  assert.deepEqual(tasksShownFor(c, ' TRACY SMITH ').map((a) => a.id), [1]);
  assert.equal(matchesPersonFilter({ owner: 'greg', actions: [] }, 'Greg'), true);
});
