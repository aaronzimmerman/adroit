import type { LedgerSnapshot } from '@adroit/shared';
import { describeReason } from './Badges.jsx';
import { ConfirmControl } from './ConfirmControl.jsx';

/**
 * @DecisionRef ui:edits-cast-suspicion — the UI walks the user through reading,
 * confirming or editing each suspect; the debt stays visible, never a gate.
 */
export function SuspectsPanel({
  snapshot,
  onOpen,
  onTravel,
  onChanged,
  onClose,
}: {
  snapshot: LedgerSnapshot;
  onOpen: (id: string) => void;
  onTravel: (id: string) => void;
  onChanged: (m: string) => void;
  onClose: () => void;
}) {
  const suspects = Object.values(snapshot.records).filter((r) => r.dubious.length > 0);
  return (
    <div className="suspects-panel">
      <div className="overlay-head">
        <strong>dubious records — {suspects.length}</strong>
        <span className="spacer" />
        <button onClick={onClose}>close</button>
      </div>
      {suspects.length === 0 && (
        <p className="muted">nothing is dubious: every record has been worked since what it
        depends on last changed</p>
      )}
      {suspects.map((r) => (
        <div key={r.id} className="suspect-row">
          <div>
            <button className="link" onClick={() => onOpen(r.id)}>
              <code>{r.id}</code>
            </button>{' '}
            <button className="link" onClick={() => onTravel(r.id)}>
              go to it →
            </button>
          </div>
          <ul>
            {r.dubious.map((reason, i) => (
              <li key={i}>{describeReason(reason)}</li>
            ))}
          </ul>
          <p className="rule-text">{r.doc.decision}</p>
          <ConfirmControl id={r.id} onDone={onChanged} />
        </div>
      ))}
    </div>
  );
}
