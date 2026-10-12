import { useState } from 'react';
import type { LedgerView } from '@adroit/shared';
import { api, reasonOf } from '../api.js';

/**
 * Which ledger is open, and the control to open another by its directory.
 * @DecisionRef ui:open-any-ledger — any adroit ledger's root directory, not only this repo's.
 * @DecisionRef principle:settings-live-in-context — the choice sits beside what it controls.
 */
export function OpenLedger({ dir, onOpened }: { dir: string; onOpened: (view: LedgerView) => void }) {
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState(dir);
  const [error, setError] = useState<string | null>(null);
  if (!editing) {
    return (
      <button className="link ledger-dir" title="open another ledger" onClick={() => setEditing(true)}>
        {dir}
      </button>
    );
  }
  return (
    <form
      className="open-ledger"
      onSubmit={(e) => {
        e.preventDefault();
        api.open(path).then(
          (v) => {
            setEditing(false);
            setError(null);
            onOpened(v);
          },
          (err) => setError(reasonOf(err, 'the ledger could not be opened')),
        );
      }}
    >
      <input aria-label="ledger directory" value={path} onChange={(e) => setPath(e.target.value)} />
      <button className="primary" type="submit">
        open
      </button>
      <button type="button" onClick={() => setEditing(false)}>
        cancel
      </button>
      {error && <span className="refusal">{error}</span>}
    </form>
  );
}
