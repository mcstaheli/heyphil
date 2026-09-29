import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderEmail } from '../../server/reminders.js';

test('builds one email per lead, with project titles bold and tasks listed under each', () => {
  const lead = {
    name: 'Greg',
    email: 'greg@philo.ventures',
    projects: [
      { title: 'Zion Promenade', tasks: ['Lock up series brand', 'Button up equity raise'] },
      { title: 'Willow', tasks: ['2.5M bond issue strategy resolved'] }
    ]
  };

  const email = buildReminderEmail(lead, 'https://heyphil.bot');

  assert.equal(email.to, 'greg@philo.ventures');
  assert.match(email.html, /<b>Zion Promenade<\/b>/);
  assert.match(email.html, /<li>Lock up series brand<\/li>/);
  assert.match(email.html, /<b>Willow<\/b>/);
  assert.match(email.html, /<li>2\.5M bond issue strategy resolved<\/li>/);
  assert.match(email.html, /href="https:\/\/heyphil\.bot"/);
});

test('escapes HTML in project titles and task text', () => {
  const lead = {
    name: 'Tracy',
    email: 'tracy@philo.ventures',
    projects: [{ title: 'A & B <script>', tasks: ['Gantt chart from Zwick & Elevation'] }]
  };

  const email = buildReminderEmail(lead, 'https://heyphil.bot');

  assert.match(email.html, /A &amp; B &lt;script&gt;/);
  assert.match(email.html, /Gantt chart from Zwick &amp; Elevation/);
  assert.doesNotMatch(email.html, /<script>/);
});
