import type { DerivedRecord, LedgerSnapshot } from '@adroit/shared';

// @DecisionRef ui:dubious-is-recorded — the mark is the record's own field; this one badge
// shows it, with its reason, on every DOM surface the record appears on.
// @DecisionRef eng:same-operation-same-control — one shared component, mounted by every
// surface that shows the state, never per-surface copies.
export function DubiousBadge({ record }: { record: Pick<DerivedRecord, 'doc'> }) {
  if (record.doc.dubious === undefined) return null;
  return (
    <span className="dubious-badge" title={record.doc.dubious}>
      DUBIOUS
    </span>
  );
}

/**
 * The mark's one line of reason, with every record it names reachable — the reason names
 * the record whose change made this one suspect (ui:dubious-is-recorded).
 */
export function DubiousReason({
  record,
  snapshot,
  onTravel,
}: {
  record: Pick<DerivedRecord, 'id' | 'doc'>;
  snapshot: LedgerSnapshot;
  onTravel: (id: string) => void;
}) {
  const line = record.doc.dubious;
  if (line === undefined) return null;
  const named = [...new Set([...line.matchAll(/[a-z][a-z-]*:[a-z][a-z-]*/g)].map((m) => m[0]))].filter(
    (id) => id !== record.id && snapshot.records[id] !== undefined,
  );
  return (
    <div className="dubious-reason">
      <span>{line}</span>{' '}
      {named.map((id) => (
        <button key={id} className="link" onClick={() => onTravel(id)}>
          read {id}
        </button>
      ))}
    </div>
  );
}

export function Hierarchy({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return <span className="hierarchy">{ids.join(' › ')}</span>;
}
