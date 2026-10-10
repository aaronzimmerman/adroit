import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EngineeringView } from '../src/components/EngineeringView.jsx';
import { GapsPanel } from '../src/components/GapsPanel.jsx';
import { ModelsView } from '../src/components/ModelsView.jsx';
import { RecordOverlay } from '../src/components/RecordOverlay.jsx';
import { SearchPanel } from '../src/components/SearchPanel.jsx';
import { SuspectsPanel } from '../src/components/SuspectsPanel.jsx';
import { makeSnapshot } from './fixture.js';

const snap = makeSnapshot();

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      const body = u.startsWith('/api/impact')
        ? {
            id: 'x',
            descendants: ['app:child-rule'],
            consumers: ['app:consumer-rule'],
            dependents: [],
            moved: ['app:severed-zone', 'app:deep-leaf'],
          }
        : u.startsWith('/api/lens/citations')
          ? { id: 'x', citations: [], axis: 'test' }
          : { ok: true, committed: true, commit: 'a'.repeat(40), touched: [], suspects: [], markedDubious: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});

describe('RecordOverlay', () => {
  it('shows the rule, the rejected losers and the context in place', () => {
    render(
      <RecordOverlay snapshot={snap} id="app:parent-rule" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    expect(screen.getByText('Parents rule broadly.')).toBeTruthy();
    expect(screen.getByText(/letting children rule/)).toBeTruthy();
    expect(screen.getByText('because')).toBeTruthy();
  });

  // @DecisionRef ui:commitments-always-visible — effective commitments, inherited no
  // less than declared, each with its declaring record reachable.
  it('shows inherited commitments with the declaring record reachable', () => {
    const onTravel = vi.fn();
    render(
      <RecordOverlay snapshot={snap} id="app:child-rule" onClose={() => {}} onTravel={onTravel} onChanged={() => {}} />,
    );
    expect(screen.getByText('works-offline')).toBeTruthy();
    expect(screen.getByText(/caches the demo list locally/)).toBeTruthy();
    fireEvent.click(screen.getByText(/declared by story:demo/));
    expect(onTravel).toHaveBeenCalledWith('story:demo');
  });

  // @DecisionRef ui:commitments-always-visible — below a negation the commitment simply
  // is not there: nothing about it appears.
  it('shows no trace of a severed commitment below the negation', () => {
    render(
      <RecordOverlay snapshot={snap} id="app:deep-leaf" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    expect(screen.queryByText(/works-offline/)).toBeNull();
  });

  it('reads the negation at the negating record itself', () => {
    render(
      <RecordOverlay snapshot={snap} id="app:severed-zone" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    expect(screen.getByText(/negates/)).toBeTruthy();
    expect(screen.getByText('works-offline')).toBeTruthy();
  });

  // @DecisionRef ui:two-depths-per-link — gist in context, and travel to full context.
  it('every link offers the gist in place and travel to the full context', () => {
    const onTravel = vi.fn();
    render(
      <RecordOverlay snapshot={snap} id="app:consumer-rule" onClose={() => {}} onTravel={onTravel} onChanged={() => {}} />,
    );
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'app:parent-rule' }));
    // depth one: the gist, in place
    expect(screen.getByText('Parents rule broadly.')).toBeTruthy();
    // depth two: travel
    fireEvent.click(screen.getByText(/go to its full context/));
    expect(onTravel).toHaveBeenCalledWith('app:parent-rule');
  });

  // @DecisionRef ui:two-depths-per-link — a tension link's gist states the divergence.
  it('a tension link gist states the divergence it marks', () => {
    render(
      <RecordOverlay snapshot={snap} id="app:deep-leaf" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'principle:single-resolver' }));
    expect(screen.getByText(/the divergence: two places hold the leaf rule on purpose/)).toBeTruthy();
  });

  // @DecisionRef ui:dubious-is-recorded — the recorded mark visible wherever the record
  // appears, with its one line of reason, the named record reachable, and a confirm.
  it('a dubious record carries the label, its reason and a confirm control', () => {
    const onTravel = vi.fn();
    render(
      <RecordOverlay snapshot={snap} id="app:child-rule" onClose={() => {}} onTravel={onTravel} onChanged={() => {}} />,
    );
    expect(screen.getAllByText('DUBIOUS').length).toBeGreaterThan(0);
    expect(screen.getByText(/app:parent-rule was edited/)).toBeTruthy();
    expect(screen.getByText('confirm coherent')).toBeTruthy();
    fireEvent.click(screen.getByText('read app:parent-rule'));
    expect(onTravel).toHaveBeenCalledWith('app:parent-rule');
  });

  // @DecisionRef ui:all-but-id-editable — the edit surface offers every field but the id.
  it('the edit tab offers decision, rejected, links, context, commitments, dubious — never id', () => {
    render(
      <RecordOverlay snapshot={snap} id="app:parent-rule" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    const select = screen.getByRole('combobox');
    const options = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['decision', 'rejected', 'links', 'context', 'commitments', 'dubious']);
    expect(screen.getByText(/the id is not editable/)).toBeTruthy();
  });

  // @DecisionRef ui:change-shows-implications — dependents at the moment of change.
  it('editing a decision puts the measured dependents in front of the user', async () => {
    render(
      <RecordOverlay snapshot={snap} id="app:parent-rule" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    expect(await screen.findByText(/implications of changing this decision/)).toBeTruthy();
    expect(await screen.findByText('app:consumer-rule')).toBeTruthy();
    expect(screen.getByText(/never gated/)).toBeTruthy();
  });

  // @DecisionRef ui:edits-cast-suspicion — the walk before the commit: a suspect read
  // through and ticked is sent as worked, so the commit marks only the unworked rest.
  it('the suspect walk sends the worked suspects with the commit', async () => {
    const fetchMock = vi.mocked(fetch);
    render(
      <RecordOverlay snapshot={snap} id="app:parent-rule" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    await screen.findByText('app:consumer-rule');
    const row = screen.getByText('app:consumer-rule').closest('label')!;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(screen.getByText(/1 unworked suspect will/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'commit' }));
    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/change');
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call![1]?.body));
      expect(body.worked).toEqual(['app:consumer-rule']);
    });
  });

  // @DecisionRef ui:edits-cast-suspicion — a move's suspects are the moved subtree.
  it('the move tab walks the moved subtree', async () => {
    render(
      <RecordOverlay snapshot={snap} id="app:severed-zone" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'move' }));
    expect(await screen.findByText('app:deep-leaf')).toBeTruthy();
    expect(screen.getByText(/2 unworked suspects will/)).toBeTruthy();
  });

  // @DecisionRef ui:dubious-is-recorded — a person sets the mark by hand through the one
  // editing control, stating what they saw.
  it('marking a record dubious by hand sends one line through edit-field', async () => {
    const fetchMock = vi.mocked(fetch);
    render(
      <RecordOverlay snapshot={snap} id="app:deep-leaf" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dubious' } });
    fireEvent.change(screen.getByLabelText('dubious value'), {
      target: { value: 'reads against the severed zone' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'commit' }));
    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/change');
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call![1]?.body));
      expect(body.operations[0]).toEqual({
        op: 'edit-field',
        id: 'app:deep-leaf',
        field: 'dubious',
        value: 'reads against the severed zone',
      });
    });
  });
});

describe('EngineeringView', () => {
  // @DecisionRef ui:engineering-reads-at-a-glance — the whole commons surveyable, each
  // rule and what refines it legible without excavation.
  it('shows every engineering rule and its children with the rule text visible', () => {
    render(<EngineeringView snapshot={snap} onOpen={() => {}} />);
    expect(screen.getByText('Do things the sample way.')).toBeTruthy();
    expect(screen.getByText('Refine the sample way.')).toBeTruthy();
    expect(screen.getByText('One rule, one place.')).toBeTruthy();
    expect(screen.getByText(/ambient/)).toBeTruthy();
  });
});

describe('ModelsView', () => {
  // @DecisionRef ui:current-and-proposed-visible — deployed reality and ruled intent
  // both visible as the normal view, not behind a compare mode.
  it('shows deployed and intended side by side for a pending field', () => {
    render(<ModelsView snapshot={snap} onTravel={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/scalar — how big it is/)).toBeTruthy();
    expect(screen.getByText(/scalar — size in millimeters/)).toBeTruthy();
    expect(screen.getAllByText('pending-migration').length).toBeGreaterThan(0);
  });

  it('model field citations travel to the governing ruling', () => {
    const onTravel = vi.fn();
    render(<ModelsView snapshot={snap} onTravel={onTravel} onChanged={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'app:parent-rule' })[0]);
    expect(onTravel).toHaveBeenCalledWith('app:parent-rule');
  });

  // @DecisionRef adr:models-memorialize-deployed-shape — landing is the user's attestation
  // that the migration shipped, offered beside the migration in flight.
  it('offers landing a migration in flight through the land-migration operation', async () => {
    const fetchMock = vi.mocked(fetch);
    const onChanged = vi.fn();
    render(<ModelsView snapshot={snap} onTravel={() => {}} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /land widget-name/ }));
    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/change');
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toEqual({
        operations: [{ op: 'land-migration', name: 'widget-name' }],
      });
      expect(onChanged).toHaveBeenCalled();
    });
  });

  // @DecisionRef adr:fields-link-their-rulings — a deployed field citing no ruling is
  // surfaced as a probable orphan.
  it('marks a field with no governing link as a probable orphan', () => {
    render(<ModelsView snapshot={snap} onTravel={() => {}} onChanged={() => {}} />);
    const table = within(screen.getByRole('table'));
    const row = table.getByText('size').closest('tr')!;
    expect(within(row).getByText('probable orphan')).toBeTruthy();
    const governed = table.getByText('name').closest('tr')!;
    expect(within(governed).queryByText('probable orphan')).toBeNull();
  });

  // @DecisionRef ui:read-only-code-lens — no per-field usage weight is measured or shown.
  it('shows no field-usage measurement', () => {
    render(<ModelsView snapshot={snap} onTravel={() => {}} onChanged={() => {}} />);
    expect(screen.queryByText(/usage/)).toBeNull();
  });
});

describe('SearchPanel', () => {
  // @DecisionRef ui:search-any-text — hits show match and location; selecting is travel.
  it('shows hits with field and hierarchy, and selection travels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            query: 'parent',
            hits: [
              {
                id: 'app:parent-rule',
                path: 'product/demo/app.parent-rule/self.yaml',
                field: 'decision',
                snippet: 'Parents rule broadly.',
                hierarchy: ['story:demo'],
                root: 'product',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const onTravel = vi.fn();
    render(<SearchPanel snapshot={snap} onTravel={onTravel} />);
    fireEvent.change(screen.getByPlaceholderText(/search any text/), {
      target: { value: 'parent' },
    });
    const hit = await screen.findByText('Parents rule broadly.');
    expect(screen.getByText('decision')).toBeTruthy();
    expect(screen.getByText('story:demo')).toBeTruthy();
    fireEvent.click(hit);
    expect(onTravel).toHaveBeenCalled();
    expect(onTravel.mock.calls[0][0]).toBe('app:parent-rule');
  });
});

describe('GapsPanel', () => {
  // @DecisionRef eng:log-ledger-interactions — the gap list derived from the log, with
  // skipped malformed lines reported rather than failing.
  it('lists the logged gaps with their ids travelable and reports skipped lines', () => {
    const onTravel = vi.fn();
    render(<GapsPanel snapshot={snap} onTravel={onTravel} onClose={() => {}} />);
    expect(screen.getByText(/decision gaps — 1/)).toBeTruthy();
    expect(screen.getByText(/1 malformed line/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'app:deep-leaf' }));
    expect(onTravel).toHaveBeenCalledWith('app:deep-leaf');
  });
});

describe('SuspectsPanel', () => {
  // @DecisionRef ui:edits-cast-suspicion — the walk through the suspect set: read,
  // confirm or edit each one.
  it('lists every dubious record with its reason and a confirm control', () => {
    render(
      <SuspectsPanel snapshot={snap} onOpen={() => {}} onTravel={() => {}} onChanged={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/dubious records — 1/)).toBeTruthy();
    expect(screen.getByText('app:child-rule')).toBeTruthy();
    expect(screen.getByText(/app:parent-rule was edited/)).toBeTruthy();
    expect(screen.getByText('confirm coherent')).toBeTruthy();
  });

  // @DecisionRef ui:dubious-is-recorded — confirming removes the field and commits that
  // removal through the one write path.
  it('confirming sends the removal of the dubious field', async () => {
    const fetchMock = vi.mocked(fetch);
    render(
      <SuspectsPanel snapshot={snap} onOpen={() => {}} onTravel={() => {}} onChanged={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText('confirm coherent'));
    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/change');
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body)).operations).toEqual([
        { op: 'edit-field', id: 'app:child-rule', field: 'dubious', value: null },
      ]);
    });
  });
});
