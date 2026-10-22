import { useEffect, useRef } from 'react';
import type { Place } from '@adroit/shared';
import { useLedger } from '../context.js';

/**
 * The hierarchy from the roots down. From it the user goes up a level, goes down, or selects
 * any child as the current node.
 * @DecisionRef ui:see-the-ledger — every root walkable, any node locatable from here.
 * @DecisionRef ui:navigation-panel-left — the left panel, the hierarchy from the roots down.
 * @DecisionRef ui:one-layout-every-root — product, capabilities, engineering and models all
 * walk in this one tree.
 * @DecisionRef ui:up-a-level-down-another — up to the parent, then into any other subtree.
 * @DecisionRef ui:current-kept-in-view — the current row is scrolled into view whenever it changes.
 * @DecisionRef ui:capabilities-shown-summarized — each capability a node includes sits beneath it,
 * after its children, marked as grafted.
 */
export function NavPanel({
  current,
  expanded,
  onToggle,
}: {
  current: string;
  expanded: Set<string>;
  onToggle: (place: string) => void;
}) {
  const { view, travel } = useLedger();
  const currentRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    currentRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);
  const here = view.places[current];
  const parent = here?.parent ?? null;
  const findingsAt = new Map<string, number>();
  for (const f of view.findings) findingsAt.set(f.place, (findingsAt.get(f.place) ?? 0) + 1);

  /** A capability grafted beneath a node: selecting it opens the capability's own tree. */
  const graftRow = (owner: string, name: string, depth: number) => {
    const at = `capabilities/${name}`;
    const root = view.places[at]?.node;
    return (
      <li key={`${owner}+${name}`}>
        <div className="nav-row graft" style={{ paddingLeft: 6 + depth * 14 }}>
          <span className="twisty" />
          {/* @DecisionRef ui:open-a-capability — selecting the graft opens the capability. */}
          <button
            className="nav-label"
            aria-label={`capability ${name}, grafted here`}
            title={root ? root.doc.decision : `no capability named ${name}`}
            disabled={!root}
            onClick={() => travel(at)}
          >
            ⤷ {name}
          </button>
          <span className="badge graft">capability</span>
        </div>
      </li>
    );
  };

  const row = (place: Place, depth: number) => {
    const open = expanded.has(place.path);
    const grafts = place.node?.doc.includes ?? [];
    const expandable = place.children.length > 0 || grafts.length > 0;
    const dubious = place.node?.doc.dubious !== undefined;
    const questions = place.node?.doc.questions?.length ?? 0;
    const findings = findingsAt.get(place.path) ?? 0;
    return (
      <li key={place.path}>
        <div
          ref={place.path === current ? currentRow : undefined}
          className={`nav-row ${place.path === current ? 'current' : ''} kind-${place.kind}`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          {expandable ? (
            <button className="twisty" aria-label={`${open ? 'collapse' : 'expand'} ${place.label}`} onClick={() => onToggle(place.path)}>
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="twisty" />
          )}
          <button className="nav-label" onClick={() => travel(place.path)} title={place.path}>
            {place.label}
          </button>
          {/* @DecisionRef ui:malformed-shown-in-place — a finding marks the row at fault. */}
          {findings > 0 && <span className="badge finding" title={`${findings} finding(s)`}>!{findings}</span>}
          {dubious && <span className="badge dubious" title={place.node!.doc.dubious}>dubious</span>}
          {questions > 0 && <span className="badge question" title={`${questions} open question(s)`}>?{questions}</span>}
          {place.uncommitted && <span className="badge uncommitted" title="differs from the last commit">uncommitted</span>}
        </div>
        {open && expandable && (
          <ul>
            {place.children.map((c) => view.places[c] && row(view.places[c], depth + 1))}
            {grafts.map((g) => graftRow(place.path, g, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav className="nav-panel" aria-label="hierarchy">
      <div className="nav-tools">
        <button disabled={parent === null || parent === ''} onClick={() => parent && travel(parent)}>
          ↑ up a level
        </button>
        <span className="muted nav-where">{here ? here.path || 'ledger' : ''}</span>
      </div>
      <ul className="nav-tree">{view.roots.map((r) => view.places[r] && row(view.places[r], 0))}</ul>
    </nav>
  );
}
