import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryCommit } from '@adroit/shared';
import { App } from '../src/App.jsx';
import { HistoryPanel } from '../src/components/HistoryPanel.jsx';
import { makeView } from './fixture.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const first: HistoryCommit = { hash: 'a'.repeat(40), subject: 'Clarify the rule', author: 'Ada', epoch: 1_700_000_000 };
const second: HistoryCommit = { hash: 'b'.repeat(40), subject: 'Initial ledger', author: 'Sam', epoch: 1_600_000_000 };
const files = [{ path: 'product/demo/rule.yaml', status: 'M' }, { path: 'engineering/removed.yaml', status: 'D' }];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const patch = (text: string) => `diff --git a/rule.yaml b/rule.yaml\n--- a/rule.yaml\n+++ b/rule.yaml\n@@ -1,2 +1,2 @@\n keep this\n-old rule\n+${text}\n`;

function mockFetch(override?: (url: URL) => Response | Promise<Response> | undefined) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const custom = override?.(url);
    if (custom) return custom;
    if (url.pathname === '/api/ledger') return response(makeView());
    if (url.pathname === '/api/history') return response({ head: first.hash, commits: [first, second], hasMore: false });
    if (url.pathname === '/api/history/files') return response({ commit: url.searchParams.get('commit'), parent: second.hash, files });
    if (url.pathname === '/api/history/diff') return response({ commit: url.searchParams.get('commit'), path: url.searchParams.get('path'), patch: url.searchParams.get('path') === files[1].path ? '@@ -1 +0,0 @@\n-removed rule\n' : patch('new rule') });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('history mode', () => {
  // @DecisionRef ui:switch-reading-modes — returning to the full ledger restores its selected node.
  // @DecisionRef ui:selected-file-diff — additions and deletions read as a patch, with no edit controls.
  it('switches between the full ledger and commit/file/diff navigation without losing the ledger place', async () => {
    mockFetch();
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'hierarchy' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Parent rule' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const diff = await screen.findByLabelText('diff lines');
    expect(diff.textContent).toContain('+new rule');
    expect(diff.querySelector('.diff-add')?.textContent).toContain('+new rule');
    expect(diff.querySelector('.diff-delete')?.textContent).toContain('-old rule');
    expect(screen.queryByRole('navigation', { name: 'hierarchy' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(within(screen.getByRole('region', { name: 'changed files' })).getByRole('button', { name: /Deleted engineering\/removed.yaml/ }));
    await waitFor(() => expect(screen.getByLabelText('diff lines').textContent).toContain('-removed rule'));
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }));
    expect(within(screen.getByRole('complementary', { name: 'details' })).getByText('Parents rule broadly.')).toBeTruthy();
  });

  it('discards late file lists after selecting a different commit', async () => {
    let finish!: (r: Response) => void;
    mockFetch((url) => url.pathname === '/api/history/files' && url.searchParams.get('commit') === first.hash
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : undefined);
    render(<HistoryPanel inRepo />);
    await screen.findByText('Reading changed files…');
    fireEvent.click(screen.getByRole('button', { name: /Initial ledger/ }));
    await screen.findByLabelText('diff lines');
    await act(async () => finish(response({ commit: first.hash, parent: null, files: [{ path: 'wrong-old-file.yaml', status: 'A' }] })));
    expect(screen.queryByText('wrong-old-file.yaml')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'changed files' })).getByText(second.hash.slice(0, 8))).toBeTruthy();
  });

  it('discards late diffs after selecting a different file', async () => {
    let finish!: (r: Response) => void;
    mockFetch((url) => url.pathname === '/api/history/diff' && url.searchParams.get('path') === files[0].path
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : undefined);
    render(<HistoryPanel inRepo />);
    await screen.findByText('Reading diff…');
    fireEvent.click(within(screen.getByRole('region', { name: 'changed files' })).getByRole('button', { name: /Deleted/ }));
    await screen.findByLabelText('diff lines');
    await act(async () => finish(response({ commit: first.hash, path: files[0].path, patch: patch('stale contents') })));
    expect(screen.getByLabelText('diff lines').textContent).toContain('-removed rule');
    expect(screen.getByLabelText('diff lines').textContent).not.toContain('stale contents');
  });

  // @DecisionRef ui:recent-ledger-commits — loading older commits preserves the selection and fixed history tip.
  it('loads older commits and refreshes the list', async () => {
    const fetch = mockFetch((url) => {
      if (url.pathname !== '/api/history') return undefined;
      return response({ head: first.hash, commits: url.searchParams.get('skip') === '0' ? [first] : [second], hasMore: url.searchParams.get('skip') === '0' });
    });
    render(<HistoryPanel inRepo />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load older commits' }));
    await screen.findByRole('button', { name: /Initial ledger/ });
    expect(fetch).toHaveBeenCalledWith(`/api/history?skip=1&head=${first.hash}`, undefined);
    expect(screen.getByRole('button', { name: /Clarify the rule/ }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('button', { name: 'Load older commits' });
    expect(screen.queryByRole('button', { name: /Initial ledger/ })).toBeNull();
  });

  // @DecisionRef eng:refusal-explains-itself — errors are shown where they happened and can be retried.
  it('shows server refusals and retries history and diff requests', async () => {
    let historyFailed = false;
    let diffFailed = false;
    mockFetch((url) => {
      if (url.pathname === '/api/history' && !historyFailed) { historyFailed = true; return response({ refusal: 'History unavailable right now' }, 422); }
      if (url.pathname === '/api/history/diff' && !diffFailed) { diffFailed = true; return response({ refusal: 'Commit no longer available' }, 422); }
      return undefined;
    });
    render(<HistoryPanel inRepo />);
    expect((await screen.findByRole('alert')).textContent).toBe('History unavailable right now');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Commit no longer available');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText('diff lines');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows empty and non-Git histories clearly', async () => {
    const fetch = mockFetch((url) => url.pathname === '/api/history' ? response({ head: null, commits: [], hasMore: false }) : undefined);
    const { unmount } = render(<HistoryPanel inRepo />);
    await screen.findByText('No commits have changed this ledger yet.');
    unmount();
    fetch.mockClear();
    render(<HistoryPanel inRepo={false} />);
    expect(screen.getByText(/has no Git history/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('replaces history when another ledger is opened', async () => {
    let opened = false;
    mockFetch((url) => {
      if (url.pathname === '/api/open') { opened = true; return response({ ...makeView(), dir: '/other/ledger', corpus: 'other' }); }
      if (opened && url.pathname === '/api/history') return response({ head: null, commits: [], hasMore: false });
      return undefined;
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'History' }));
    await screen.findByLabelText('diff lines');
    fireEvent.click(screen.getByRole('button', { name: '/tmp/fixture/ledger' }));
    fireEvent.change(screen.getByLabelText('ledger directory'), { target: { value: '/other/ledger' } });
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByText('No commits have changed this ledger yet.');
    expect(screen.queryByRole('button', { name: /Clarify the rule/ })).toBeNull();
    expect(screen.queryByLabelText('diff lines')).toBeNull();
  });
});
