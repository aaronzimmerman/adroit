import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EngineeringView } from '../src/components/EngineeringView.jsx';
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
        ? { id: 'x', descendants: ['app:child-rule'], consumers: ['app:consumer-rule'], dependents: [] }
        : u.startsWith('/api/lens/citations')
          ? { id: 'x', citations: [], axis: 'test' }
          : { ok: true, committed: true, commit: 'a'.repeat(40), touched: [], suspects: [] };
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

  // @DecisionRef ui:edits-cast-suspicion — DUBIOUS visible wherever the record appears,
  // with the reason and a way to work it.
  it('a dubious record carries the label, its reasons and a confirm control', () => {
    render(
      <RecordOverlay snapshot={snap} id="app:child-rule" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    expect(screen.getAllByText('DUBIOUS').length).toBeGreaterThan(0);
    expect(screen.getByText(/an ancestor.*changed its decision/)).toBeTruthy();
    expect(screen.getByText('confirm coherent')).toBeTruthy();
  });

  // @DecisionRef ui:all-but-id-editable — the edit surface offers every field but the id.
  it('the edit tab offers decision, rejected, links, context, commitments — never id', () => {
    render(
      <RecordOverlay snapshot={snap} id="app:parent-rule" onClose={() => {}} onTravel={() => {}} onChanged={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    const select = screen.getByRole('combobox');
    const options = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['decision', 'rejected', 'links', 'context', 'commitments']);
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
    fireEvent.click(screen.getByRole('button', { name: 'app:parent-rule' }));
    expect(onTravel).toHaveBeenCalledWith('app:parent-rule');
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

describe('SuspectsPanel', () => {
  // @DecisionRef ui:edits-cast-suspicion — the walk through the suspect set: read,
  // confirm or edit each one.
  it('lists every dubious record with reasons and a confirm control', () => {
    render(
      <SuspectsPanel snapshot={snap} onOpen={() => {}} onTravel={() => {}} onChanged={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/dubious records — 1/)).toBeTruthy();
    expect(screen.getByText('app:child-rule')).toBeTruthy();
    expect(screen.getByText(/an ancestor.*changed its decision/)).toBeTruthy();
    expect(screen.getByText('confirm coherent')).toBeTruthy();
  });

  // @DecisionRef ui:dubious-derived-not-stored — confirming goes through the write path.
  it('confirming posts one line of provenance to the server', async () => {
    const fetchMock = vi.mocked(fetch);
    render(
      <SuspectsPanel snapshot={snap} onOpen={() => {}} onTravel={() => {}} onChanged={() => {}} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/why it is still coherent/), {
      target: { value: 'checked against the new parent rule' },
    });
    fireEvent.click(screen.getByText('confirm coherent'));
    await vi.waitFor(() => {
      const confirmCall = fetchMock.mock.calls.find(([u]) => String(u) === '/api/confirm');
      expect(confirmCall).toBeTruthy();
      expect(String(confirmCall![1]?.body)).toContain('checked against the new parent rule');
    });
  });
});
