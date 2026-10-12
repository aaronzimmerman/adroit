// adroit — the ledger's ONE loader, validator and index builder (ADROIT.md, The node).
//
// The canonical store is `ledger/` at the repo root. Four roots:
//
//   engineering/           read in full by every piece of work
//   capabilities/<name>/   self-contained trees, each rooted at a `self.yaml` stating what an includer takes on
//   models/                the data at rest, plus the flat read contracts (views) beside it
//   product/<app>/         one tree per app, its root node at `self.yaml`
//
// THE NODE FORMAT (user-ruled 2026-10-11). Every decision file under engineering/, capabilities/ and
// product/ is a NODE: a friendly `name` plus a list of one-clause `decisions` (each `id`,
// `decision`, optional `rejected`, optional `severable`), optionally `includes` (capabilities whose
// whole tree joins the scope of the node and every descendant), `severed` (severable decision ids
// this node and its descendants are released from), and the maintenance notes `dubious`,
// `questions` and `context`. Directory nesting is parentage: a directory's own node is its
// `self.yaml`, and every decision of a node binds everything nested beneath it and nothing else.
// The file name is derived from the name and carries no meaning; ids live only inside the file.
//
// `models/` keeps its own format (one record per file, `shape:` blocks whose field citations name
// decision ids). A capability is nothing but its subtree: its root node's first decision states what
// an includer takes on, and its nodes' `includes` are its dependencies. The capability contract file
// is retired (user-ruled 2026-10-12) — one anywhere in the store fails the check.
//
// The interaction events (ADROIT.md, The interactions log) are NOT in the store: they are usage
// telemetry, appended to a machine-local log outside any repository
// (`~/.adroit/<corpus>/interactions.jsonl`), validated line by line on read.
//
// The loader still READS the previous tree format (one host record per file + `peers:`), because
// `--diff` compares the working tree against git refs that predate the node format. A file in that
// shape is adapted into a node on load (legacyNode) and FAILS the check in the working tree — the
// retired keys are errors there.
//
// Deliberately: no index, no SQLite, no cache. Several hundred small files parse in milliseconds,
// so every structure here is rebuilt per request (derive-dont-materialize).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from './yaml.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..');
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
export const NODE_KEYS = ['name', 'decisions', 'includes', 'severed', 'dubious', 'questions', 'context'];
/** A decision entry's keys, in order. */
export const DECISION_KEYS = ['id', 'decision', 'rejected', 'severable'];
/** Keys of retired formats, each with what replaced it — a hard error, never ignored. */
export const RETIRED_NODE_KEYS = {
  id: 'ids live in decisions[].id',
  decision: 'decision text lives in decisions[].decision',
  rejected: 'rejected lives on its decision entry',
  severable: 'severable lives on its decision entry',
  peers: 'every decision of a node is an entry of decisions:',
  links: 'links are retired — parentage is the directory, a capability is brought in by includes:',
  mounts: 'renamed includes:',
  severs: 'renamed severed:',
  commitments: 'a rule binding the subtree is a decision of the node, marked severable: true when a descendant may sever it',
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
export const RESERVED_KINDS = ['principle', 'story', 'model', 'view'];
export const DOMAINS_FILE = 'domains.yaml';
/** The one key of `domains.yaml` that is not a domain: the corpus's stable name, which keys its
 *  machine-local interaction log. */
export const CORPUS_KEY = 'corpus';

/** The id rule (ADROIT.md, Ids and the registry): `<namespace>:<slug>`, the slug a few kebab-case words
 *  naming the decision's substance. */
export const ID_SHAPE = /^[a-z][a-z0-9-]*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const namespaceOf = (id) => (typeof id === 'string' && id.includes(':') ? id.slice(0, id.indexOf(':')) : null);
export const kindOf = (id) => (RESERVED_KINDS.includes(namespaceOf(id)) ? namespaceOf(id) : 'decision');
export const isPrinciple = (id) => namespaceOf(id) === 'principle';
export const isModel = (id) => kindOf(id) === 'model' || kindOf(id) === 'view';

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
const ACRONYMS = new Map(['ai', 'api', 'cors', 'csrf', 'csv', 'cta', 'db', 'hq', 'http', 'id', 'ip',
  'llm', 'mcp', 'og', 'qr', 'sql', 'ui', 'url', 'utc', 'json', 'html', 'ssi', 'sms', 'pdf', 'dto']
  .map((w) => [w, w.toUpperCase()]).concat([['apis', 'APIs'], ['ids', 'IDs'], ['urls', 'URLs']]));

/** A draft name from a decision id: `story:guest-checkout` → "Guest checkout". */
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

/** Is this parsed file in the previous format (a host record with optional `peers:`)? */
export const isLegacyNode = (raw) => isMap(raw) && raw.decisions === undefined && typeof raw.id === 'string';

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
 *  (host first, peers in file order), `mounts` → `includes`, `severs` → `severed`, contexts merge,
 *  the name is drafted from the host id. `links` carry nothing forward. */
export function legacyNode(raw) {
  const entry = (id, d) => {
    const out = { id, decision: d?.decision };
    if (Array.isArray(d?.rejected) && d.rejected.length) out.rejected = d.rejected;
    if (d?.severable === true) out.severable = true;
    return out;
  };
  const peers = isMap(raw.peers) ? Object.entries(raw.peers).filter(([, p]) => isMap(p)) : [];
  const node = {
    name: draftName(raw.id),
    decisions: [entry(raw.id, raw), ...peers.map(([pid, p]) => entry(pid, p))],
  };
  if (isStrArray(raw.mounts) && raw.mounts.length) node.includes = raw.mounts;
  if (isStrArray(raw.severs) && raw.severs.length) node.severed = raw.severs;
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
  models: 'The data at rest, and the flat read contracts (views) derived over it.',
};

/** A capability's root node's path — the node whose first decision states what an includer takes on. */
const capabilityRootRel = (cap) => `capabilities/${cap}/${SELF}`;

/** The trees, derived from the paths nodes and models live at. */
function synthesizeTrees(nodes, models) {
  const names = new Set([...nodes.map((n) => n.tree), ...models.map((m) => m._tree)]);
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
      purpose: cap ? (nodes.find((n) => n.rel === capabilityRootRel(cap))?.raw?.decisions?.[0]?.decision ?? null)
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
 *    nodes       every node, in path order: { rel, file, tree, parent, name, ids, includes,
 *                severed, dubious, questions, context, raw, legacy }
 *    nodeByRel   rel → node
 *    records     one per decision ({ id, decision, rejected?, severable?, _file, _rel, _tree,
 *                _node, _nestedUnder }) plus one per model/view (its file, as written)
 *    byId        id → record
 *    retiredFiles  ledger-relative paths of retired files (a capability contract), which fail the check */
export function buildStore(entries) {
  const files = [], models = [], retiredFiles = [];
  let domains = new Map(), domainsRaw;
  const parse = (entry) => {
    try {
      return parseYaml(entry.content);
    } catch (e) {
      throw new Error(`${entry.path}: ${e.message}`);
    }
  };
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    if (entry.kind === 'node') files.push({ entry, raw: parse(entry) });
    else if (entry.kind === 'model') {
      const raw = parse(entry);
      models.push({ ...(isMap(raw) ? raw : {}), _file: entry.path, _rel: entry.rel, _tree: 'models' });
    } else if (entry.kind === 'retired') {
      retiredFiles.push(entry.rel);
    } else if (entry.kind === 'domains') {
      domainsRaw = parse(entry);
      if (isMap(domainsRaw)) domains = new Map(Object.entries(domainsRaw).filter(([k]) => k !== CORPUS_KEY));
    }
  }

  const rels = new Set(files.map((f) => f.entry.rel));
  const nodes = [], records = [];
  for (const { entry, raw } of files) {
    const legacy = isLegacyNode(raw);
    const body = legacy ? legacyNode(raw) : (isMap(raw) ? raw : {});
    const node = {
      rel: entry.rel, file: entry.path, tree: treeOfPath(entry.rel),
      parent: parentRelOf(entry.rel, (r) => rels.has(r)),
      name: body.name,
      ids: [],
      includes: isStrArray(body.includes) ? body.includes : [],
      severed: isStrArray(body.severed) ? body.severed : [],
      dubious: body.dubious, questions: body.questions, context: body.context,
      raw, legacy,
    };
    for (const d of Array.isArray(body.decisions) ? body.decisions : []) {
      if (!isMap(d) || typeof d.id !== 'string') continue;   // validate reports the shape
      node.ids.push(d.id);
      records.push({
        id: d.id, decision: d.decision,
        ...(d.rejected !== undefined ? { rejected: d.rejected } : {}),
        ...(d.severable !== undefined ? { severable: d.severable } : {}),
        _file: entry.path, _rel: `${entry.rel}#${d.id}`, _tree: node.tree, _node: node.rel,
        ...(node.parent ? { _nestedUnder: node.parent } : {}),
      });
    }
    nodes.push(node);
  }
  // Parents before children, a directory's own node before its contents.
  const order = (rel) => rel.replace(/(^|\/)self\.yaml$/, '/');
  nodes.sort((a, b) => order(a.rel).localeCompare(order(b.rel)));
  records.push(...models);

  const trees = synthesizeTrees(nodes, models);
  return {
    // The interaction events are not part of the store (ADROIT.md, The interactions log); loadLedger
    // attaches the machine-local log's valid events here, so every consumer reads one array.
    nodes, nodeByRel: new Map(nodes.map((n) => [n.rel, n])),
    records, byId: new Map(records.map((r) => [r.id, r])),
    trees, treeByName: new Map(trees.map((t) => [t.tree, t])),
    capabilities: new Set(trees.filter((t) => t.kind === 'capability').map((t) => t.name)),
    retiredFiles, domains, domainsRaw, interactions: [],
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
  if (parts[0] === 'models') return parts.length === 2 ? 'model' : null;
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
// The model layer
// ---------------------------------------------------------------------------

/** ADROIT.md, Models — the ids a shape field cites in parens are LINKS: each field
 *  points at the decisions it realizes. `edges` resolve, `dangling` do not (a check error), and
 *  `unlinked` are deployed fields citing nothing — the probable-orphan signal, a report only.
 *  Pending entries are scanned for dangling citations only. */
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
    if (!isMap(rec.shape)) continue;
    for (const [section, orphanable] of [['fields', true], ['pending', false]]) {
      const entries = rec.shape[section];
      if (!isMap(entries)) continue;
      for (const [field, raw] of Object.entries(entries)) {
        if (typeof raw !== 'string') continue;
        const cited = citesOf(raw);
        for (const ruling of cited) (byId.has(ruling) ? edges : dangling).push({ model: rec.id, field, ruling, section });
        if (orphanable && !cited.size) unlinked.push({ model: rec.id, field });
      }
    }
  }
  return { edges, unlinked, dangling };
}

/** The model layer's wiring: the models and views, and which decision trees each REALIZES — read
 *  off its field citations (model → decision; no decision points at a model). */
export function modelIndex({ records = [], byId = new Map() } = {}) {
  const models = records.filter((r) => isModel(r.id) && r._tree === 'models');
  const refs = [], seen = new Set();
  for (const e of shapeIndex({ records: models, byId }).edges) {
    const from = byId.get(e.ruling)?._tree;
    if (!from || from === 'models') continue;
    const key = `${from} ${e.model} ${e.ruling}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ from, model: e.model, via: e.ruling });
  }
  const realizersOf = (id) => [...new Set(refs.filter((r) => r.model === id).map((r) => r.from))].sort();
  return { models, refs, realizersOf };
}

/** A model's own links to other models (the models directory keeps its own format), as
 *  [type, target]. Only the ERD reads these. */
export const modelEdges = (rec) => [
  ...[].concat(rec.links?.grounds ?? []).map((t) => ['grounds', t]),
  ...[].concat(rec.links?.consumes ?? []).map((t) => ['consumes', t]),
].filter(([, t]) => typeof t === 'string');

/** The tables a model stands for — read from its own `tables:`, else `context.tables`. A view
 *  maps to no tables by construction. */
export const tablesOf = (rec) =>
  [].concat(rec?.tables ?? rec?.context?.tables ?? [])
    .filter((t) => typeof t === 'string' && t.trim());

/** The derivations a view DECLARES: its shape fields of kind `derived`; for a record with no shape
 *  block, the capitalised names introduced with an em dash in its statement. */
export const declaredDerivations = (rec) => {
  const fields = rec?.shape?.fields;
  if (isMap(fields)) {
    return Object.entries(fields).filter(([, v]) => typeof v === 'string' && /^derived\b/.test(v)).map(([k]) => k);
  }
  return [...new Set([...(rec?.decision ?? '').matchAll(/\b([A-Z][A-Z-]{2,})\s+—/g)].map((m) => m[1]))];
};

// ---------------------------------------------------------------------------
// Nodes: ancestry, includes and severs
// ---------------------------------------------------------------------------

/** NODES, INCLUDES AND SEVERS (user-ruled 2026-10-11). Every decision of a node binds everything
 *  nested beneath the node and nothing else. `includes: [x]` brings the whole `capabilities/x`
 *  tree into the scope of the node and every descendant — and whatever that tree's own nodes
 *  include, transitively. `severed: [id]` releases the node and its descendants from a decision
 *  marked `severable: true`, which must be a decision of an ancestor node or of a node inside a
 *  capability in this node's scope. Helpers:
 *    ancestorsOf(node)          ancestor nodes, root first
 *    severedFor(node)           ids severed by the node or any ancestor
 *    includedFor(node)          capability names the node or an ancestor includes
 *    capabilityClosure(names)   those names plus everything their trees include, transitively
 *    nodesOfCapability(name)    the capability's nodes, in path order */
export function nodeIndex(store) {
  const { nodes = [], nodeByRel = new Map(), byId = new Map() } = store;
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
  const lineage = (n) => [...ancestorsOf(n), nodeOf(n)].filter(Boolean);
  const severedFor = (n) => new Set(lineage(n).flatMap((x) => x.severed));
  const includedFor = (n) => new Set(lineage(n).flatMap((x) => x.includes));
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

  const problems = [];
  for (const n of nodes) {
    if (!n.severed.length) continue;
    const ancestral = new Set(ancestorsOf(n).flatMap((a) => a.ids));
    const included = new Set([...capabilityClosure(includedFor(n))].flatMap((c) => nodesOfCapability(c).flatMap((x) => x.ids)));
    for (const id of n.severed) {
      const target = byId.get(id);
      const say = (message) => problems.push({ id: n.rel, rule: 'severed', message: `severs '${id}', ${message}` });
      if (!target || !target._node) say('which names no decision');
      else if (!ancestral.has(id) && !included.has(id)) {
        say('which is neither a decision of an ancestor node nor of a capability this node includes — a decision binds only its own subtree');
      } else if (target.severable !== true) say('which is not marked severable — it binds every descendant');
    }
  }
  return { nodeOf, ancestorsOf, severedFor, includedFor, capabilityClosure, nodesOfCapability, problems };
}

// ---------------------------------------------------------------------------
// Text rules
// ---------------------------------------------------------------------------

/** Every model: or view: id a node names in its decisions (text and rejected) or its context. A
 *  decision never points at the models directory (ADROIT.md, Models): the model cites the
 *  decision. `dubious` and `questions` are maintenance notes and never a check fault. */
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
 *  `decision` field names no record id. `rejected` and `context` are history and may keep theirs.
 *  A token counts only when it RESOLVES to a live id. model:/view: ids are left to modelIdsInText.
 *  Flip the constant to make the findings warnings instead of errors. */
export const IDS_IN_DECISION_TEXT_FAIL = true;

const TEXT_ID_TOKEN = /(?<![A-Za-z0-9_:-])[a-z][a-z0-9-]*:[a-z0-9]+(?:-[a-z0-9]+)*/g;

/** Every record id named in a decision's text — [{ where, token }]. Models are out of scope. */
export function idsInDecisionText(rec, byId = new Map()) {
  if (!rec?._node || typeof rec.decision !== 'string') return [];
  const out = [], seen = new Set();
  for (const m of rec.decision.matchAll(TEXT_ID_TOKEN)) {
    const token = m[0];
    if (seen.has(token) || !byId.has(token) || isModel(token)) continue;
    seen.add(token);
    out.push({ where: 'decision', token });
  }
  return out;
}

/** The store-wide findings — the ONE walk validate, warn and the --check summary read. */
export function idsInDecisionTextFindings({ records = [], byId = new Map() } = {}) {
  return records.flatMap((rec) => idsInDecisionText(rec, byId).map((f) => ({ id: rec.id, ...f })));
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
    domainsRaw, strayRoots = [], retiredFiles = [], capabilities = new Set() } = store;
  const errors = [];
  const bad = (id, rule, message) => errors.push({ id, rule, message });

  for (const name of strayRoots) {
    bad(`${name}/`, 'root', `is not a ledger root — records live under ${TREE_ROOTS.join(', ')}` +
      (name === RETIRED_INTERACTIONS_DIR
        ? `; interaction events are machine-local telemetry, appended to ${interactionLogPath('<corpus>')} (ADROIT.md, The interactions log)`
        : ''));
  }

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
    if (!oneLine(raw.name)) bad(at, 'shape', 'name must be a non-empty, one-line string');
    if (!Array.isArray(raw.decisions) || !raw.decisions.length) {
      bad(at, 'shape', 'decisions must be a non-empty list');
    } else {
      raw.decisions.forEach((d, i) => {
        const where = typeof d?.id === 'string' ? d.id : `${at} decisions[${i}]`;
        if (!isMap(d)) { bad(where, 'shape', 'a decision entry must be a mapping'); return; }
        const extra = Object.keys(d).filter((k) => !DECISION_KEYS.includes(k));
        if (extra.length) bad(where, 'unknown-key', `carries [${extra.join(', ')}] — a decision holds only ${DECISION_KEYS.join(', ')}`);
        if (typeof d.id !== 'string' || !d.id) bad(where, 'shape', 'id must be a non-empty string');
        if (typeof d.decision !== 'string' || !d.decision.trim()) bad(where, 'shape', 'decision must be a non-empty string');
        if (d.rejected !== undefined && !isStrArray(d.rejected)) bad(where, 'shape', 'rejected must be a list of strings');
        if (d.severable !== undefined && typeof d.severable !== 'boolean') bad(where, 'shape', 'severable must be true or false');
      });
    }
    if (raw.includes !== undefined) {
      if (!isStrArray(raw.includes)) bad(at, 'includes', 'includes must be a list of capability names');
      else {
        if (new Set(raw.includes).size !== raw.includes.length) bad(at, 'includes', 'includes names a capability twice');
        for (const c of raw.includes) if (!capabilities.has(c)) bad(at, 'includes', `includes '${c}', which is no capability`);
        for (const c of raw.includes) if (n.tree === `capabilities/${c}`) bad(at, 'includes', `includes '${c}', the capability it lives in`);
      }
    }
    if (raw.severed !== undefined && !isStrArray(raw.severed)) bad(at, 'severed', 'severed must be a list of decision ids');
    if (raw.dubious !== undefined && !oneLine(raw.dubious)) bad(at, 'dubious', 'dubious must be one non-empty line saying why');
    if (raw.questions !== undefined && !(Array.isArray(raw.questions) && raw.questions.length && raw.questions.every(oneLine))) {
      bad(at, 'questions', 'questions must be a list of non-empty, one-line strings');
    }
  }
  for (const p of nodeIndex(store).problems) bad(p.id, p.rule, p.message);

  // --- ids ------------------------------------------------------------------------
  const seenIds = new Map();
  for (const rec of records) {
    const at = rec._rel ?? rec._file ?? '(in memory)';
    if (typeof rec.id !== 'string' || !rec.id) { bad(at, 'shape', 'id must be a non-empty string'); continue; }
    if (seenIds.has(rec.id)) bad(rec.id, 'duplicate-id', `also written in ${seenIds.get(rec.id)} (this one: ${at})`);
    else seenIds.set(rec.id, at);
    if (!ID_SHAPE.test(rec.id)) bad(rec.id, 'id-shape', `must be <namespace>:<kebab-case-slug> naming the decision's substance`);
    const ns = namespaceOf(rec.id);
    if (ns && !RESERVED_KINDS.includes(ns) && !namespaces.has(ns)) {
      bad(rec.id, 'namespace', `namespace '${ns}:' is neither a capability tree, a reserved kind ` +
        `(${RESERVED_KINDS.join(', ')}), nor a domain declared in ${DOMAINS_FILE} — declare it before using it`);
    }
    if (ns && capabilities.has(ns) && rec._tree !== `capabilities/${ns}`) {
      bad(rec.id, 'namespace', `is namespaced to the '${ns}' capability but lives in ${rec._tree}`);
    }
    if (isModel(rec.id) !== (rec._tree === 'models')) {
      bad(rec.id, 'models', isModel(rec.id) ? `a ${kindOf(rec.id)} lives in the models directory, not ${rec._tree}`
        : 'the models directory holds only model: and view: records');
    }
  }

  // --- the models directory: its own format -----------------------------------------
  for (const rec of records.filter((r) => r._tree === 'models')) {
    if (typeof rec.decision !== 'string' || !rec.decision.trim()) bad(rec.id ?? rec._rel, 'shape', 'decision must be a non-empty string');
    for (const [type, t] of modelEdges(rec)) {
      if (!byId.has(t) && !isPrinciple(t)) bad(rec.id, 'dangling', `${type} '${t}' names no record`);
    }
  }
  for (const d of shapeIndex(store).dangling) {
    bad(d.model, 'shape-citation', `${d.section}.${d.field} cites '${d.ruling}', which resolves to no record`);
  }

  // --- what decision text may say ---------------------------------------------------
  for (const n of nodes) {
    if (n.legacy || !isMap(n.raw)) continue;
    const said = Array.isArray(n.raw.decisions) ? n.raw.decisions.map((x) => [x?.decision, x?.rejected]) : [];
    for (const id of modelIdsInText([said, n.raw.context])) {
      bad(n.rel, 'model-in-decision', `names '${id}' — a decision never points at the models directory; ` +
        `state the business rule, and let the model's fields cite the decision`);
    }
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

/** WARNINGS — worth seeing, never failing the check (eng:honest-exit-codes). */
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
    severable: decisions.filter((r) => r.severable === true).length,
    severed: store.nodes.reduce((n, x) => n + x.severed.length, 0),
    includes: store.nodes.reduce((n, x) => n + x.includes.length, 0),
    dubious: store.nodes.filter((x) => x.dubious !== undefined).length,
    questions: store.nodes.reduce((n, x) => n + (Array.isArray(x.questions) ? x.questions.length : 0), 0),
  };
}

// ---------------------------------------------------------------------------
// The scoped read (user-directed 2026-10-10)
// ---------------------------------------------------------------------------

/** The scope roles, in reading order. */
export const SCOPE_ROLES = ['engineering', 'ancestor', 'target', 'capability', 'descendant'];

/** Resolve a target — a decision id, or a ledger-relative path to a node file or directory — to
 *  its node; null when nothing matches. */
export function resolveNode(store, t) {
  const rec = store.byId.get(t);
  if (rec?._node) return store.nodeByRel.get(rec._node);
  const rel = String(t).replace(/^\.?\/?/, '').replace(/^ledger\//, '').replace(/\/+$/, '');
  return store.nodeByRel.get(rel) ?? store.nodeByRel.get(`${rel}/${SELF}`) ?? null;
}

/** What an agent working on `targets` reads — decisions scope DOWNWARD, so the rest of the store
 *  does not bind the work. In reading order:
 *    engineering — every engineering node;
 *    ancestor / target — each target's ancestor nodes, root first, then the target node;
 *    capability — every node of every capability the target or an ancestor includes, plus what
 *      those nodes include, transitively;
 *    descendant — with `subtree`, every node nested beneath a target.
 *  A node appears once, under its strongest role (target > ancestor > capability > descendant >
 *  engineering). `severed` holds the ids the targets' own chains sever. An unresolvable target
 *  throws. */
export function scopedRead(store, targets, { subtree = false } = {}) {
  const unknown = targets.filter((t) => !resolveNode(store, t));
  if (unknown.length) throw new Error(`no decision or ledger path matches: ${unknown.join(', ')}`);
  const nx = nodeIndex(store);
  const resolved = targets.map((t) => resolveNode(store, t));
  const PRIORITY = ['target', 'ancestor', 'capability', 'descendant', 'engineering'];
  const role = new Map();
  const claim = (n, r) => {
    const cur = role.get(n.rel);
    if (!cur || PRIORITY.indexOf(r) < PRIORITY.indexOf(cur)) role.set(n.rel, r);
  };

  for (const n of store.nodes) if (n.tree === 'engineering') claim(n, 'engineering');
  const capabilities = new Set();
  const descendants = [];
  for (const t of resolved) {
    for (const a of nx.ancestorsOf(t)) claim(a, 'ancestor');
    claim(t, 'target');
    for (const c of nx.capabilityClosure(nx.includedFor(t))) capabilities.add(c);
    if (subtree && path.posix.basename(t.rel) === SELF) {
      const dir = t.rel.slice(0, -SELF.length);
      descendants.push(...store.nodes.filter((n) => n.rel.startsWith(dir) && n !== t));
    }
  }
  for (const c of capabilities) for (const n of nx.nodesOfCapability(c)) claim(n, 'capability');
  for (const n of descendants) claim(n, 'descendant');

  // Reading order: engineering (principles first), then each target's chain root-first, then the
  // capabilities, then the descendants — each group in path order.
  const rank = (n) => (n.ids.some(isPrinciple) ? 0 : 1);
  const chainOrder = [];
  for (const t of resolved) for (const n of [...nx.ancestorsOf(t), t]) if (!chainOrder.includes(n)) chainOrder.push(n);
  const groups = {
    engineering: store.nodes.filter((n) => role.get(n.rel) === 'engineering').sort((a, b) => rank(a) - rank(b)),
    chain: chainOrder.filter((n) => ['ancestor', 'target'].includes(role.get(n.rel))),
    capability: store.nodes.filter((n) => role.get(n.rel) === 'capability'),
    descendant: store.nodes.filter((n) => role.get(n.rel) === 'descendant'),
  };
  const nodes = [...groups.engineering, ...groups.chain, ...groups.capability, ...groups.descendant];
  const severed = new Set(resolved.flatMap((t) => [...nx.severedFor(t)]));
  return { nodes, role, severed, targets: resolved };
}

/** ONE dump line for a node — what `dump.mjs` writes, so a test can hold the shape to account.
 *  `dubious`, `questions` and `context` are maintenance notes, left out unless `maintenance`. */
export function nodeLine(store, node, { role, severed = new Set(), maintenance = false } = {}) {
  const decisions = node.ids.map((id) => {
    const r = store.byId.get(id);
    return {
      id, decision: r?.decision,
      ...(Array.isArray(r?.rejected) && r.rejected.length ? { rejected: r.rejected } : {}),
      ...(r?.severable === true ? { severable: true } : {}),
      ...(severed.has(id) ? { severed: true } : {}),
    };
  });
  return {
    node: node.rel, name: node.name, decisions,
    ...(node.includes.length ? { includes: node.includes } : {}),
    ...(node.severed.length ? { severed: node.severed } : {}),
    ...(maintenance && node.dubious !== undefined ? { dubious: node.dubious } : {}),
    ...(maintenance && node.questions !== undefined ? { questions: node.questions } : {}),
    ...(maintenance && node.context !== undefined ? { context: node.context } : {}),
    tree: node.tree,
    ...(role ? { scope_role: role } : {}),
  };
}

/** A model record as a dump line: its own content, minus loader bookkeeping and (unless
 *  `maintenance`) its context. */
export function modelLine(rec, { maintenance = false } = {}) {
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

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'dist-types', 'build', '.git', 'coverage']);
const TEXT_EXT = new Set(['.java', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.md', '.json', '.jsonl',
  '.sql', '.yml', '.yaml', '.conf', '.css', '.html', '.txt']);

/** Walk the repo's source-ish directories, yielding { file, lineNo, line } per hit. */
export function scanRepo(needle, dirs = ['app', 'tools', 'ledger', 'seed']) {
  const hits = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (!TEXT_EXT.has(path.extname(entry.name))) continue;
      const file = path.join(dir, entry.name);
      const content = fs.readFileSync(file, 'utf8');
      if (!content.includes(needle)) continue;
      content.split('\n').forEach((line, i) => {
        if (line.includes(needle)) hits.push({ file: path.relative(ROOT, file), lineNo: i + 1, line: line.trim() });
      });
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d));
  return hits;
}

/** All `@DecisionRef <id>` citations in the app's code and tests, as { id -> [{file, lineNo}] }
 *  (ADROIT.md, Citing decisions). */
export function decisionRefBindings() {
  const bindings = new Map();
  for (const hit of scanRepo('@DecisionRef', ['app'])) {
    for (const m of hit.line.matchAll(/@DecisionRef\s+([a-z][a-z0-9-]*:[a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
      const id = m[1];
      if (!bindings.has(id)) bindings.set(id, []);
      bindings.get(id).push({ file: hit.file, lineNo: hit.lineNo });
    }
  }
  return bindings;
}

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

/** A node's identity across two stores: its first decision's id (paths move when names change). */
const nodeKey = (n) => n.ids[0] ?? n.rel;
const parentKey = (store, n) => (n.parent ? nodeKey(store.nodeByRel.get(n.parent)) : null);

/** Compare two stores. Decisions are matched by id, nodes by their first decision's id. Every
 *  structural change (parent, includes, severed) with no change to what any of the node's decisions
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
    if ((before.severable === true) !== (after.severable === true)) {
      ops.push({ kind: 'severable', line: after.severable === true ? 'marked severable' : 'no longer severable' });
    }
    if (ops.length) textMoved.add(after._node ? nodeKey(head.nodeByRel.get(after._node)) : after.id);
    const nb = before._node && base.nodeByRel.get(before._node), na = after._node && head.nodeByRel.get(after._node);
    if (nb && na && nodeKey(nb) !== nodeKey(na)) ops.push({ kind: 'regrouped', line: `moved from node ${nodeKey(nb)} to node ${nodeKey(na)}` });
    if (!after._node && JSON.stringify(before.shape ?? null) !== JSON.stringify(after.shape ?? null)) {
      ops.push({ kind: 'shape', line: 'shape edited' });
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
    for (const field of ['includes', 'severed']) {
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

/** A node's first decision, opening words — what a row shows beside the name. */
export const gistOf = (store, n) => firstLine(store.byId.get(n.ids[0])?.decision ?? '');

/** THE TREE, as the filesystem has it: the roots, one group per capability and per app, every node
 *  nested under its parent node. Models sit flat under their root. */
export function treeIndex(store) {
  const rows = new Map(store.nodes.map((n) => [n.rel, {
    kind: 'node', key: n.rel, name: n.name ?? n.rel, tree: n.tree, ids: n.ids,
    gist: gistOf(store, n), includes: n.includes, severed: n.severed,
    dubious: n.dubious !== undefined, questions: Array.isArray(n.questions) ? n.questions.length : 0,
    children: [], count: 1,
  }]));
  const tops = [];
  for (const n of store.nodes) (n.parent && rows.get(n.parent) ? rows.get(n.parent).children : tops).push(rows.get(n.rel));
  for (const m of store.records.filter((r) => r._tree === 'models')) {
    tops.push({ kind: 'model', key: m.id, name: m.id, tree: 'models', ids: [m.id], gist: firstLine(m.decision ?? ''),
      includes: [], severed: [], dubious: false, questions: 0, children: [], count: 1 });
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
 *  notes the dump leaves out are all here). `key` is a node path or a decision/model id. */
export function nodeDetail(store, key) {
  const n = store.nodeByRel.get(key) ?? resolveNode(store, key);
  const ix = interactionIndex(store);
  if (!n) {
    const m = store.byId.get(key);
    if (!m) return null;
    return { model: true, key: m.id, name: m.id, tree: 'models', file: m._file,
      decisions: [{ id: m.id, decision: m.decision, interactions: ix.byDecision.get(m.id) ?? [] }],
      tables: tablesOf(m), context: m.context, includes: [], severed: [], ancestors: [], children: [] };
  }
  const nx = nodeIndex(store);
  return {
    key: n.rel, name: n.name, tree: n.tree, file: n.file,
    decisions: n.ids.map((id) => {
      const r = store.byId.get(id);
      return { id, decision: r?.decision, rejected: r?.rejected ?? [], severable: r?.severable === true,
        interactions: ix.byDecision.get(id) ?? [] };
    }),
    includes: n.includes, severed: n.severed, dubious: n.dubious, questions: n.questions, context: n.context,
    inScope: [...nx.capabilityClosure(nx.includedFor(n))].sort(),
    severedHere: [...nx.severedFor(n)].sort(),
    ancestors: nx.ancestorsOf(n).map((a) => ({ key: a.rel, name: a.name })),
    children: store.nodes.filter((c) => c.parent === n.rel).map((c) => ({ key: c.rel, name: c.name })),
  };
}

/** THE CAPABILITY EXPLORER's data: per capability, its root node (the decisions an includer takes
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
      root: root ? { key: root.rel, name: root.name,
        decisions: root.ids.map((id) => ({ id, decision: store.byId.get(id)?.decision })) } : null,
      nodes: own.length,
      decisions: own.reduce((s, n) => s + n.ids.length, 0),
      includerCount: includers.length,
      includersByTree: [...grouped].map(([t, rows]) => ({ tree: t, cloud: cloudOfTree(t), nodes: rows }))
        .sort((a, b) => b.nodes.length - a.nodes.length || a.tree.localeCompare(b.tree)),
      uses: [...(deps.get(name) ?? new Map())].map(([to, why]) => ({ name: to, why })).sort((a, b) => a.name.localeCompare(b.name)),
      usedBy: (usedBy.get(name) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

/** THE ERD: one entity per model and view, its fields taken from a database schema (when one is
 *  passed) through the record's own table mapping, and the links between models. A mapped name the
 *  schema lacks comes back marked rather than dropped. Adroit's own models describe files, not
 *  tables, so the explorer passes no schema. */
export function erdData(store, schema) {
  const mx = modelIndex(store);
  const tables = schema?.tables ?? {};
  const spelling = new Map(Object.keys(tables).map((t) => [t.toLowerCase(), t]));
  const entities = mx.models.map((rec) => {
    const kind = kindOf(rec.id);
    const mapped = tablesOf(rec).map((declared) => {
      const real = spelling.get(declared.toLowerCase());
      return { table: real ?? declared, found: Boolean(real), columns: real ? tables[real] : [] };
    });
    return {
      id: rec.id, kind, name: rec.id.slice(rec.id.indexOf(':') + 1),
      statement: firstLine(rec.decision ?? ''),
      tables: mapped,
      fields: mapped.reduce((n, t) => n + t.columns.length, 0),
      unmapped: mapped.filter((t) => !t.found).map((t) => t.table),
      derivations: kind === 'view' ? declaredDerivations(rec) : [],
      consumers: mx.realizersOf(rec.id),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const known = new Set(entities.map((e) => e.id));
  const edges = [];
  for (const rec of mx.models) for (const [type, target] of modelEdges(rec)) if (known.has(target)) edges.push({ source: rec.id, target, type });
  const tableNames = Object.keys(tables);
  const claimed = new Set(entities.flatMap((e) => e.tables.filter((t) => t.found).map((t) => t.table)));
  return {
    entities, edges,
    schema: {
      present: Boolean(schema), migrations: schema?.migrations ?? 0, highWater: schema?.highWater ?? 0,
      tables: tableNames.length, columns: tableNames.reduce((n, t) => n + tables[t].length, 0),
      unclaimed: tableNames.filter((t) => !claimed.has(t)).sort(),
    },
  };
}
