// The derived picture the view renders: the places of the hierarchy, each node's scope, the
// models with their pending definitions, and the findings placed where they belong.
// @DecisionRef eng:browser-is-pure-view — the view renders this and derives nothing from disk.
// @DecisionRef principle:derive-dont-materialize — rebuilt from the files on every request.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  DecisionEntry,
  LedgerView,
  ModelFieldView,
  ModelView,
  NodeDoc,
  NodeView,
  Place,
} from '@adroit/shared';
import { CORPUS_KEY, corpusNameOf, emitYaml, nodeIndex, ROOT_ORDER, SELF, shapeIndex, type LibNode, type LibRecord } from './adroit.js';
import type { GitFacts } from './gitfacts.js';
import { placeOfFile, type Opened } from './ledger.js';
import { capabilitiesInScope, capabilityOf, editReach } from './scope.js';

const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;

/** A node's document as far as it can be read; the check reports what is wrong with it. */
function nodeDocOf(n: LibNode, fallbackName: string): NodeDoc {
  const raw = isMap(n.raw) ? n.raw : {};
  const decisions: DecisionEntry[] = (Array.isArray(raw.decisions) ? raw.decisions : [])
    .filter(isMap)
    .map((d) => ({
      id: String(d.id ?? ''),
      decision: typeof d.decision === 'string' ? d.decision : '',
      ...(strings(d.rejected) ? { rejected: strings(d.rejected) } : {}),
      ...(typeof d.severable === 'boolean' ? { severable: d.severable } : {}),
    }));
  const doc: NodeDoc = { name: typeof raw.name === 'string' ? raw.name : fallbackName, decisions };
  if (strings(raw.includes)) doc.includes = strings(raw.includes);
  if (strings(raw.severed)) doc.severed = strings(raw.severed);
  if (typeof raw.dubious === 'string') doc.dubious = raw.dubious;
  if (strings(raw.questions)) doc.questions = strings(raw.questions);
  if (raw.context !== undefined) doc.context = raw.context;
  return doc;
}

function modelViewOf(rec: LibRecord, opened: Opened, cites: Map<string, string[]>): ModelView {
  const shape = isMap(rec.shape) ? rec.shape : {};
  const fields = isMap(shape.fields) ? shape.fields : {};
  const pending = isMap(shape.pending) ? shape.pending : {};
  const inFlight = opened.pending.flatMap((p) =>
    (Array.isArray(p.doc.operations) ? p.doc.operations : [])
      .filter((o) => isMap(o) && o.model === rec.id)
      .map((o) => ({ field: String(o.field), intended: String(o.intended ?? ''), at: p.rel })),
  );
  const names = [...new Set([...Object.keys(fields), ...Object.keys(pending), ...inFlight.map((o) => o.field)])];
  const out: ModelFieldView[] = names.map((name) => {
    const flight = inFlight.find((o) => o.field === name);
    return {
      name,
      ...(typeof fields[name] === 'string' ? { deployed: fields[name] as string } : {}),
      ...(typeof pending[name] === 'string'
        ? { intended: pending[name] as string, pendingIn: 'model' }
        : flight
          ? { intended: flight.intended, pendingIn: flight.at }
          : {}),
      cites: cites.get(`${rec.id} ${name}`) ?? [],
    };
  });
  return { id: rec.id, decision: typeof rec.decision === 'string' ? rec.decision : '', fields: out };
}

/** Ledger-relative paths differing from the last commit, from git's status. */
async function uncommittedPaths(dir: string, git: GitFacts | null): Promise<Set<string>> {
  if (!git) return new Set();
  const prefix = path.relative(fs.realpathSync(git.repoRoot), fs.realpathSync(dir));
  const out = new Set<string>();
  for (const p of (await git.status()).keys()) {
    const rel = prefix ? (p.startsWith(`${prefix}/`) ? p.slice(prefix.length + 1) : null) : p;
    if (rel) out.add(rel);
  }
  return out;
}

export async function buildView(opened: Opened, git: GitFacts | null): Promise<LedgerView> {
  const { store, dir } = opened;
  const nx = nodeIndex(store);
  const dirty = await uncommittedPaths(dir, git);
  const places: Record<string, Place> = {};
  const add = (p: Omit<Place, 'children' | 'uncommitted'>) => {
    places[p.path] = { ...p, children: [], uncommitted: false };
  };

  add({ path: '', kind: 'root', label: path.basename(dir), parent: null });
  // Every root shows, an absent one empty (ADROIT.md, Layout).
  for (const root of ROOT_ORDER) add({ path: root, kind: 'root', label: root, parent: '' });
  for (const d of opened.dirs) {
    if (places[d]) continue;
    const parent = path.posix.dirname(d) === '.' ? '' : path.posix.dirname(d);
    add({ path: d, kind: 'dir', label: path.posix.basename(d), parent });
  }
  const unreadable = new Map(opened.unreadable.map((u) => [u.rel, u.content]));
  for (const f of opened.files) {
    const at = placeOfFile(f);
    const parent = path.posix.dirname(at) === '.' ? '' : path.posix.dirname(at);
    if (at !== f) {
      // a directory's own self.yaml: the directory place carries it
      if (unreadable.has(f)) places[at].raw = unreadable.get(f);
      continue;
    }
    const kind = f.startsWith('models/pending-changes/') ? 'pending-change' : f.startsWith('models/') ? 'model' : 'file';
    add({ path: f, kind, label: path.posix.basename(f), parent, ...(unreadable.has(f) ? { raw: unreadable.get(f) } : {}) });
  }

  const reachCount = (rel: string) => editReach(store, rel).size;
  for (const n of store.nodes) {
    const at = placeOfFile(n.rel);
    const place = places[at];
    if (!place) continue;
    const doc = nodeDocOf(n, place.label.replace(/\.yaml$/, ''));
    const cap = capabilityOf(n.tree);
    const chain = [...nx.ancestorsOf(n), n];
    const severed: Record<string, string> = {};
    for (const c of chain) for (const id of c.severed) severed[id] ??= placeOfFile(c.rel);
    const view: NodeView = {
      rel: n.rel,
      tree: n.tree,
      doc,
      ancestors: nx.ancestorsOf(n).map((a) => placeOfFile(a.rel)),
      capabilities: capabilitiesInScope(store, n.rel).map(({ name, via }) => {
        const root = `capabilities/${name}/${SELF}`;
        return {
          name,
          root: store.nodeByRel.has(root) ? placeOfFile(root) : null,
          via: placeOfFile(via),
          decisionCount: nx.nodesOfCapability(name).reduce((s, x) => s + x.ids.length, 0),
        };
      }),
      severed,
      dependents: reachCount(n.rel),
      contextText: doc.context === undefined ? '' : emitYaml(doc.context),
      ...(cap ? { capability: cap } : {}),
      ...(cap && n.rel === `capabilities/${cap}/${SELF}`
        ? { includers: store.nodes.filter((x) => x.includes.includes(cap)).map((x) => placeOfFile(x.rel)) }
        : {}),
    };
    places[at] = { ...place, kind: 'node', label: doc.name, node: view };
  }

  const cites = new Map<string, string[]>();
  for (const e of shapeIndex(store).edges) {
    if (e.section !== 'fields') continue;
    cites.set(`${e.model} ${e.field}`, [...(cites.get(`${e.model} ${e.field}`) ?? []), e.ruling]);
  }
  for (const rec of store.records.filter((r) => r._tree === 'models' && !r._node)) {
    const place = places[rec._rel];
    if (place) places[rec._rel] = { ...place, label: rec.id, model: modelViewOf(rec, opened, cites) };
  }
  for (const p of opened.pending) {
    const place = places[p.rel];
    if (place) {
      places[p.rel] = { ...place, label: typeof p.doc.name === 'string' ? p.doc.name : place.label, change: p.doc };
    }
  }

  for (const rel of dirty) {
    const at = places[placeOfFile(rel)];
    if (at) at.uncommitted = true;
  }
  // children, in reading order: the roots by ROOT_ORDER, everything else by label
  for (const p of Object.values(places)) if (p.parent !== null) places[p.parent]?.children.push(p.path);
  for (const p of Object.values(places)) {
    if (p.path === '') {
      const rank = (x: string) => (ROOT_ORDER.includes(x) ? ROOT_ORDER.indexOf(x) : ROOT_ORDER.length + (places[x].kind === 'file' ? 1 : 0));
      p.children.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    } else {
      p.children.sort((a, b) => places[a].label.localeCompare(places[b].label));
    }
  }

  const domains: Record<string, string> = {};
  if (isMap(store.domainsRaw)) {
    for (const [k, v] of Object.entries(store.domainsRaw)) if (k !== CORPUS_KEY) domains[k] = String(v);
  }
  const decisions: Record<string, string> = {};
  for (const r of store.records) if (r._node) decisions[r.id] ??= placeOfFile(r._node);

  return {
    dir,
    corpus: corpusNameOf(store, dir),
    domains,
    repo: git?.repoRoot ?? null,
    places,
    roots: places[''].children,
    findings: opened.findings,
    decisions,
  };
}
