#!/usr/bin/env node
// dump — the ledger as one compact stream, for reading into an agent's context (ADROIT.md, The node).
//
//   node tools/dump.mjs           # domains, every node, every view — one per line
//   node tools/dump.mjs --pretty  # the same, indented, for a human at a terminal
//
//   node tools/dump.mjs --scope <id|path>[,<id|path>...]            # only what binds that work
//   node tools/dump.mjs --scope <id|path>[,...] --subtree           # ...plus each target's descendants
//
//   node tools/dump.mjs --referrers <view:id>[,...]   # PLANNING ONLY: each view + every decision referencing it
//
//   node tools/dump.mjs --maintenance   # ...with each node's dubious, questions and context kept
//   node tools/dump.mjs --interactions  # ...with this machine's interaction log appended (ADROIT.md, The interactions log)
//
// ONE LINE PER NODE, and a node is ONE decision: `{node, id, name, decision, rejected?,
// references?, includes?, tree, scope_role?}` — `node` is the file's ledger-relative path.
//
// THE SCOPED READ (user-directed 2026-10-10). Each decision is a how of its parent: it describes its
// own node and informs the branch beneath it (directory nesting is parentage; `self.yaml` is a
// directory's own decision, a leaf file a child decision of its directory). So for work on a given
// decision read ENGINEERING IN FULL, then the ANCESTOR nodes of the target (tree root down) and the
// TARGET node. A capability is grafted beneath the node that includes it, as if its nodes were
// nested there, so it is in no other node's scope; for a target INSIDE a capability, the path above
// the graft is read too — each INCLUDER of that capability with its own ancestors. `--subtree` adds
// the target's DESCENDANTS, the capabilities grafted beneath it among them, for work that changes
// the target itself. A target is a decision id or a ledger-relative path (a node file or directory;
// a leading `ledger/` is accepted); an unknown one exits 1. Every line carries `scope_role` —
// engineering | includer | ancestor | target | descendant — and a node appears once.
//
// The full dump reads in tree order: engineering (principles first), then the capabilities, then
// the products, then the views. stdout is pure JSONL; the tally goes to stderr so a pipe stays clean.
//
// A node's `dubious`, `questions` and `context` are LEFT OUT by default: they are maintenance notes
// — suspicion, open tensions, the author's why and provenance — and an agent that reads them beside
// a decision weighs them as law. `--maintenance` brings them back for ledger work (coherence probes,
// authoring), never for implementation. A view's `context` follows the same flag.
//
// Interaction events are LEFT OUT by default too: they are evidence the ledger did work, not law,
// and they are not in the store at all — `--interactions` reads the machine-local log beside it.
//
// THE REFERRER WALK (user-directed 2026-10-14). `--referrers view:x` prints the view record and then
// every decision that references it (explicit `references:` or a `{slug.field}` token), each line
// carrying `scope_role: "referrer"`. It is a PLANNING instrument — the blast-radius walk before a
// view's shape changes, each referrer declared unaffected or given a decision at its own node — and
// never part of an implementation scope: a build brief carries only the law already ruled.
import { loadLedger, isPrinciple, scopedRead, referrersOf, nodeLine, viewLine, SCOPE_ROLES } from './lib.mjs';

const argv = process.argv.slice(2);
const PRETTY = argv.includes('--pretty');
const WITH_INTERACTIONS = argv.includes('--interactions');
const SUBTREE = argv.includes('--subtree');
const MAINTENANCE = argv.includes('--maintenance');
const scopeAt = argv.indexOf('--scope');
const SCOPE = scopeAt === -1 ? null
  : (argv[scopeAt + 1] && !argv[scopeAt + 1].startsWith('--') ? argv[scopeAt + 1] : '')
    .split(',').map((s) => s.trim()).filter(Boolean);
if (SCOPE && !SCOPE.length) {
  process.stderr.write('dump: --scope needs one or more decision ids or ledger paths, comma-separated\n');
  process.exit(1);
}
if (SUBTREE && !SCOPE) {
  process.stderr.write('dump: --subtree only means something with --scope\n');
  process.exit(1);
}
const referrersAt = argv.indexOf('--referrers');
const REFERRERS = referrersAt === -1 ? null
  : (argv[referrersAt + 1] && !argv[referrersAt + 1].startsWith('--') ? argv[referrersAt + 1] : '')
    .split(',').map((s) => s.trim()).filter(Boolean);
if (REFERRERS && !REFERRERS.length) {
  process.stderr.write('dump: --referrers needs one or more view: ids, comma-separated\n');
  process.exit(1);
}
if (REFERRERS && SCOPE) {
  process.stderr.write('dump: --referrers is a planning walk of its own — it does not combine with --scope\n');
  process.exit(1);
}
const ctx = loadLedger();
const { nodes, records, interactions, domains } = ctx;

// A dump is made to be piped (`| head`, `| grep`); a closed reader is the pipe working, not a fault.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
process.stderr.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });

const write = (o) => process.stdout.write((PRETTY ? JSON.stringify(o, null, 2) : JSON.stringify(o)) + '\n');

let scope = null;
if (SCOPE) {
  try {
    scope = scopedRead(ctx, SCOPE, { subtree: SUBTREE });
  } catch (e) {
    process.stderr.write(`dump: ${e.message}\n`);
    process.exit(1);
  }
}

// The referrer walk stands alone: each view, then its subscribers, nothing else.
if (REFERRERS) {
  let walks;
  try {
    walks = REFERRERS.map((id) => referrersOf(ctx, id));
  } catch (e) {
    process.stderr.write(`dump: ${e.message}\n`);
    process.exit(1);
  }
  let total = 0;
  for (const { view, nodes: refs } of walks) {
    write(viewLine(view, { maintenance: MAINTENANCE }));
    for (const n of refs) write(nodeLine(ctx, n, { role: 'referrer', maintenance: MAINTENANCE }));
    total += refs.length;
  }
  process.stderr.write(`${total} decision(s) reference ${REFERRERS.join(', ')}\n`);
  process.exit(0);
}

// The declared domains lead: they are what a new id's namespace is chosen from.
if (domains.size) write({ domains: Object.fromEntries(domains) });
const decisionCount = (list) => list.reduce((n, x) => n + x.ids.length, 0);
if (scope) {
  for (const n of scope.nodes) {
    write(nodeLine(ctx, n, { role: scope.role.get(n.rel), maintenance: MAINTENANCE }));
  }
} else {
  const tier = (n) => (n.tree === 'engineering' ? (n.ids.some(isPrinciple) ? 0 : 1) : n.tree.startsWith('capabilities/') ? 2 : 3);
  for (const n of [...nodes].sort((a, b) => tier(a) - tier(b))) write(nodeLine(ctx, n, { maintenance: MAINTENANCE }));
  for (const m of records.filter((r) => r._tree === 'models')) write(viewLine(m, { maintenance: MAINTENANCE }));
}
if (WITH_INTERACTIONS) for (const e of [...interactions].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))) write(e);

const tail = WITH_INTERACTIONS ? ` · ${interactions.length} interaction events` : '';
if (scope) {
  const tally = {};
  for (const n of scope.nodes) { const r = scope.role.get(n.rel); tally[r] = (tally[r] ?? 0) + 1; }
  const roles = SCOPE_ROLES.filter((r) => tally[r]).map((r) => `${tally[r]} ${r}`).join(', ');
  process.stderr.write(
    `${decisionCount(scope.nodes)} of ${decisionCount(nodes)} decisions in scope (${roles})${tail}\n`);
} else {
  process.stderr.write(
    `${decisionCount(nodes)} decisions · ` +
    `${records.filter((r) => r._tree === 'models').length} views${tail}\n`);
}
