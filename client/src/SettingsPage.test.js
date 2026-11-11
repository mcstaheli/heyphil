import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import SettingsPage from './SettingsPage';

const PEOPLE = [
  { name: 'Chad', email: 'chad@philo.ventures' },
  { name: 'Greg', email: 'greg@philo.ventures' },
];
const GROUPS = [
  { id: 'labs', label: 'Labs', apps: [{ key: 'board', label: 'Project Board' }, { key: 'modeling', label: 'Modeling' }] },
  { id: 'shared', label: 'Shared Service Tools', apps: [{ key: 'design', label: 'Design' }] },
];
const ACCESS = [
  { email: 'chad@philo.ventures', isAdmin: true },
  { email: 'greg@philo.ventures', isAdmin: false },
  { email: 'jeff@addaxoutdoors.com', isAdmin: false },
];

let grants;
function mockServer(extra = () => null) {
  grants = { 'greg@philo.ventures': ['board', 'design'] };
  global.fetch = jest.fn((url, opts = {}) => {
    const custom = extra(url, opts);
    if (custom) return custom;
    if (url.endsWith('/api/people')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ people: PEOPLE }) });
    if (url.endsWith('/api/allowed-emails')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: ACCESS.map((a) => a.email), access: ACCESS }) });
    }
    if (url.endsWith('/api/app-access') && !opts.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ groups: GROUPS, access: grants, people: ACCESS }) });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

afterEach(() => { delete global.fetch; });

const rowFor = (email) => screen.getByDisplayValue(email).closest('.settings-item');
const box = (row, label) => within(row).getByLabelText(label);

test('non-admin: sees who has access and who is admin, but every access control is disabled', async () => {
  mockServer();
  render(<SettingsPage user={{ email: 'greg@philo.ventures', name: 'Greg' }} onLogout={() => {}} />);
  await screen.findByDisplayValue('chad@philo.ventures');

  expect(box(rowFor('chad@philo.ventures'), 'Admin')).toBeChecked();
  expect(box(rowFor('greg@philo.ventures'), 'Admin')).not.toBeChecked();
  for (const email of ['chad@philo.ventures', 'greg@philo.ventures', 'jeff@addaxoutdoors.com']) {
    expect(box(rowFor(email), 'Can log in')).toBeDisabled();
    expect(box(rowFor(email), 'Admin')).toBeDisabled();
  }
  expect(screen.queryByText(/Grant access/)).not.toBeInTheDocument();
  expect(within(rowFor('jeff@addaxoutdoors.com')).queryByTitle('Revoke login')).not.toBeInTheDocument();
  expect(screen.getByText(/Only admins can change who can log in/)).toBeInTheDocument();
});

test('admin: can manage others, but not revoke their own login or demote the last admin', async () => {
  mockServer();
  render(<SettingsPage user={{ email: 'chad@philo.ventures', name: 'Chad' }} onLogout={() => {}} />);
  await screen.findByDisplayValue('chad@philo.ventures');

  const chad = rowFor('chad@philo.ventures');
  expect(box(chad, 'Can log in')).toBeDisabled();   // own login
  expect(box(chad, 'Admin')).toBeDisabled();        // last admin
  const greg = rowFor('greg@philo.ventures');
  expect(box(greg, 'Can log in')).toBeEnabled();
  expect(box(greg, 'Admin')).toBeEnabled();
  expect(screen.getByText(/Grant access/)).toBeInTheDocument();
  expect(within(rowFor('jeff@addaxoutdoors.com')).getByTitle('Revoke login')).toBeInTheDocument();
});

test('admin: making someone an admin calls the server, and then the last-admin lock lifts', async () => {
  mockServer((url, opts) => (url.endsWith('/admin') && opts.method === 'PUT'
    ? Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }) : null));
  render(<SettingsPage user={{ email: 'chad@philo.ventures', name: 'Chad' }} onLogout={() => {}} />);
  await screen.findByDisplayValue('chad@philo.ventures');

  fireEvent.click(box(rowFor('greg@philo.ventures'), 'Admin'));
  await screen.findByDisplayValue('greg@philo.ventures');
  const put = global.fetch.mock.calls.find(([url, o]) => url.endsWith('/greg%40philo.ventures/admin') && o.method === 'PUT');
  expect(JSON.parse(put[1].body)).toEqual({ isAdmin: true });
  // two admins now -> Chad's own admin box is no longer locked
  await waitFor(() => expect(box(rowFor('chad@philo.ventures'), 'Admin')).toBeEnabled());
  expect(box(rowFor('greg@philo.ventures'), 'Admin')).toBeChecked();
});

test('a refusal from the server is shown, not silently treated as success', async () => {
  mockServer((url, opts) => (opts.method === 'DELETE'
    ? Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "That's the last admin - make someone else an admin first." }) }) : null));
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
  render(<SettingsPage user={{ email: 'chad@philo.ventures', name: 'Chad' }} onLogout={() => {}} />);
  await screen.findByDisplayValue('jeff@addaxoutdoors.com');
  fireEvent.click(within(rowFor('jeff@addaxoutdoors.com')).getByTitle('Revoke login'));
  await screen.findByDisplayValue('jeff@addaxoutdoors.com');
  await new Promise((r) => setTimeout(r, 0));
  expect(alert).toHaveBeenCalledWith("That's the last admin - make someone else an admin first.");
  expect(screen.getByDisplayValue('jeff@addaxoutdoors.com')).toBeInTheDocument(); // still listed
  alert.mockRestore();
});

// ---- App access (Settings -> App access) ----
const appBox = (title) => screen.getByTitle(title);

test('app access: shows grants; admins have everything; non-admins can\'t change anything', async () => {
  mockServer();
  render(<SettingsPage user={{ email: 'greg@philo.ventures', name: 'Greg' }} onLogout={() => {}} />);
  await screen.findByTitle('Project Board for Greg');
  expect(appBox('Project Board for Greg')).toBeChecked();
  expect(appBox('Modeling for Greg')).not.toBeChecked();
  expect(appBox('Modeling for Chad')).toBeChecked(); // admin: everything
  expect(appBox('Modeling for jeff@addaxoutdoors.com')).not.toBeChecked(); // nothing until granted
  expect(appBox('Modeling for Greg')).toBeDisabled(); // Greg isn't an admin
});

test('app access: an admin ticking a heading grants all of its apps in one call', async () => {
  mockServer((url, opts) => {
    if (!(url.endsWith('/api/app-access') && opts.method === 'PUT')) return null;
    const { email, appKeys } = JSON.parse(opts.body);
    grants = { ...grants, [email]: appKeys }; // the server now has it
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, access: grants }) });
  });
  render(<SettingsPage user={{ email: 'chad@philo.ventures', name: 'Chad' }} onLogout={() => {}} />);
  await screen.findByTitle('Project Board for Greg');
  const jeffLabs = within(appBox('Modeling for jeff@addaxoutdoors.com').closest('tr')).getAllByTitle('All of Labs')[0];
  expect(appBox('Modeling for Chad')).toBeDisabled(); // admins can't be narrowed
  fireEvent.click(jeffLabs);
  await waitFor(() => expect(appBox('Modeling for jeff@addaxoutdoors.com')).toBeChecked());
  const put = global.fetch.mock.calls.find(([url, o]) => url.endsWith('/api/app-access') && o.method === 'PUT');
  expect(JSON.parse(put[1].body)).toEqual({ email: 'jeff@addaxoutdoors.com', appKeys: ['board', 'modeling'], granted: true });
});
