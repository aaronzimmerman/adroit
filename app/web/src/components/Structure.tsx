import { useState } from 'react';
import type { Operation, Place } from '@adroit/shared';
import { labelOf, useLedger } from '../context.js';
import { ChangeFlow } from './ChangeFlow.jsx';

type Form = 'add' | 'move' | 'extract' | null;

/** The places a node may go beneath: the roots that hold nodes, and every node or directory
 * outside its own subtree. */
function parentChoices(places: Record<string, Place>, own?: string): string[] {
  return Object.values(places)
    .filter((p) => p.path !== '' && (p.kind === 'node' || p.kind === 'dir' || ['product', 'capabilities', 'engineering'].includes(p.path)))
    .filter((p) => p.path !== 'models' && !p.path.startsWith('models/'))
    .filter((p) => !own || (p.path !== own && !p.path.startsWith(`${own}/`)))
    .map((p) => p.path)
    .sort();
}

/**
 * The structural changes made from a place: a node beneath it, a move, an extraction.
 * @DecisionRef ui:change-the-ledger — add a node beneath another; move one; extract a capability.
 */
export function Structure({ place }: { place: string }) {
  const { view } = useLedger();
  const [form, setForm] = useState<Form>(null);
  const [ops, setOps] = useState<Operation[] | null>(null);
  const isNode = view.places[place]?.kind === 'node';
  if (ops) return <ChangeFlow operations={ops} onCancel={() => setOps(null)} />;
  return (
    <section aria-label="structure">
      <div className="row">
        <button onClick={() => setForm(form === 'add' ? null : 'add')}>add a node beneath</button>
        {isNode && <button onClick={() => setForm(form === 'move' ? null : 'move')}>move</button>}
        {isNode && <button onClick={() => setForm(form === 'extract' ? null : 'extract')}>extract as a capability</button>}
      </div>
      {form === 'add' && <AddNode parent={place} onReady={setOps} />}
      {form === 'move' && <MoveNode place={place} onReady={setOps} />}
      {form === 'extract' && <Extract place={place} onReady={setOps} />}
    </section>
  );
}

/** @DecisionRef ui:create-a-node — a new node, in its place beneath this one. */
function AddNode({ parent, onReady }: { parent: string; onReady: (ops: Operation[]) => void }) {
  const { view } = useLedger();
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [decision, setDecision] = useState('');
  const [rejected, setRejected] = useState('');
  const namespaces = [...Object.keys(view.domains), ...view.places.capabilities.children.map((c) => c.split('/')[1]), 'story', 'principle'];
  return (
    <div className="form" aria-label="add a node">
      <label>
        name <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        first decision's id{' '}
        <input list="namespaces" value={id} placeholder="domain:kebab-slug" onChange={(e) => setId(e.target.value)} />
      </label>
      <datalist id="namespaces">
        {namespaces.map((n) => (
          <option key={n} value={`${n}:`} />
        ))}
      </datalist>
      <label>
        the decision, one clause
        <textarea rows={3} value={decision} onChange={(e) => setDecision(e.target.value)} />
      </label>
      <label>
        rejected alternatives, one per line, each with why it lost
        <textarea rows={2} value={rejected} onChange={(e) => setRejected(e.target.value)} />
      </label>
      <button
        className="primary"
        disabled={!name.trim() || !id.trim() || !decision.trim()}
        onClick={() =>
          onReady([
            {
              op: 'create-node',
              parent,
              doc: {
                name,
                decisions: [{ id, decision, rejected: rejected.split('\n').filter((r) => r.trim()) }],
              },
            },
          ])
        }
      >
        create beneath {labelOf(view, parent)}
      </button>
    </div>
  );
}

/** @DecisionRef ui:reparent-is-a-move — re-parenting is a move, never a text edit. */
function MoveNode({ place, onReady }: { place: string; onReady: (ops: Operation[]) => void }) {
  const { view } = useLedger();
  const choices = parentChoices(view.places, place).filter((p) => p !== view.places[place]?.parent);
  const [to, setTo] = useState(choices[0] ?? '');
  return (
    <div className="form" aria-label="move the node">
      <label>
        move beneath{' '}
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          {choices.map((p) => (
            <option key={p} value={p}>
              {p} — {labelOf(view, p)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">The node and everything beneath it move; each becomes suspect, since its scope changes.</p>
      <button className="primary" disabled={!to} onClick={() => onReady([{ op: 'move-node', place, newParent: to }])}>
        move
      </button>
    </div>
  );
}

/** @DecisionRef ui:extract-a-capability — the pattern's root moves into capabilities and each
 * place it repeated includes it. */
function Extract({ place, onReady }: { place: string; onReady: (ops: Operation[]) => void }) {
  const { view } = useLedger();
  const own = view.places[place]?.kind === 'node' ? place.replace(/\.yaml$/, '') : place;
  const candidates = Object.values(view.places)
    .filter((p) => p.kind === 'node' && p.path !== place && !p.path.startsWith(`${own}/`))
    .map((p) => p.path)
    .sort();
  const parent = view.places[place]?.parent ?? '';
  const [name, setName] = useState('');
  // @DecisionRef eng:defaults-are-likely-usage — the place it came from is the likeliest includer.
  const [chosen, setChosen] = useState<Set<string>>(new Set(view.places[parent]?.kind === 'node' ? [parent] : []));
  return (
    <div className="form" aria-label="extract a capability">
      <label>
        capability name <input value={name} placeholder="kebab-name" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="muted">include it at each place the pattern repeated:</div>
      <div className="checklist">
        {candidates.map((p) => (
          <label key={p} className="checkbox-row">
            <input
              type="checkbox"
              checked={chosen.has(p)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(p);
                else next.delete(p);
                setChosen(next);
              }}
            />
            {labelOf(view, p)} <span className="muted">{p}</span>
          </label>
        ))}
      </div>
      <button
        className="primary"
        disabled={!name.trim()}
        onClick={() => onReady([{ op: 'extract-capability', place, name: name.trim(), includers: [...chosen] }])}
      >
        extract
      </button>
    </div>
  );
}
