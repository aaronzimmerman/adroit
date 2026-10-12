// @DecisionRef eng:frontend-test-harness — the view's components, driven as a user drives them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChangeOutcome, ChangePreview } from '@adroit/shared';
import { LedgerContext } from '../src/context.js';
import { DetailsPanel } from '../src/components/DetailsPanel.jsx';
import { FindingsList } from '../src/components/Findings.jsx';
import { NavPanel } from '../src/components/NavPanel.jsx';
import { Search } from '../src/components/Search.jsx';
import { makeView } from './fixture.js';

const view = makeView();
let travel: ReturnType<typeof vi.fn>;
let landed: ReturnType<typeof vi.fn>;
let preview: ChangePreview;
let calls: { url: string; body: unknown }[];

const OUTCOME: ChangeOutcome = { ok: true, commit: 'a'.repeat(40), touched: [], suspects: [], marked: [] };

beforeEach(() => {
  travel = vi.fn();
  landed = vi.fn();
  calls = [];
  preview = { suspects: [], touched: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const body = u.startsWith('/api/change/preview')
        ? preview
        : u.startsWith('/api/change')
          ? OUTCOME
          : u.startsWith('/api/search')
            ? { query: 'x', hits: [{ place: 'product/demo/parent-rule', field: 'app:parent-rule · rejected 1', snippet: 'letting children rule', trail: ['product', 'Demo'] }] }
            : u.startsWith('/api/lens')
              ? { id: 'x', citations: [{ id: 'app:parent-rule', file: 'src/a.ts', line: 3, snippet: 'const a = 1;', fileLastChanged: 0, changedSinceDecision: true, diff: '+const a = 1;' }] }
              : {};
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});
afterEach(() => cleanup());

const wrap = (ui: ReactNode) => render(<LedgerContext.Provider value={{ view, travel, landed }}>{ui}</LedgerContext.Provider>);

describe('the navigation panel', () => {
  it('shows the hierarchy from the roots down, and selecting a child makes it current', () => {
    wrap(<NavPanel current="product/demo" expanded={new Set(['product', 'product/demo'])} onToggle={() => {}} />);
    for (const r of ['product', 'capabilities', 'engineering', 'models']) expect(screen.getByRole('button', { name: r })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Parent rule' }));
    expect(travel).toHaveBeenCalledWith('product/demo/parent-rule');
  });

  it('goes up a level from the current node', () => {
    wrap(<NavPanel current="product/demo/parent-rule" expanded={new Set(['product', 'product/demo'])} onToggle={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /up a level/ }));
    expect(travel).toHaveBeenCalledWith('product/demo');
  });

  it('marks rows with their findings, dubious marks and questions', () => {
    wrap(
      <NavPanel
        current="product/demo"
        expanded={new Set(['product', 'product/demo', 'product/demo/parent-rule'])}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByTitle('1 finding(s)')).toBeTruthy();
    expect(screen.getByText('dubious')).toBeTruthy();
    expect(screen.getByTitle('1 open question(s)')).toBeTruthy();
  });

  it('expands and collapses a place', () => {
    const onToggle = vi.fn();
    wrap(<NavPanel current="product" expanded={new Set(['product'])} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'expand Demo' }));
    expect(onToggle).toHaveBeenCalledWith('product/demo');
  });
});

describe('the details panel', () => {
  // @DecisionRef ui:details-panel-right — decisions with rejected, the dubious mark, questions.
  it('shows the node\'s decisions with their rejected alternatives, its mark and its questions', () => {
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    expect(screen.getByText('Parents rule broadly.')).toBeTruthy();
    expect(screen.getByText('letting children rule — too chaotic')).toBeTruthy();
    expect(screen.getByText("decision names 'app:x'")).toBeTruthy();
    cleanup();
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    expect(screen.getByRole('note').textContent).toContain('"Parent rule" changed');
    cleanup();
    wrap(<DetailsPanel current="product/demo" />);
    expect(screen.getByText('Does the demo need accounts?')).toBeTruthy();
  });

  // @DecisionRef ui:ancestors-grouped-by-ancestor — each ancestor's decisions under its name.
  // @DecisionRef ui:severed-shown-marked — a severed decision still shows, marked.
  it('groups the binding decisions by ancestor and marks the severed one', () => {
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    const above = screen.getByRole('region', { name: 'binding from above' });
    expect(within(above).getByRole('button', { name: 'Demo' })).toBeTruthy();
    expect(within(above).getByRole('button', { name: 'Parent rule' })).toBeTruthy();
    const severed = within(above).getByText(/Every surface works with no network/).closest('li')!;
    expect(severed.className).toBe('severed');
    expect(within(severed).getByText(/severed by/)).toBeTruthy();
  });

  // @DecisionRef ui:capabilities-shown-summarized — summarized by the root's decisions.
  // @DecisionRef ui:open-a-capability — and opened in the navigation panel from there.
  it('summarizes each capability in scope by its root\'s decisions, with a way to open it', () => {
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    const caps = screen.getByRole('region', { name: 'capabilities in scope' });
    expect(within(caps).getByText(/The user is told when something happens/)).toBeTruthy();
    expect(within(caps).getByText(/1 more decision in its tree/)).toBeTruthy();
    fireEvent.click(within(caps).getByRole('button', { name: 'open capability notify' }));
    expect(travel).toHaveBeenCalledWith('capabilities/notify');
  });

  it('shows a capability\'s includers', () => {
    wrap(<DetailsPanel current="capabilities/notify" />);
    const inc = screen.getByRole('region', { name: 'included by' });
    fireEvent.click(within(inc).getByRole('button', { name: 'Demo' }));
    expect(travel).toHaveBeenCalledWith('product/demo');
  });

  // @DecisionRef ui:models-read-as-fields — fields, deployed beside intended.
  it('reads a model as its fields, deployed beside intended', () => {
    wrap(<DetailsPanel current="models/model.widget.yaml" />);
    expect(screen.getByText('scalar — how big')).toBeTruthy();
    expect(screen.getByText('scalar — in millimetres')).toBeTruthy();
  });

  // @DecisionRef ui:read-only-code-lens — snippets and what changed, and nothing to edit code with.
  it('opens the code lens on a decision', async () => {
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    fireEvent.click(screen.getByRole('button', { name: 'code lens' }));
    await screen.findByText('src/a.ts:3');
    expect(screen.getByText('changed since the decision did')).toBeTruthy();
    expect(screen.getByText('+const a = 1;')).toBeTruthy();
  });
});

describe('editing in place', () => {
  // @DecisionRef ui:change-shows-implications — the reach shows while editing.
  // @DecisionRef ui:walk-the-suspect-set — each suspect is walked before the commit.
  // @DecisionRef ui:commit-never-gated — the commit lands with suspects still unworked.
  it('an edit shows its reach, walks the suspects, and commits without working them all', async () => {
    preview = {
      suspects: [
        { place: 'product/demo/parent-rule/online-only', readAt: 'product/demo/parent-rule/online-only', name: 'Online only', reason: '"Parent rule" changed' },
        { place: 'product/demo/parent-rule/online-only/deep-leaf.yaml', readAt: 'product/demo/parent-rule/online-only/deep-leaf.yaml', name: 'Deep leaf', reason: '"Parent rule" changed' },
      ],
      touched: [],
    };
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    fireEvent.click(screen.getByRole('button', { name: 'edit app:parent-rule decision' }));
    expect(screen.getByText(/Changing this makes 2 nodes that depend on it suspect/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('app:parent-rule decision'), { target: { value: 'Parents rule kindly.' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    const walk = await screen.findByLabelText('change walk');
    expect(within(walk).getByText(/makes 2 nodes suspect/)).toBeTruthy();
    expect(within(walk).getByText('This corner works online only.')).toBeTruthy();
    fireEvent.click(within(walk).getByRole('button', { name: /still holds/ }));
    fireEvent.click(within(walk).getByRole('button', { name: /commit — 1 unworked will be marked dubious/ }));
    await waitFor(() => expect(landed).toHaveBeenCalledWith(OUTCOME));
    const commit = calls.find((c) => c.url === '/api/change')!.body as { operations: unknown[]; worked: string[] };
    expect(commit.operations).toEqual([
      { op: 'edit-decision', place: 'product/demo/parent-rule', id: 'app:parent-rule', field: 'decision', value: 'Parents rule kindly.', clearDubious: false },
    ]);
    expect(commit.worked).toEqual(['product/demo/parent-rule/online-only']);
  });

  it('a suspect edited in the walk joins the same change', async () => {
    preview = {
      suspects: [{ place: 'product/demo/parent-rule/online-only', readAt: 'product/demo/parent-rule/online-only', name: 'Online only', reason: 'r' }],
      touched: [],
    };
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    fireEvent.click(screen.getByRole('button', { name: 'edit app:parent-rule decision' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    const walk = await screen.findByLabelText('change walk');
    fireEvent.click(within(walk).getByRole('button', { name: 'edit it' }));
    fireEvent.change(within(walk).getByLabelText('app:online-only text'), { target: { value: 'Online, mostly.' } });
    fireEvent.click(within(walk).getByRole('button', { name: 'add these edits to the change' }));
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/change/preview')).toHaveLength(2));
    fireEvent.click(await within(walk).findByRole('button', { name: /^commit/ }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    const commit = calls.find((c) => c.url === '/api/change')!.body as { operations: { id: string }[]; worked: string[] };
    expect(commit.operations.map((o) => o.id)).toEqual(['app:parent-rule', 'app:online-only']);
    expect(commit.worked).toEqual(['product/demo/parent-rule/online-only']);
  });

  // @DecisionRef ui:single-field-one-act — nothing suspect: the edit commits in one act.
  it('an edit that makes nothing suspect commits straight away', async () => {
    wrap(<DetailsPanel current="product/demo" />);
    fireEvent.click(screen.getByRole('button', { name: 'edit questions' }));
    fireEvent.change(screen.getByLabelText('questions, one per line'), { target: { value: 'Does the demo need accounts?\nWho hosts it?' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    const commit = calls.find((c) => c.url === '/api/change')!.body as { operations: { value: string[] }[] };
    expect(commit.operations[0].value).toEqual(['Does the demo need accounts?', 'Who hosts it?']);
  });

  it('editing a dubious node offers to clear its mark, on by default', async () => {
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    fireEvent.click(screen.getByRole('button', { name: 'edit questions' }));
    expect((screen.getByRole('checkbox', { name: /clears its dubious mark/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: { clearDubious: boolean }[] }).operations[0].clearDubious).toBe(true);
  });

  // @DecisionRef ui:dubious-clears-on-work — confirming is one commit removing the mark.
  it('confirms a dubious node in one step', async () => {
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    fireEvent.click(screen.getByRole('button', { name: /read it through and it holds/ }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: unknown[] }).operations).toEqual([
      { op: 'confirm', place: 'product/demo/parent-rule/online-only' },
    ]);
  });

  // @DecisionRef ui:dubious-set-by-hand — the person states what they saw.
  it('marks a node dubious by hand with the reason given', async () => {
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    fireEvent.click(screen.getByRole('button', { name: 'mark dubious…' }));
    fireEvent.change(screen.getByPlaceholderText('one line: the contradiction'), { target: { value: 'contradicts the story' } });
    fireEvent.click(screen.getByRole('button', { name: 'mark dubious' }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: unknown[] }).operations).toEqual([
      { op: 'mark-dubious', place: 'product/demo/parent-rule', reason: 'contradicts the story' },
    ]);
  });

  it('a refusal explains itself, and the user returns to the edit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, refusal: 'the check would fail: x' }), { status: 422 })));
    wrap(<DetailsPanel current="product/demo" />);
    fireEvent.click(screen.getByRole('button', { name: 'edit includes' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('the check would fail: x');
    fireEvent.click(screen.getByRole('button', { name: 'back to the edit' }));
    expect(screen.getByRole('button', { name: 'save' })).toBeTruthy();
  });

  it('adds a node beneath the current one', async () => {
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    fireEvent.click(screen.getByRole('button', { name: 'add a node beneath' }));
    const form = screen.getByLabelText('add a node');
    fireEvent.change(within(form).getByLabelText('name'), { target: { value: 'Grandchild' } });
    fireEvent.change(within(form).getByLabelText(/first decision's id/), { target: { value: 'app:grandchild' } });
    fireEvent.change(within(form).getByLabelText('the decision, one clause'), { target: { value: 'A grandchild rule.' } });
    fireEvent.click(within(form).getByRole('button', { name: /create beneath Parent rule/ }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: { op: string; parent: string }[] }).operations[0]).toMatchObject({
      op: 'create-node',
      parent: 'product/demo/parent-rule',
    });
  });
});

describe('search and findings', () => {
  // @DecisionRef ui:selecting-a-hit-travels — a hit makes its node current.
  it('a hit shows what matched and where, and selecting it travels there', async () => {
    wrap(<Search />);
    fireEvent.change(screen.getByLabelText('search the ledger'), { target: { value: 'children' } });
    const hit = await screen.findByRole('option');
    expect(hit.textContent).toContain('product › Demo');
    expect(hit.textContent).toContain('letting children rule');
    fireEvent.click(hit);
    expect(travel).toHaveBeenCalledWith('product/demo/parent-rule');
  });

  // @DecisionRef ui:findings-list-travels — the list takes the user to each finding's place.
  it('the findings list travels to a finding\'s place', () => {
    const onClose = vi.fn();
    wrap(<FindingsList onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Parent rule/ }));
    expect(travel).toHaveBeenCalledWith('product/demo/parent-rule');
    expect(onClose).toHaveBeenCalled();
  });
});
