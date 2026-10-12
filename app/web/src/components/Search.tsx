import { useEffect, useState } from 'react';
import type { SearchHit } from '@adroit/shared';
import { api, reasonOf } from '../api.js';
import { labelOf, useLedger } from '../context.js';

/**
 * Search over any text in the ledger. Every hit shows what matched and where it lives;
 * selecting it makes its place current in both panels.
 * @DecisionRef ui:search-any-text — one box, any text; the server does the matching.
 * @DecisionRef ui:hit-shows-its-place — the field, the snippet and the trail above it.
 * @DecisionRef ui:selecting-a-hit-travels — a hit travels to its place.
 */
export function Search() {
  const { view, travel } = useLedger();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.search(q).then(
        (r) => live && (setHits(r.hits), setError(null)),
        (e) => live && setError(reasonOf(e, 'search failed')),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="search">
      <input type="search" aria-label="search the ledger" placeholder="search any text…" value={q} onChange={(e) => setQ(e.target.value)} />
      {(hits || error) && (
        <div className="popover search-results" role="listbox" aria-label="search results">
          {error && <div className="refusal">{error}</div>}
          {hits && hits.length === 0 && <p className="muted">Nothing matches.</p>}
          {hits?.map((h, i) => (
            <button
              key={`${h.place}|${h.field}|${i}`}
              className="hit"
              role="option"
              aria-selected={false}
              onClick={() => {
                travel(h.place);
                setQ('');
              }}
            >
              <div>
                <strong>{labelOf(view, h.place)}</strong> <span className="muted">{h.trail.join(' › ')}</span>
              </div>
              <div>
                <span className="muted">{h.field}:</span> {h.snippet}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
