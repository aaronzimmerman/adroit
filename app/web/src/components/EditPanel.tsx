import { useEffect, useState } from 'react';
import type { EditableField, LedgerSnapshot } from '@adroit/shared';
import { api, ApiRefusal } from '../api.js';

// @DecisionRef eng:same-operation-same-control — the one editing control every surface
// mounts; a surface never rebuilds field editing for itself.
// @DecisionRef ui:all-but-id-editable — every field is offered here except the id.
const FIELDS: EditableField[] = ['decision', 'rejected', 'links', 'context', 'commitments'];

export function EditPanel({
  snapshot,
  id,
  onDone,
}: {
  snapshot: LedgerSnapshot;
  id: string;
  onDone: (message: string) => void;
}) {
  const rec = snapshot.records[id];
  const [field, setField] = useState<EditableField>('decision');
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<{ descendants: string[]; consumers: string[] } | null>(null);

  useEffect(() => {
    const value = rec.doc[field];
    setText(field === 'decision' ? String(value ?? '') : JSON.stringify(value ?? (field === 'rejected' ? [] : {}), null, 2));
  }, [field, id, rec]);

  // @DecisionRef ui:change-shows-implications — the dependents, measured from the graph,
  // are in front of the user at the moment of change, not discovered afterward.
  useEffect(() => {
    let live = true;
    api.impact(id).then((r) => {
      if (live) setImpact({ descendants: r.descendants, consumers: r.consumers });
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      let value: unknown = text;
      if (field !== 'decision') {
        try {
          value = JSON.parse(text);
        } catch {
          setError(`${field} must be valid JSON`);
          setBusy(false);
          return;
        }
      }
      const outcome = await api.change({
        operations: [{ op: 'edit-field', id, field, value }],
        ...(message.trim() ? { message } : {}),
      });
      // @DecisionRef eng:outcome-honesty — report what actually happened, suspects cast
      // included.
      const suspectNote =
        outcome.suspects.length > 0
          ? ` — suspicion cast over ${outcome.suspects.length} dependent record(s)`
          : '';
      onDone(`committed ${outcome.commit?.slice(0, 8) ?? ''}${suspectNote}`);
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'the change failed');
    } finally {
      setBusy(false);
    }
  };

  const showsImplications = field === 'decision' && impact;
  return (
    <div className="edit-panel">
      <div className="edit-row">
        <label>
          field{' '}
          <select value={field} onChange={(e) => setField(e.target.value as EditableField)}>
            {FIELDS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">the id is not editable — it is the name citations bind to</span>
      </div>
      <textarea
        rows={field === 'decision' ? 6 : 10}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {showsImplications && (
        <div className="implications">
          <strong>implications of changing this decision</strong>
          <div>
            {impact.descendants.length} descendant(s) and {impact.consumers.length} consumer(s)
            become suspect:
          </div>
          <div className="id-list">
            {[...impact.descendants, ...impact.consumers].map((d) => (
              <code key={d}>{d}</code>
            ))}
          </div>
          <div className="muted">
            the commit is never gated — unworked suspects will read as DUBIOUS until
            confirmed or edited
          </div>
        </div>
      )}
      <div className="edit-row">
        <input
          placeholder="commit message (defaulted from the operation)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button onClick={commit} disabled={busy}>
          commit
        </button>
      </div>
      {error && <div className="refusal">{error}</div>}
    </div>
  );
}
