import type { NodeView } from '@adroit/shared';
import { labelOf, useLedger } from '../context.js';

/**
 * Where the current node sits: the path down to it, each step showing its own decision on hover.
 * Nothing above is listed as binding it.
 * @DecisionRef ui:trace-dependence — the path, each step selectable, its decision on hover.
 */
export function PlaceInTree({ node }: { node: NodeView }) {
  const { view, travel } = useLedger();
  return (
    <section aria-label="where it sits">
      {node.ancestors.length === 0 ? (
        <p className="muted">This node is a tree's root.</p>
      ) : (
        <nav aria-label="path" className="row">
          {node.ancestors.map((a, i) => (
            <span key={a}>
              {i > 0 && <span className="muted"> › </span>}
              <span className="crumb">
                <button className="link" onClick={() => travel(a)} aria-describedby={`crumb-${i}`}>
                  {labelOf(view, a)}
                </button>
                {view.places[a]?.node && (
                  <span className="crumb-tip" role="tooltip" id={`crumb-${i}`}>
                    {view.places[a].node!.doc.decision}
                  </span>
                )}
              </span>
            </span>
          ))}
        </nav>
      )}
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
