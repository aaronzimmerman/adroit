import type { DerivedRecord, DubiousReason } from '@adroit/shared';
import { renderInstant } from '../time.js';

// @DecisionRef ui:edits-cast-suspicion — an unworked suspect reads as DUBIOUS visibly,
// wherever it appears; this one badge is that label on every DOM surface.
// @DecisionRef eng:same-operation-same-control — one shared component, mounted by every
// surface that shows the state, never per-surface copies.
export function DubiousBadge({ record }: { record: Pick<DerivedRecord, 'dubious'> }) {
  if (record.dubious.length === 0) return null;
  return (
    <span className="dubious-badge" title={record.dubious.map(describeReason).join('\n')}>
      DUBIOUS
    </span>
  );
}

export function describeReason(r: DubiousReason): string {
  const when = renderInstant(r.at);
  switch (r.kind) {
    case 'ancestor-decision':
      return `${r.source} (an ancestor) changed its decision ${when}`;
    case 'moved':
      return `this record was moved — its ancestry and effective commitments changed ${when}`;
    case 'consumed-change':
      return `${r.source}, which this record consumes, changed ${when}`;
  }
}

export function Hierarchy({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return <span className="hierarchy">{ids.join(' › ')}</span>;
}
