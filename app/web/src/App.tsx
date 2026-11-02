import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeOutcome, LedgerView } from '@adroit/shared';
import { api } from './api.js';
import { LedgerContext, type Ledger } from './context.js';
import { DetailsPanel } from './components/DetailsPanel.jsx';
import { FindingsList } from './components/Findings.jsx';
import { HistoryPanel } from './components/HistoryPanel.jsx';
import { NavPanel } from './components/NavPanel.jsx';
import { OpenLedger } from './components/OpenLedger.jsx';
import { Search } from './components/Search.jsx';

/** Every place above one, so the navigation panel shows it. */
function chainOf(view: LedgerView, place: string): string[] {
  const out: string[] = [];
  for (let p: string | null = view.places[place]?.parent ?? null; p !== null; p = view.places[p]?.parent ?? null) out.push(p);
  return out;
}

/** The first node to show: the first product tree's root, else the first root. */
const firstPlace = (view: LedgerView): string =>
  view.places.product?.children[0] ?? view.roots.find((r) => view.places[r]?.children.length) ?? view.roots[0] ?? '';

/**
 * Hosts the full-ledger and history reading modes, sharing the opened directory.
 * @DecisionRef ui:switch-reading-modes — retain the full-ledger selection across mode changes.
 * @DecisionRef story:ui — understand and manipulate a ledger.
 */
export function App() {
  const [view, setView] = useState<LedgerView | null>(null);
  const [current, setCurrent] = useState('');
  const [field, setField] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [mode, setMode] = useState<'ledger' | 'history'>('ledger');
  const currentRef = useRef('');

  const go = useCallback((v: LedgerView, place: string, picked?: string) => {
    currentRef.current = place;
    setCurrent(place);
    setField(picked);
    setExpanded((e) => new Set([...e, ...chainOf(v, place), place]));
  }, []);

  const show = useCallback(
    (v: LedgerView, place?: string) => {
      setView(v);
      const cur = currentRef.current;
      go(v, place && v.places[place] ? place : v.places[cur] && cur ? cur : firstPlace(v));
      setVersion((n) => n + 1);
    },
    [go],
  );

  const reload = useCallback(
    async (place?: string) => {
      try {
        show(await api.ledger(), place);
        setLoadError(null);
      } catch {
        setLoadError('the local server is not reachable — is it running?');
      }
    },
    [show],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  /** @DecisionRef ui:selecting-a-hit-travels — travel makes a place current in both panels. */
  const travel = useCallback(
    (place: string, picked?: string) => {
      if (view?.places[place]) go(view, place, picked);
    },
    [view, go],
  );

  // @DecisionRef eng:own-action-visible — after a change lands the whole view is refetched, so
  // every surface shows it without a reload.
  // @DecisionRef eng:outcome-honesty — the notice says what the commit did, marks included.
  const landed = useCallback(
    (outcome: ChangeOutcome) => {
      setNotice(
        `committed ${outcome.commit.slice(0, 8)}` +
          (outcome.removed.length ? ` — deleted ${outcome.removed.length} node${outcome.removed.length === 1 ? '' : 's'}` : '') +
          (outcome.marked.length ? ` — marked ${outcome.marked.length} suspect${outcome.marked.length === 1 ? '' : 's'} dubious` : ''),
      );
      void reload(outcome.landedAt);
      window.setTimeout(() => setNotice(null), 8000);
    },
    [reload],
  );

  const ctx = useMemo<Ledger | null>(() => (view ? { view, travel, landed } : null), [view, travel, landed]);

  if (loadError) return <div className="load-error">{loadError}</div>;
  if (!view || !ctx) return <div className="load-error muted">reading the ledger…</div>;

  const errors = view.findings.filter((f) => f.severity === 'error').length;
  return (
    <LedgerContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <span className="brand">adroit</span>
          <span className="muted">{view.corpus}</span>
          {/* @DecisionRef ui:switch-reading-modes — the current ledger place survives a visit to history. */}
          <div className="mode-switch" role="group" aria-label="reading mode">
            <button aria-pressed={mode === 'ledger'} onClick={() => setMode('ledger')}>Ledger</button>
            <button aria-pressed={mode === 'history'} onClick={() => { setMode('history'); setFindingsOpen(false); }}>History</button>
          </div>
          <OpenLedger dir={view.dir} onOpened={(v) => show(v, firstPlace(v))} />
          <span className="spacer" />
          {mode === 'ledger' && <><Search />
          <button className={`findings-button ${errors ? 'has-errors' : ''}`} onClick={() => setFindingsOpen(!findingsOpen)}>
            findings: {view.findings.length}
          </button></>}
        </header>
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {!view.repo && <div className="notice muted">This ledger is not inside a git repository: it can be read, and changes cannot land.</div>}
        {mode === 'ledger' && findingsOpen && <FindingsList onClose={() => setFindingsOpen(false)} />}
        {mode === 'history' ? <HistoryPanel key={`${view.dir}#${version}`} inRepo={!!view.repo} /> : <main className="panels">
          <NavPanel
            current={current}
            expanded={expanded}
            onToggle={(p) =>
              setExpanded((e) => {
                const next = new Set(e);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              })
            }
          />
          <DetailsPanel key={`${current}#${field ?? ''}#${version}`} current={current} field={field} />
        </main>}
      </div>
    </LedgerContext.Provider>
  );
}
