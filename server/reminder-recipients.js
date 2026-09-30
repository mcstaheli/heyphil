// Who gets a standup-reminder email and what's in it (pure - the data comes
// from board-db.getOpenTasksByLead; tested in scripts/tests/taskAssign.test.js).
//
// One email per person, combining:
//   - projects they LEAD: every open task (each carrying its assignee, so
//     the email can say who it's assigned to), and
//   - projects they DON'T lead but have tasks assigned on: only those
//     tasks ("led by X").
// A task assigned to the project's own lead is just part of their lead
// list, not repeated.

export function groupReminderRecipients(projects, people) {
  const emailByName = new Map((people || []).filter((p) => p.email).map((p) => [p.name, p.email]));
  const byPerson = new Map(); // name -> { lead: [...], assigned: [...] }
  const entry = (name) => {
    if (!byPerson.has(name)) byPerson.set(name, { lead: [], assigned: [] });
    return byPerson.get(name);
  };
  const leadsWithNothingOpen = new Set();

  for (const project of projects || []) {
    const owner = project.owner || null;
    const open = (project.tasks || [])
      .filter((t) => !t.completedOn)
      .map((t) => ({ text: t.text, starred: !!t.starred, assignee: t.assignee || null }));

    if (owner) {
      if (open.length > 0) {
        entry(owner).lead.push({ title: project.title, lead: owner, role: 'lead', tasks: open });
      } else {
        leadsWithNothingOpen.add(owner);
      }
    }

    const byAssignee = new Map();
    for (const t of open) {
      if (!t.assignee || t.assignee === owner) continue;
      if (!byAssignee.has(t.assignee)) byAssignee.set(t.assignee, []);
      byAssignee.get(t.assignee).push(t);
    }
    for (const [assignee, tasks] of byAssignee) {
      entry(assignee).assigned.push({ title: project.title, lead: owner, role: 'assigned', tasks });
    }
  }

  const recipients = [];
  const skipped = [];
  for (const [name, { lead, assigned }] of byPerson) {
    const email = emailByName.get(name);
    if (!email) {
      skipped.push({ name, reason: 'no email on file' });
      continue;
    }
    recipients.push({ name, email, projects: [...lead, ...assigned] });
  }
  for (const name of leadsWithNothingOpen) {
    if (!byPerson.has(name)) skipped.push({ name, reason: 'no open items' });
  }
  return { recipients, skipped };
}
