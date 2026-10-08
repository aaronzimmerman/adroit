import { useEffect, useRef, useState } from 'react';
import type { LedgerSnapshot, SearchHit } from '@adroit/shared';
import { api } from '../api.js';
import { DubiousBadge, Hierarchy } from './Badges.jsx';

/**
 * @DecisionRef ui:search-any-text — full-text over the whole ledger directory, ids
 * included; every hit shows what matched and where it lives; selecting one is travel.
 */
export function SearchPanel({
  snapshot,
  onTravel,
}: {
  snapshot: LedgerSnapshot;
  onTravel: (id: string, hit: SearchHit) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);
    if (!q.trim()) {
      setHits(null);
      return;
    }
    timer.current = setTimeout(() => {
      api.search(q).then((r) => setHits(r.hits)).catch(() => setHits([]));
    }, 180);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <div className="search-panel">
      <input
        className="search-input"
        placeholder="search any text in the ledger — rules, losers, context, field names, ids…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {hits !== null && (
        <div className="search-results">
          {hits.length === 0 && <div className="muted">no match in the ledger</div>}
          {hits.map((h, i) => {
            const rec = h.id ? snapshot.records[h.id] : undefined;
            return (
              <button
                key={i}
                className="search-hit"
                onClick={() => {
                  if (h.id) onTravel(h.id, h);
                  setQ('');
                }}
              >
                <span className="hit-head">
                  <code>{h.id ?? h.path}</code>
                  <span className="hit-field">{h.field}</span>
                  {rec && <DubiousBadge record={rec} />}
                </span>
                <span className="hit-snippet">{h.snippet}</span>
                <Hierarchy ids={h.hierarchy.length > 0 ? h.hierarchy : [h.root]} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
