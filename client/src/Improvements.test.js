import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import Improvements from './Improvements';

jest.mock('socket.io-client', () => ({ io: () => ({ on: () => {}, disconnect: () => {} }) }));

const ITEM = {
  id: 'a1', seqNum: 33, title: 'Grid looks off', note: 'n', kind: null, status: 'intake',
  hasScreenshot: true, reporterHint: 'broken', priority: 'high', duplicateOf: 12,
  reporterName: 'Greg', createdAt: '2026-10-01T00:00:00Z', context: null,
};

function mockFetch({ canManage }) {
  global.fetch = jest.fn((url) => {
    if (url.endsWith('/api/improvements')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ improvements: [ITEM], canManage }) });
    if (url.endsWith('/api/people')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ people: [] }) });
    if (url.includes('/screenshot')) return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'], { type: 'image/jpeg' })) });
    throw new Error(`unexpected ${url}`);
  });
}

beforeAll(() => { global.URL.createObjectURL = jest.fn(() => 'blob:thumb'); });
afterEach(() => { delete global.fetch; });

test('cards show priority, duplicate and hint; the list has no image data and thumbnails load lazily', async () => {
  let observed = null;
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { observed = this; }
    disconnect() {}
  };
  mockFetch({ canManage: true });
  render(<Improvements />);
  await screen.findByText('Grid looks off');
  expect(screen.getByTitle('High priority')).toBeInTheDocument();
  expect(screen.getByText('Duplicate of #12')).toBeInTheDocument();
  expect(screen.getByText('Reporter says: Something is broken')).toBeInTheDocument();
  // not fetched until the card scrolls into view
  expect(global.fetch.mock.calls.some(([u]) => u.includes('/screenshot'))).toBe(false);
  observed.cb([{ isIntersecting: true }]);
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => u.endsWith('/api/improvements/a1/screenshot'))).toBe(true));
  delete global.IntersectionObserver;
});

test('non-admins can view but cards are not draggable', async () => {
  mockFetch({ canManage: false });
  render(<Improvements />);
  const title = await screen.findByText('Grid looks off');
  expect(title.closest('.imp-card')).toHaveAttribute('draggable', 'false');
  expect(screen.getByText(/Only admins can move or edit cards/)).toBeInTheDocument();
});
