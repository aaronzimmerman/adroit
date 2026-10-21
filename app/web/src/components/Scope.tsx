import type { NodeView } from '@adroit/shared';
import { labelOf, useLedger } from '../context.js';
import { TokenText } from './TokenText.jsx';

/**
 * Where the current node sits: the path down to it, and the parent's decision as the how this
 * node refines. Nothing above is listed as binding it.
 * @DecisionRef ui:trace-dependence — the path, each step selectable, and the parent's decision.
 */
export function PlaceInTree({ node }: { node: NodeView }) {
  const { view, travel } = useLedger();
  const parent = node.ancestors.at(-1);
  const parentNode = parent !== undefined ? view.places[parent]?.node : undefined;
  return (
    <section aria-label="where it sits">
      {node.ancestors.length === 0 ? (
        <p className="muted">This node is a tree's root.</p>
      ) : (
        <nav aria-label="path" className="row">
          {node.ancestors.map((a, i) => (
            <span key={a}>
              {i > 0 && <span className="muted"> › </span>}
              <button className="link" onClick={() => travel(a)}>
                {labelOf(view, a)}
              </button>
            </span>
          ))}
        </nav>
      )}
      {parentNode && (
        <p className="muted">
          A how of: <TokenText text={parentNode.doc.decision} />
        </p>
      )}
    </section>
  );
}

/**
 * The capabilities this node includes, each grafted beneath it and summarized by its root node's
 * decision.
 * @DecisionRef ui:capabilities-shown-summarized — beneath the includer, by the root's decision.
 */
export function Grafted({ node }: { node: NodeView }) {
  const { view, travel } = useLedger();
  const names = node.doc.includes ?? [];
  if (names.length === 0) return null;
  return (
    <section aria-label="grafted beneath">
      <h3>Grafted beneath</h3>
      {names.map((name) => {
        const at = `capabilities/${name}`;
        const root = view.places[at]?.node;
        return (
          <div key={name} className="capability-group">
            <div className="row">
              <strong>{name}</strong>
              {/* @DecisionRef ui:open-a-capability — open it in the navigation panel. */}
              {root && (
                <button onClick={() => travel(at)} aria-label={`open capability ${name}`}>
                  open {name}
                </button>
              )}
            </div>
            {root ? <p><TokenText text={root.doc.decision} /></p> : <p className="muted">No capability by this name has a root node.</p>}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Every node that includes the current capability.
 * @DecisionRef ui:capability-shows-includers — every node that includes this capability.
 */
export function IncludedBy({ node }: { node: NodeView }) {
  const { view, travel } = useLedger();
  if (!node.includers) return null;
  return (
    <section aria-label="included by">
      <h3>Included by</h3>
      {node.includers.length === 0 && <p className="muted">No node includes this capability.</p>}
      <ul className="plain">
        {node.includers.map((p) => (
          <li key={p}>
            <button className="link" onClick={() => travel(p)}>
              {labelOf(view, p)}
            </button>{' '}
            <span className="muted">{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
