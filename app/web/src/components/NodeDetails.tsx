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
          render={(v) => <h2>{v}</h2>}
          editor={textEditor('name', 1)}
          toOps={edit('name')}
          dubious={dubious}
        />
        <div className="row">
          <code className="decision-id">{doc.id}</code>
          <span className="muted">
            {place} · {node.tree}
          </span>
        </div>
        {/* @DecisionRef eng:prominence-follows-dependence — what depends on this node is surfaced
            where it is edited, weighted by how much does. */}
        {reach > 0 && (
          <div className={`dependents ${reach >= 10 ? 'heavy' : ''}`}>
            {reach} node{reach === 1 ? '' : 's'} depend{reach === 1 ? 's' : ''} on this one
          </div>
        )}
      </header>

      <DubiousMark place={place} line={doc.dubious} />

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
          saying that it is there. */}
      <details className="note-group" aria-label="questions">
        <summary>
          Questions{' '}
          <span className="muted">{doc.questions?.length ? `(${doc.questions.length})` : '— none'}</span>
        </summary>
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
            ) : (
              <p className="muted">No capability grafted beneath.</p>
            )
          }
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
 * The node's dubious mark, and the two things a person does with it.
 * @DecisionRef ui:dubious-set-by-hand — mark it on seeing a contradiction, saying what was seen.
 * @DecisionRef ui:dubious-clears-on-work — confirm it after reading it through, in a commit.
 * @DecisionRef eng:one-step-reversible — confirming is one step: a commit is easily reverted.
 */
function DubiousMark({ place, line }: { place: string; line?: string }) {
  const [ops, setOps] = useState<Operation[] | null>(null);
  const [marking, setMarking] = useState(false);
  const [reason, setReason] = useState('');
  if (ops) return <ChangeFlow operations={ops} onCancel={() => setOps(null)} />;
  if (line !== undefined) {
    return (
      <div className="dubious-box" role="note">
        <strong>Dubious:</strong> {line}
        <div className="row">
          <button onClick={() => setOps([{ op: 'confirm', place }])}>I read it through and it holds — confirm</button>
        </div>
      </div>
    );
  }
  if (!marking) {
    return (
      <button className="link" onClick={() => setMarking(true)}>
        mark dubious…
      </button>
    );
  }
  return (
    <div className="form" aria-label="mark dubious">
      <label>
        what did you see?{' '}
        <input value={reason} placeholder="one line: the contradiction" onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="muted">Every node beneath is marked too, naming this one.</p>
      <div className="row">
        <button className="primary" disabled={!reason.trim()} onClick={() => setOps([{ op: 'mark-dubious', place, reason }])}>
          mark dubious
        </button>
        <button onClick={() => setMarking(false)}>cancel</button>
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
