import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectResources from './ProjectResources';

function Harness({ initial = [] }) {
  const [links, setLinks] = useState(initial);
  return (
    <>
      <ProjectResources projectId="p1" projectName="Zion Promenade" links={links} onLinksChange={(u) => setLinks(u)} />
      <output data-testid="links">{JSON.stringify(links)}</output>
    </>
  );
}

const FOLDERS = [
  { id: 'f1', name: 'Willow', url: 'https://drive.google.com/drive/folders/f1' },
  { id: 'f2', name: 'Zion Promenade', url: 'https://drive.google.com/drive/folders/f2' },
];

afterEach(() => { delete global.fetch; });

test('"Add folder" opens the picker with the matching folder suggested first; picking one saves it', async () => {
  global.fetch = jest.fn((url, opts = {}) => {
    if (url.endsWith('/api/drive/project-folders')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ folders: FOLDERS }) });
    }
    if (url.endsWith('/api/origination/link') && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ link: { id: 7, ...body } }) });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<Harness />);

  fireEvent.click(screen.getByText('＋ Add folder'));
  await screen.findByText('Willow');
  const names = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(names).toEqual(['Zion PromenadeSuggested', 'Willow']);

  fireEvent.click(screen.getByText('Zion Promenade'));
  await waitFor(() => expect(JSON.parse(screen.getByTestId('links').textContent)).toHaveLength(1));
  const saved = JSON.parse(screen.getByTestId('links').textContent)[0];
  expect(saved).toMatchObject({ kind: 'folder', title: 'Zion Promenade', url: 'https://drive.google.com/drive/folders/f2' });
  // tile shows the slot name with the folder's name underneath
  expect(screen.getByText('Project Folder')).toBeInTheDocument();
  expect(screen.getAllByText('Zion Promenade').length).toBeGreaterThan(0);
});

test('when Drive isn\'t set up, the picker says what to share and offers paste instead', async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: false,
    json: () => Promise.resolve({ error: 'The Projects folder isn\'t shared with HeyPhil yet.', setup: true, serviceAccountEmail: 'bot@x.iam.gserviceaccount.com' }),
  }));
  render(<Harness />);
  fireEvent.click(screen.getByText('＋ Add folder'));
  await screen.findByText(/isn't shared with HeyPhil yet/);
  expect(screen.getByText('bot@x.iam.gserviceaccount.com')).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/Paste a folder link/)).toBeInTheDocument();
});
