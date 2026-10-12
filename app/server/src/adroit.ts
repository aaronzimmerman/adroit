// The bridge to the ledger tools the methodology ships (tools/lib.mjs, tools/yaml.mjs): the ONE
// loader, parser, validator and YAML writer. The app types the slice it uses and never
// re-implements a rule.
// @DecisionRef principle:single-resolver — every load, parse and finding routes through the
// tools' functions; this file only declares their types.
// @DecisionRef ui:findings-match-the-check — validate and warn are the check's own functions.
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface LibNode {
  rel: string;
  tree: string;
  parent: string | null;
  name: unknown;
  ids: string[];
  includes: string[];
  severed: string[];
  dubious: unknown;
  questions: unknown;
  context: unknown;
  raw: unknown;
  legacy: boolean;
}

export interface LibRecord {
  id: string;
  decision?: unknown;
  rejected?: unknown;
  severable?: unknown;
  shape?: unknown;
  _rel: string;
  _tree: string;
  _node?: string;
  [other: string]: unknown;
}

export interface LibStore {
  nodes: LibNode[];
  nodeByRel: Map<string, LibNode>;
  records: LibRecord[];
  byId: Map<string, LibRecord>;
  capabilities: Set<string>;
  domains: Map<string, unknown>;
  domainsRaw: unknown;
  retiredFiles: string[];
  strayRoots?: string[];
}

export interface LibEntry {
  kind: string;
  path: string;
  rel: string;
  content: string;
}

interface LibFinding {
  id: string;
  rule: string;
  message: string;
}

interface NodeIndex {
  ancestorsOf(n: LibNode | string): LibNode[];
  severedFor(n: LibNode | string): Set<string>;
  includedFor(n: LibNode | string): Set<string>;
  capabilityClosure(names: Iterable<string>): Set<string>;
  nodesOfCapability(name: string): LibNode[];
}

interface Lib {
  buildStore(entries: LibEntry[]): LibStore;
  entryKind(relPath: string, dir?: string): string | null;
  validate(store: LibStore): LibFinding[];
  warn(store: LibStore): LibFinding[];
  nodeIndex(store: LibStore): NodeIndex;
  corpusNameOf(store: LibStore, dir: string): string;
  slugOf(name: string): string;
  shapeIndex(store: LibStore): { edges: { model: string; field: string; ruling: string; section: string }[] };
  TREE_ROOTS: string[];
  ROOT_ORDER: string[];
  NODE_KEYS: string[];
  DECISION_KEYS: string[];
  SELF: string;
  CORPUS_KEY: string;
}

interface Yaml {
  parse(text: string): unknown;
  emit(value: unknown): string;
}

/** The tools directory beside app/: the same depth from src/ and from dist/. */
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tools');

const lib = (await import(pathToFileURL(path.join(TOOLS, 'lib.mjs')).href)) as Lib;
const yaml = (await import(pathToFileURL(path.join(TOOLS, 'yaml.mjs')).href)) as Yaml;

export const {
  buildStore,
  entryKind,
  validate,
  warn,
  nodeIndex,
  corpusNameOf,
  slugOf,
  shapeIndex,
  TREE_ROOTS,
  ROOT_ORDER,
  NODE_KEYS,
  DECISION_KEYS,
  SELF,
  CORPUS_KEY,
} = lib;
export const parseYaml = yaml.parse;
export const emitYaml = yaml.emit;
