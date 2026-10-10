import type { LedgerSnapshot } from '@adroit/shared';
import { DubiousBadge } from './Badges.jsx';

/**
 * The walk through a change's suspect set before the commit: each suspect read in place
 * and, once read through, ticked as worked; the commit marks only the unticked rest
 * dubious. Nothing here gates the commit.
 * @DecisionRef ui:edits-cast-suspicion — the UI walks the user through the suspect set,
 * and the commit lands over an unworked set all the same.
 * @DecisionRef eng:same-operation-same-control — one walk, mounted by every change that
 * casts suspicion (edit, move, extraction).
 */
export function SuspectWalk({
  snapshot,
  suspects,
  worked,
  onToggle,
}: {
  snapshot: LedgerSnapshot;
  suspects: string[];
  worked: Set<string>;
  onToggle: (id: string, worked: boolean) => void;
}) {
  if (suspects.length === 0) {
    return <div className="muted">nothing depends on this — no record becomes suspect</div>;
  }
  const unworked = suspects.filter((s) => !worked.has(s)).length;
  return (
    <div className="suspect-walk">
      <ul>
        {suspects.map((id) => {
          const rec = snapshot.records[id];
          return (
            <li key={id}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={worked.has(id)}
                  onChange={(e) => onToggle(id, e.target.checked)}
                />
                <code>{id}</code> <span className="muted">read through — still coherent</span>
              </label>
              {rec && <DubiousBadge record={rec} />}
              {rec && <p className="rule-text">{rec.doc.decision}</p>}
            </li>
          );
        })}
      </ul>
      <div className="muted">
        the commit is never gated — {unworked} unworked suspect{unworked === 1 ? '' : 's'} will
        be marked DUBIOUS by it, naming this change, until confirmed or edited
      </div>
    </div>
  );
}
