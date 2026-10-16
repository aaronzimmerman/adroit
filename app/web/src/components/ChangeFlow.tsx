import { useEffect, useState } from 'react';
import type { ChangePreview, Operation } from '@adroit/shared';
import { api, reasonOf } from '../api.js';
import { useLedger } from '../context.js';

/**
 * The one path every change takes from the UI: preview what it makes suspect and what it
 * deletes, show that, and commit. A change that makes nothing suspect and deletes nothing
 * commits in one act.
 * @DecisionRef eng:same-operation-same-control — every edit, move, deletion, extraction and
 * creation mounts this one component.
 * @DecisionRef ui:suspect-set-shown — every node the change makes suspect, before it commits.
 * @DecisionRef ui:commit-never-gated — the commit button is live whatever the set holds.
 * @DecisionRef principle:inform-dont-fence — the set informs; the commit marks it, never blocks.
 */
export function ChangeFlow({
  operations,
  onCancel,
}: {
  operations: Operation[];
  onCancel: () => void;
}) {
  const { landed } = useLedger();
  // The operations as they stood when the flow opened: a parent re-rendering never re-plans them.
  const [ops] = useState<Operation[]>(operations);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const commit = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      landed(await api.change({ operations: ops, ...(message.trim() ? { message } : {}) }));
    } catch (e) {
      setRefusal(reasonOf(e, 'the change could not be committed'));
      setBusy(false);
    }
  };

  useEffect(() => {
    let live = true;
    setRefusal(null);
    api.preview({ operations: ops }).then(
      (p) => {
        if (!live) return;
        // @DecisionRef ui:single-field-one-act — nothing to show: the edit commits in one act.
        if (p.suspects.length === 0 && p.removed.length === 0) void commit();
        else setPreview(p);
      },
      (e) => live && setRefusal(reasonOf(e, 'the change could not be checked')),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops]);

  if (refusal) {
    return (
      <div className="flow">
        <div className="refusal" role="alert">{refusal}</div>
        <button onClick={onCancel}>back to the edit</button>
      </div>
    );
  }
  if (!preview) return <div className="flow muted">checking the change…</div>;

  const { suspects, removed } = preview;
  return (
    <div className="flow" aria-label="change preview">
      {/* @DecisionRef ui:deletion-shows-everything-lost — every node and decision a deletion
          removes, before it commits. */}
      {removed.length > 0 && (
        <section aria-label="deleted by this change">
          <strong>
            This change deletes {removed.length} node{removed.length === 1 ? '' : 's'}:
          </strong>
          <ul className="removed-list">
            {removed.map((r) => (
              <li key={r.place}>
                <strong>{r.name}</strong> <span className="muted">{r.place}</span>
                <div>
                  {r.id && <code>{r.id}</code>} {r.decision}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {suspects.length > 0 && (
        <section aria-label="made suspect by this change">
          {/* @DecisionRef ui:change-shows-implications — every node the change reaches, before it lands. */}
          <strong>
            This change makes {suspects.length} node{suspects.length === 1 ? '' : 's'} suspect.
          </strong>{' '}
          {/* @DecisionRef ui:commit-marks-suspects — the commit writes the mark onto each. */}
          <span className="muted">The commit marks each one dubious; confirm or edit it whenever you read it through.</span>
          <ul className="suspect-list">
            {suspects.map((s) => (
              <li key={s.place}>
                <strong>{s.name}</strong> <span className="muted">{s.place}</span>
                <div className="muted">why: {s.reason}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flow-foot">
        <input placeholder="commit message (defaulted from the change)" value={message} onChange={(e) => setMessage(e.target.value)} />
        <button className="primary" disabled={busy} onClick={() => void commit()}>
          {removed.length > 0 ? 'delete and commit' : 'commit'}
          {suspects.length > 0 ? ` — marks ${suspects.length} dubious` : ''}
        </button>
        <button onClick={onCancel} disabled={busy}>
          cancel
        </button>
      </div>
    </div>
  );
}
