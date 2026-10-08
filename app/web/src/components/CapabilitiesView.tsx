import { useState } from 'react';
import type { DerivedCapability, LedgerSnapshot } from '@adroit/shared';
import { DubiousBadge } from './Badges.jsx';

/**
 * A serviceable capability treatment: the contract as the interface it is, with the
 * adherents unfolding as a hierarchy rooted at the capability
 * (@DecisionRef ui:links-explored-by-relation; presentation deliberately unruled —
 * ui:roots-get-native-treatments keeps capabilities open).
 */
export function CapabilitiesView({
  snapshot,
  onTravel,
  onOpen,
}: {
  snapshot: LedgerSnapshot;
  onTravel: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="capabilities-view">
      {snapshot.capabilities.length === 0 && (
        <p className="muted">no capabilities in this corpus yet</p>
      )}
      {snapshot.capabilities.map((cap) => (
        <CapabilityCard key={cap.name} cap={cap} snapshot={snapshot} onTravel={onTravel} onOpen={onOpen} />
      ))}
    </div>
  );
}

function CapabilityCard({
  cap,
  snapshot,
  onTravel,
  onOpen,
}: {
  cap: DerivedCapability;
  snapshot: LedgerSnapshot;
  onTravel: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [unfolded, setUnfolded] = useState(true);
  const sections: [string, unknown][] = Object.entries(cap.contract).filter(
    ([k]) => !['capability', 'version', 'summary', 'commitments'].includes(k),
  );

  return (
    <div className="capability-card" id={`rec-${cap.name}`}>
      <div className="model-head">
        <code className="record-id">{cap.name}</code>
        <span className="muted">contract v{String(cap.contract.version)}</span>
      </div>
      <p>{cap.contract.summary}</p>
      {(cap.contract.commitments ?? []).length > 0 && (
        <section>
          <h4>commitments every consuming tree incorporates</h4>
          <ul>
            {cap.contract.commitments!.map((c) => (
              <li key={c.id}>
                <strong>{c.id}</strong>
                {c.severable === false && <em className="unseverable"> (unseverable)</em>} —{' '}
                {c.description}
              </li>
            ))}
          </ul>
        </section>
      )}
      {sections.map(([k, v]) => (
        <section key={k}>
          <h4>{k}</h4>
          {typeof v === 'string' ? (
            <p>{v}</p>
          ) : (
            <dl className="context-list">
              {Object.entries(v as Record<string, unknown>).map(([k2, v2]) => (
                <div key={k2}>
                  <dt>
                    <code>{k2}</code>
                  </dt>
                  <dd>{String(v2)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}

      <section>
        <h4>
          <button className="link" onClick={() => setUnfolded(!unfolded)}>
            {unfolded ? '▾' : '▸'} adherents ({cap.adherents.length})
          </button>
        </h4>
        {unfolded && (
          <ul className="adherents-tree">
            {cap.adherents.map((id) => {
              const rec = snapshot.records[id];
              if (!rec) return null;
              const chain: string[] = [];
              let cur: string | undefined = rec.parent;
              while (cur) {
                chain.unshift(cur);
                cur = snapshot.records[cur]?.parent;
              }
              return (
                <li key={id}>
                  <span className="hierarchy">{chain.join(' › ')}</span>
                  <div>
                    <button className="link" onClick={() => onOpen(id)}>
                      <code>{id}</code>
                    </button>{' '}
                    <DubiousBadge record={rec} />
                    <button className="link" onClick={() => onTravel(id)}>
                      go to it →
                    </button>
                  </div>
                  <p className="rule-text">{rec.doc.decision}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {cap.records.length > 0 && (
        <section>
          <h4>the capability's own records</h4>
          <ul>
            {cap.records.map((id) => (
              <li key={id}>
                <button className="link" onClick={() => onOpen(id)}>
                  <code>{id}</code>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
