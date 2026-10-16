import type { NodeDoc, NodeView } from '@adroit/shared';
import { labelOf, useLedger } from '../context.js';

/** One node's decision, as read in scope. */
function ScopedDecision({ doc }: { doc: NodeDoc }) {
  return (
    <li>
      <code>{doc.id}</code> {doc.decision}
    </li>
  );
}

/**
 * Everything binding the current node from above: each ancestor's decision under that
 * ancestor, then each capability in scope summarized by its root node's decision.
 * @DecisionRef ui:trace-dependence — the node's own decision sits above this; here is the rest.
 * @DecisionRef ui:ancestors-grouped-by-ancestor — grouped by the ancestor that holds them.
 * @DecisionRef ui:engineering-left-out-of-scope — engineering is not listed here; it has its own root.
 */
export function BindingFromAbove({ node }: { node: NodeView }) {
  const { view, travel } = useLedger();
  return (
    <>
      <section aria-label="binding from above">
        <h3>Binding from above</h3>
        {node.ancestors.length === 0 && <p className="muted">This node is a tree's root: nothing above it.</p>}
        {node.ancestors.map((a) => {
          const anc = view.places[a]?.node;
          return (
            <div key={a} className="ancestor-group">
              <button className="link group-name" onClick={() => travel(a)}>
                {labelOf(view, a)}
              </button>
              <ul className="decision-list">
                {anc && <ScopedDecision doc={anc.doc} />}
              </ul>
            </div>
          );
        })}
      </section>
      {node.capabilities.length > 0 && (
        <section aria-label="capabilities in scope">
          <h3>Capabilities in scope</h3>
          {/* @DecisionRef ui:capabilities-shown-summarized — each by its root node's decision. */}
          {node.capabilities.map((c) => {
            const root = c.root ? view.places[c.root]?.node : undefined;
            const shown = root ? 1 : 0;
            return (
              <div key={c.name} className="capability-group">
                <div className="row">
                  <strong>{c.name}</strong>
                  <span className="muted">
                    brought in by{' '}
                    <button className="link" onClick={() => travel(c.via)}>
                      {labelOf(view, c.via)}
                    </button>
                  </span>
                  {/* @DecisionRef ui:open-a-capability — open it in the navigation panel. */}
                  {c.root && (
                    <button onClick={() => travel(c.root!)} aria-label={`open capability ${c.name}`}>
                      open {c.name}
                    </button>
                  )}
                </div>
                {root && (
                  <ul className="decision-list">
                    <ScopedDecision doc={root.doc} />
                  </ul>
                )}
                {c.decisionCount > shown && (
                  <p className="muted">
                    {c.decisionCount - shown} more decision{c.decisionCount - shown === 1 ? '' : 's'} in its tree bind here too — open it to
                    read them.
                  </p>
                )}
                {!root && <p className="muted">This capability has no root node to summarize it.</p>}
              </div>
            );
          })}
        </section>
      )}
      {node.includers && (
        <section aria-label="included by">
          <h3>Included by</h3>
          {/* @DecisionRef ui:capability-shows-includers — every node that includes this capability. */}
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
      )}
    </>
  );
}
