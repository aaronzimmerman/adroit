import { useLedger } from '../context.js';
import { FindingsHere } from './Findings.jsx';
import { Children, NodeDetails } from './NodeDetails.jsx';
import { Structure } from './Structure.jsx';
import { ViewDetails } from './ViewDetails.jsx';

/**
 * The right panel: whatever is current, with the findings placed on it first.
 * @DecisionRef ui:details-panel-right — the current node's details sit on the right.
 * @DecisionRef ui:one-layout-every-root — one panel for nodes of every root.
 */
export function DetailsPanel({ current }: { current: string }) {
  const { view } = useLedger();
  const place = view.places[current];
  if (!place) return <aside className="details-panel muted">Select a place in the hierarchy.</aside>;
  return (
    <aside className="details-panel" aria-label="details">
      <FindingsHere place={current} />
      {place.node && <NodeDetails place={current} node={place.node} />}
      {place.view && <ViewDetails record={place.view} />}
      {!place.node && !place.view && (
        <article>
          <h2>{place.label}</h2>
          <p className="muted">{place.path || view.dir}</p>
          {place.raw !== undefined && (
            <>
              <p>The parser could not read this file; here is its text.</p>
              <pre className="raw">{place.raw}</pre>
            </>
          )}
          <Children place={current} />
          {(place.kind === 'root' || place.kind === 'dir') && current !== '' && !current.startsWith('models') && <Structure place={current} />}
        </article>
      )}
    </aside>
  );
}
