import { useEffect, useRef, useState } from 'react';
import type { ChangePreview, Operation, Suspect } from '@adroit/shared';
import { api, reasonOf } from '../api.js';
import { labelOf, useLedger } from '../context.js';

/**
 * The one path every change takes from the UI: preview what it makes suspect, walk the user
 * through each suspect — reading, confirming or editing it — and commit. A change that makes
 * nothing suspect commits in one act.
 * @DecisionRef eng:same-operation-same-control — every edit, move, extraction and creation
 * mounts this one component.
 * @DecisionRef ui:walk-the-suspect-set — each suspect is read in place and confirmed or edited.
 * @DecisionRef ui:commit-never-gated — the commit button is live at every step of the walk.
 * @DecisionRef principle:inform-dont-fence — the walk informs; the unworked rest is marked, not blocked.
 */
export function ChangeFlow({
  operations,
  onCancel,
}: {
  operations: Operation[];
  onCancel: () => void;
}) {
  const { view, landed } = useLedger();
  const [ops, setOps] = useState<Operation[]>(operations);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [worked, setWorked] = useState<Map<string, 'confirmed' | 'edited'>>(new Map());
  const [index, setIndex] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const walked = useRef(false);

  const commit = async (finalOps: Operation[], workedPlaces: string[]) => {
    setBusy(true);
    setRefusal(null);
    try {
      landed(await api.change({ operations: finalOps, worked: workedPlaces, ...(message.trim() ? { message } : {}) }));
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
        // @DecisionRef ui:single-field-one-act — nothing to walk: the edit commits in one act.
        if (p.suspects.length === 0 && !walked.current) void commit(ops, []);
        else {
          walked.current = true;
          setPreview(p);
        }
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

  const suspects = preview.suspects;
  const current: Suspect | undefined = suspects[Math.min(index, suspects.length - 1)];
  const unworked = suspects.filter((s) => !worked.has(s.place)).length;
  const mark = (place: string, how: 'confirmed' | 'edited') => {
    setWorked((m) => new Map(m).set(place, how));
    setIndex((i) => Math.min(i + 1, suspects.length - 1));
  };

  return (
    <div className="flow" aria-label="change walk">
      <div className="flow-head">
        {/* @DecisionRef ui:change-shows-implications — every node the change reaches, before it lands. */}
        <strong>
          This change makes {suspects.length} node{suspects.length === 1 ? '' : 's'} suspect.
        </strong>{' '}
        <span className="muted">Read each through; confirm it still holds, or edit it into this change.</span>
      </div>
      <ol className="suspect-list">
        {suspects.map((s, i) => (
          <li key={s.place} className={i === index ? 'current' : ''}>
            <button className="link" onClick={() => setIndex(i)}>
              {s.name}
            </button>{' '}
            <span className={`walk-state ${worked.get(s.place) ?? 'unworked'}`}>{worked.get(s.place) ?? 'unworked'}</span>
          </li>
        ))}
      </ol>
      {current && (
        <SuspectCard
          key={current.place}
          suspect={current}
          onConfirm={() => mark(current.place, 'confirmed')}
          onEdit={(edits) => {
            setWorked((m) => new Map(m).set(current.place, 'edited'));
            setOps((o) => [...o, ...edits]);
          }}
          onSkip={() => setIndex((i) => Math.min(i + 1, suspects.length - 1))}
          readLabel={labelOf(view, current.readAt)}
        />
      )}
      <div className="flow-foot">
        <input placeholder="commit message (defaulted from the change)" value={message} onChange={(e) => setMessage(e.target.value)} />
        <button
          className="primary"
          disabled={busy}
          onClick={() => void commit(ops, [...worked.keys()].filter((p) => suspects.some((s) => s.place === p)))}
        >
          commit{unworked > 0 ? ` — ${unworked} unworked will be marked dubious` : ''}
        </button>
        <button onClick={onCancel} disabled={busy}>
          cancel
        </button>
      </div>
    </div>
  );
}

/** One suspect, read where it is now, with the levers to confirm it or edit it in. */
function SuspectCard({
  suspect,
  onConfirm,
  onEdit,
  onSkip,
  readLabel,
}: {
  suspect: Suspect;
  onConfirm: () => void;
  onEdit: (ops: Operation[]) => void;
  onSkip: () => void;
  readLabel: string;
}) {
  const { view } = useLedger();
  const decisions = view.places[suspect.readAt]?.node?.doc.decisions ?? [];
  const [editing, setEditing] = useState(false);
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(decisions.map((d) => [d.id, d.decision])),
  );
  return (
    <div className="suspect-card">
      <div>
        <strong>{suspect.name}</strong> <span className="muted">{suspect.place}</span>
      </div>
      <div className="muted">why: {suspect.reason}</div>
      <ul className="decision-list">
        {decisions.map((d) => (
          <li key={d.id}>
            <code>{d.id}</code>{' '}
            {editing ? (
              <textarea
                aria-label={`${d.id} text`}
                rows={3}
                value={texts[d.id] ?? ''}
                onChange={(e) => setTexts({ ...texts, [d.id]: e.target.value })}
              />
            ) : (
              <span>{d.decision}</span>
            )}
          </li>
        ))}
      </ul>
      {decisions.length === 0 && <p className="muted">({readLabel} could not be read)</p>}
      <div className="row">
        {editing ? (
          <>
            <button
              onClick={() => {
                const edits = decisions
                  .filter((d) => (texts[d.id] ?? '').trim() !== d.decision)
                  .map((d) => ({ op: 'edit-decision' as const, place: suspect.place, id: d.id, field: 'decision' as const, value: texts[d.id] }));
                if (edits.length > 0) onEdit(edits);
                else onConfirm();
              }}
            >
              add these edits to the change
            </button>
            <button onClick={() => setEditing(false)}>stop editing</button>
          </>
        ) : (
          <>
            <button onClick={onConfirm}>still holds — confirm</button>
            <button onClick={() => setEditing(true)}>edit it</button>
            <button onClick={onSkip}>skip</button>
          </>
        )}
      </div>
    </div>
  );
}
