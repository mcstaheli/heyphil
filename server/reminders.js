// Standup-reminder emails ("Send Reminder" button on the Project Board) -
// one email per person, via Resend: the projects they lead (every open
// task, noting who each is assigned to) plus any project they don't lead
// but have tasks assigned on (just those tasks). Who gets what:
// reminder-recipients.js.
import { getOpenTasksByLead } from './board-db.js';

const FROM = 'HeyPhil <noreply@heyphil.bot>';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const MUTED = 'style="color: #888;"';

export function buildReminderEmail(lead, appUrl) {
  const taskHtml = (task) => {
    // Show who it's assigned to - unless that's the person reading it.
    const assignee = task.assignee && task.assignee !== lead.name
      ? ` <span ${MUTED}>→ ${escapeHtml(task.assignee)}</span>`
      : '';
    return `<li>${task.starred ? '★ ' : ''}${escapeHtml(task.text)}${assignee}</li>`;
  };
  const projectsHtml = lead.projects
    .map((project) => {
      // A project they don't lead (only here because of tasks assigned to them)
      const ledBy = project.role === 'assigned' && project.lead
        ? ` <span ${MUTED}>· led by ${escapeHtml(project.lead)}</span>`
        : '';
      return `
      <p style="margin: 16px 0 4px;"><b><u>${escapeHtml(project.title)}</u></b>${ledBy}</p>
      <ul style="margin: 0 0 0 4px; padding-left: 20px;">
        ${project.tasks.map(taskHtml).join('')}
      </ul>
    `;
    })
    .join('');

  const html = `
    <div style="font-family: -apple-system, sans-serif; color: #222; max-width: 560px;">
      <p>Hi ${escapeHtml(lead.name)},</p>
      <p>Here are your remaining standup items:</p>
      ${projectsHtml}
      <p style="margin-top: 24px;">
        <a href="${appUrl}" style="color: #2196f3;">Go update these in HeyPhil</a>
      </p>
    </div>
  `;

  return {
    from: FROM,
    to: lead.email,
    subject: 'Your open standup items',
    html
  };
}

// Everyone currently eligible for a reminder (has an email + open items -
// as a lead or an assignee),
// with just enough detail for a "pick who to send to" checklist - no need
// to ship the full task text/HTML for that.
export async function previewStandupReminders() {
  const { leads, skipped } = await getOpenTasksByLead();
  return {
    leads: leads.map((lead) => ({
      name: lead.name,
      email: lead.email,
      projectCount: lead.projects.length,
      itemCount: lead.projects.reduce((sum, p) => sum + p.tasks.length, 0)
    })),
    skipped
  };
}

// onlyEmails, when given, restricts the actual send to that subset of
// otherwise-eligible leads (the "Send Reminder" modal's unchecked boxes) -
// eligible leads left out this way are reported separately from `skipped`
// (which is leads that were never eligible at all - no email or no open
// items), so the summary can distinguish "nothing to send" from "chose not to".
export async function sendStandupReminders({ onlyEmails = null } = {}) {
  const { leads, skipped } = await getOpenTasksByLead();
  const appUrl = process.env.APP_URL || 'https://heyphil.bot';

  const onlySet = onlyEmails ? new Set(onlyEmails.map((e) => e.toLowerCase())) : null;
  const excluded = onlySet ? leads.filter((l) => !onlySet.has(l.email.toLowerCase())).map((l) => l.email) : [];
  const toSend = onlySet ? leads.filter((l) => onlySet.has(l.email.toLowerCase())) : leads;

  const emails = toSend.map((lead) => buildReminderEmail(lead, appUrl));

  const sent = [];
  const failed = [];
  for (const email of emails) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: email.from, to: email.to, subject: email.subject, html: email.html })
    });
    if (res.ok) {
      sent.push(email.to);
    } else {
      const body = await res.text();
      failed.push({ to: email.to, error: body });
    }
  }

  return { sent, failed, skipped, excluded };
}
