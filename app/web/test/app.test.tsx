import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.jsx';
import { makeView } from './fixture.js';

afterEach(() => cleanup());

describe('the app', () => {
  // @DecisionRef ui:organized-around-hierarchy — the navigation on the left, details on the right.
  it('opens on the first product tree, and selecting in the hierarchy drives the details panel', async () => {
    const view = makeView();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(view), { status: 200 })));
    render(<App />);
    const details = await screen.findByRole('complementary', { name: 'details' });
    expect(within(details).getByRole('heading', { name: 'Demo' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'hierarchy' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Parent rule' }));
    await waitFor(() => expect(within(screen.getByRole('complementary', { name: 'details' })).getByText('Parents rule broadly.')).toBeTruthy());
    fireEvent.click(within(nav).getByRole('button', { name: /up a level/ }));
    await waitFor(() => expect(within(screen.getByRole('complementary', { name: 'details' })).getByRole('heading', { name: 'Demo' })).toBeTruthy());
  });

  // @DecisionRef ui:open-any-ledger — another ledger, opened by its directory.
  it('opens another ledger by its directory', async () => {
    const first = makeView();
    const second = { ...makeView(), corpus: 'second', dir: '/elsewhere/ledger' };
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      new Response(JSON.stringify(String(url) === '/api/open' ? second : first), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '/tmp/fixture/ledger' }));
    fireEvent.change(screen.getByLabelText('ledger directory'), { target: { value: '/elsewhere/ledger' } });
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByText('second');
    expect(fetchMock).toHaveBeenCalledWith('/api/open', expect.objectContaining({ method: 'POST' }));
  });

  it('the findings list travels to the place at fault', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(makeView()), { status: 200 })));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'findings: 1' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'findings' })).getByRole('button', { name: /Parent rule/ }));
    await waitFor(() => expect(within(screen.getByRole('complementary', { name: 'details' })).getByText(/decision names 'app:x'/)).toBeTruthy());
  });
});
