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

const OUTCOME: ChangeOutcome = { ok: true, commit: 'a'.repeat(40), touched: [], suspects: [], removed: [], marked: [] };

beforeEach(() => {
  travel = vi.fn();
  landed = vi.fn();
  calls = [];
  preview = { suspects: [], removed: [], touched: [] };
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

  // @DecisionRef ui:current-kept-in-view — the current row is brought into view each time it changes.
  it('brings the current row into view whenever the current node changes', () => {
    const scrolled: string[] = [];
    // jsdom has no layout, so no scrollIntoView: record which row asks for it. Browsers may return
    // a promise from it, which an effect must never hand back to React as its cleanup.
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.textContent ?? '');
      return Promise.resolve() as unknown as void;
    };
    const open = new Set(['product', 'product/demo', 'models']);
    const { rerender } = wrap(<NavPanel current="product/demo" expanded={open} onToggle={() => {}} />);
    expect(scrolled.at(-1)).toContain('Demo');
    rerender(
      <LedgerContext.Provider value={{ view, travel, landed }}>
        <NavPanel current="models/widget.yaml" expanded={open} onToggle={() => {}} />
      </LedgerContext.Provider>,
    );
    expect(scrolled.at(-1)).toContain('view:widget');
    cleanup();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  // @DecisionRef ui:capabilities-shown-summarized — beneath its includer, after its children, marked.
  // @DecisionRef ui:open-a-capability — selecting the graft opens the capability.
  it('shows a capability grafted beneath its includer, after its children, and opens it', () => {
    wrap(<NavPanel current="product/demo" expanded={new Set(['product', 'product/demo', 'product/demo/parent-rule'])} onToggle={() => {}} />);
    const graft = screen.getByRole('button', { name: 'capability notify, grafted here' });
    expect(graft.getAttribute('title')).toBe('The user is told when something happens.');
    const demoList = screen.getByRole('button', { name: 'Demo' }).closest('li')!.querySelector('ul')!;
    const rows = [...demoList.children].map((li) => li.querySelector('.nav-label')!.textContent);
    expect(rows).toEqual(['Parent rule', '⤷ notify']);
    expect(screen.getAllByRole('button', { name: /grafted here/ })).toHaveLength(1);
    fireEvent.click(graft);
    expect(travel).toHaveBeenCalledWith('capabilities/notify');
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
  // @DecisionRef ui:details-panel-right — the decision with rejected, the dubious mark, questions.
  it('shows the node\'s decision with its rejected alternatives, its mark and its questions', () => {
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    const own = screen.getByRole('region', { name: 'the decision' });
    expect(within(own).getByText('Parents rule broadly.')).toBeTruthy();
    expect(within(own).getByText('letting children rule — too chaotic')).toBeTruthy();
    expect(screen.getByText('app:parent-rule', { selector: 'code.decision-id' })).toBeTruthy();
    // the views it governs: the one it lists, and one a field token names
    fireEvent.click(within(own).getByRole('button', { name: 'view:widget' }));
    expect(travel).toHaveBeenCalledWith('models/widget.yaml');
    expect(within(own).getByText(/by a field token/).parentElement!.textContent).toContain('view:part');
    expect(screen.getByText("decision names 'app:x'")).toBeTruthy();
    cleanup();
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    expect(screen.getByRole('note').textContent).toContain('"Parent rule" changed');
    cleanup();
    wrap(<DetailsPanel current="product/demo" />);
    expect(screen.getByText('Does the demo need accounts?')).toBeTruthy();
  });

  // @DecisionRef ui:trace-dependence — the path down, each step selectable, its decision on hover.
  it('shows where a node sits: its path, each step\'s decision on hover, nothing listed as binding it', () => {
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    const at = screen.getByRole('region', { name: 'where it sits' });
    const path = within(at).getByRole('navigation', { name: 'path' });
    expect(within(path).getAllByRole('button').map((b) => b.textContent)).toEqual(['Demo', 'Parent rule']);
    const tips = within(path).getAllByRole('tooltip', { hidden: true }).map((t) => t.textContent);
    expect(tips).toEqual(['A user can demo things.', 'Parents rule broadly.']);
    const step = within(path).getByRole('button', { name: 'Parent rule' });
    expect(document.getElementById(step.getAttribute('aria-describedby')!)!.textContent).toBe('Parents rule broadly.');
    expect(at.textContent).not.toContain('A how of');
    // @DecisionRef ui:details-panel-right — the header names the id alone, no path or tree.
    const header = screen.getByRole('heading', { name: 'Online only' }).closest('header')!;
    expect(header.textContent).toContain('app:online-only');
    expect(header.textContent).not.toContain('product/demo');
    // the empty grafts line says nothing; its control says what it does
    expect(screen.queryByText('No capability grafted beneath.')).toBeNull();
    expect(screen.getByRole('button', { name: 'edit includes' }).textContent).toBe('graft a capability…');
    fireEvent.click(within(path).getByRole('button', { name: 'Demo' }));
    expect(travel).toHaveBeenCalledWith('product/demo');
  });

  // @DecisionRef ui:capabilities-shown-summarized — not a field here; only its editor.
  // @DecisionRef ui:children-as-buttons — each child a button that makes it current.
  it('shows each child beneath as a button that makes it current', () => {
    wrap(<DetailsPanel current="product/demo" />);
    const beneath = screen.getByRole('region', { name: 'children' });
    const child = within(beneath).getByRole('button', { name: 'Parent rule' });
    expect(child.className).toContain('child-button');
    fireEvent.click(child);
    expect(travel).toHaveBeenCalledWith('product/demo/parent-rule');
  });

  it('leaves a node\'s grafts out of its fields, editing them beneath', () => {
    wrap(<DetailsPanel current="product/demo" />);
    expect(screen.queryByRole('heading', { name: 'Includes' })).toBeNull();
    const grafted = screen.getByRole('region', { name: 'grafted beneath' });
    expect(grafted.textContent).toContain('grafted beneath: notify');
    expect(within(grafted).getByRole('button', { name: 'edit includes' })).toBeTruthy();
  });

  // @DecisionRef ui:notes-collapsed — closed until opened, each saying it is there.
  // @DecisionRef ui:decision-text-prominent — the decision stands on its own, set apart.
  it('collapses questions and context, each saying whether it holds anything', () => {
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    const questions = screen.getByRole('group', { name: 'questions' }) as HTMLDetailsElement;
    const context = screen.getByRole('group', { name: 'context' }) as HTMLDetailsElement;
    expect(questions.open).toBe(false);
    expect(context.open).toBe(false);
    expect(questions.querySelector('summary')!.textContent).toContain('none');
    // @DecisionRef ui:rejected-collapsed — closed beneath the decision, saying how many.
    const rejected = screen.getByRole('group', { name: 'rejected' }) as HTMLDetailsElement;
    expect(rejected.open).toBe(false);
    expect(rejected.querySelector('summary')!.textContent).toContain('(1)');
    expect(rejected.closest('.decision-card')).toBeTruthy();
    expect(context.querySelector('summary')!.textContent).not.toContain('none');
    expect(screen.getByText('Parents rule broadly.').closest('.decision-card')).toBeTruthy();
    cleanup();
    wrap(<DetailsPanel current="product/demo" />);
    expect(screen.getByRole('group', { name: 'questions' }).querySelector('summary')!.textContent).toContain('(1)');
  });

  it('shows a capability\'s includers', () => {
    wrap(<DetailsPanel current="capabilities/notify" />);
    const inc = screen.getByRole('region', { name: 'included by' });
    fireEvent.click(within(inc).getByRole('button', { name: 'Demo' }));
    expect(travel).toHaveBeenCalledWith('product/demo');
  });

  // @DecisionRef ui:field-token-opens-its-view — a token naming a field travels to its view, the
  // field picked out; one naming no field stays plain text.
  it('shows a field token as its field, and selecting it opens the view with the field picked out', () => {
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only/deep-leaf.yaml" />);
    const decision = screen.getByRole('region', { name: 'the decision' });
    fireEvent.click(within(decision).getByRole('button', { name: 'field size of view:widget' }));
    expect(travel).toHaveBeenCalledWith('models/widget.yaml', 'size');
    expect(within(decision).queryByRole('button', { name: /colour/ })).toBeNull();
    expect(decision.textContent).toContain('never by {widget.colour}.');
    cleanup();
    const scrolled: string[] = [];
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.textContent ?? '');
      return Promise.resolve() as unknown as void;
    };
    wrap(<DetailsPanel current="models/widget.yaml" field="size" />);
    const fields = screen.getByRole('table', { name: 'fields' });
    expect(within(fields).getByText('size').closest('tr')!.getAttribute('aria-current')).toBe('true');
    expect(within(fields).getByText('name').closest('tr')!.getAttribute('aria-current')).toBeNull();
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]).toContain('size');
    cleanup();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  // @DecisionRef ui:views-read-as-fields — each typed field: type, citations, meaning; and links.
  it('reads a view as its typed fields, with its links', () => {
    wrap(<DetailsPanel current="models/widget.yaml" />);
    const fields = screen.getByRole('table', { name: 'fields' });
    const size = within(fields).getByText('size').closest('tr')!;
    expect(within(size).getByText('int')).toBeTruthy();
    expect(within(size).getByText('how big it is')).toBeTruthy();
    expect(within(size).getByText('none')).toBeTruthy();
    fireEvent.click(within(fields).getByRole('button', { name: 'app:parent-rule' }));
    expect(travel).toHaveBeenCalledWith('product/demo/parent-rule');
    const links = screen.getByRole('region', { name: 'links' });
    expect(links.textContent).toContain('consumes view:part');
    expect(links.textContent).toContain('grounds in principle:derive-dont-materialize');
  });

  // @DecisionRef ui:views-not-changed-here — a view is read, never changed, in the UI.
  it('offers no way to change a view', () => {
    wrap(<DetailsPanel current="models/widget.yaml" />);
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    const buttons = screen.queryAllByRole('button').map((b) => b.textContent);
    expect(buttons.every((t) => /^(app|view|principle):/.test(t ?? ''))).toBe(true);
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
  // @DecisionRef ui:suspect-set-shown — every suspect is shown before the commit.
  // @DecisionRef ui:commit-never-gated — the commit is one press away, whatever the set holds.
  // @DecisionRef ui:commit-marks-suspects — the commit says it marks each suspect.
  it('an edit shows its reach, then the suspect set, and commits it in one press', async () => {
    preview = {
      suspects: [
        { place: 'product/demo/parent-rule/online-only', readAt: 'product/demo/parent-rule/online-only', name: 'Online only', reason: '"Parent rule" changed' },
        { place: 'product/demo/parent-rule/online-only/deep-leaf.yaml', readAt: 'product/demo/parent-rule/online-only/deep-leaf.yaml', name: 'Deep leaf', reason: '"Parent rule" changed' },
      ],
      removed: [],
      touched: [],
    };
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    fireEvent.click(screen.getByRole('button', { name: 'edit decision' }));
    expect(screen.getByText(/Changing this makes 2 nodes that depend on it suspect/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('decision'), { target: { value: 'Parents rule kindly.' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    const set = await screen.findByRole('region', { name: 'made suspect by this change' });
    expect(within(set).getByText(/makes 2 nodes suspect/)).toBeTruthy();
    expect(within(set).getByText('Online only')).toBeTruthy();
    expect(within(set).getByText('Deep leaf')).toBeTruthy();
    // no per-suspect walk: nothing to confirm or edit inside the change
    expect(screen.queryByRole('button', { name: /still holds|edit it|skip/ })).toBeNull();
    expect(landed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'commit — marks 2 dubious' }));
    await waitFor(() => expect(landed).toHaveBeenCalledWith(OUTCOME));
    const commit = calls.find((c) => c.url === '/api/change')!.body as Record<string, unknown>;
    expect(commit).toEqual({
      operations: [{ op: 'edit-node', place: 'product/demo/parent-rule', field: 'decision', value: 'Parents rule kindly.', clearDubious: false }],
    });
  });

  it('edits the references as lines', async () => {
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    fireEvent.click(screen.getByRole('button', { name: 'edit references' }));
    fireEvent.change(screen.getByLabelText('references, one per line'), { target: { value: 'view:widget\n view:part \n' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: unknown[] }).operations).toEqual([
      { op: 'edit-node', place: 'product/demo/parent-rule', field: 'references', value: ['view:widget', 'view:part'], clearDubious: false },
    ]);
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

  // @DecisionRef ui:edit-offers-clearing — checked by default, and the editor can uncheck it.
  it('editing a dubious node offers to clear its mark, on by default', async () => {
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    fireEvent.click(screen.getByRole('button', { name: 'edit questions' }));
    expect((screen.getByRole('checkbox', { name: /clears its dubious mark/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: { clearDubious: boolean }[] }).operations[0].clearDubious).toBe(true);
    cleanup();
    calls = [];
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    fireEvent.click(screen.getByRole('button', { name: 'edit questions' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /clears its dubious mark/ }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/change')).toBe(true));
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: { clearDubious: boolean }[] }).operations[0].clearDubious).toBe(false);
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

  // @DecisionRef ui:dubious-set-by-hand — marked while asking a question, the question its reason.
  it('marks a node dubious only while asking a question, which stays on the node', async () => {
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    expect(screen.queryByRole('button', { name: /mark dubious/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ask a question…' }));
    const form = screen.getByLabelText('ask a question');
    fireEvent.change(within(form).getByLabelText(/the question/), { target: { value: ' contradicts\n the story? ' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: /mark this node dubious/ }));
    expect(within(form).getByText(/The 2 nodes beneath are marked too/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'ask and mark dubious' }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: unknown[] }).operations).toEqual([
      { op: 'edit-node', place: 'product/demo/parent-rule', field: 'questions', value: ['contradicts the story?'], clearDubious: false },
      { op: 'mark-dubious', place: 'product/demo/parent-rule', reason: 'contradicts the story?' },
    ]);
  });

  it('asks a question without marking anything', async () => {
    wrap(<DetailsPanel current="product/demo" />);
    fireEvent.click(screen.getByRole('button', { name: 'ask a question…' }));
    fireEvent.change(screen.getByLabelText(/the question/), { target: { value: 'Who hosts it?' } });
    fireEvent.click(screen.getByRole('button', { name: 'ask' }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: unknown[] }).operations).toEqual([
      { op: 'edit-node', place: 'product/demo', field: 'questions', value: ['Does the demo need accounts?', 'Who hosts it?'], clearDubious: false },
    ]);
  });

  // @DecisionRef ui:dubious-with-questions — the mark sits with the questions, open while it stands.
  // @DecisionRef ui:header-one-line — name, id and the dependents as a bare number on one line.
  it('puts the dubious mark with the open questions, and the header on one line', () => {
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    const questions = screen.getByRole('group', { name: 'questions' }) as HTMLDetailsElement;
    expect(questions.open).toBe(true);
    expect(within(questions).getByRole('note').textContent).toContain('"Parent rule" changed');
    cleanup();
    wrap(<DetailsPanel current="product/demo/parent-rule" />);
    const line = screen.getByRole('heading', { name: 'Parent rule' }).closest('.title-line')!;
    expect(line.textContent).toContain('app:parent-rule');
    const count = within(line as HTMLElement).getByLabelText('2 nodes depend on this one');
    expect(count.textContent).toBe('2');
    expect(screen.queryByText(/depend on this one/)).toBeNull();
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
    fireEvent.change(within(form).getByLabelText('id'), { target: { value: 'app:grandchild' } });
    fireEvent.change(within(form).getByLabelText('the decision, one clause'), { target: { value: 'A grandchild rule.' } });
    fireEvent.click(within(form).getByRole('button', { name: /create beneath Parent rule/ }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: unknown[] }).operations[0]).toEqual({
      op: 'create-node',
      parent: 'product/demo/parent-rule',
      doc: { id: 'app:grandchild', name: 'Grandchild', decision: 'A grandchild rule.', rejected: [] },
    });
  });

  // @DecisionRef ui:delete-a-node — a node and everything beneath it.
  // @DecisionRef ui:deletion-shows-everything-lost — every node and decision, before the commit.
  it('a deletion shows every node and decision it removes, and commits only when asked', async () => {
    preview = {
      suspects: [],
      removed: [
        { place: 'product/demo/parent-rule/online-only/deep-leaf.yaml', name: 'Deep leaf', id: 'app:deep-leaf', decision: 'Deep leaves live here.' },
        { place: 'product/demo/parent-rule/online-only', name: 'Online only', id: 'app:online-only', decision: 'This corner works online only.' },
      ],
      touched: [],
    };
    wrap(<DetailsPanel current="product/demo/parent-rule/online-only" />);
    fireEvent.click(screen.getByRole('button', { name: 'delete…' }));
    const lost = await screen.findByRole('region', { name: 'deleted by this change' });
    expect(within(lost).getByText(/deletes 2 nodes/)).toBeTruthy();
    expect(within(lost).getByText('app:deep-leaf')).toBeTruthy();
    expect(within(lost).getByText(/This corner works online only/)).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/change')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'delete and commit' }));
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect((calls.find((c) => c.url === '/api/change')!.body as { operations: unknown[] }).operations).toEqual([
      { op: 'delete-node', place: 'product/demo/parent-rule/online-only' },
    ]);
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
