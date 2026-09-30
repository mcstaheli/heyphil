import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderEmail } from '../../server/reminders.js';

test('builds one email per lead, with project titles underlined/bold and tasks listed under each', () => {
  const lead = {
    name: 'Greg',
    email: 'greg@philo.ventures',
    projects: [
      {
        title: 'Zion Promenade',
        tasks: [
          { text: 'Lock up series brand', starred: false },
          { text: 'Button up equity raise', starred: false }
        ]
      },
      { title: 'Willow', tasks: [{ text: '2.5M bond issue strategy resolved', starred: false }] }
    ]
  };

  const email = buildReminderEmail(lead, 'https://heyphil.bot');

  assert.equal(email.to, 'greg@philo.ventures');
  assert.match(email.html, /<b><u>Zion Promenade<\/u><\/b>/);
  assert.match(email.html, /<li>Lock up series brand<\/li>/);
  assert.match(email.html, /<b><u>Willow<\/u><\/b>/);
  assert.match(email.html, /<li>2\.5M bond issue strategy resolved<\/li>/);
  assert.match(email.html, /href="https:\/\/heyphil\.bot"/);
});

test('prefixes starred tasks with a star, unstarred tasks get no marker', () => {
  const lead = {
    name: 'Greg',
    email: 'greg@philo.ventures',
    projects: [{
      title: 'Zion Promenade',
      tasks: [
        { text: 'Lock up series brand', starred: true },
        { text: 'Button up equity raise', starred: false }
      ]
    }]
  };

  const email = buildReminderEmail(lead, 'https://heyphil.bot');

  assert.match(email.html, /<li>★ Lock up series brand<\/li>/);
  assert.match(email.html, /<li>Button up equity raise<\/li>/);
});

test('escapes HTML in project titles and task text', () => {
  const lead = {
    name: 'Tracy',
    email: 'tracy@philo.ventures',
    projects: [{ title: 'A & B <script>', tasks: [{ text: 'Gantt chart from Zwick & Elevation', starred: false }] }]
  };

  const email = buildReminderEmail(lead, 'https://heyphil.bot');

  assert.match(email.html, /A &amp; B &lt;script&gt;/);
  assert.match(email.html, /Gantt chart from Zwick &amp; Elevation/);
  assert.doesNotMatch(email.html, /<script>/);
});

test('lead email says who each task is assigned to (unless it is the recipient)', () => {
  const lead = {
    name: 'Chad',
    email: 'chad@philo.ventures',
    projects: [{
      title: 'Zion Promenade', lead: 'Chad', role: 'lead',
      tasks: [
        { text: 'Button up equity raise', starred: false, assignee: 'Greg' },
        { text: 'Lock up series brand', starred: false, assignee: 'Chad' },
        { text: 'Call bank', starred: false, assignee: null }
      ]
    }]
  };
  const email = buildReminderEmail(lead, 'https://heyphil.bot');
  assert.match(email.html, /<li>Button up equity raise <span[^>]*>→ Greg<\/span><\/li>/);
  assert.match(email.html, /<li>Lock up series brand<\/li>/);
  assert.match(email.html, /<li>Call bank<\/li>/);
});

test('assignee email lists a project they do not lead, marked with its lead', () => {
  const greg = {
    name: 'Greg',
    email: 'greg@philo.ventures',
    projects: [{
      title: 'Zion Promenade', lead: 'Chad', role: 'assigned',
      tasks: [{ text: 'Button up equity raise', starred: false, assignee: 'Greg' }]
    }]
  };
  const email = buildReminderEmail(greg, 'https://heyphil.bot');
  assert.match(email.html, /<b><u>Zion Promenade<\/u><\/b> <span[^>]*>· led by Chad<\/span>/);
  // their own task - no "→ Greg" marker
  assert.match(email.html, /<li>Button up equity raise<\/li>/);
});
