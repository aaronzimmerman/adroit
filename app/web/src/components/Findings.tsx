import type { Finding } from '@adroit/shared';
import { labelOf, useLedger } from '../context.js';

function FindingLine({ f }: { f: Finding }) {
  return (
    <>
      <span className={`badge ${f.severity}`}>{f.severity}</span> <code>{f.rule}</code> <span className="muted">{f.subject}</span> {f.message}
    </>
  );
}

/** The findings at one place, shown on the place at fault.
 * @DecisionRef ui:malformed-shown-in-place — each finding on the node or directory at fault. */
export function FindingsHere({ place }: { place: string }) {
  const { view } = useLedger();
  const here = view.findings.filter((f) => f.place === place);
  if (here.length === 0) return null;
  return (
    <ul className="findings-here" aria-label="findings here">
      {here.map((f, i) => (
        <li key={i}>
          <FindingLine f={f} />
        </li>
      ))}
    </ul>
  );
}

/** Every finding in one list; selecting one takes the user to its place.
 * @DecisionRef ui:findings-list-travels — the list travels to each finding's place. */
export function FindingsList({ onClose }: { onClose: () => void }) {
  const { view, travel } = useLedger();
  return (
    <div className="popover" role="dialog" aria-label="findings">
      <div className="row">
        <strong>
          {view.findings.length} finding{view.findings.length === 1 ? '' : 's'}
        </strong>
        <span className="spacer" />
        <button onClick={onClose}>close</button>
      </div>
      {view.findings.length === 0 && <p className="muted">The check finds nothing wrong with this ledger.</p>}
      <ul className="plain">
        {view.findings.map((f, i) => (
          <li key={i}>
            <button
              className="hit"
              onClick={() => {
                travel(f.place);
                onClose();
              }}
            >
              <div>
                <strong>{labelOf(view, f.place)}</strong> <span className="muted">{f.place || 'the ledger'}</span>
              </div>
              <div>
                <FindingLine f={f} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
