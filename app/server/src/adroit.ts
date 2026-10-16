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
  /** Its one decision's id; absent when the file names none. */
  id: string | undefined;
  /** That id as a list — several only for a file in a retired format. */
  ids: string[];
  includes: string[];
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
  references?: unknown;
  /** A view's typed schema. */
  schema?: unknown;
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
  includedFor(n: LibNode | string): Set<string>;
  capabilityClosure(names: Iterable<string>): Set<string>;
  nodesOfCapability(name: string): LibNode[];
}

/** One field citation: a view's field and a decision id it cites. */
interface ShapeEdge {
  model: string;
  field: string;
  ruling: string;
}

type SchemaField = { type: string; refs: string[]; meaning: string } | { error: string };

interface Lib {
  buildStore(entries: LibEntry[]): LibStore;
  entryKind(relPath: string, dir?: string): string | null;
  validate(store: LibStore): LibFinding[];
  warn(store: LibStore): LibFinding[];
  nodeIndex(store: LibStore): NodeIndex;
  corpusNameOf(store: LibStore, dir: string): string;
  slugOf(name: string): string;
  decisionsOf(raw: unknown): { id: string; decision: unknown }[];
  effectiveReferences(rec: LibRecord | undefined): string[];
  shapeIndex(store: Pick<LibStore, 'records' | 'byId'>): { edges: ShapeEdge[]; dangling: ShapeEdge[] };
  parseSchemaField(raw: unknown): SchemaField;
  viewLinks(rec: LibRecord): ['consumes' | 'grounds', string][];
  ROOT_ORDER: string[];
  TREE_ROOTS: string[];
  NODE_KEYS: string[];
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
  decisionsOf,
  effectiveReferences,
  shapeIndex,
  parseSchemaField,
  viewLinks,
  TREE_ROOTS,
  ROOT_ORDER,
  NODE_KEYS,
  SELF,
  CORPUS_KEY,
} = lib;
export const parseYaml = yaml.parse;
export const emitYaml = yaml.emit;
