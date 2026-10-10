import { useState } from 'react';
import { api, ApiRefusal } from '../api.js';

// @DecisionRef eng:same-operation-same-control — confirming a suspect is one shared
// control wherever it appears (overlay, suspects walk).
// @DecisionRef ui:dubious-is-recorded — confirming removes the dubious field and commits
// that removal, through the ordinary edit-field write path.
export function ConfirmControl({
  id,
  onDone,
}: {
  id: string;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // @DecisionRef eng:one-step-reversible — a non-destructive, reversible act: one step.
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.change({
        operations: [{ op: 'edit-field', id, field: 'dubious', value: null }],
        message: `confirm ${id}`,
      });
      onDone(`confirmed ${id} in commit ${outcome.commit?.slice(0, 8) ?? ''}`);
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'confirmation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="confirm-control">
      <button onClick={confirm} disabled={busy}>
        confirm coherent
      </button>
      {error && <span className="refusal">{error}</span>}
    </span>
  );
}
