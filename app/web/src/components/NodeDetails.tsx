import { useState } from 'react';
import type { DecisionEntry, NodeView, Operation } from '@adroit/shared';
import { labelOf, useLedger } from '../context.js';
import { ChangeFlow } from './ChangeFlow.jsx';
import { EditInPlace, linesEditor, textEditor } from './EditInPlace.jsx';
import { Lens } from './Lens.jsx';
import { BindingFromAbove } from './Scope.jsx';
import { Structure } from './Structure.jsx';

const trimmed = (lines: string[]) => lines.map((l) => l.trim()).filter(Boolean);

/**
 * The current node, read and edited in place: its peer decisions with their rejected
 * alternatives, its dubious mark and questions, its structure, and everything binding it from
 * above.
 * @DecisionRef ui:details-panel-right — the right panel shows the current node.
 * @DecisionRef ui:all-but-id-editable — every field edits here; a decision's id is shown, fixed.
 */
export function NodeDetails({ place, node }: { place: string; node: NodeView }) {
  const doc = node.doc;
  const dubious = doc.dubious !== undefined;
  const reach = node.dependents;
  return (
    <article className="node-details">
      <header>
        <EditInPlace
          label="name"
          value={doc.name}
          render={(v) => <h2>{v}</h2>}
          editor={textEditor('name', 1)}
          toOps={(v, clearDubious) => [{ op: 'edit-node', place, field: 'name', value: v, clearDubious }]}
          dubious={dubious}
        />
        <div className="muted">
          {place} · {node.tree}
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

      <section aria-label="decisions">
        <h3>Decisions</h3>
        {doc.decisions.map((d) => (
          <DecisionCard key={d.id} place={place} d={d} reach={reach} dubious={dubious} />
        ))}
        <AddDecision place={place} reach={reach} />
      </section>

      <section aria-label="questions">
        <h3>Questions</h3>
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
          toOps={(qs, clearDubious) => [{ op: 'edit-node', place, field: 'questions', value: trimmed(qs), clearDubious }]}
          dubious={dubious}
        />
      </section>

      <section aria-label="includes and severed">
        <h3>Includes</h3>
        <EditInPlace
          label="includes"
          value={doc.includes ?? []}
          render={(v) => (v.length ? <p>{v.join(', ')}</p> : <p className="muted">Includes no capability.</p>)}
          editor={linesEditor('includes, one per line', 2)}
          toOps={(v, clearDubious) => [{ op: 'edit-node', place, field: 'includes', value: trimmed(v), clearDubious }]}
          dependents={reach}
          dubious={dubious}
        />
        <h3>Severed</h3>
        <EditInPlace
          label="severed"
          value={doc.severed ?? []}
          render={(v) => (v.length ? <p>{v.join(', ')}</p> : <p className="muted">Severs nothing.</p>)}
          editor={linesEditor('severed, one per line', 2)}
          toOps={(v, clearDubious) => [{ op: 'edit-node', place, field: 'severed', value: trimmed(v), clearDubious }]}
          dependents={reach}
          dubious={dubious}
        />
      </section>

      <section aria-label="context">
        <h3>Context</h3>
        <EditInPlace
          label="context"
          value={node.contextText}
          render={(v) => (v ? <pre className="context">{v}</pre> : <p className="muted">No context.</p>)}
          editor={textEditor('context', 5)}
          toOps={(v, clearDubious) => [{ op: 'edit-node', place, field: 'context', value: v, clearDubious }]}
          dependents={reach}
          dubious={dubious}
        />
      </section>

      <BindingFromAbove node={node} />
      <Children place={place} />
      <Structure place={place} />
    </article>
  );
}

function DecisionCard({ place, d, reach, dubious }: { place: string; d: DecisionEntry; reach: number; dubious: boolean }) {
  const [lens, setLens] = useState(false);
  const edit = (field: 'decision' | 'rejected' | 'severable') => (value: unknown, clearDubious: boolean): Operation[] => [
    { op: 'edit-decision', place, id: d.id, field, value, clearDubious },
  ];
  return (
    <div className="decision-card">
      <div className="row">
        <code className="decision-id">{d.id}</code>
        <button className="link" onClick={() => setLens(!lens)}>
          {lens ? 'hide the code' : 'code lens'}
        </button>
      </div>
      <EditInPlace
        label={`${d.id} decision`}
        value={d.decision}
        render={(v) => <p className="decision-text">{v}</p>}
        editor={textEditor(`${d.id} decision`, 4)}
        toOps={edit('decision')}
        dependents={reach}
        dubious={dubious}
      />
      <EditInPlace
        label={`${d.id} rejected`}
        value={d.rejected ?? []}
        render={(v) =>
          v.length ? (
            <ul className="rejected">
              {v.map((r, i) => (
                <li key={i}>
                  <span className="muted">rejected:</span> {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No rejected alternatives.</p>
          )
        }
        editor={linesEditor(`${d.id} rejected`)}
        toOps={(v, c) => edit('rejected')(trimmed(v), c)}
        dependents={reach}
        dubious={dubious}
      />
      <EditInPlace
        label={`${d.id} severable`}
        value={d.severable === true}
        render={(v) => <p className="muted">{v ? 'severable: a descendant may opt out' : 'not severable'}</p>}
        editor={(v, set) => (
          <label className="checkbox-row">
            <input type="checkbox" aria-label={`${d.id} severable`} checked={v} onChange={(e) => set(e.target.checked)} /> severable
          </label>
        )}
        toOps={edit('severable')}
        dependents={reach}
        dubious={dubious}
      />
      {lens && <Lens id={d.id} />}
    </div>
  );
}

/** A new peer decision on this node.
 * @DecisionGap the ledger makes a node's decisions editable without saying whether that adds or
 * removes peers; adding one is offered, removing one is not, since a deleted decision is a
 * supersession and the UI does not offer supersession. */
function AddDecision({ place, reach }: { place: string; reach: number }) {
  const [open, setOpen] = useState(false);
  const [ops, setOps] = useState<Operation[] | null>(null);
  const [id, setId] = useState('');
  const [text, setText] = useState('');
  const [rejected, setRejected] = useState('');
  if (ops) return <ChangeFlow operations={ops} onCancel={() => setOps(null)} />;
  if (!open) return <button onClick={() => setOpen(true)}>add a peer decision</button>;
  return (
    <div className="form" aria-label="add a decision">
      <label>
        id <input value={id} placeholder="domain:kebab-slug" onChange={(e) => setId(e.target.value)} />
      </label>
      <label>
        the decision, one clause
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label>
        rejected alternatives, one per line
        <textarea rows={2} value={rejected} onChange={(e) => setRejected(e.target.value)} />
      </label>
      {reach > 0 && <div className="implication">Adding a decision makes {reach} node{reach === 1 ? '' : 's'} beneath suspect.</div>}
      <div className="row">
        <button
          className="primary"
          disabled={!id.trim() || !text.trim()}
          onClick={() => setOps([{ op: 'add-decision', place, entry: { id, decision: text, rejected: trimmed(rejected.split('\n')) } }])}
        >
          add
        </button>
        <button onClick={() => setOpen(false)}>cancel</button>
      </div>
    </div>
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

/** The children of the current place, each selectable as the next current node. */
export function Children({ place }: { place: string }) {
  const { view, travel } = useLedger();
  const children = view.places[place]?.children ?? [];
  if (children.length === 0) return null;
  return (
    <section aria-label="children">
      <h3>Beneath</h3>
      <ul className="plain">
        {children.map((c) => (
          <li key={c}>
            <button className="link" onClick={() => travel(c)}>
              {labelOf(view, c)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
