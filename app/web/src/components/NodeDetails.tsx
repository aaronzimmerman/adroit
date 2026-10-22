import { useState } from 'react';
import type { NodeView, Operation } from '@adroit/shared';
import { labelOf, useLedger } from '../context.js';
import { ChangeFlow } from './ChangeFlow.jsx';
import { EditInPlace, linesEditor, textEditor } from './EditInPlace.jsx';
import { Lens } from './Lens.jsx';
import { IncludedBy, PlaceInTree } from './Scope.jsx';
import { TokenText } from './TokenText.jsx';
import { Structure } from './Structure.jsx';

const trimmed = (lines: string[]) => lines.map((l) => l.trim()).filter(Boolean);

/**
 * The current node, read and edited in place: where it sits, its one decision with its rejected
 * alternatives and the views it references, its dubious mark, its questions and context collapsed,
 * what is nested and grafted beneath it, and its structure.
 * @DecisionRef ui:details-panel-right — the right panel shows the current node: its decision with
 * its rejected alternatives, and its dubious mark.
 * @DecisionRef ui:decision-text-prominent — the decision is the largest text here, set apart.
 * @DecisionRef ui:header-one-line — name, id and dependents on one line, the last two lighter.
 * @DecisionRef ui:all-but-id-editable — every field edits here; the id is shown, fixed.
 */
export function NodeDetails({ place, node }: { place: string; node: NodeView }) {
  const { view, travel } = useLedger();
  const [lens, setLens] = useState(false);
  const doc = node.doc;
  const dubious = doc.dubious !== undefined;
  const reach = node.dependents;
  const edit =
    (field: Extract<Operation, { op: 'edit-node' }>['field']) =>
    (value: unknown, clearDubious: boolean): Operation[] => [{ op: 'edit-node', place, field, value, clearDubious }];
  const explicit = new Set(doc.references ?? []);
  return (
    <article className="node-details">
      <PlaceInTree node={node} />
      <header>
        <EditInPlace
          label="name"
          value={doc.name}
          render={(v) => (
            <div className="title-line">
              <h2>{v}</h2>
              <code className="decision-id">{doc.id}</code>
              {reach > 0 && <Dependents count={reach} />}
              {dubious && <span className="badge dubious">dubious</span>}
            </div>
          )}
          editor={textEditor('name', 1)}
          toOps={edit('name')}
          dubious={dubious}
        />
      </header>

      <section aria-label="the decision" className="decision-card">
        <EditInPlace
          label="decision"
          value={doc.decision}
          render={(v) => (
            <p className="decision-text">
              <TokenText text={v} />
            </p>
          )}
          editor={textEditor('decision', 4)}
          toOps={edit('decision')}
          dependents={reach}
          dubious={dubious}
        />
        {/* @DecisionRef ui:rejected-collapsed — closed beneath the decision, saying how many. */}
        <details className="note-group rejected-group" aria-label="rejected">
          <summary>
            Rejected <span className="muted">{doc.rejected?.length ? `(${doc.rejected.length})` : '— none'}</span>
          </summary>
          <EditInPlace
            label="rejected"
            value={doc.rejected ?? []}
            render={(v) =>
              v.length ? (
                <ul className="rejected">
                  {v.map((r, i) => (
                    <li key={i}>
                      <TokenText text={r} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No rejected alternatives.</p>
              )
            }
            editor={linesEditor('rejected, one per line')}
            toOps={(v, c) => edit('rejected')(trimmed(v), c)}
            dependents={reach}
            dubious={dubious}
          />
        </details>
        <EditInPlace
          label="references"
          value={doc.references ?? []}
          render={() =>
            node.views.length ? (
              <p>
                <span className="muted">references:</span>{' '}
                {node.views.map((id) => (
                  <span key={id}>
                    {view.ids[id] !== undefined ? (
                      <button className="link" onClick={() => travel(view.ids[id])}>
                        {id}
                      </button>
                    ) : (
                      <code>{id}</code>
                    )}
                    {!explicit.has(id) && <span className="muted"> (by a field token)</span>}{' '}
                  </span>
                ))}
              </p>
            ) : (
              <p className="muted">References no view.</p>
            )
          }
          editor={linesEditor('references, one per line', 2)}
          toOps={(v, c) => edit('references')(trimmed(v), c)}
          dependents={reach}
          dubious={dubious}
        />
        <button className="link" onClick={() => setLens(!lens)}>
          {lens ? 'hide the code' : 'code lens'}
        </button>
        {lens && <Lens id={doc.id} />}
      </section>

      {/* @DecisionRef ui:notes-collapsed — questions and context are closed until opened, each
          saying that it is there.
          @DecisionRef ui:dubious-with-questions — the mark sits with the questions, open while it stands. */}
      <details className="note-group" aria-label="questions" open={dubious || undefined}>
        <summary>
          Questions{' '}
          <span className="muted">{doc.questions?.length ? `(${doc.questions.length})` : '— none'}</span>
          {dubious && <span className="badge dubious">dubious</span>}
        </summary>
        <DubiousNote place={place} line={doc.dubious} />
        <EditInPlace
          label="questions"
          value={doc.questions ?? []}
          render={(qs) =>
            qs.length ? (
              <ul className="questions">
                {qs.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">No open questions.</p>
            )
          }
          editor={linesEditor('questions, one per line')}
          toOps={(qs, c) => edit('questions')(trimmed(qs), c)}
          dubious={dubious}
        />
        <AskQuestion place={place} questions={doc.questions ?? []} below={reach} />
      </details>

      <details className="note-group" aria-label="context">
        <summary>
          Context <span className="muted">{node.contextText ? '' : '— none'}</span>
        </summary>
        <EditInPlace
          label="context"
          value={node.contextText}
          render={(v) => (v ? <pre className="context">{v}</pre> : <p className="muted">No context.</p>)}
          editor={textEditor('context', 5)}
          toOps={edit('context')}
          dependents={reach}
          dubious={dubious}
        />
      </details>

      <Children place={place} />
      {/* @DecisionRef ui:capabilities-shown-summarized — a graft is shown in the navigation panel
          beneath this node; here it is only edited. */}
      <section aria-label="grafted beneath">
        <EditInPlace
          label="includes"
          value={doc.includes ?? []}
          render={(v) =>
            v.length ? (
              <p className="muted">
                grafted beneath: <span className="graft-names">{v.join(', ')}</span>
              </p>
            ) : null
          }
          editText={doc.includes?.length ? 'edit' : 'graft a capability…'}
          editor={linesEditor('includes, one per line', 2)}
          toOps={(v, c) => edit('includes')(trimmed(v), c)}
          dependents={reach}
          dubious={dubious}
        />
      </section>
      <IncludedBy node={node} />
      <Structure place={place} />
    </article>
  );
}

/**
 * How many nodes depend on this one: a bare number beside a below icon, its meaning on hover.
 * @DecisionRef eng:prominence-follows-dependence — surfaced where the node is edited, weighted by
 * how much depends on it.
 */
function Dependents({ count }: { count: number }) {
  const meaning = `${count} node${count === 1 ? '' : 's'} depend${count === 1 ? 's' : ''} on this one`;
  return (
    <span className={`dependents ${count >= 10 ? 'heavy' : ''}`} title={meaning} aria-label={meaning}>
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className="below-icon">
        <circle cx="8" cy="3" r="2" fill="currentColor" />
        <path d="M8 5v3M4 11V8h8v3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="4" cy="13" r="2" fill="currentColor" />
        <circle cx="12" cy="13" r="2" fill="currentColor" />
      </svg>
      {count}
    </span>
  );
}

/**
 * The node's dubious mark, and confirming it after reading the node through.
 * @DecisionRef ui:dubious-clears-on-work — confirm it after reading it through, in a commit.
 * @DecisionRef eng:one-step-reversible — confirming is one step: a commit is easily reverted.
 */
function DubiousNote({ place, line }: { place: string; line?: string }) {
  const [ops, setOps] = useState<Operation[] | null>(null);
  if (line === undefined) return null;
  if (ops) return <ChangeFlow operations={ops} onCancel={() => setOps(null)} />;
  return (
    <div className="dubious-box" role="note">
      <strong>Dubious:</strong> {line}
      <div className="row">
        <button onClick={() => setOps([{ op: 'confirm', place }])}>I read it through and it holds — confirm</button>
      </div>
    </div>
  );
}

/**
 * Asking a question about the node, and with it, marking the node dubious: the mark needs a
 * question, which states what was seen and stays on the node.
 * @DecisionRef ui:dubious-set-by-hand — marked while asking a question, the question its reason.
 */
function AskQuestion({ place, questions, below }: { place: string; questions: string[]; below: number }) {
  const [ops, setOps] = useState<Operation[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [mark, setMark] = useState(false);
  if (ops) return <ChangeFlow operations={ops} onCancel={() => setOps(null)} />;
  if (!asking) {
    return (
      <button className="link" onClick={() => setAsking(true)}>
        ask a question…
      </button>
    );
  }
  // one line: a question is one line of the list, and a dubious reason is one line
  const q = text.replace(/\s+/g, ' ').trim();
  return (
    <div className="form" aria-label="ask a question">
      <label>
        the question{' '}
        <textarea rows={2} value={text} placeholder="what is unclear, or what contradicts it?" onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} />
        it's a contradiction — mark this node dubious
      </label>
      {mark && below > 0 && (
        <p className="muted">
          The {below} node{below === 1 ? '' : 's'} beneath {below === 1 ? 'is' : 'are'} marked too, naming this one.
        </p>
      )}
      <div className="row">
        <button
          className="primary"
          disabled={!q}
          onClick={() =>
            setOps([
              { op: 'edit-node', place, field: 'questions', value: [...questions, q], clearDubious: false },
              ...(mark ? [{ op: 'mark-dubious' as const, place, reason: q }] : []),
            ])
          }
        >
          {mark ? 'ask and mark dubious' : 'ask'}
        </button>
        <button onClick={() => setAsking(false)}>cancel</button>
      </div>
    </div>
  );
}

/**
 * The children of the current place, each selectable as the next current node.
 * @DecisionRef ui:children-as-buttons — each child a button that makes it current.
 */
export function Children({ place }: { place: string }) {
  const { view, travel } = useLedger();
  const children = view.places[place]?.children ?? [];
  if (children.length === 0) return null;
  return (
    <section aria-label="children">
      <h3>Beneath</h3>
      <ul className="child-buttons">
        {children.map((c) => (
          <li key={c}>
            <button className="child-button" onClick={() => travel(c)}>
              {labelOf(view, c)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
