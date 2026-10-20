// adroit — the ledger's ONE loader, validator and index builder (ADROIT.md, The node).
//
// The canonical store is `ledger/` at the repo root. Four roots:
//
//   engineering/           read in full by every piece of work
//   capabilities/<name>/   self-contained trees, each rooted at a `self.yaml` stating what an includer takes on
//   models/                the typed views — the DTOs that cross section and trust boundaries
//   product/<app>/         one tree per app, its root node at `self.yaml`
//
// THE NODE FORMAT — ONE DECISION PER FILE (user-ruled 2026-10-14). Every decision file under
// engineering/, capabilities/ and product/ is a NODE holding exactly one decision: its `id`, a
// friendly `name`, the one-clause `decision`, optional `rejected`, optional `references` naming
// the view records whose data the decision governs (plus, implicitly, every view a
// `{slug.field}` token in its text names), optionally `includes` (capabilities whose whole tree
// joins the scope of the node and every descendant), and the maintenance notes `dubious`,
// `questions` and `context`. Directory nesting is parentage: a directory's own decision is its
// `self.yaml`, and a leaf file is a child decision of its directory. The file name carries no
// meaning; the id lives only inside the file.
//
// Internally a node still carries `ids` (a list): a file in one of the PREVIOUS formats — the
// `decisions:` list of 2026-10-11, or the host record + `peers:` before it — is read as a node of
// several decisions so `--diff` can compare against refs that predate one-decision-per-file. Such
// a file FAILS the check in the working tree: its retired keys are errors there.
//
// `models/` keeps its own format: one VIEW record per file, each carrying a TYPED `schema:` block —
// the DTO contract that crosses boundaries, its field types a closed vocabulary the check validates
// (see parseSchemaField), its field citations naming decision ids. The legacy `model:` records and
// their `shape:` / `tables:` / `pending:` blocks are retired (user-directed 2026-10-13): storage is
// memorialized by the code, in its migrations and models, never in the ledger. A capability is nothing but its subtree: its root node's decisions state what
// an includer takes on, and its nodes' `includes` are its dependencies. The capability contract file
// is retired (user-ruled 2026-10-12) — one anywhere in the store fails the check.
//
// The interaction events (ADROIT.md, The interactions log) are NOT in the store: they are usage
// telemetry, appended to a machine-local log outside any repository
// (`~/.adroit/<corpus>/interactions.jsonl`), validated line by line on read.
//
// Deliberately: no index, no SQLite, no cache. Several hundred small files parse in milliseconds,
// so every structure here is rebuilt per request (derive-dont-materialize).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from './yaml.mjs';

/** The adroit checkout these tools live in — never the project they read. */
export const TOOLS_DIR = import.meta.dirname;

/** The project the tools read: ADROIT_PROJECT_DIR, else the nearest directory at or above the
 *  working directory that holds a `ledger/`, else the working directory. The tools are run from
 *  the adopting project (`node $ADROIT_DIR/tools/dump.mjs`), never copied into it. */
function findProjectRoot() {
  if (process.env.ADROIT_PROJECT_DIR) return path.resolve(process.env.ADROIT_PROJECT_DIR);
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'ledger'))) return d;
    if (path.dirname(d) === d) return process.cwd();
  }
}
export const ROOT = findProjectRoot();
// ADROIT_LEDGER_DIR points the whole tool at another store — the server's `--dir` for everything
// that does not go through the server (tests, a frozen snapshot, a second checkout).
export const LEDGER_DIR = process.env.ADROIT_LEDGER_DIR
  ? path.resolve(process.env.ADROIT_LEDGER_DIR)
  : path.join(ROOT, 'ledger');

/** A directory's own node. */
export const SELF = 'self.yaml';
/** The retired capability interface file (user-ruled 2026-10-12): read only to be refused. */
export const RETIRED_CONTRACT = 'contract.yaml';
/** The roots. `capabilities/` and `product/` hold one tree per name; the rest are one tree each. */
export const TREE_ROOTS = ['capabilities', 'engineering', 'models', 'product'];
/** The roots whose files are NODES. */
export const NODE_ROOTS = ['capabilities', 'engineering', 'product'];
/** The directory the interaction events used to live in, named so the stray-root error can say
 *  where they went instead of only that the directory is wrong. */
export const RETIRED_INTERACTIONS_DIR = 'interactions';

/** A node's keys, in the order a file writes them. */
export const NODE_KEYS = ['id', 'name', 'decision', 'rejected', 'references', 'includes', 'dubious', 'questions', 'context'];
/** The keys of a node's one decision — the part a previous-format entry maps onto. */
export const DECISION_KEYS = ['id', 'decision', 'rejected', 'references'];
/** Keys of retired formats, each with what replaced it — a hard error, never ignored. */
export const RETIRED_NODE_KEYS = {
  decisions: 'one decision per file — id, name and decision sit at the top level, and each other ' +
    'decision is its own file in the node\'s directory',
  severable: 'severs are retired — a decision is a how of its direct parent',
  severed: 'severs are retired — a decision is a how of its direct parent',
  peers: 'one decision per file — each peer is its own file in the node\'s directory',
  links: 'links are retired — parentage is the directory, a capability is brought in by includes:',
  mounts: 'renamed includes:',
  severs: 'severs are retired — a decision is a how of its direct parent',
  commitments: 'a rule of the node is a decision file in its directory',
};

/** The tree a path inside the store belongs to — the directory, so there is one string to reason
 *  about and no second mapping from a record to its home. */
export const treeOfPath = (rel) => {
  const p = rel.split('/');
  return (p[0] === 'capabilities' || p[0] === 'product') && p.length > 1 ? `${p[0]}/${p[1]}` : p[0];
};
/** A tree's short name: a capability's or an app's own name, else the root's. */
export const cloudOfTree = (tree) => (tree.includes('/') ? tree.slice(tree.indexOf('/') + 1) : tree);
export const capabilityOfTree = (tree) =>
  (tree.startsWith('capabilities/') ? tree.slice('capabilities/'.length) : null);

/** The three moments worth recording (ADROIT.md, The interactions log). Routine citations are never logged. */
export const INTERACTION_KINDS = ['resolved-fork', 'prevented', 'gap'];
/** A note is a tally pointer, not a diary (ADROIT.md, The interactions log). */
export const INTERACTION_NOTE_CAP = 200;

/** ADROIT.md, Ids and the registry: an id's namespace names its KIND and is LOOKED UP, never inferred
 *  from shape. These are the graph-level kinds; every other namespace is a capability or a domain
 *  declared in `domains.yaml`. */
export const RESERVED_KINDS = ['principle', 'story', 'view'];
/** Kinds that once existed, each with what replaced it — an id in one is a hard error. */
export const RETIRED_KINDS = {
  model: 'models were retired for views — a typed view: record is the data vocabulary, and storage ' +
    'lives in the code, in its migrations and models',
};
/** A view record's keys, in the order a file writes them. */
export const VIEW_KEYS = ['id', 'decision', 'schema', 'rejected', 'links', 'context'];
/** A view's `links:` keys: the views it consumes, the principles it grounds in. */
export const VIEW_LINK_KEYS = ['consumes', 'grounds'];
/** Keys of the retired model format, each with what replaced it — a hard error on a view record. */
export const RETIRED_VIEW_KEYS = {
  shape: 'a view carries a typed schema: — the legacy shape: block went with the models; storage lives in the code, in its migrations and models',
  tables: 'storage is memorialized by the code, in its migrations and models, never listed in the ledger',
  pending: 'a view states current truth only; a ruled-but-unbuilt shape lives in the decisions that reference the view',
};
export const DOMAINS_FILE = 'domains.yaml';
/** The one key of `domains.yaml` that is not a domain: the corpus's stable name, which keys its
 *  machine-local interaction log. */
export const CORPUS_KEY = 'corpus';

/** The id rule (ADROIT.md, Ids and the registry): `<namespace>:<slug>`, the slug a few kebab-case words
 *  naming the decision's substance. A project that renumbered may keep `tools/id-map.json` to translate retired numbered ids. */
export const ID_SHAPE = /^[a-z][a-z0-9-]*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const namespaceOf = (id) => (typeof id === 'string' && id.includes(':') ? id.slice(0, id.indexOf(':')) : null);
export const kindOf = (id) => (RESERVED_KINDS.includes(namespaceOf(id)) ? namespaceOf(id) : 'decision');
export const isPrinciple = (id) => namespaceOf(id) === 'principle';
export const isView = (id) => kindOf(id) === 'view';
/** The retired kind an id is namespaced to, or null. */
export const retiredKindOf = (id) => (Object.hasOwn(RETIRED_KINDS, namespaceOf(id) ?? '') ? namespaceOf(id) : null);

export const truncate = (s, n = 110) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const oneLine = (s) => typeof s === 'string' && s.trim() !== '' && !/[\n\r]/.test(s);

// ---------------------------------------------------------------------------
// Names and file names
// ---------------------------------------------------------------------------

/** A name's file-name slug: lowercase, spaces → hyphens, punctuation dropped. The file name is
 *  DERIVED from the name and nothing keys off it — a node is found by its path, a decision by its id. */
export const slugOf = (name) => String(name).toLowerCase()
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');

/** Words a sentence-cased name keeps upper-case. Cosmetic only: a slug is lower-case either way. */
const ACRONYMS = new Map(['ai', 'api', 'cors', 'csrf', 'csv', 'cta', 'db', 'http', 'id', 'ip',
  'llm', 'mcp', 'og', 'qr', 'sql', 'ui', 'url', 'utc', 'json', 'html', 'ssi', 'sms', 'pdf', 'dto']
  .map((w) => [w, w.toUpperCase()]).concat([['apis', 'APIs'], ['ids', 'IDs'], ['urls', 'URLs']]));

/** A draft name from a decision id: `story:checkout-steps` → "Checkout steps". */
export function draftName(id) {
  const words = String(id).slice(String(id).indexOf(':') + 1).split('-').filter(Boolean)
    .map((w) => ACRONYMS.get(w) ?? w);
  if (!words.length) return String(id);
  if (words[0] === words[0].toLowerCase()) words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

// ---------------------------------------------------------------------------
// The previous tree format, read for --diff against older refs
// ---------------------------------------------------------------------------

/** Keys only the host-record format (before 2026-10-11) wrote — a file carrying one, and no `name`,
 *  is read in that format. */
const HOST_FORMAT_KEYS = ['peers', 'links', 'mounts', 'severs', 'severable'];

/** Is this parsed file in the host-record format (a host record with optional `peers:`)? A file
 *  with a `name` is never one: the host format had none. */
export const isLegacyNode = (raw) => isMap(raw) && raw.decisions === undefined && typeof raw.id === 'string'
  && raw.name === undefined && HOST_FORMAT_KEYS.some((k) => raw[k] !== undefined);

/** Is this parsed file in the decision-list format of 2026-10-11 (`name` + `decisions:` list)? */
export const isListNode = (raw) => isMap(raw) && Array.isArray(raw.decisions);

/** The decision entries a parsed node file carries, whatever its format — `[{ id, decision,
 *  rejected?, references? }]`, entries without a non-empty string id dropped (validate reports the
 *  shape). */
export function decisionsOf(raw) {
  if (!isMap(raw)) return [];
  const list = isLegacyNode(raw) ? legacyNode(raw).decisions
    : isListNode(raw) ? raw.decisions
      : [raw];
  return list.filter((d) => isMap(d) && typeof d.id === 'string' && d.id).map((d) => ({
    id: d.id, decision: d.decision,
    ...(d.rejected !== undefined ? { rejected: d.rejected } : {}),
    ...(d.references !== undefined ? { references: d.references } : {}),
  }));
}

/** The contexts of a node's decisions merged into the node's one `context`: one source keeps its
 *  shape, several become a mapping keyed by decision id. Nothing is dropped. */
export function mergeContexts(sources) {
  const present = sources.filter(([, c]) => c !== undefined && c !== null
    && !(typeof c === 'string' && !c.trim()) && !(isMap(c) && !Object.keys(c).length));
  if (!present.length) return undefined;
  if (present.length === 1) return present[0][1];
  return Object.fromEntries(present);
}

/** Adapt a previous-format file into a node: the host record and its peers become `decisions`
 *  (host first, peers in file order), `mounts` → `includes`, contexts merge, the name is drafted
 *  from the host id. `links`, `severable` and `severs` carry nothing forward. */
export function legacyNode(raw) {
  const entry = (id, d) => {
    const out = { id, decision: d?.decision };
    if (Array.isArray(d?.rejected) && d.rejected.length) out.rejected = d.rejected;
    return out;
  };
  const peers = isMap(raw.peers) ? Object.entries(raw.peers).filter(([, p]) => isMap(p)) : [];
  const node = {
    name: draftName(raw.id),
    decisions: [entry(raw.id, raw), ...peers.map(([pid, p]) => entry(pid, p))],
  };
  if (isStrArray(raw.mounts) && raw.mounts.length) node.includes = raw.mounts;
  const context = mergeContexts([[raw.id, raw.context], ...peers.map(([pid, p]) => [pid, p.context])]);
  if (context !== undefined) node.context = context;
  return node;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** A tree's colour. Small fixed palette, assigned by position in the sorted name list. */
export const TREE_ACCENT = { engineering: '#A8841C', models: '#7C5CD6' };
const CAPABILITY_ACCENTS = ['#8B8FA3', '#B45309', '#0D9488', '#9333EA', '#059669',
  '#BE365E', '#0284C7', '#64748B', '#C2410C', '#4F46E5'];
const PRODUCT_ACCENTS = ['#7C5CD6', '#B45309', '#0284C7', '#0D9488', '#64748B'];
const TREE_PURPOSE = {
  engineering: 'How the project is built — read in full by every piece of work.',
  models: 'The typed views — the DTO contracts that cross section and trust boundaries.',
};

/** A capability's root node's path — the node whose decisions state what an includer takes on. */
const capabilityRootRel = (cap) => `capabilities/${cap}/${SELF}`;

/** The trees, derived from the paths nodes and views live at. */
function synthesizeTrees(nodes, views) {
  const names = new Set([...nodes.map((n) => n.tree), ...views.map((m) => m._tree)]);
  const sorted = [...names].sort();
  const nth = (t, prefix) => sorted.filter((x) => x.startsWith(prefix)).indexOf(t);
  return sorted.map((tree) => {
    const cap = capabilityOfTree(tree);
    const app = tree.startsWith('product/') ? tree.slice('product/'.length) : null;
    return {
      name: cloudOfTree(tree), tree, kind: cap ? 'capability' : app ? 'product' : tree,
      accent: cap ? CAPABILITY_ACCENTS[nth(tree, 'capabilities/') % CAPABILITY_ACCENTS.length]
        : app ? PRODUCT_ACCENTS[nth(tree, 'product/') % PRODUCT_ACCENTS.length]
          : (TREE_ACCENT[tree] ?? null),
      purpose: cap ? (decisionsOf(nodes.find((n) => n.rel === capabilityRootRel(cap))?.raw).map((d) => d.decision)
        .filter((x) => typeof x === 'string').join(' · ') || null)
        : app ? `The ${app} app.` : (TREE_PURPOSE[tree] ?? null),
    };
  });
}

/** The parent node of a node file: the nearest enclosing directory holding a `self.yaml`, never
 *  above the file's own tree. */
function parentRelOf(rel, has) {
  const tree = treeOfPath(rel);
  let dir = path.posix.dirname(rel);
  if (path.posix.basename(rel) === SELF) dir = path.posix.dirname(dir);
  for (; dir.length >= tree.length && dir !== '.'; dir = path.posix.dirname(dir)) {
    if (has(`${dir}/${SELF}`)) return `${dir}/${SELF}`;
    if (dir === tree) break;
  }
  return null;
}

/** THE parser. Both sides of every read hand it the same entries — the working tree from disk, a
 *  git ref from `git cat-file` — so history and the working tree are parsed by one set of rules.
 *
 *  The store it returns:
 *    nodes       every node, in path order: { rel, file, tree, parent, id, name, ids, includes,
 *                dubious, questions, context, raw, legacy } — `id` its one decision, `ids` that
 *                one id as a list (several only for a previous-format file)
 *    nodeByRel   rel → node
 *    records     one per decision ({ id, decision, rejected?, references?, _file, _rel, _tree,
 *                _node, _nestedUnder }) plus one per view (its file, as written)
 *    byId        id → record
 *    retiredFiles  ledger-relative paths of retired files (a capability contract), which fail the check
 *    unreadable    [{ rel, message }] — files the parser refused; each fails the check, and the rest of
 *                  the store is still read and validated (ADROIT.md, The tools) */
export function buildStore(entries) {
  const files = [], views = [], retiredFiles = [], unreadable = [];
  let domains = new Map(), domainsRaw;
  const UNREADABLE = Symbol('unreadable');
  const parse = (entry) => {
    try {
      return parseYaml(entry.content);
    } catch (e) {
      unreadable.push({ rel: entry.rel, message: e.message });
      return UNREADABLE;
    }
  };
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    if (entry.kind === 'node') { const raw = parse(entry); if (raw !== UNREADABLE) files.push({ entry, raw }); }
    else if (entry.kind === 'view') {
      const raw = parse(entry);
      if (raw === UNREADABLE) continue;
      views.push({ ...(isMap(raw) ? raw : {}), _file: entry.path, _rel: entry.rel, _tree: 'models' });
    } else if (entry.kind === 'retired') {
      retiredFiles.push(entry.rel);
    } else if (entry.kind === 'domains') {
      domainsRaw = parse(entry);
      if (domainsRaw === UNREADABLE) domainsRaw = undefined;
      if (isMap(domainsRaw)) domains = new Map(Object.entries(domainsRaw).filter(([k]) => k !== CORPUS_KEY));
    }
  }

  const rels = new Set(files.map((f) => f.entry.rel));
  const nodes = [], records = [];
  for (const { entry, raw } of files) {
    // A previous-format file (decision list, or host record + peers) is read so --diff can compare
    // across the format changes; `legacy` marks it, and the check fails it in the working tree.
    const legacy = isLegacyNode(raw) || isListNode(raw);
    const body = isLegacyNode(raw) ? legacyNode(raw) : (isMap(raw) ? raw : {});
    const node = {
      rel: entry.rel, file: entry.path, tree: treeOfPath(entry.rel),
      parent: parentRelOf(entry.rel, (r) => rels.has(r)),
      name: body.name,
      ids: [],
      includes: isStrArray(body.includes) ? body.includes : [],
      dubious: body.dubious, questions: body.questions, context: body.context,
      raw, legacy,
    };
    for (const d of decisionsOf(raw)) {
      node.ids.push(d.id);
      records.push({
        ...d,
        _file: entry.path, _rel: `${entry.rel}#${d.id}`, _tree: node.tree, _node: node.rel,
        ...(node.parent ? { _nestedUnder: node.parent } : {}),
      });
    }
    node.id = node.ids[0];
    nodes.push(node);
  }
  // Parents before children, a directory's own node before its contents.
  const order = (rel) => rel.replace(/(^|\/)self\.yaml$/, '/');
  nodes.sort((a, b) => order(a.rel).localeCompare(order(b.rel)));
  records.push(...views);

  const trees = synthesizeTrees(nodes, views);
  return {
    // The interaction events are not part of the store (ADROIT.md, The interactions log); loadLedger
    // attaches the machine-local log's valid events here, so every consumer reads one array.
    nodes, nodeByRel: new Map(nodes.map((n) => [n.rel, n])),
    records, byId: new Map(records.map((r) => [r.id, r])),
    trees, treeByName: new Map(trees.map((t) => [t.tree, t])),
    capabilities: new Set(trees.filter((t) => t.kind === 'capability').map((t) => t.name)),
    retiredFiles, unreadable, domains, domainsRaw, interactions: [],
  };
}

/** Which kind of entry a path inside the store is — read off the path's shape, so one function
 *  answers for the working tree and for a git ref. Unknown files are ignored, not guessed at. */
export function entryKind(relPath, dir = 'ledger') {
  const rel = relPath.startsWith(`${dir}/`) ? relPath.slice(dir.length + 1) : null;
  if (rel === null || !rel.endsWith('.yaml')) return null;
  if (rel === DOMAINS_FILE) return 'domains';
  const parts = rel.split('/');
  if (parts[parts.length - 1] === RETIRED_CONTRACT) return 'retired';
  if (parts[0] === 'models') return parts.length === 2 ? 'view' : null;
  return NODE_ROOTS.includes(parts[0]) ? 'node' : null;
}

/** Load the whole store from the working tree. */
export function loadLedger({ dir = LEDGER_DIR } = {}) {
  const entries = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const rel = path.relative(dir, full).split(path.sep).join('/');
      const kind = entryKind(`ledger/${rel}`);
      if (kind) entries.push({ kind, path: path.relative(ROOT, full), rel, content: fs.readFileSync(full, 'utf8') });
    }
  };
  for (const root of TREE_ROOTS) walk(path.join(dir, root));
  // The files beside the roots: domains.yaml, and a retired file that must be reported, not skipped.
  for (const name of [DOMAINS_FILE, RETIRED_CONTRACT]) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) {
      entries.push({ kind: entryKind(`ledger/${name}`), path: path.relative(ROOT, full), rel: name, content: fs.readFileSync(full, 'utf8') });
    }
  }
  const store = buildStore(entries);
  // A directory beside the roots is invisible to every rule, so it is reported, not skipped.
  store.strayRoots = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !TREE_ROOTS.includes(e.name)).map((e) => e.name).sort()
    : [];
  store.corpus = corpusNameOf(store, dir);
  store.interactionLog = readInteractionLog(store.corpus);
  store.interactions = store.interactionLog.events;
  return store;
}

/** Load the store as it stood at a git ref. One `ls-tree` + one batched `cat-file`, then the same
 *  parser. Throws on a git failure (a bad ref is an error, not an empty diff). */
export function loadLedgerAtRef(ref, { cwd = ROOT, dir = 'ledger' } = {}) {
  const run = (args, input) =>
    execFileSync('git', args, { cwd, input, encoding: input === undefined ? 'utf8' : undefined, maxBuffer: 512 * 1024 * 1024 });
  const listing = run(['ls-tree', '-r', '-z', ref, '--', dir]).split('\0').filter(Boolean);
  const wanted = [];
  for (const row of listing) {
    const [meta, relPath] = row.split('\t');
    const [, type, sha] = meta.split(/\s+/);
    if (type !== 'blob') continue;
    const kind = entryKind(relPath, dir);
    if (kind) wanted.push({ kind, sha, path: relPath, rel: relPath.slice(dir.length + 1) });
  }
  if (!wanted.length) return buildStore([]);
  const out = run(['cat-file', '--batch'], wanted.map((w) => w.sha).join('\n') + '\n');
  const bySha = new Map();
  for (let pos = 0; pos < out.length;) {
    const nl = out.indexOf(0x0a, pos);
    if (nl === -1) break;
    const [sha, type, size] = out.subarray(pos, nl).toString('utf8').split(' ');
    if (type !== 'blob') { pos = nl + 1; continue; }
    const start = nl + 1;
    bySha.set(sha, out.subarray(start, start + Number(size)).toString('utf8'));
    pos = start + Number(size) + 1;
  }
  return buildStore(wanted.map((w) => ({ ...w, content: bySha.get(w.sha) ?? '' })));
}

// ---------------------------------------------------------------------------
// The interaction log — usage telemetry, machine-local (ADROIT.md, The interactions log)
// ---------------------------------------------------------------------------

/** The corpus's stable name: `corpus:` in domains.yaml, else the repository directory's name. */
export function corpusNameOf(store, dir = LEDGER_DIR) {
  const declared = isMap(store.domainsRaw) ? store.domainsRaw[CORPUS_KEY] : undefined;
  return typeof declared === 'string' && declared.trim() ? declared.trim() : path.basename(path.dirname(path.resolve(dir)));
}

/** Where the logs live. ADROIT_HOME moves them (tests, a second machine profile). */
export const adroitHome = () =>
  (process.env.ADROIT_HOME ? path.resolve(process.env.ADROIT_HOME) : path.join(os.homedir(), '.adroit'));
export const interactionLogPath = (corpus) => path.join(adroitHome(), corpus, 'interactions.jsonl');

/** What is wrong with one event, as sentences — empty when nothing is. Which ids an event names is
 *  NOT checked: an event may cite a decision of another corpus (the methodology's, upstream). */
export function eventProblems(e) {
  if (!isMap(e)) return ['an event must be a JSON object'];
  const out = [];
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) out.push('ts must be epoch millis');
  for (const k of ['src', 'note', 'where']) {
    if (typeof e[k] !== 'string' || !e[k].trim()) out.push(`${k} must be a non-empty string`);
  }
  if (typeof e.note === 'string' && e.note.length > INTERACTION_NOTE_CAP) {
    out.push(`note is ${e.note.length} chars (cap ${INTERACTION_NOTE_CAP}) — events are tallies, not diaries`);
  }
  if (!INTERACTION_KINDS.includes(e.kind)) out.push(`kind '${e.kind}' is not one of ${INTERACTION_KINDS.join(' | ')}`);
  if (!isStrArray(e.decisions)) out.push('decisions must be an array of decision ids');
  else if (!e.decisions.length && e.kind !== 'gap') out.push(`a '${e.kind}' event must name the decision that did the work`);
  return out;
}

/** Validation ON READ: every well-formed line is an event, every other line is reported with its
 *  number and skipped. A bad line never fails the corpus — the log is not the corpus. */
export function parseInteractionLog(text) {
  const events = [], bad = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let e;
    try {
      e = JSON.parse(line);
    } catch (err) {
      bad.push({ line: i + 1, problems: [`bad JSON: ${err.message}`] });
      return;
    }
    const problems = eventProblems(e);
    if (problems.length) bad.push({ line: i + 1, problems });
    else events.push({ ...e, _line: i + 1 });
  });
  return { events, bad };
}

/** The corpus's log, or an empty one when this machine has none — absence is a state, not an error. */
export function readInteractionLog(corpus) {
  const file = interactionLogPath(corpus);
  if (!fs.existsSync(file)) return { corpus, file, present: false, events: [], bad: [] };
  return { corpus, file, present: true, ...parseInteractionLog(fs.readFileSync(file, 'utf8')) };
}

/** The log's standing, for a renderer: where it is, whether it exists, and what was skipped. */
export const interactionLogSummary = ({ interactionLog: l } = {}) => (l
  ? { corpus: l.corpus, file: l.file, present: l.present, events: l.events.length, bad: l.bad }
  : { corpus: null, file: null, present: false, events: 0, bad: [] });

/** Events → { byDecision: Map<id, events[]>, gaps, events }, newest first. Derived on read. */
export function interactionIndex({ interactions = [] } = {}) {
  const newestFirst = [...interactions].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const byDecision = new Map();
  for (const e of newestFirst) {
    for (const id of e.decisions ?? []) byDecision.set(id, [...(byDecision.get(id) ?? []), e]);
  }
  return { byDecision, gaps: newestFirst.filter((e) => e.kind === 'gap'), events: newestFirst };
}

/** Decision ids a free-text note mentions, by id shape, kept only when the store has them. A
 *  citation with prose fused onto it backs off one hyphenated segment at a time. */
export function citedIds(text, byId) {
  const out = [];
  for (const m of String(text ?? '').match(/\b[A-Za-z][A-Za-z0-9-]*[:-][A-Za-z0-9][A-Za-z0-9-]*/g) ?? []) {
    for (let id = m.replace(/[-.,;:)]+$/, ''); id.includes('-') || id.includes(':');
      id = id.slice(0, id.lastIndexOf('-'))) {
      if (byId.has(id)) {
        if (!out.includes(id)) out.push(id);
        break;
      }
      if (!id.includes('-')) break;
    }
  }
  return out;
}

/** OPEN gaps: a gap event no decision has closed (naming the decision it produced closes it). Each
 *  is placed by the trees of the decisions its text cites. */
export function openGaps({ interactions = [], byId = new Map() } = {}) {
  return interactions
    .filter((e) => e.kind === 'gap' && !(e.decisions ?? []).length)
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    .map((e, i) => {
      const cites = citedIds(`${e.note ?? ''} ${e.where ?? ''} ${e.src ?? ''}`, byId);
      return {
        kind: 'gap', key: `gap:${e.ts ?? 0}:${i}`, ts: e.ts ?? null,
        note: e.note ?? '', where: e.where ?? '', src: e.src ?? '', cites,
        trees: [...new Set(cites.map((id) => byId.get(id)?._tree).filter(Boolean))].sort(),
      };
    });
}

// ---------------------------------------------------------------------------
// The views
// ---------------------------------------------------------------------------

/** The ids a schema field cites in parens are LINKS: each field
 *  points at the decisions it realizes. `edges` resolve, `dangling` do not (a check error), and
 *  `unlinked` are fields citing nothing — the probable-orphan signal, a report only. */
export function shapeIndex({ records = [], byId = new Map() } = {}) {
  const CITE_GROUP = /\(([^)]*)\)/g;
  const CITE_ID = /[a-z][a-z0-9-]*:[a-z][a-z0-9-]*/g;
  const citesOf = (raw) => {
    const out = new Set();
    for (const g of String(raw).matchAll(CITE_GROUP))
      for (const t of g[1].matchAll(CITE_ID)) out.add(t[0]);
    return out;
  };
  const edges = [], unlinked = [], dangling = [];
  for (const rec of records) {
    const fields = rec._tree === 'models' && isMap(rec.schema?.fields) ? rec.schema.fields : null;
    if (!fields) continue;
    for (const [field, raw] of Object.entries(fields)) {
      if (typeof raw !== 'string') continue;
      const cited = citesOf(raw);
      for (const ruling of cited) (byId.has(ruling) ? edges : dangling).push({ model: rec.id, field, ruling, section: 'fields' });
      if (!cited.size) unlinked.push({ model: rec.id, field });
    }
  }
  return { edges, unlinked, dangling };
}

/** THE TYPED SCHEMA (user-directed 2026-10-13: the ledger's typed data vocabulary is VIEWS ONLY —
 *  the DTOs that move through the system, never table schemas). Every record in models/ is a view
 *  carrying `schema:`; it holds `fields` only — no `tables` (storage lives in the code)
 *  and no `pending` (a view states current truth; ruled-but-unbuilt shapes live in the decisions
 *  that reference it). A field reads
 *    field: <type> [(id, id)] [— meaning]
 *  and the type is CLOSED vocabulary:
 *    string | text | int | long | double | bool | epoch | date | json
 *    enum<a|b|c> | ref<view:slug> | derived<type> | list<type> | map<key,type>
 *  The parenthesised ids are the links shapeIndex reads; the meaning is prose. */
export const SCHEMA_SCALARS = ['string', 'text', 'int', 'long', 'double', 'bool', 'epoch', 'date', 'json'];
const SCHEMA_ENUM_VALUE = /^[A-Za-z0-9_-]+$/;
const SCHEMA_REF = /^view:[a-z][a-z0-9-]*$/;

/** Parse one type token → { type, refs } or { error }. `refs` are the ids its ref<…>s name. */
export function parseSchemaType(token) {
  const t = String(token ?? '');
  if (SCHEMA_SCALARS.includes(t)) return { type: t, refs: [] };
  let m = /^enum<(.*)>$/.exec(t);
  if (m) {
    const values = m[1].split('|');
    if (!values.every((v) => SCHEMA_ENUM_VALUE.test(v))) return { error: `enum<…> takes |-separated values, got '${t}'` };
    if (new Set(values).size !== values.length) return { error: `enum<…> names a value twice in '${t}'` };
    return { type: t, refs: [] };
  }
  m = /^ref<(.*)>$/.exec(t);
  if (m) {
    if (SCHEMA_REF.test(m[1])) return { type: t, refs: [m[1]] };
    return { error: retiredKindOf(m[1])
      ? `ref<…> names '${m[1]}' — ${RETIRED_KINDS[retiredKindOf(m[1])]}; ref a view, or write the bare id as a scalar`
      : `ref<…> takes one view: id, got '${t}'` };
  }
  m = /^(derived|list)<(.*)>$/.exec(t);
  if (m) {
    const inner = parseSchemaType(m[2]);
    return inner.error ? inner : { type: t, refs: inner.refs };
  }
  m = /^map<(.*)>$/.exec(t);
  if (m) {
    let depth = 0, cut = -1;
    for (let i = 0; i < m[1].length; i++) {
      const c = m[1][i];
      if (c === '<') depth++;
      else if (c === '>') depth--;
      else if (c === ',' && depth === 0) { cut = i; break; }
    }
    if (cut < 0) return { error: `map<key,type> takes a key and a value type (no space, the type is one token), got '${t}'` };
    const key = m[1].slice(0, cut).trim();
    if (!['string', 'int', 'long'].includes(key)) return { error: `map<…> keys are string, int or long, got '${key}'` };
    const inner = parseSchemaType(m[1].slice(cut + 1).trim());
    return inner.error ? inner : { type: t, refs: inner.refs };
  }
  return { error: `'${t}' is not a schema type — use ${SCHEMA_SCALARS.join(' | ')} | enum<a|b> | ref<view:slug> | derived<type> | list<type> | map<key,type>` };
}

/** Parse one typed field value → { type, refs, meaning } or { error }. The type is the leading
 *  token (it holds no spaces); what follows is an optional parenthesised citation group and an
 *  optional `— meaning`. */
export function parseSchemaField(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'a schema field must be a non-empty string' };
  const m = /^(\S+)(?:\s+\(([^)]*)\))?(?:\s+—\s+([\s\S]*))?$/.exec(raw.trim());
  if (!m) return { error: `must read '<type> [(ids)] [— meaning]', got '${raw.length > 60 ? `${raw.slice(0, 60)}…` : raw}'` };
  const t = parseSchemaType(m[1]);
  return t.error ? t : { ...t, meaning: m[3] ?? '' };
}

/** Every way a view record's typed `schema:` block is malformed or missing — [{ field, message }]. */
export function schemaFindings(rec, byId = new Map()) {
  if (rec?.schema === undefined) {
    return [{ field: 'schema', message: 'a view carries a typed schema: — its DTO contract, fields only' }];
  }
  const out = [];
  if (!isMap(rec.schema)) return [{ field: 'schema', message: 'schema must be a mapping' }];
  for (const k of Object.keys(rec.schema)) {
    if (k !== 'fields') {
      out.push({ field: k, message: k === 'tables'
        ? 'a typed schema lists no tables — storage is memorialized by the code, in its migrations and models'
        : k === 'pending'
          ? 'a typed schema has no pending — a view states current truth only; a ruled-but-unbuilt shape lives in the decisions that reference the view'
          : `'${k}' is not a schema key — schema holds fields only` });
    }
  }
  if (!isMap(rec.schema.fields) || !Object.keys(rec.schema.fields).length) {
    return [...out, { field: 'fields', message: 'schema.fields must be a non-empty mapping of field → typed value' }];
  }
  for (const [field, raw] of Object.entries(rec.schema.fields)) {
    const f = parseSchemaField(raw);
    if (f.error) { out.push({ field, message: f.error }); continue; }
    for (const r of f.refs) {
      if (!(byId.get(r)?._tree === 'models')) out.push({ field, message: `${f.type} names '${r}', which is no view record` });
    }
  }
  return out;
}

/** Every view record's typed fields, as [{ name, type, refs, cites }] — what the ERD draws. */
export const schemaFieldsOf = (rec) => (isMap(rec?.schema?.fields) ? Object.entries(rec.schema.fields) : [])
  .map(([name, raw]) => {
    const f = parseSchemaField(raw);
    return f.error ? { name, type: '?', refs: [] } : { name, type: f.type, refs: f.refs };
  });

/** The view layer's wiring: the views, and which decision trees each REALIZES — read off its field
 *  citations (view → decision; a decision reaches a view only through its references). */
export function viewIndex({ records = [], byId = new Map() } = {}) {
  const views = records.filter((r) => isView(r.id) && r._tree === 'models');
  const refs = [], seen = new Set();
  for (const e of shapeIndex({ records: views, byId }).edges) {
    const from = byId.get(e.ruling)?._tree;
    if (!from || from === 'models') continue;
    const key = `${from} ${e.model} ${e.ruling}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ from, model: e.model, via: e.ruling });
  }
  const realizersOf = (id) => [...new Set(refs.filter((r) => r.model === id).map((r) => r.from))].sort();
  return { views, refs, realizersOf };
}

/** A view's own links (`links:` — the views it consumes, the principles it grounds in), as
 *  [type, target]. */
export const viewLinks = (rec) => [
  ...[].concat(rec.links?.grounds ?? []).map((t) => ['grounds', t]),
  ...[].concat(rec.links?.consumes ?? []).map((t) => ['consumes', t]),
].filter(([, t]) => typeof t === 'string');

/** The derivations a view DECLARES: its schema fields of type `derived<…>`; for a record with no
 *  schema, the capitalised names introduced with an em dash in its statement. */
export const declaredDerivations = (rec) => {
  const fields = rec?.schema?.fields;
  if (isMap(fields)) {
    return Object.entries(fields).filter(([, v]) => typeof v === 'string' && /^derived\b/.test(v)).map(([k]) => k);
  }
  return [...new Set([...(rec?.decision ?? '').matchAll(/\b([A-Z][A-Z-]{2,})\s+—/g)].map((m) => m[1]))];
};

// ---------------------------------------------------------------------------
// Nodes: ancestry and includes
// ---------------------------------------------------------------------------

/** NODES AND INCLUDES (user-ruled 2026-10-11; one decision per node 2026-10-14). A node's
 *  ancestors are the `self.yaml` of each enclosing directory. `includes: [x]` grafts the whole
 *  `capabilities/x` tree beneath the including node, exactly as if its nodes were nested there —
 *  with whatever that tree's own nodes include, transitively. It reaches nothing else beneath the
 *  includer: a capability is the includer's child, never a rule over its other descendants. Helpers:
 *    ancestorsOf(node)          ancestor nodes, root first
 *    includersOf(name)          the nodes outside a capability that include it
 *    capabilityClosure(names)   those names plus everything their trees include, transitively
 *    nodesOfCapability(name)    the capability's nodes, in path order */
export function nodeIndex(store) {
  const { nodes = [], nodeByRel = new Map() } = store;
  const nodeOf = (x) => (typeof x === 'string' ? nodeByRel.get(x) : x);
  const ancestorsOf = (n) => {
    const chain = [];
    for (let p = nodeOf(n)?.parent; p; p = nodeByRel.get(p)?.parent) {
      const anc = nodeByRel.get(p);
      if (!anc || chain.includes(anc)) break;
      chain.unshift(anc);
    }
    return chain;
  };
  const includersOf = (name) => nodes.filter((x) => x.includes.includes(name) && x.tree !== `capabilities/${name}`);
  const nodesOfCapability = (name) => nodes.filter((x) => x.tree === `capabilities/${name}`);
  const capabilityClosure = (names) => {
    const out = new Set(), queue = [...names];
    while (queue.length) {
      const c = queue.shift();
      if (out.has(c)) continue;
      out.add(c);
      for (const x of nodesOfCapability(c)) queue.push(...x.includes);
    }
    return out;
  };

  return { nodeOf, ancestorsOf, includersOf, capabilityClosure, nodesOfCapability };
}

// ---------------------------------------------------------------------------
// Text rules
// ---------------------------------------------------------------------------

/** Every view: id — or retired model: id — a node names in its decision (text and rejected) or
 *  its context. Decision TEXT never points at the models directory: the
 *  channels are a `{slug.field}` token and the `references:` key. `dubious` and `questions` are
 *  maintenance notes and never a check fault. */
export function modelIdsInText(value) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { for (const m of v.matchAll(/\b(?:model|view):[a-z][a-z0-9-]*/g)) out.add(m[0]); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (isMap(v)) for (const x of Object.values(v)) walk(x);
  };
  walk(value);
  return [...out];
}

/** NO IDS IN DECISION TEXT (user-directed 2026-10-10). A decision's text states the rule; its
 *  relationships are structural — the parent is the directory, a capability is an include. So the
 *  `decision` field names no record id. `rejected` and `context` may name ids.
 *  A token counts only when it RESOLVES to a live id. view: (and retired model:) ids are left to
 *  modelIdsInText. Flip the constant to make the findings warnings instead of errors. */
export const IDS_IN_DECISION_TEXT_FAIL = true;

const TEXT_ID_TOKEN = /(?<![A-Za-z0-9_:-])[a-z][a-z0-9-]*:[a-z0-9]+(?:-[a-z0-9]+)*/g;

/** Every record id named in a decision's text — [{ where, token }]. Views are out of scope. */
export function idsInDecisionText(rec, byId = new Map()) {
  if (!rec?._node || typeof rec.decision !== 'string') return [];
  const out = [], seen = new Set();
  for (const m of rec.decision.matchAll(TEXT_ID_TOKEN)) {
    const token = m[0];
    if (seen.has(token) || !byId.has(token) || isView(token) || retiredKindOf(token)) continue;
    seen.add(token);
    out.push({ where: 'decision', token });
  }
  return out;
}

/** The store-wide findings — the ONE walk validate, warn and the --check summary read. */
export function idsInDecisionTextFindings({ records = [], byId = new Map() } = {}) {
  return records.flatMap((rec) => idsInDecisionText(rec, byId).map((f) => ({ id: rec.id, ...f })));
}

/** FIELD TOKENS (user-directed 2026-10-13). A decision's prose may name a typed view's field inline
 *  as `{<slug>.<field>}` — in its `decision` or `rejected` text, never its context. `<slug>`
 *  resolves to the record `view:<slug>`, which must carry a typed `schema:`; `<field>` must be one
 *  of that schema's fields. Any `{…}` is a token: one that does not read `slug.field` (one dot,
 *  both parts non-empty, no spaces) is malformed, never passed over. Each token implies the
 *  decision references its view — see effectiveReferences. */
const FIELD_TOKEN = /\{([^{}]*)\}/g;
const FIELD_TOKEN_SHAPE = /^([a-z][a-z0-9-]*)\.([^\s.{}]+)$/;

/** Every `{…}` in one text → [{ raw, slug?, field?, view? }]; slug/field/view only when well-formed. */
export function fieldTokens(text) {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(FIELD_TOKEN)].map((m) => {
    const s = FIELD_TOKEN_SHAPE.exec(m[1]);
    return s ? { raw: m[0], slug: s[1], field: s[2], view: `view:${s[1]}` } : { raw: m[0] };
  });
}

/** The decision texts a token may sit in, as [where, text]. */
const tokenTexts = (rec) => [
  ['decision', rec?.decision],
  ...(Array.isArray(rec?.rejected) ? rec.rejected.map((t, i) => [`rejected[${i}]`, t]) : []),
];

/** Every way a decision's field tokens fail to resolve — [{ where, token, message }]. */
export function tokenFindings(rec, byId = new Map()) {
  if (!rec?._node) return [];
  const out = [];
  for (const [where, text] of tokenTexts(rec)) {
    for (const t of fieldTokens(text)) {
      if (!t.slug) { out.push({ where, token: t.raw, message: `'${t.raw}' is not a field token — write {<view-slug>.<field>}` }); continue; }
      const view = byId.get(t.view);
      const fields = view?._tree === 'models' && isMap(view.schema?.fields) ? view.schema.fields : null;
      if (!fields) out.push({ where, token: t.raw, message: `'${t.raw}' names ${t.view}, which is no typed view` });
      else if (!Object.hasOwn(fields, t.field)) {
        out.push({ where, token: t.raw, message: `'${t.raw}': ${t.view} has no field '${t.field}' — its fields are ${Object.keys(fields).join(', ')}` });
      }
    }
  }
  return out;
}

/** A decision's EFFECTIVE references: its explicit `references:` plus the view each well-formed
 *  field token names, in that order, deduplicated. */
export function effectiveReferences(rec) {
  const explicit = isStrArray(rec?.references) ? rec.references : [];
  const derived = tokenTexts(rec).flatMap(([, text]) => fieldTokens(text).filter((t) => t.view).map((t) => t.view));
  return [...new Set([...explicit, ...derived])];
}

const idsInTextMessage = (f) => `${f.where} names '${f.token}' — decision text carries no record ids; ` +
  `the parent is the directory, a capability is an include, history goes to context`;

/** REACH OVERCLAIM (user-directed 2026-10-10). A decision binds only its own subtree, so a product
 *  decision whose TEXT claims reach beyond it ("in any tool", "across the product") overstates what
 *  it governs. Scanned: the decision text of product nodes below an app root. A warning (some hits
 *  are legitimate); flip the constant to make the findings errors. */
export const OVERCLAIM_FAIL = false;
export const REACH_OVERCLAIM_PHRASES = [
  'anywhere', 'in any tool', 'every tool', 'all tools', 'any tool', 'across the product',
  'everywhere', 'throughout the app', 'in every app', 'platform-wide',
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OVERCLAIM_RE = new RegExp(
  `(?<![A-Za-z0-9-])(?:${[...REACH_OVERCLAIM_PHRASES].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![A-Za-z0-9-])`,
  'gi');

/** Every reach-word a product decision's own text carries — [{ where, phrase }]. */
export function reachOverclaims(rec) {
  if (!rec?._tree?.startsWith('product/') || !rec._nestedUnder || typeof rec.decision !== 'string') return [];
  const out = [], seen = new Set();
  for (const m of rec.decision.matchAll(OVERCLAIM_RE)) {
    const phrase = m[0].toLowerCase();
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    out.push({ where: 'decision', phrase });
  }
  return out;
}

export function reachOverclaimFindings({ records = [] } = {}) {
  return records.flatMap((rec) => reachOverclaims(rec).map((f) => ({ id: rec.id, ...f })));
}

const overclaimMessage = (f) => `${f.where} says '${f.phrase}' — a decision binds only its own ` +
  `subtree; state the reach it actually has, or move the rule up to where it binds`;

// ---------------------------------------------------------------------------
// Capability dependencies
// ---------------------------------------------------------------------------

/** One capability depending on another: a node inside capability a INCLUDES b. Library
 *  dependencies, so they must be ACYCLIC. */
export function capabilityDependencies({ nodes = [] } = {}) {
  const edges = new Map();
  const add = (a, b, why) => {
    if (!a || !b || a === b) return;
    const m = edges.get(a) ?? new Map();
    m.set(b, [...(m.get(b) ?? []), why]);
    edges.set(a, m);
  };
  for (const n of nodes) {
    const a = capabilityOfTree(n.tree);
    for (const b of a ? n.includes : []) add(a, b, `${n.rel} includes ${b}`);
  }
  return edges;
}

/** Cycles in that graph, as name paths. */
export function capabilityCycles(edges) {
  const cycles = [], state = new Map(), stack = [];
  const walk = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node)?.keys() ?? []) {
      if (state.get(next) === 1) cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) walk(next);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of [...edges.keys()].sort()) if (!state.has(node)) walk(node);
  return cycles;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Every way a store breaks the rules, as [{ id, rule, message }]. `id` is a decision id when one
 *  is at fault, else the ledger-relative path. */
export function validate(store) {
  const { records = [], byId = new Map(), nodes = [], nodeByRel = new Map(), domains = new Map(),
    domainsRaw, strayRoots = [], retiredFiles = [], unreadable = [], capabilities = new Set() } = store;
  const errors = [];
  const bad = (id, rule, message) => errors.push({ id, rule, message });

  for (const name of strayRoots) {
    bad(`${name}/`, 'root', `is not a ledger root — records live under ${TREE_ROOTS.join(', ')}; ` +
      `adroit's own corpus lives upstream` +
      (name === RETIRED_INTERACTIONS_DIR
        ? `; interaction events are machine-local telemetry, appended to ${interactionLogPath('<corpus>')} (ADROIT.md, The interactions log)`
        : ''));
  }
  for (const u of unreadable) bad(u.rel, 'unreadable', `could not be parsed — ${u.message}`);

  // --- the domain declaration (domains.yaml) --------------------------------
  // A namespace must name a capability tree, a reserved kind, or a declared domain.
  const namespaces = new Set([...capabilities, ...domains.keys()]);
  if (domainsRaw !== undefined && !isMap(domainsRaw)) {
    bad(DOMAINS_FILE, 'domains', 'must be a mapping of domain name → what it covers');
  } else if (domainsRaw && CORPUS_KEY in domainsRaw && !(typeof domainsRaw[CORPUS_KEY] === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(domainsRaw[CORPUS_KEY]))) {
    bad(DOMAINS_FILE, 'domains', `'${CORPUS_KEY}' must be a lowercase kebab name — it keys the machine-local interaction log`);
  }
  const inUse = new Set(records.map((r) => namespaceOf(r.id)));
  for (const [name, purpose] of domains) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) bad(DOMAINS_FILE, 'domains', `'${name}' is not a lowercase namespace`);
    if (typeof purpose !== 'string' || !purpose.trim()) bad(DOMAINS_FILE, 'domains', `'${name}' names no purpose`);
    if (RESERVED_KINDS.includes(name)) bad(DOMAINS_FILE, 'domains', `'${name}' is a reserved kind, not a domain`);
    if (Object.hasOwn(RETIRED_KINDS, name)) bad(DOMAINS_FILE, 'domains', `'${name}' is a retired kind, not a domain — ${RETIRED_KINDS[name]}`);
    if (capabilities.has(name)) bad(DOMAINS_FILE, 'domains', `'${name}' is a capability tree — its namespace already means that`);
    if (!inUse.has(name)) bad(DOMAINS_FILE, 'domains', `'${name}' is declared but no record uses it`);
  }

  // --- the node shape ---------------------------------------------------------
  for (const n of nodes) {
    const at = n.rel;
    const raw = n.raw;
    if (!isMap(raw)) { bad(at, 'shape', 'a node file must be a mapping'); continue; }
    for (const k of Object.keys(raw)) {
      if (NODE_KEYS.includes(k)) continue;
      if (RETIRED_NODE_KEYS[k]) bad(at, 'retired-key', `'${k}' is retired — ${RETIRED_NODE_KEYS[k]}`);
      else bad(at, 'unknown-key', `'${k}' is not a node key — a node holds only ${NODE_KEYS.join(', ')}`);
    }
    if (n.legacy) continue;  // the retired keys above are the whole story for an old-format file
    // ONE decision per file: id, name and decision at the top level.
    const where = typeof raw.id === 'string' && raw.id ? raw.id : at;
    if (typeof raw.id !== 'string' || !raw.id) bad(at, 'shape', 'id must be a non-empty string — a node file holds one decision');
    if (!oneLine(raw.name)) bad(where, 'shape', 'name must be a non-empty, one-line string');
    if (typeof raw.decision !== 'string' || !raw.decision.trim()) bad(where, 'shape', 'decision must be a non-empty string');
    if (raw.rejected !== undefined && !isStrArray(raw.rejected)) bad(where, 'shape', 'rejected must be a list of strings');
    if (raw.references !== undefined) {
      if (!isStrArray(raw.references) || !raw.references.length) bad(where, 'references', 'references must be a non-empty list of view ids');
      else {
        if (new Set(raw.references).size !== raw.references.length) bad(where, 'references', 'references names a record twice');
        for (const r of raw.references) {
          if (retiredKindOf(r)) bad(where, 'references', `'${r}' — ${RETIRED_KINDS[retiredKindOf(r)]}; reference the view that carries it`);
          else if (!(isView(r) && byId.get(r)?._tree === 'models')) bad(where, 'references', `'${r}' resolves to no view record`);
        }
      }
    }
    if (raw.includes !== undefined) {
      if (!isStrArray(raw.includes)) bad(at, 'includes', 'includes must be a list of capability names');
      else {
        if (new Set(raw.includes).size !== raw.includes.length) bad(at, 'includes', 'includes names a capability twice');
        for (const c of raw.includes) if (!capabilities.has(c)) bad(at, 'includes', `includes '${c}', which is no capability`);
        for (const c of raw.includes) if (n.tree === `capabilities/${c}`) bad(at, 'includes', `includes '${c}', the capability it lives in`);
      }
    }
    if (raw.dubious !== undefined && !oneLine(raw.dubious)) bad(at, 'dubious', 'dubious must be one non-empty line saying why');
    if (raw.questions !== undefined && !(Array.isArray(raw.questions) && raw.questions.length && raw.questions.every(oneLine))) {
      bad(at, 'questions', 'questions must be a list of non-empty, one-line strings');
    }
    if (raw.context !== undefined && !(typeof raw.context === 'string' && raw.context.trim())) {
      bad(at, 'context', 'context must be one free-form text, with no sub-keys');
    }
  }

  // --- ids ------------------------------------------------------------------------
  const seenIds = new Map();
  for (const rec of records) {
    const at = rec._rel ?? rec._file ?? '(in memory)';
    if (typeof rec.id !== 'string' || !rec.id) { bad(at, 'shape', 'id must be a non-empty string'); continue; }
    if (seenIds.has(rec.id)) bad(rec.id, 'duplicate-id', `also written in ${seenIds.get(rec.id)} (this one: ${at})`);
    else seenIds.set(rec.id, at);
    if (!ID_SHAPE.test(rec.id)) bad(rec.id, 'id-shape', `must be <namespace>:<kebab-case-slug> naming the decision's substance`);
    const ns = namespaceOf(rec.id);
    if (retiredKindOf(rec.id)) {
      bad(rec.id, 'retired-kind', `'${ns}:' is retired — ${RETIRED_KINDS[ns]}`);
      continue;
    }
    if (ns && !RESERVED_KINDS.includes(ns) && !namespaces.has(ns)) {
      bad(rec.id, 'namespace', `namespace '${ns}:' is neither a capability tree, a reserved kind ` +
        `(${RESERVED_KINDS.join(', ')}), nor a domain declared in ${DOMAINS_FILE} — declare it before using it`);
    }
    if (ns && capabilities.has(ns) && rec._tree !== `capabilities/${ns}`) {
      bad(rec.id, 'namespace', `is namespaced to the '${ns}' capability but lives in ${rec._tree}`);
    }
    if (isView(rec.id) !== (rec._tree === 'models')) {
      bad(rec.id, 'models', isView(rec.id) ? `a view lives in the models directory, not ${rec._tree}`
        : 'the models directory holds only view: records');
    }
  }

  // --- the models directory: one typed view per file -------------------------------
  for (const rec of records.filter((r) => r._tree === 'models')) {
    const at = rec.id ?? rec._rel;
    for (const k of Object.keys(rec).filter((x) => !x.startsWith('_'))) {
      if (VIEW_KEYS.includes(k)) continue;
      if (RETIRED_VIEW_KEYS[k]) bad(at, 'retired-key', `'${k}' is retired — ${RETIRED_VIEW_KEYS[k]}`);
      else bad(at, 'unknown-key', `'${k}' is not a view key — a view holds only ${VIEW_KEYS.join(', ')}`);
    }
    if (typeof rec.decision !== 'string' || !rec.decision.trim()) bad(at, 'shape', 'decision must be a non-empty string');
    if (rec.rejected !== undefined && !isStrArray(rec.rejected)) bad(at, 'shape', 'rejected must be a list of strings');
    if (rec.links !== undefined) {
      if (!isMap(rec.links)) bad(at, 'shape', 'links must be a mapping of consumes / grounds');
      else {
        for (const k of Object.keys(rec.links).filter((x) => !VIEW_LINK_KEYS.includes(x))) {
          bad(at, 'unknown-key', `links.${k} is not a link — a view's links are ${VIEW_LINK_KEYS.join(', ')}`);
        }
      }
    }
    for (const [type, t] of viewLinks(rec)) {
      if (type === 'consumes' && !(isView(t) && byId.get(t)?._tree === 'models')) {
        bad(at, 'dangling', `consumes '${t}', which is no view record — a view consumes other views; ` +
          `storage lives in the code, in its migrations and models`);
      } else if (type === 'grounds' && !byId.has(t) && !isPrinciple(t)) {
        bad(at, 'dangling', `grounds '${t}' names no record`);
      }
    }
  }
  for (const rec of records.filter((r) => r._tree === 'models')) {
    for (const f of schemaFindings(rec, byId)) bad(rec.id ?? rec._rel, 'schema-type', `schema.${f.field}: ${f.message}`);
  }
  for (const d of shapeIndex(store).dangling) {
    bad(d.model, 'shape-citation', `schema.${d.field} cites '${d.ruling}', which resolves to no record`);
  }

  // --- what decision text may say ---------------------------------------------------
  for (const n of nodes) {
    if (n.legacy || !isMap(n.raw)) continue;
    for (const id of modelIdsInText([n.raw.decision, n.raw.rejected, n.raw.context])) {
      bad(n.rel, 'model-in-decision', `names '${id}' — decision text never names a view id; ` +
        `name a field as a {slug.field} token, or list the view in the decision's references:`);
    }
  }
  for (const rec of records) {
    for (const f of tokenFindings(rec, byId)) bad(rec.id, 'token', `${f.where}: ${f.message}`);
  }
  if (IDS_IN_DECISION_TEXT_FAIL) {
    for (const f of idsInDecisionTextFindings(store)) bad(f.id, 'id-in-decision-text', idsInTextMessage(f));
  }
  if (OVERCLAIM_FAIL) {
    for (const f of reachOverclaimFindings(store)) bad(f.id, 'reach-overclaim', overclaimMessage(f));
  }

  // --- the capabilities ---------------------------------------------------------------
  // A capability is its subtree; its root node states what an includer takes on.
  for (const cap of [...capabilities].sort()) {
    if (!nodeByRel.has(capabilityRootRel(cap))) {
      bad(`capabilities/${cap}/`, 'capability-root', `has no root ${SELF} — a capability's root node states what an includer takes on`);
    }
  }
  for (const rel of retiredFiles) {
    bad(rel, 'retired-file', `${RETIRED_CONTRACT} is retired — a capability's root node states what an includer takes on`);
  }
  for (const cycle of capabilityCycles(capabilityDependencies(store))) {
    bad(`capabilities/${cycle[0]}`, 'capability-cycle', `capability dependencies must be one-way: ${cycle.join(' → ')}`);
  }
  return errors;
}

/** WARNINGS — worth seeing, never failing the check (ADROIT.md, The tools). */
export function warn(store) {
  const warnings = [];
  if (!IDS_IN_DECISION_TEXT_FAIL) {
    for (const f of idsInDecisionTextFindings(store)) warnings.push({ id: f.id, rule: 'id-in-decision-text', message: idsInTextMessage(f) });
  }
  if (!OVERCLAIM_FAIL) {
    for (const f of reachOverclaimFindings(store)) warnings.push({ id: f.id, rule: 'reach-overclaim', message: overclaimMessage(f) });
  }
  return warnings;
}

/** The --check summary's counts, in one place. */
export function storeCounts(store) {
  const decisions = store.records.filter((r) => r._node);
  return {
    nodes: store.nodes.length,
    decisions: decisions.length,
    includes: store.nodes.reduce((n, x) => n + x.includes.length, 0),
    dubious: store.nodes.filter((x) => x.dubious !== undefined).length,
    questions: store.nodes.reduce((n, x) => n + (Array.isArray(x.questions) ? x.questions.length : 0), 0),
    views: store.records.filter((r) => r._tree === 'models' && isView(r.id)).length,
    references: decisions.reduce((n, r) => n + effectiveReferences(r).length, 0),
  };
}

// ---------------------------------------------------------------------------
// The scoped read (user-directed 2026-10-10)
// ---------------------------------------------------------------------------

/** The scope roles, in reading order. */
export const SCOPE_ROLES = ['engineering', 'includer', 'ancestor', 'target', 'descendant'];

/** Resolve a target — a decision id, or a ledger-relative path to a node file or directory — to
 *  its node; null when nothing matches. */
export function resolveNode(store, t) {
  const rec = store.byId.get(t);
  if (rec?._node) return store.nodeByRel.get(rec._node);
  const rel = String(t).replace(/^\.?\/?/, '').replace(/^ledger\//, '').replace(/\/+$/, '');
  return store.nodeByRel.get(rel) ?? store.nodeByRel.get(`${rel}/${SELF}`) ?? null;
}

/** What an agent working on `targets` reads — each node is a how of its parent, so the rest of
 *  the store does not bind the work. In reading order:
 *    engineering — every engineering node;
 *    includer — for a target inside a capability, the path above the graft: each node that
 *      includes the capability, with its own ancestors, root first (and on up through any
 *      capability that includer itself lives in);
 *    ancestor / target — each target's ancestor nodes, root first, then the target node; each
 *      ancestor (and a self.yaml target) WHOLE — with the direct leaf files of its directory;
 *    descendant — with `subtree`, every node nested beneath a target, and every node of each
 *      capability grafted beneath it (by the target or a descendant), transitively.
 *  A capability included by an ancestor is that ancestor's child: it is not in the scope of the
 *  ancestor's other descendants. A node appears once, under its strongest role (target > ancestor >
 *  includer > descendant > engineering). An unresolvable target throws. */
export function scopedRead(store, targets, { subtree = false } = {}) {
  const unknown = targets.filter((t) => !resolveNode(store, t));
  if (unknown.length) throw new Error(`no decision or ledger path matches: ${unknown.join(', ')}`);
  const nx = nodeIndex(store);
  const resolved = targets.map((t) => resolveNode(store, t));
  const PRIORITY = ['target', 'ancestor', 'includer', 'descendant', 'engineering'];
  const role = new Map();
  const claim = (n, r) => {
    const cur = role.get(n.rel);
    if (!cur || PRIORITY.indexOf(r) < PRIORITY.indexOf(cur)) role.set(n.rel, r);
  };

  // An ancestor is read WHOLE: its directory's own decision (`self.yaml`) and the direct leaf
  // files beside it — the decisions that were peers on one node before one-decision-per-file. The
  // same holds for a target that is a directory's self.yaml. Nested directories are not pulled in.
  const leavesBeside = new Map();
  for (const n of store.nodes) {
    if (path.posix.basename(n.rel) === SELF) continue;
    const dir = path.posix.dirname(n.rel);
    leavesBeside.set(dir, [...(leavesBeside.get(dir) ?? []), n]);
  }
  const chainOf = (t) => [...nx.ancestorsOf(t), t].flatMap((n) => (path.posix.basename(n.rel) === SELF
    ? [n, ...(leavesBeside.get(path.posix.dirname(n.rel)) ?? []).filter((x) => x !== t)] : [n]));
  const capabilityOf = (n) => (n.tree.startsWith('capabilities/') ? n.tree.slice('capabilities/'.length) : null);

  // The path above a graft: the includers of the capability a node lives in, each with its own
  // chain, and on up through the capability an includer lives in, until none is new.
  const includerChains = (t) => {
    const out = [], seen = new Set(), queue = [capabilityOf(t)].filter(Boolean);
    while (queue.length) {
      const cap = queue.shift();
      if (seen.has(cap)) continue;
      seen.add(cap);
      for (const inc of nx.includersOf(cap)) {
        for (const n of chainOf(inc)) if (!out.includes(n)) out.push(n);
        const next = capabilityOf(inc);
        if (next) queue.push(next);
      }
    }
    return out;
  };

  for (const n of store.nodes) if (n.tree === 'engineering') claim(n, 'engineering');
  const above = [];
  const descendants = [];
  for (const t of resolved) {
    for (const n of includerChains(t)) { claim(n, 'includer'); if (!above.includes(n)) above.push(n); }
    // the leaves beside a self.yaml target are the target read whole, so they read as the target
    const beside = path.posix.basename(t.rel) === SELF ? (leavesBeside.get(path.posix.dirname(t.rel)) ?? []) : [];
    for (const a of chainOf(t)) if (a !== t) claim(a, beside.includes(a) ? 'target' : 'ancestor');
    claim(t, 'target');
    if (subtree) {
      const nested = path.posix.basename(t.rel) === SELF
        ? store.nodes.filter((n) => n.rel.startsWith(t.rel.slice(0, -SELF.length)) && n !== t) : [];
      const grafted = nx.capabilityClosure([t, ...nested].flatMap((n) => n.includes));
      descendants.push(...nested, ...[...grafted].flatMap((c) => nx.nodesOfCapability(c)));
    }
  }
  for (const n of descendants) claim(n, 'descendant');

  // Reading order: engineering (principles first), then the path above any graft, then each
  // target's chain root-first, then the descendants — each group in path order.
  const rank = (n) => (n.ids.some(isPrinciple) ? 0 : 1);
  const chainOrder = [];
  for (const t of resolved) for (const n of chainOf(t)) if (!chainOrder.includes(n)) chainOrder.push(n);
  const groups = {
    engineering: store.nodes.filter((n) => role.get(n.rel) === 'engineering').sort((a, b) => rank(a) - rank(b)),
    includer: above.filter((n) => role.get(n.rel) === 'includer'),
    chain: chainOrder.filter((n) => ['ancestor', 'target'].includes(role.get(n.rel))),
    descendant: store.nodes.filter((n) => role.get(n.rel) === 'descendant'),
  };
  const nodes = [...groups.engineering, ...groups.includer, ...groups.chain, ...groups.descendant];
  return { nodes, role, targets: resolved };
}

/** THE REFERRER WALK (user-directed 2026-10-14) — a PLANNING instrument, never part of an
 *  implementation scope. A view's referencing decisions are its subscriber list: a change to the
 *  view's shape is planned by walking them, each declared unaffected or given a decision at its own
 *  node saying how the new shape propagates. Returns the view record and every node whose decision
 *  effectively references it (explicit `references:` or a `{slug.field}` token), in store order.
 *  An id that resolves to no view record throws. */
export function referrersOf(store, viewId) {
  const rec = store.byId.get(viewId);
  if (!isView(viewId) || rec?._tree !== 'models') throw new Error(`'${viewId}' resolves to no view record`);
  const nodes = store.nodes.filter((n) => effectiveReferences(store.byId.get(n.id)).includes(viewId));
  return { view: rec, nodes };
}

/** ONE dump line for a node — its one decision — what `dump.mjs` writes, so a test can hold the
 *  shape to account.
 *  `dubious`, `questions` and `context` are maintenance notes, left out unless `maintenance`. */
export function nodeLine(store, node, { role, maintenance = false } = {}) {
  const r = store.byId.get(node.id);
  const references = effectiveReferences(r);
  return {
    node: node.rel, id: node.id, name: node.name, decision: r?.decision,
    ...(Array.isArray(r?.rejected) && r.rejected.length ? { rejected: r.rejected } : {}),
    ...(references.length ? { references } : {}),
    ...(node.includes.length ? { includes: node.includes } : {}),
    ...(maintenance && node.dubious !== undefined ? { dubious: node.dubious } : {}),
    ...(maintenance && node.questions !== undefined ? { questions: node.questions } : {}),
    ...(maintenance && node.context !== undefined ? { context: node.context } : {}),
    tree: node.tree,
    ...(role ? { scope_role: role } : {}),
  };
}

/** A view record as a dump line: its own content, minus loader bookkeeping and (unless
 *  `maintenance`) its context. */
export function viewLine(rec, { maintenance = false } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_') || (k === 'context' && !maintenance)) continue;
    out[k] = v;
  }
  return { ...out, tree: 'models' };
}

// ---------------------------------------------------------------------------
// Repo scanning (for @DecisionRef bindings)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '.git', 'coverage']);

const CODE_EXT = new Set(['.java', '.kt', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.cs', '.swift']);
const CITED_ID = /[a-z][a-z0-9-]*:[a-z0-9]+(?:-[a-z0-9]+)*/;

/** The ids one line cites: `@DecisionRef <id>` in a comment, or an annotation
 *  `@DecisionRef("id")` / `@DecisionRef({"a", "b"})`. */
export function decisionRefIds(line) {
  const ids = [];
  for (const m of line.matchAll(/@DecisionRef(?:\s*\(([^)]*)\)|\s+([^\s,;)]+))/g)) {
    if (m[1] !== undefined) {
      for (const q of m[1].matchAll(/["']([^"']+)["']/g)) if (CITED_ID.test(q[1])) ids.push(q[1]);
    } else {
      const id = m[2].match(new RegExp(`^${CITED_ID.source}`))?.[0];
      if (id) ids.push(id);
    }
  }
  return ids;
}

/** The project's tracked code files (git ls-files), less the ledger and these tools' own
 *  checkout — or every code file under the root when the project is not a git repository. */
function codeFiles() {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      .split('\0').filter(Boolean);
  } catch {
    files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel); } else files.push(rel);
      }
    };
    walk('');
  }
  const own = path.relative(ROOT, TOOLS_DIR);
  const inOwn = own && !own.startsWith('..') ? (f) => f === own || f.startsWith(`${own}/`) : () => false;
  return files.filter((f) => CODE_EXT.has(path.extname(f)) && !f.startsWith('ledger/') && !inOwn(f));
}

/** Every decision citation in the project's code and tests, as { id -> [{file, lineNo}] }
 *  (ADROIT.md, Citing decisions). */
export function decisionRefBindings() {
  const bindings = new Map();
  for (const file of codeFiles()) {
    let content;
    try { content = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch { continue; }
    if (!content.includes('@DecisionRef')) continue;
    content.split('\n').forEach((line, i) => {
      for (const id of decisionRefIds(line)) {
        if (!bindings.has(id)) bindings.set(id, []);
        bindings.get(id).push({ file, lineNo: i + 1 });
      }
    });
  }
  return bindings;
}

/** Citations whose id resolves to no record — [{ id, sites }]. */
export const danglingCitations = (store, bindings = decisionRefBindings()) =>
  [...bindings].filter(([id]) => !store.byId.has(id)).map(([id, sites]) => ({ id, sites }));

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** The text a node is found by: its name and every decision's id, text and rejected. (Not its
 *  path: a path names every ancestor, so a search would match whole subtrees.) */
const nodeHaystack = (store, n) => [n.name,
  ...n.ids.flatMap((id) => { const r = store.byId.get(id); return [id, r?.decision ?? '', ...(r?.rejected ?? [])]; }),
].join(' \u0001 ').toLowerCase();

/** Nodes matching every word of `q` somewhere in their text — "cast graphic" finds a node whose
 *  words are apart. */
export function search(store, { q = '' } = {}) {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return store.nodes.filter((n) => {
    const hay = nodeHaystack(store, n);
    return terms.every((t) => hay.includes(t));
  });
}

// ---------------------------------------------------------------------------
// Semantic diff — operations on decisions and nodes, not text hunks
// ---------------------------------------------------------------------------

const firstLine = (text = '') => truncate(String(text).split(/(?<=\.)\s/)[0] ?? String(text), 120);
const missing = (a, b) => [...a].filter((x) => !b.has(x)); // in a, not in b

/** Show a text change compactly: trim what both versions share and quote only what moved. */
export function compactTextChange(before = '', after = '') {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start
    && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const ws = (c) => c === undefined || /\s/.test(c);
  while (start > 0 && !ws(before[start - 1])) start--;
  while (end > 0 && !ws(before[before.length - end - 1])) end--;
  const oldMid = before.slice(start, before.length - end).trim();
  const newMid = after.slice(start, after.length - end).trim();
  if (!oldMid && !newMid) return null;
  if (start + end < 12) return `"${truncate(before, 90)}" → "${truncate(after, 90)}"`;
  const lead = start ? '…' : '';
  const tail = end ? '…' : '';
  if (!oldMid) return `${lead}inserted "${truncate(newMid, 90)}"${tail}`;
  if (!newMid) return `${lead}removed "${truncate(oldMid, 90)}"${tail}`;
  return `${lead}"${truncate(oldMid, 90)}" → "${truncate(newMid, 90)}"${tail}`;
}

/** A node's matching key across two stores (paths move when names change): its decision's id (the
 *  first listed, for a previous-format file of several). */
const nodeKey = (n) => n.ids[0] ?? n.rel;
const parentKey = (store, n) => (n.parent ? nodeKey(store.nodeByRel.get(n.parent)) : null);

/** Compare two stores. Decisions are matched by id, nodes by their matching key. Every
 *  structural change (parent, includes) with no change to what any of the node's decisions
 *  say is flagged as a SILENT RE-WIRING — what review must see first. */
export function diffStores(base, head, { ref = '' } = {}) {
  const added = [], deleted = [], changed = [], nodes = [];
  const brief = (r) => ({ id: r.id, decision: firstLine(r.decision), tree: r._tree ?? null });
  for (const r of head.records) if (!base.byId.has(r.id)) added.push(brief(r));
  for (const r of base.records) if (!head.byId.has(r.id)) deleted.push(brief(r));

  const textMoved = new Set();
  for (const after of head.records) {
    const before = base.byId.get(after.id);
    if (!before) continue;
    const ops = [];
    if (before.decision !== after.decision) {
      ops.push({ kind: 'decision-text', line: `decision text changed: ${compactTextChange(before.decision, after.decision)}` });
    }
    const rb = before.rejected ?? [], ra = after.rejected ?? [];
    const rAdded = ra.filter((x) => !rb.includes(x)), rRemoved = rb.filter((x) => !ra.includes(x));
    if (rAdded.length) ops.push({ kind: 'rejected-grown', line: `rejected grew ${rb.length}→${ra.length}: + ${rAdded.map((x) => truncate(x, 70)).join(' | ')}` });
    if (rRemoved.length) ops.push({ kind: 'rejected-shrunk', line: `rejected shrank ${rb.length}→${ra.length}: − ${rRemoved.map((x) => truncate(x, 70)).join(' | ')}` });
    if (ops.length) textMoved.add(after._node ? nodeKey(head.nodeByRel.get(after._node)) : after.id);
    const nb = before._node && base.nodeByRel.get(before._node), na = after._node && head.nodeByRel.get(after._node);
    if (nb && na && nodeKey(nb) !== nodeKey(na)) ops.push({ kind: 'regrouped', line: `moved from node ${nodeKey(nb)} to node ${nodeKey(na)}` });
    if (!after._node && JSON.stringify(before.schema ?? null) !== JSON.stringify(after.schema ?? null)) {
      ops.push({ kind: 'schema', line: before.schema === undefined ? 'schema typed' : 'schema edited' });
    }
    if (after._node && JSON.stringify(before.references ?? []) !== JSON.stringify(after.references ?? [])) {
      ops.push({ kind: 'references', line: `references [${(before.references ?? []).join(', ')}] → [${(after.references ?? []).join(', ')}]` });
    }
    if (ops.length) changed.push({ id: after.id, tree: after._tree ?? null, ops });
  }

  const baseNodes = new Map(base.nodes.map((n) => [nodeKey(n), n]));
  for (const after of head.nodes) {
    const before = baseNodes.get(nodeKey(after));
    if (!before) continue;
    const ops = [];
    let structural = false;
    if (before.name !== after.name) ops.push({ kind: 'name', line: `name: ${JSON.stringify(before.name ?? null)} → ${JSON.stringify(after.name ?? null)}` });
    if (before.rel !== after.rel) ops.push({ kind: 'path', line: `file: ${before.rel} → ${after.rel}` });
    const pb = parentKey(base, before), pa = parentKey(head, after);
    if (pb !== pa) { structural = true; ops.push({ kind: 're-parented', line: `re-parented: ${pb ?? '(tree root)'} → ${pa ?? '(tree root)'}` }); }
    for (const field of ['includes']) {
      const b = new Set(before[field]), a = new Set(after[field]);
      const gained = missing(a, b), lost = missing(b, a);
      if (gained.length) { structural = true; ops.push({ kind: `${field}-gained`, line: `${field} gained ${gained.join(', ')}` }); }
      if (lost.length) { structural = true; ops.push({ kind: `${field}-lost`, line: `${field} lost ${lost.join(', ')}` }); }
    }
    if (before.dubious !== after.dubious) ops.push({ kind: 'dubious', line: after.dubious === undefined ? 'dubious cleared' : `dubious: ${truncate(String(after.dubious), 90)}` });
    if (JSON.stringify(before.questions ?? null) !== JSON.stringify(after.questions ?? null)) ops.push({ kind: 'questions', line: 'questions edited' });
    if (JSON.stringify(before.context ?? null) !== JSON.stringify(after.context ?? null)) ops.push({ kind: 'context', line: 'context edited' });
    if (ops.length) {
      nodes.push({ key: nodeKey(after), rel: after.rel, ops, silentRewire: structural && !textMoved.has(nodeKey(after)) });
    }
  }
  const treeNames = (s) => new Set(s.trees.map((t) => t.tree));
  const tb = treeNames(base), ta = treeNames(head);
  return {
    ref, added, deleted, changed, nodes,
    treesAdded: missing(ta, tb), treesRemoved: missing(tb, ta),
    summary: {
      decisionsTouched: added.length + deleted.length + changed.length,
      nodesTouched: nodes.length,
      silentRewires: nodes.filter((n) => n.silentRewire).map((n) => n.key),
    },
  };
}

/** True when the working tree differs from the ref at all. */
export const hasDiff = (d) => d.summary.decisionsTouched > 0 || d.summary.nodesTouched > 0
  || d.treesAdded.length > 0 || d.treesRemoved.length > 0;

// ---------------------------------------------------------------------------
// The explorer's views — the hierarchy, the capability explorer, and the ERD
// ---------------------------------------------------------------------------

/** The shell is `ui.html`; the views' own script and stylesheet live beside it in `ui/`. */
export const UI_DIR = path.join(import.meta.dirname, 'ui');
export const UI_MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** Resolve a `/ui/...` request to a file, or to null: the resolved path must be INSIDE `ui/`
 *  however the request spelled its `..`, and of a type this server serves. */
export function resolveUiAsset(urlPath, { dir = UI_DIR } = {}) {
  if (!urlPath.startsWith('/ui/')) return null;
  let rest;
  try {
    rest = decodeURIComponent(urlPath.slice('/ui/'.length));
  } catch {
    return null;
  }
  const file = path.resolve(dir, rest);
  if (file !== dir && !file.startsWith(dir + path.sep)) return null;
  if (!UI_MIME[path.extname(file)]) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return { file, type: UI_MIME[path.extname(file)] };
}

/** Reading order for the roots in the explorer. */
export const ROOT_ORDER = ['product', 'capabilities', 'engineering', 'models'];

/** The opening words of a node's decisions — what a row shows beside the name (display only). */
export const gistOf = (store, n) => firstLine(store.byId.get(n.ids[0])?.decision ?? '');

/** THE TREE, as the filesystem has it: the roots, one group per capability and per app, every node
 *  nested under its parent node. Views sit flat under the models root. */
export function treeIndex(store) {
  const rows = new Map(store.nodes.map((n) => [n.rel, {
    kind: 'node', key: n.rel, name: n.name ?? n.rel, tree: n.tree, id: n.id,
    gist: gistOf(store, n), includes: n.includes,
    dubious: n.dubious !== undefined, questions: Array.isArray(n.questions) ? n.questions.length : 0,
    children: [], count: 1,
  }]));
  const tops = [];
  for (const n of store.nodes) (n.parent && rows.get(n.parent) ? rows.get(n.parent).children : tops).push(rows.get(n.rel));
  for (const m of store.records.filter((r) => r._tree === 'models')) {
    tops.push({ kind: 'view', key: m.id, name: m.id, tree: 'models', id: m.id, gist: firstLine(m.decision ?? ''),
      includes: [], dubious: false, questions: 0, children: [], count: 1 });
  }
  const settle = (r) => {
    r.children.sort((a, b) => a.name.localeCompare(b.name));
    r.count = 1 + r.children.reduce((s, c) => s + settle(c), 0);
    return r.count;
  };
  tops.forEach(settle);
  const byTree = new Map();
  for (const r of tops) byTree.set(r.tree, [...(byTree.get(r.tree) ?? []), r]);
  const group = (tree, label) => {
    const children = (byTree.get(tree) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const t = store.treeByName.get(tree);
    return { kind: 'group', key: tree, label, tree, accent: t?.accent ?? null, purpose: t?.purpose ?? null,
      children, count: children.reduce((s, c) => s + c.count, 0) };
  };
  const roots = [];
  for (const root of ROOT_ORDER) {
    if (root === 'capabilities' || root === 'product') {
      const children = store.trees.filter((t) => t.tree.startsWith(`${root}/`)).map((t) => group(t.tree, t.name));
      if (children.length) roots.push({ kind: 'root', key: root, label: root, children, count: children.reduce((s, c) => s + c.count, 0) });
    } else {
      const g = group(root, root);
      if (g.children.length) roots.push({ ...g, kind: 'root' });
    }
  }
  return { roots, capabilities: [...store.capabilities].sort(), nodes: store.nodes.length };
}

/** One node, whole — every field, for the explorer's detail panel (a maintenance surface, so the
 *  notes the dump leaves out are all here). `key` is a node path or a decision/view id. */
export function nodeDetail(store, key) {
  const n = store.nodeByRel.get(key) ?? resolveNode(store, key);
  const ix = interactionIndex(store);
  if (!n) {
    const m = store.byId.get(key);
    if (!m) return null;
    return { view: true, key: m.id, id: m.id, name: m.id, tree: 'models', file: m._file,
      decision: m.decision, rejected: Array.isArray(m.rejected) ? m.rejected : [],
      interactions: ix.byDecision.get(m.id) ?? [],
      fields: schemaFieldsOf(m).map((f) => `${f.name}: ${f.type}`),
      context: m.context, includes: [], ancestors: [], children: [] };
  }
  const nx = nodeIndex(store);
  const r = store.byId.get(n.id);
  return {
    key: n.rel, id: n.id, name: n.name, tree: n.tree, file: n.file,
    decision: r?.decision, rejected: r?.rejected ?? [], references: effectiveReferences(r),
    interactions: ix.byDecision.get(n.id) ?? [],
    includes: n.includes, dubious: n.dubious, questions: n.questions, context: n.context,
    grafted: [...nx.capabilityClosure(n.includes)].sort(),
    ancestors: nx.ancestorsOf(n).map((a) => ({ key: a.rel, name: a.name })),
    children: store.nodes.filter((c) => c.parent === n.rel).map((c) => ({ key: c.rel, name: c.name })),
  };
}

/** THE CAPABILITY EXPLORER's data: per capability, its root node (the decision an includer takes
 *  on), the size of its tree, the nodes
 *  outside it that INCLUDE it (grouped by tree), and its library dependencies both ways. */
export function capabilityIndex(store) {
  const deps = capabilityDependencies(store);
  const usedBy = new Map();
  for (const [from, m] of deps) for (const [to, why] of m) usedBy.set(to, [...(usedBy.get(to) ?? []), { name: from, why }]);
  return [...store.capabilities].sort().map((name) => {
    const tree = `capabilities/${name}`;
    const own = store.nodes.filter((n) => n.tree === tree);
    const includers = store.nodes.filter((n) => n.tree !== tree && n.includes.includes(name))
      .map((n) => ({ key: n.rel, name: n.name, tree: n.tree, gist: gistOf(store, n) }));
    const grouped = new Map();
    for (const c of includers) grouped.set(c.tree, [...(grouped.get(c.tree) ?? []), c]);
    const root = store.nodeByRel.get(capabilityRootRel(name));
    return {
      name, tree,
      root: root ? { key: root.rel, id: root.id, name: root.name, decision: store.byId.get(root.id)?.decision } : null,
      nodes: own.length,
      includerCount: includers.length,
      includersByTree: [...grouped].map(([t, rows]) => ({ tree: t, cloud: cloudOfTree(t), nodes: rows }))
        .sort((a, b) => b.nodes.length - a.nodes.length || a.tree.localeCompare(b.tree)),
      uses: [...(deps.get(name) ?? new Map())].map(([to, why]) => ({ name: to, why })).sort((a, b) => a.name.localeCompare(b.name)),
      usedBy: (usedBy.get(name) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

/** THE ERD — a catalog of the views: one entity per view with its typed fields, and the edges
 *  between views — each `ref<view:…>` a field carries (`ref`, labelled with the field) and each view
 *  a view `consumes`. Storage is not drawn: it lives in the code, in its migrations and models. */
export function erdData(store) {
  const vx = viewIndex(store);
  const entities = vx.views.map((rec) => {
    const fields = schemaFieldsOf(rec);
    return {
      id: rec.id, kind: 'view', name: rec.id.slice(rec.id.indexOf(':') + 1),
      statement: firstLine(rec.decision ?? ''),
      fields: fields.map(({ name, type }) => ({ name, type })),
      derivations: declaredDerivations(rec),
      consumers: vx.realizersOf(rec.id),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const known = new Set(entities.map((e) => e.id));
  const edges = [], seen = new Set();
  const add = (source, target, type, field) => {
    const key = `${source} ${target} ${type} ${field ?? ''}`;
    if (!known.has(target) || seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, type, ...(field ? { field } : {}) });
  };
  for (const rec of vx.views) {
    for (const f of schemaFieldsOf(rec)) for (const t of f.refs) add(rec.id, t, 'ref', f.name);
    for (const [type, target] of viewLinks(rec)) add(rec.id, target, type);
  }
  return { entities, edges };
}
