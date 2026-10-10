import { useEffect, useState } from 'react';
import { SUSPICION_FIELDS } from '@adroit/shared';
import type { EditableField, LedgerSnapshot } from '@adroit/shared';
import { api, ApiRefusal } from '../api.js';
import { SuspectWalk } from './SuspectWalk.jsx';

// @DecisionRef eng:same-operation-same-control — the one editing control every surface
// mounts; a surface never rebuilds field editing for itself.
// @DecisionRef ui:all-but-id-editable — every field is offered here except the id.
const FIELDS: EditableField[] = ['decision', 'rejected', 'links', 'context', 'commitments', 'dubious'];
/** Plain-text fields; the rest are edited as JSON. */
const TEXT_FIELDS: EditableField[] = ['decision', 'dubious'];

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
  const [impact, setImpact] = useState<{
    descendants: string[];
    consumers: string[];
    modelFields: { model: string; field: string }[];
  } | null>(null);
  const [worked, setWorked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const value = rec.doc[field];
    setText(
      TEXT_FIELDS.includes(field)
        ? String(value ?? '')
        : JSON.stringify(value ?? (field === 'rejected' || field === 'commitments' ? [] : {}), null, 2),
    );
  }, [field, id, rec]);

  // @DecisionRef ui:change-shows-implications — the dependents, measured from the graph,
  // are in front of the user at the moment of change, not discovered afterward.
  useEffect(() => {
    let live = true;
    setWorked(new Set());
    api.impact(id).then((r) => {
      if (live) {
        setImpact({
          descendants: r.descendants,
          consumers: r.consumers,
          modelFields: r.modelFields ?? [],
        });
      }
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
      if (field === 'dubious') {
        // an emptied mark is a removal: confirming by hand
        value = text.trim() ? text.trim() : null;
      } else if (!TEXT_FIELDS.includes(field)) {
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
        ...(castsSuspicion ? { worked: [...worked] } : {}),
      });
      // @DecisionRef eng:outcome-honesty — report what actually happened, the marks this
      // commit wrote included.
      const marked =
        outcome.markedDubious.length > 0
          ? ` — ${outcome.markedDubious.length} unworked suspect(s) marked dubious`
          : '';
      onDone(`committed ${outcome.commit?.slice(0, 8) ?? ''}${marked}`);
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'the change failed');
    } finally {
      setBusy(false);
    }
  };

  const castsSuspicion = SUSPICION_FIELDS.includes(field);
  const suspects = impact ? [...impact.descendants, ...impact.consumers] : [];
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
      {field === 'dubious' && (
        <div className="muted">
          one line: the contradiction you observed — leave it empty to remove the mark
        </div>
      )}
      <textarea
        aria-label={`${field} value`}
        rows={field === 'decision' ? 6 : field === 'dubious' ? 2 : 10}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {castsSuspicion && impact && (
        <div className="implications">
          <strong>implications of changing this decision</strong>
          <div>
            {impact.descendants.length} descendant(s) and {impact.consumers.length} consumer(s)
            become suspect:
          </div>
          {/* @DecisionRef adr:fields-link-their-rulings — the model fields citing this
              ruling are its migration surface, visible before the change lands. */}
          {impact.modelFields.length > 0 && (
            <div>
              migration surface: {impact.modelFields.length} model field(s) cite this ruling —{' '}
              {impact.modelFields.map((f) => (
                <code key={`${f.model}.${f.field}`}>
                  {f.model}.{f.field}{' '}
                </code>
              ))}
            </div>
          )}
          <SuspectWalk
            snapshot={snapshot}
            suspects={suspects}
            worked={worked}
            onToggle={(s, on) => {
              const next = new Set(worked);
              if (on) next.add(s);
              else next.delete(s);
              setWorked(next);
            }}
          />
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
