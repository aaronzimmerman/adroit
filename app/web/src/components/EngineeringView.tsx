import type { DerivedRecord, LedgerSnapshot } from '@adroit/shared';
import { DubiousBadge } from './Badges.jsx';

/**
 * @DecisionRef ui:roots-get-native-treatments — engineering gets its own treatment, not
 * the deep-zoom star map.
 * @DecisionRef ui:engineering-reads-at-a-glance — the whole commons of small peer trees
 * surveyable, each rule and what refines it legible without excavation.
 */
export function EngineeringView({
  snapshot,
  onOpen,
  highlight,
}: {
  snapshot: LedgerSnapshot;
  onOpen: (id: string) => void;
  highlight?: string | null;
}) {
  const all = Object.values(snapshot.records).filter((r) => r.root === 'engineering');
  const roots = all.filter((r) => !r.parent);
  const principles = roots.filter((r) => r.id.startsWith('principle:'));
  const practices = roots
    .filter((r) => !r.id.startsWith('principle:'))
    .sort((a, b) => b.subtreeSize - a.subtreeSize || a.id.localeCompare(b.id));

  return (
    <div className="engineering-view">
      <section>
        <h3>principles — ambient: they bind every record with no link needed</h3>
        <div className="commons">
          {principles.map((r) => (
            <RuleCard key={r.id} rec={r} snapshot={snapshot} onOpen={onOpen} highlight={highlight} />
          ))}
        </div>
      </section>
      <section>
        <h3>the engineering commons — {practices.length} small trees</h3>
        <div className="commons">
          {practices.map((r) => (
            <RuleCard key={r.id} rec={r} snapshot={snapshot} onOpen={onOpen} highlight={highlight} />
          ))}
        </div>
      </section>
    </div>
  );
}

function RuleCard({
  rec,
  snapshot,
  onOpen,
  highlight,
  depth = 0,
}: {
  rec: DerivedRecord;
  snapshot: LedgerSnapshot;
  onOpen: (id: string) => void;
  highlight?: string | null;
  depth?: number;
}) {
  return (
    <div
      className={`rule-card depth-${depth} ${highlight === rec.id ? 'highlight' : ''}`}
      id={`rec-${rec.id.replace(':', '-')}`}
    >
      <div className="rule-head">
        <button className="link" onClick={() => onOpen(rec.id)}>
          <code>{rec.id}</code>
        </button>
        <DubiousBadge record={rec} />
        {rec.consumers.length > 0 && (
          <span className="muted">· {rec.consumers.length} consumer(s)</span>
        )}
      </div>
      <p className="rule-text">{rec.doc.decision}</p>
      {rec.children.map((c) => {
        const child = snapshot.records[c];
        return child ? (
          <RuleCard
            key={c}
            rec={child}
            snapshot={snapshot}
            onOpen={onOpen}
            highlight={highlight}
            depth={depth + 1}
          />
        ) : null;
      })}
    </div>
  );
}
