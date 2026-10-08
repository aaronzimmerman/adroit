import { useState } from 'react';
import { api, ApiRefusal } from '../api.js';

// @DecisionRef eng:same-operation-same-control — confirming a suspect is one shared
// control wherever it appears (overlay, suspects walk).
// @DecisionRef ui:dubious-derived-not-stored — a confirmation writes one line of
// provenance into the record's context, committed like any edit.
export function ConfirmControl({
  id,
  onDone,
}: {
  id: string;
  onDone: (message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.confirm(id, note);
      onDone(`confirmed ${id} in commit ${outcome.commit?.slice(0, 8) ?? ''}`);
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'confirmation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="confirm-control">
      <input
        placeholder="one line: why it is still coherent"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy}
      />
      <button onClick={confirm} disabled={busy}>
        confirm coherent
      </button>
      {error && <span className="refusal">{error}</span>}
    </span>
  );
}
