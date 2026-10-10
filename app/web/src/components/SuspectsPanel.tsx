import type { LedgerSnapshot } from '@adroit/shared';
import { DubiousReason } from './Badges.jsx';
import { ConfirmControl } from './ConfirmControl.jsx';

/**
 * @DecisionRef ui:edits-cast-suspicion — the marked records stay visible until each is read
 * through and confirmed or edited; the debt stays visible, never a gate.
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
  const suspects = Object.values(snapshot.records).filter((r) => r.doc.dubious !== undefined);
  return (
    <div className="suspects-panel">
      <div className="overlay-head">
        <strong>dubious records — {suspects.length}</strong>
        <span className="spacer" />
        <button onClick={onClose}>close</button>
      </div>
      {suspects.length === 0 && <p className="muted">no record carries a dubious mark</p>}
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
          <DubiousReason record={r} snapshot={snapshot} onTravel={onTravel} />
          <p className="rule-text">{r.doc.decision}</p>
          <ConfirmControl id={r.id} onDone={onChanged} />{' '}
          <button className="link" onClick={() => onOpen(r.id)}>
            read and edit it
          </button>
        </div>
      ))}
    </div>
  );
}
