// The derived picture the view renders: the places of the hierarchy, each node's scope, the
// views read as their typed fields, and the findings placed where they belong.
// @DecisionRef eng:browser-is-pure-view — the view renders this and derives nothing from disk.
// @DecisionRef principle:derive-dont-materialize — rebuilt from the files on every request.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LedgerView, NodeDoc, NodeView, Place, ViewField, ViewRecord } from '@adroit/shared';
import {
  CORPUS_KEY,
  corpusNameOf,
  effectiveReferences,
  emitYaml,
  entryKind,
  nodeIndex,
  parseSchemaField,
  ROOT_ORDER,
  SELF,
  shapeIndex,
  viewLinks,
  type LibNode,
  type LibRecord,
  type LibStore,
} from './adroit.js';
import type { GitFacts } from './gitfacts.js';
import { placeOfFile, type Opened } from './ledger.js';
import { capabilitiesInScope, capabilityOf, editReach } from './scope.js';

const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A node's one decision as far as it can be read; the check reports what is wrong with it. */
function nodeDocOf(n: LibNode, rec: LibRecord | undefined, fallbackName: string): NodeDoc {
  const raw = isMap(n.raw) ? n.raw : {};
  const doc: NodeDoc = {
    id: n.id ?? '',
    name: typeof raw.name === 'string' ? raw.name : fallbackName,
    decision: text(rec?.decision),
  };
  if (strings(rec?.rejected)) doc.rejected = strings(rec?.rejected);
  if (strings(rec?.references)) doc.references = strings(rec?.references);
  if (strings(raw.includes)) doc.includes = strings(raw.includes);
  if (typeof raw.dubious === 'string') doc.dubious = raw.dubious;
  if (strings(raw.questions)) doc.questions = strings(raw.questions);
  if (raw.context !== undefined) doc.context = raw.context;
  return doc;
}

/**
 * A view read as its typed fields: each field's type, the decision ids it cites, its meaning.
 * @DecisionRef ui:views-read-as-fields — typed fields, not a decision tree.
 */
function viewRecordOf(rec: LibRecord, cites: Map<string, string[]>): ViewRecord {
  const schema = isMap(rec.schema) ? rec.schema : {};
  const fields: ViewField[] = Object.entries(isMap(schema.fields) ? schema.fields : {}).map(([name, raw]) => {
    const f = parseSchemaField(raw);
    return {
      name,
      type: 'error' in f ? '?' : f.type,
      cites: cites.get(`${rec.id} ${name}`) ?? [],
      meaning: 'error' in f ? '' : f.meaning,
      raw: text(raw),
    };
  });
  const links = viewLinks(rec);
  return {
    id: text(rec.id) || rec._rel,
    decision: text(rec.decision),
    rejected: strings(rec.rejected) ?? [],
    fields,
    consumes: links.filter(([t]) => t === 'consumes').map(([, x]) => x),
    grounds: links.filter(([t]) => t === 'grounds').map(([, x]) => x),
  };
}

/** Each view field's cited decision ids, resolving or not: the check reports the dangling ones. */
function fieldCites(store: LibStore): Map<string, string[]> {
  const { edges, dangling } = shapeIndex(store);
  const out = new Map<string, string[]>();
  for (const e of [...edges, ...dangling]) {
    const key = `${e.model} ${e.field}`;
    if (!out.get(key)?.includes(e.ruling)) out.set(key, [...(out.get(key) ?? []), e.ruling]);
  }
  return out;
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
    const kind = entryKind(`ledger/${f}`) === 'view' ? 'view' : 'file';
    add({ path: f, kind, label: path.posix.basename(f), parent, ...(unreadable.has(f) ? { raw: unreadable.get(f) } : {}) });
  }

  const reachCount = (rel: string) => editReach(store, rel).size;
  const decisionOf = new Map(store.records.filter((r) => r._node).map((r) => [r._node!, r]));
  for (const n of store.nodes) {
    const at = placeOfFile(n.rel);
    const place = places[at];
    if (!place) continue;
    const rec = decisionOf.get(n.rel);
    const doc = nodeDocOf(n, rec, place.label.replace(/\.yaml$/, ''));
    const cap = capabilityOf(n.tree);
    const view: NodeView = {
      rel: n.rel,
      tree: n.tree,
      doc,
      views: effectiveReferences(rec),
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
      dependents: reachCount(n.rel),
      contextText: doc.context === undefined ? '' : typeof doc.context === 'string' ? doc.context : emitYaml(doc.context),
      ...(cap ? { capability: cap } : {}),
      ...(cap && n.rel === `capabilities/${cap}/${SELF}`
        ? { includers: store.nodes.filter((x) => x.includes.includes(cap)).map((x) => placeOfFile(x.rel)) }
        : {}),
    };
    places[at] = { ...place, kind: 'node', label: doc.name, node: view };
  }

  const cites = fieldCites(store);
  for (const rec of store.records.filter((r) => r._tree === 'models' && !r._node)) {
    const place = places[rec._rel];
    if (place) places[rec._rel] = { ...place, label: typeof rec.id === 'string' ? rec.id : place.label, view: viewRecordOf(rec, cites) };
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
  const ids: Record<string, string> = {};
  for (const r of store.records) if (typeof r.id === 'string') ids[r.id] ??= r._node ? placeOfFile(r._node) : r._rel;

  return {
    dir,
    corpus: corpusNameOf(store, dir),
    domains,
    repo: git?.repoRoot ?? null,
    places,
    roots: places[''].children,
    findings: opened.findings,
    ids,
  };
}
