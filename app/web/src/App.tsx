import { useCallback, useEffect, useRef, useState } from 'react';
import type { LedgerSnapshot } from '@adroit/shared';
import { api } from './api.js';
import type { StarMap } from './map/StarMap.js';
import { CapabilitiesView } from './components/CapabilitiesView.jsx';
import { EngineeringView } from './components/EngineeringView.jsx';
import { MapView } from './components/MapView.jsx';
import { ModelsView } from './components/ModelsView.jsx';
import { RecordOverlay } from './components/RecordOverlay.jsx';
import { GapsPanel } from './components/GapsPanel.jsx';
import { SearchPanel } from './components/SearchPanel.jsx';
import { SuspectsPanel } from './components/SuspectsPanel.jsx';

type View =
  | { kind: 'tree'; tree: string }
  | { kind: 'engineering' }
  | { kind: 'models' }
  | { kind: 'capabilities' };

export function App() {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [overlayId, setOverlayId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [suspectsOpen, setSuspectsOpen] = useState(false);
  const [gapsOpen, setGapsOpen] = useState(false);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mapRef = useRef<StarMap | null>(null);

  const reload = useCallback(async () => {
    try {
      const snap = await api.ledger();
      setSnapshot(snap);
      setLoadError(null);
      setView((v) => v ?? (snap.productTrees[0] ? { kind: 'tree', tree: snap.productTrees[0].name } : { kind: 'engineering' }));
    } catch {
      setLoadError('the local server is not reachable — is it running against a ledger?');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // @DecisionRef eng:own-action-visible — after any mutation the whole snapshot is
  // refetched, so every surface reflects what the user just did without a reload.
  const onChanged = useCallback(
    (message: string) => {
      setNotice(message);
      void reload();
      window.setTimeout(() => setNotice(null), 6000);
    },
    [reload],
  );

  /**
   * Travel: within the current product tree it is continuous flight; into another root
   * or tree it is a clean cut landed on the target's native treatment
   * (@DecisionRef ui:explore-as-star-map, @DecisionRef ui:cross-root-is-a-cut).
   */
  const travel = useCallback(
    (id: string) => {
      if (!snapshot) return;
      const rec = snapshot.records[id];
      if (rec) {
        if (rec.root === 'product' && rec.treeName) {
          const sameTree = view?.kind === 'tree' && view.tree === rec.treeName;
          if (!sameTree) setView({ kind: 'tree', tree: rec.treeName });
          // flight within the tree; after a cut the landing itself is the arrival —
          // the map consumes the focus after its data is set, so the flight never races
          setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
          setOverlayId(null);
          return;
        }
        if (rec.root === 'engineering') {
          setView({ kind: 'engineering' });
        } else {
          setView({ kind: 'capabilities' });
        }
        setHighlight(id);
        setOverlayId(id);
        return;
      }
      if (snapshot.models.some((m) => m.id === id)) {
        setView({ kind: 'models' });
        setHighlight(id);
        return;
      }
      if (snapshot.capabilities.some((c) => c.name === id)) {
        setView({ kind: 'capabilities' });
        setHighlight(id);
        return;
      }
    },
    [snapshot, view],
  );

  if (loadError) return <div className="load-error">{loadError}</div>;
  if (!snapshot || !view) return <div className="load-error muted">reading the ledger…</div>;

  const suspectCount = Object.values(snapshot.records).filter((r) => r.doc.dubious !== undefined).length;
  const treeRoot =
    view.kind === 'tree'
      ? snapshot.productTrees.find((t) => t.name === view.tree)?.rootId
      : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          adroit <span className="muted">· {snapshot.corpus}</span>
        </span>
        <nav className="root-tabs">
          {/* Each root gets its native treatment; switching is a clean cut
              (ui:roots-get-native-treatments, ui:cross-root-is-a-cut). */}
          {snapshot.productTrees.map((t) => (
            <button
              key={t.name}
              className={view.kind === 'tree' && view.tree === t.name ? 'active' : ''}
              onClick={() => setView({ kind: 'tree', tree: t.name })}
            >
              {t.name}
            </button>
          ))}
          <button
            className={view.kind === 'engineering' ? 'active' : ''}
            onClick={() => setView({ kind: 'engineering' })}
          >
            engineering
          </button>
          <button
            className={view.kind === 'models' ? 'active' : ''}
            onClick={() => setView({ kind: 'models' })}
          >
            models
          </button>
          <button
            className={view.kind === 'capabilities' ? 'active' : ''}
            onClick={() => setView({ kind: 'capabilities' })}
          >
            capabilities
          </button>
        </nav>
        <SearchPanel snapshot={snapshot} onTravel={(id) => travel(id)} />
        <button
          className={`suspects-button ${suspectCount > 0 ? 'has-suspects' : ''}`}
          onClick={() => setSuspectsOpen(!suspectsOpen)}
        >
          dubious: {suspectCount}
        </button>
        <button className="suspects-button" onClick={() => setGapsOpen(!gapsOpen)}>
          gaps: {snapshot.gaps.length}
        </button>
      </header>

      {notice && <div className="notice">{notice}</div>}
      {snapshot.incoherences.length > 0 && (
        <div className="incoherence-bar">
          {snapshot.incoherences.length} commitment incoherence(s):{' '}
          {snapshot.incoherences.map((i) => (
            <button key={`${i.recordId}|${i.commitmentId}|${i.kind}`} className="link" onClick={() => travel(i.recordId)}>
              {i.note}
            </button>
          ))}
        </div>
      )}
      {snapshot.workingDiff.length > 0 && (
        <div className="working-diff muted">
          in-flight working diff: {snapshot.workingDiff.length} file(s) uncommitted
        </div>
      )}

      <main className="main-area">
        {view.kind === 'tree' && treeRoot && (
          <MapView
            snapshot={snapshot}
            rootId={treeRoot}
            focus={focus}
            onOpen={(id) => setOverlayId(id)}
            onSelect={() => undefined}
            mapRef={mapRef}
          />
        )}
        {view.kind === 'engineering' && (
          <EngineeringView snapshot={snapshot} onOpen={setOverlayId} highlight={highlight} />
        )}
        {view.kind === 'models' && (
          <ModelsView snapshot={snapshot} onTravel={travel} onChanged={onChanged} highlight={highlight} />
        )}
        {view.kind === 'capabilities' && (
          <CapabilitiesView snapshot={snapshot} onTravel={travel} onOpen={setOverlayId} />
        )}

        {overlayId && snapshot.records[overlayId] && (
          <RecordOverlay
            snapshot={snapshot}
            id={overlayId}
            onClose={() => setOverlayId(null)}
            onTravel={travel}
            onChanged={onChanged}
          />
        )}
        {suspectsOpen && (
          <SuspectsPanel
            snapshot={snapshot}
            onOpen={setOverlayId}
            onTravel={travel}
            onChanged={onChanged}
            onClose={() => setSuspectsOpen(false)}
          />
        )}
        {gapsOpen && (
          <GapsPanel snapshot={snapshot} onTravel={travel} onClose={() => setGapsOpen(false)} />
        )}
      </main>
    </div>
  );
}
