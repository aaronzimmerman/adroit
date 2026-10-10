import type { LedgerSnapshot } from '@adroit/shared';

/**
 * The missing-decisions worklist: every gap event in the machine-local interactions log,
 * its decision ids travelable. Malformed log lines are reported, never a failure.
 * @DecisionRef eng:log-ledger-interactions — the explorer derives the gap list from the log.
 */
export function GapsPanel({
  snapshot,
  onTravel,
  onClose,
}: {
  snapshot: LedgerSnapshot;
  onTravel: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="suspects-panel">
      <div className="overlay-head">
        <strong>decision gaps — {snapshot.gaps.length}</strong>
        <span className="spacer" />
        <button onClick={onClose}>close</button>
      </div>
      {snapshot.interactionsSkipped > 0 && (
        <p className="muted">
          {snapshot.interactionsSkipped} malformed line(s) in the interactions log were skipped
        </p>
      )}
      {snapshot.gaps.length === 0 && <p className="muted">the interactions log records no gaps</p>}
      {snapshot.gaps.map((g, i) => (
        <div key={i} className="suspect-row">
          <p>{g.note}</p>
          <div>
            {g.ids.map((id) => (
              <button key={id} className="link" onClick={() => onTravel(id)}>
                {id}
              </button>
            ))}
            {g.where && <span className="muted"> · {g.where}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
