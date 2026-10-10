import { useEffect, useState } from 'react';
import type { CodeCitation, LedgerSnapshot, RecordDoc } from '@adroit/shared';
import { api, ApiRefusal } from '../api.js';
import { renderInstant } from '../time.js';
import { DubiousBadge, DubiousReason } from './Badges.jsx';
import { ConfirmControl } from './ConfirmControl.jsx';
import { EditPanel } from './EditPanel.jsx';
import { SuspectWalk } from './SuspectWalk.jsx';

interface TravelFn {
  (id: string): void;
}

/**
 * The full weight of a record, expanded in place over whatever view is behind it;
 * revealing it never navigates away (@DecisionRef ui:full-record-expands-in-place).
 */
export function RecordOverlay({
  snapshot,
  id,
  onClose,
  onTravel,
  onChanged,
}: {
  snapshot: LedgerSnapshot;
  id: string;
  onClose: () => void;
  onTravel: TravelFn;
  onChanged: (message: string) => void;
}) {
  const rec = snapshot.records[id];
  const [tab, setTab] = useState<'read' | 'edit' | 'add-child' | 'move' | 'promote' | 'lens'>(
    'read',
  );
  useEffect(() => setTab('read'), [id]);
  if (!rec) return null;

  return (
    <div className="overlay" role="dialog" aria-label={`record ${id}`}>
      <div className="overlay-head">
        <code className="record-id">{rec.id}</code>
        <DubiousBadge record={rec} />
        {rec.interactionCount > 0 && (
          <span className="keep-count" title="interaction-log earned-its-keep count">
            earned its keep ×{rec.interactionCount}
          </span>
        )}
        <span className="spacer" />
        <button onClick={onClose}>close</button>
      </div>

      {rec.doc.dubious !== undefined && (
        <div className="dubious-box">
          <strong>There is reason to expect this record is no longer coherent:</strong>
          <DubiousReason record={rec} snapshot={snapshot} onTravel={onTravel} />
          <ConfirmControl id={id} onDone={onChanged} />
        </div>
      )}

      <nav className="overlay-tabs">
        {(['read', 'edit', 'add-child', 'move', 'promote', 'lens'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'lens' ? 'code lens' : t === 'promote' ? 'extract capability' : t}
          </button>
        ))}
      </nav>

      {tab === 'read' && <ReadView snapshot={snapshot} rec={rec} onTravel={onTravel} />}
      {tab === 'edit' && <EditPanel snapshot={snapshot} id={id} onDone={onChanged} />}
      {tab === 'add-child' && <AddChild id={id} snapshot={snapshot} onDone={onChanged} />}
      {tab === 'move' && <MovePanel id={id} snapshot={snapshot} onDone={onChanged} />}
      {tab === 'promote' && <PromotePanel id={id} snapshot={snapshot} onDone={onChanged} />}
      {tab === 'lens' && <LensPanel id={id} />}
    </div>
  );
}

function ReadView({
  snapshot,
  rec,
  onTravel,
}: {
  snapshot: LedgerSnapshot;
  rec: LedgerSnapshot['records'][string];
  onTravel: TravelFn;
}) {
  return (
    <div className="record-read">
      <p className="decision-text">{rec.doc.decision}</p>

      <section>
        <h4>rejected ({rec.doc.rejected.length})</h4>
        {rec.doc.rejected.length === 0 ? (
          <p className="muted">no alternatives recorded — an empty list is honest</p>
        ) : (
          <ul>
            {rec.doc.rejected.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </section>

      {/* @DecisionRef ui:commitments-always-visible — exactly the EFFECTIVE set, the
          inherited no less than the declared, each declaring record reachable; below a
          negation nothing about the commitment appears. */}
      <section>
        <h4>effective commitments</h4>
        {rec.effectiveCommitments.length === 0 && rec.negations.length === 0 && (
          <p className="muted">none in force here</p>
        )}
        <ul>
          {rec.effectiveCommitments.map((c) => (
            <li key={c.id}>
              <strong>{c.id}</strong>
              {!c.severable && <em className="unseverable"> (unseverable)</em>} — {c.description}{' '}
              {c.declaredBy.startsWith('capability:') ? (
                <span className="muted">incorporated from {c.declaredBy.slice(11)}</span>
              ) : c.declaredBy === rec.id ? (
                <span className="muted">declared here</span>
              ) : (
                <button className="link" onClick={() => onTravel(c.declaredBy)}>
                  declared by {c.declaredBy}
                </button>
              )}
              {c.adherence && <div className="adherence">adheres: {c.adherence}</div>}
            </li>
          ))}
          {rec.negations.map((n) => (
            <li key={n} className="negation">
              negates <strong>{n}</strong> — not in force here or anywhere beneath
            </li>
          ))}
        </ul>
      </section>

      <LinksExplorer snapshot={snapshot} rec={rec} onTravel={onTravel} />

      <section>
        <h4>context</h4>
        <dl className="context-list">
          {Object.entries(rec.doc.context).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/**
 * Links explored per relation, each with two depths: the gist in the context of the
 * record being read, and travel to the full context
 * (@DecisionRef ui:links-explored-by-relation, @DecisionRef ui:two-depths-per-link).
 */
function LinksExplorer({
  snapshot,
  rec,
  onTravel,
}: {
  snapshot: LedgerSnapshot;
  rec: LedgerSnapshot['records'][string];
  onTravel: TravelFn;
}) {
  const gistOf = (target: string): string => {
    const r = snapshot.records[target];
    if (r) return r.doc.decision;
    const model = snapshot.models.find((m) => m.id === target);
    if (model) return model.doc.summary;
    const cap = snapshot.capabilities.find((c) => c.name === target);
    if (cap) return cap.contract.summary;
    if (target.startsWith('principle:')) {
      return 'an ambient principle — it binds every record with no link needed';
    }
    return '(not found in this corpus)';
  };

  const relations: { name: string; note: string; targets: string[] }[] = [];
  const links = rec.doc.links ?? {};
  if (rec.parent) relations.push({ name: 'refines', note: 'the path carries it', targets: [rec.parent] });
  for (const relation of ['consumes', 'grounds', 'tension'] as const) {
    const targets = (links[relation] as string[] | undefined) ?? [];
    if (targets.length > 0) {
      relations.push({
        name: relation,
        note:
          relation === 'consumes'
            ? 'a contract this rule depends on'
            : relation === 'grounds'
              ? 'a principle this rests on (optional emphasis — principles are ambient)'
              : 'a principle this deliberately diverges from',
        targets,
      });
    }
  }
  if (rec.children.length > 0) {
    relations.push({ name: 'refined by', note: 'children in the tree', targets: rec.children });
  }
  if (rec.consumers.length > 0) {
    relations.push({ name: 'consumed by', note: 'records depending on this one', targets: rec.consumers });
  }

  const [open, setOpen] = useState<string | null>(null);

  return (
    <section>
      <h4>links, by relation</h4>
      {relations.length === 0 && <p className="muted">no links</p>}
      {relations.map((rel) => (
        <div key={rel.name} className="relation-group">
          <div className="relation-name">
            {rel.name} <span className="muted">— {rel.note}</span>
          </div>
          <ul>
            {rel.targets.map((t) => {
              const key = `${rel.name}:${t}`;
              const targetRec = snapshot.records[t];
              return (
                <li key={key}>
                  <button className="link" onClick={() => setOpen(open === key ? null : key)}>
                    {t}
                  </button>{' '}
                  {targetRec && <DubiousBadge record={targetRec} />}
                  {open === key && (
                    <div className="gist">
                      <p>{gistOf(t)}</p>
                      {/* @DecisionRef ui:two-depths-per-link — a tension link's gist states
                          the divergence it marks.
                          @DecisionGap no field holds the divergence a tension link marks;
                          chosen: the citing record's context.why, which carries it today. */}
                      {rel.name === 'tension' && (
                        <p className="muted">
                          the divergence:{' '}
                          {typeof rec.doc.context.why === 'string'
                            ? rec.doc.context.why
                            : 'this record states no reason for diverging'}
                        </p>
                      )}
                      {!t.startsWith('principle:') || snapshot.records[t] ? (
                        <button className="link" onClick={() => onTravel(t)}>
                          go to its full context →
                        </button>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function AddChild({
  id,
  snapshot,
  onDone,
}: {
  id: string;
  snapshot: LedgerSnapshot;
  onDone: (m: string) => void;
}) {
  const domains = Object.keys(snapshot.domains);
  const [recId, setRecId] = useState(`${domains[0] ?? 'eng'}:`);
  const [decision, setDecision] = useState('');
  const [rejected, setRejected] = useState('');
  const [why, setWhy] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    setError(null);
    const record: RecordDoc = {
      id: recId.trim(),
      decision: decision.trim(),
      rejected: rejected
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      links: {},
      context: why.trim() ? { why: why.trim() } : {},
    };
    try {
      const outcome = await api.change({
        operations: [{ op: 'create-record', parent: id, record }],
      });
      onDone(`created ${record.id} in commit ${outcome.commit?.slice(0, 8) ?? ''}`);
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'create failed');
    }
  };

  return (
    <div className="edit-panel">
      <p className="muted">a child that refines {id}; the path will carry the relation</p>
      <label>
        id <input value={recId} onChange={(e) => setRecId(e.target.value)} placeholder="domain:kebab-slug" />
      </label>
      <label>
        decision — the rule, stated so a reader can comply or detect violation
        <textarea rows={4} value={decision} onChange={(e) => setDecision(e.target.value)} />
      </label>
      <label>
        rejected alternatives, one per line (empty is honest)
        <textarea rows={3} value={rejected} onChange={(e) => setRejected(e.target.value)} />
      </label>
      <label>
        context.why — one clause of rationale
        <input value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <button onClick={commit}>create and commit</button>
      {error && <div className="refusal">{error}</div>}
    </div>
  );
}

function MovePanel({
  id,
  snapshot,
  onDone,
}: {
  id: string;
  snapshot: LedgerSnapshot;
  onDone: (m: string) => void;
}) {
  const [newParent, setNewParent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const moved = useMovedSubtree(id);
  const [worked, setWorked] = useWorkedSet(id);
  const subtree = moved.length;

  const commit = async () => {
    setError(null);
    try {
      const outcome = await api.change({
        operations: [{ op: 'move-record', id, newParent: newParent.trim() }],
        worked: [...worked],
      });
      onDone(
        `moved ${id}; ${outcome.markedDubious.length} unworked record(s) of the moved subtree marked dubious`,
      );
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'move failed');
    }
  };

  return (
    <div className="edit-panel">
      <p className="muted">
        re-parenting is a file move; the record's content and id are untouched
      </p>
      <div className="implications">
        a move casts suspicion over the moved subtree ({subtree} record{subtree === 1 ? '' : 's'}):
        ancestry and effective commitments change without touching a field
        <SuspectWalk snapshot={snapshot} suspects={moved} worked={worked} onToggle={setWorked} />
      </div>
      <label>
        new parent (a record id, or <code>engineering</code> / <code>capabilities/&lt;name&gt;</code>)
        <input list="all-record-ids" value={newParent} onChange={(e) => setNewParent(e.target.value)} />
      </label>
      <datalist id="all-record-ids">
        {Object.keys(snapshot.records).map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <button onClick={commit} disabled={!newParent.trim()}>
        move and commit
      </button>
      {error && <div className="refusal">{error}</div>}
    </div>
  );
}

/**
 * Extraction: select the root of a pattern, promote it to the capabilities root, and
 * relink what consumes it — a bigger edit, the same use case
 * (@DecisionRef ui:change-the-ledger).
 */
function PromotePanel({
  id,
  snapshot,
  onDone,
}: {
  id: string;
  snapshot: LedgerSnapshot;
  onDone: (m: string) => void;
}) {
  const rec = snapshot.records[id];
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [relink, setRelink] = useState<Record<string, boolean>>(
    Object.fromEntries(rec.consumers.map((c) => [c, true])),
  );
  const [error, setError] = useState<string | null>(null);
  const moved = useMovedSubtree(id);
  const [worked, setWorked] = useWorkedSet(id);

  const commit = async () => {
    setError(null);
    const capName = name.trim();
    try {
      const ops = [
        {
          op: 'publish-contract' as const,
          name: capName,
          contract: { capability: capName, version: 1, summary: summary.trim() },
        },
        { op: 'move-record' as const, id, newParent: `capabilities/${capName}` },
        ...rec.consumers
          .filter((c) => relink[c])
          .map((c) => {
            const links = { ...snapshot.records[c].doc.links };
            links.consumes = ((links.consumes as string[]) ?? []).map((t) =>
              t === id ? capName : t,
            );
            return { op: 'edit-field' as const, id: c, field: 'links' as const, value: links };
          }),
      ];
      const outcome = await api.change({
        operations: ops,
        message: `extract capability ${capName} from ${id}`,
        worked: [...worked],
      });
      onDone(`extracted capability ${capName} in commit ${outcome.commit?.slice(0, 8) ?? ''}`);
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'extraction failed');
    }
  };

  return (
    <div className="edit-panel">
      <p className="muted">
        promotes this subtree to the capabilities root with a published contract, and
        relinks the consumers you choose — one atomic commit
      </p>
      <label>
        capability name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="kebab-name" />
      </label>
      <label>
        contract summary
        <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      {rec.consumers.length > 0 && (
        <div>
          <strong>relink consumers</strong>
          {rec.consumers.map((c) => (
            <label key={c} className="checkbox-row">
              <input
                type="checkbox"
                checked={relink[c] ?? false}
                onChange={(e) => setRelink({ ...relink, [c]: e.target.checked })}
              />
              <code>{c}</code>
            </label>
          ))}
        </div>
      )}
      <div className="implications">
        the promoted subtree moves, so each of its records becomes suspect
        <SuspectWalk snapshot={snapshot} suspects={moved} worked={worked} onToggle={setWorked} />
      </div>
      <button onClick={commit} disabled={!name.trim() || !summary.trim()}>
        extract and commit
      </button>
      {error && <div className="refusal">{error}</div>}
    </div>
  );
}

/** A move's suspect set, measured by the server: the moved subtree. */
function useMovedSubtree(id: string): string[] {
  const [moved, setMoved] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    api.impact(id).then((r) => live && setMoved(r.moved ?? [])).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  return moved;
}

function useWorkedSet(id: string): [Set<string>, (s: string, on: boolean) => void] {
  const [worked, setWorked] = useState<Set<string>>(new Set());
  useEffect(() => setWorked(new Set()), [id]);
  const toggle = (s: string, on: boolean) =>
    setWorked((prev) => {
      const next = new Set(prev);
      if (on) next.add(s);
      else next.delete(s);
      return next;
    });
  return [worked, toggle];
}

/** @DecisionRef ui:read-only-code-lens — read the code's citations of this decision and
 * whether each changed since the rule did. */
function LensPanel({ id }: { id: string }) {
  const [citations, setCitations] = useState<CodeCitation[] | null>(null);
  const [axis, setAxis] = useState('');
  useEffect(() => {
    let live = true;
    api.citations(id).then((r) => {
      if (live) {
        setCitations(r.citations);
        setAxis(r.axis);
      }
    }).catch(() => live && setCitations([]));
    return () => {
      live = false;
    };
  }, [id]);

  if (citations === null) return <p className="muted">reading the code…</p>;
  return (
    <div className="lens-panel">
      <p className="muted">read-only: the ledger decides, the code complies, the lens reports ({axis})</p>
      {citations.length === 0 && <p className="muted">no code cites this decision yet</p>}
      {citations.map((c, i) => (
        <div key={i} className="citation">
          <div className="citation-head">
            <code>
              {c.file}:{c.line}
            </code>
            {c.changedSinceDecision ? (
              <span className="caught-up">changed since the rule changed</span>
            ) : (
              <span className="lagging">not touched since the rule changed</span>
            )}
            <span className="muted">file last changed {renderInstant(c.fileLastChanged)}</span>
          </div>
          <pre>{c.snippet}</pre>
        </div>
      ))}
    </div>
  );
}
