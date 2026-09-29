// Standup-reminder emails ("Send Reminder" button on the Project Board) -
// one email per lead who has at least one open task, listing their
// projects (bold) and the open tasks under each, via Resend.
import { getOpenTasksByLead } from './board-db.js';

const FROM = 'HeyPhil <noreply@heyphil.bot>';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildReminderEmail(lead, appUrl) {
  const projectsHtml = lead.projects
    .map((project) => `
      <p style="margin: 16px 0 4px;"><b>${escapeHtml(project.title)}</b></p>
      <ul style="margin: 0 0 0 4px; padding-left: 20px;">
        ${project.tasks.map((task) => `<li>${escapeHtml(task)}</li>`).join('')}
      </ul>
    `)
    .join('');

  const html = `
    <div style="font-family: -apple-system, sans-serif; color: #222; max-width: 560px;">
      <p>Hi ${escapeHtml(lead.name)},</p>
      <p>Here are the remaining standup items on your projects:</p>
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

// dryRun computes exactly what would be sent without calling Resend - used
// to verify the grouping/query logic without risking a real send to the team.
export async function sendStandupReminders({ dryRun = false } = {}) {
  const { leads, skipped } = await getOpenTasksByLead();
  const appUrl = process.env.APP_URL || 'https://heyphil.bot';
  const emails = leads.map((lead) => buildReminderEmail(lead, appUrl));

  if (dryRun) {
    return {
      sent: [],
      skipped,
      dryRun: true,
      wouldSend: emails.map((e) => ({ to: e.to, subject: e.subject, html: e.html }))
    };
  }

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

  return { sent, failed, skipped };
}
