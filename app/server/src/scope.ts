// What a change to a node reaches, measured from the tree (the directory nesting and the
// includes) — one place, read by the snapshot and by the write path.
// @DecisionRef principle:single-resolver — the snapshot's dependents count and the commit's
// suspect set are the same function.
import * as path from 'node:path';
import { SELF, type LibNode, type LibStore } from './adroit.js';

export const capabilityOf = (tree: string): string | null =>
  tree.startsWith('capabilities/') ? tree.slice('capabilities/'.length) : null;

/** Every node nested beneath a node: a leaf has none. */
export function descendantsOf(store: LibStore, rel: string): LibNode[] {
  if (path.posix.basename(rel) !== SELF) return [];
  const dir = rel.slice(0, -SELF.length);
  return store.nodes.filter((n) => n.rel.startsWith(dir) && n.rel !== rel);
}

/** Why a node falls in an edit's reach. */
type Reach = { kind: 'descendant' } | { kind: 'includer'; capability: string };

/**
 * The nodes an edit of a node's decision, rejected, references, includes or context makes suspect:
 * every descendant and, for a node inside a capability, every node that includes that
 * capability, with its descendants (ADROIT.md, Dubious).
 * Includers are followed through capabilities that include the edited one, one capability at a
 * time, until none is new (ADROIT.md, Dubious).
 */
export function editReach(store: LibStore, rel: string): Map<string, Reach> {
  const out = new Map<string, Reach>();
  for (const d of descendantsOf(store, rel)) out.set(d.rel, { kind: 'descendant' });
  const node = store.nodeByRel.get(rel);
  const first = node ? capabilityOf(node.tree) : null;
  const queue = first ? [first] : [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const cap = queue.shift()!;
    if (seen.has(cap)) continue;
    seen.add(cap);
    for (const inc of store.nodes.filter((n) => n.includes.includes(cap) && n.tree !== `capabilities/${cap}`)) {
      for (const n of [inc, ...descendantsOf(store, inc.rel)]) {
        if (n.rel !== rel && !out.has(n.rel)) out.set(n.rel, { kind: 'includer', capability: cap });
      }
      const next = capabilityOf(inc.tree);
      if (next) queue.push(next);
    }
  }
  return out;
}
