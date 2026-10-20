// The ledger store's rules, driven through the SHIPPED entry points (`server.mjs --check`,
// `dump.mjs`, the explorer's HTTP routes) wherever a rule has one, and through lib.mjs directly for
// the indexes those entry points read.
//
// The store is a tree of NODES, ONE DECISION PER FILE (user-ruled 2026-10-14): each file an `id`, a
// `name` and a `decision` (optional `rejected`, `references`), with optional `includes`, `dubious`,
// `questions` and `context`; directory nesting is parentage. Most fixtures are a small synthetic
// store, so each rule is asserted against a shape built for it rather than against ids of the live
// ledger that a reorganisation would rot.
//
//   node --test tools/ledger.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, renameSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emit } from './yaml.mjs';
import {
  loadLedger, buildStore, validate, warn, storeCounts, scopedRead, referrersOf, nodeLine, resolveNode,
  interactionIndex, parseInteractionLog, interactionLogPath, openGaps, citedIds, compactTextChange,
  decisionRefBindings, decisionRefIds, danglingCitations, shapeIndex, viewIndex, declaredDerivations, erdData,
  treeIndex, nodeDetail, capabilityIndex, capabilityDependencies, capabilityCycles, search,
  resolveUiAsset, entryKind, treeOfPath, cloudOfTree, idsInDecisionText, reachOverclaims, kindOf,
  fieldTokens, effectiveReferences,
  INTERACTION_KINDS, NODE_KEYS, VIEW_KEYS, RETIRED_CONTRACT, SELF,
} from './lib.mjs';

const SERVER = fileURLToPath(new URL('server.mjs', import.meta.url));
const DUMP = fileURLToPath(new URL('dump.mjs', import.meta.url));
const LEDGER = fileURLToPath(new URL('../ledger', import.meta.url));

// THE INTERACTION LOG is machine-local telemetry (ADROIT.md, The interactions log), so no test may read
// the developer's own `~/.adroit/`: ADROIT_HOME points every load — here and in every spawned
// process, which inherit the environment — at a scratch home.
const HOME = mkdtempSync(join(tmpdir(), 'adroit-home-'));
process.env.ADROIT_HOME = HOME;
process.on('exit', () => rmSync(HOME, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// The synthetic store
// ---------------------------------------------------------------------------

/** One node file: its id, name and decision (defaulted), the rest in the node's own key order. */
const node = (id, name, extra = {}) => {
  const all = { id, name, decision: `The ${id.replace(/[:-]/g, ' ')} rule.`, ...extra };
  return Object.fromEntries([...NODE_KEYS.filter((k) => k in all), ...Object.keys(all).filter((k) => !NODE_KEYS.includes(k))]
    .map((k) => [k, all[k]]));
};

/** A small store with every shape the rules talk about: an engineering root, three capabilities,
 *  each rooted at its own self.yaml (capa includes capb; capc is included by nobody), and one app
 *  whose root includes capa and carries the maintenance notes, with a leaf decision beside its tools. */
const BASE = () => ({
  'domains.yaml': { corpus: 'fixture', eng: 'Engineering.', app: 'The app.' },
  'engineering/a-principle.yaml': node('principle:fixture-principle', 'A principle'),
  'engineering/a-rule.yaml': node('eng:a-rule', 'A rule'),
  'capabilities/capa/self.yaml': node('capa:root-a', 'Root A', { decision: 'The capa root rule.' }),
  'capabilities/capa/leaf-a.yaml': node('capa:leaf-a', 'Leaf A', { includes: ['capb'] }),
  'capabilities/capb/self.yaml': node('capb:only-b', 'Only B'),
  'capabilities/capc/self.yaml': node('capc:only-c', 'Only C', { decision: 'The capc rule.' }),
  'product/app/self.yaml': node('story:app', 'App', {
    decision: 'A person runs the app.', rejected: ['a second app'],
    includes: ['capa'],
    dubious: 'the phone decision may no longer hold',
    questions: ['does the free tier still bind?'],
    context: 'the app root',
  }),
  'product/app/on-phone.yaml': node('app:on-phone', 'On phone', { decision: 'Every surface works on a phone.' }),
  'product/app/tools/self.yaml': node('story:tools', 'Tools'),
  'product/app/tools/one-tool/self.yaml': node('app:one-tool', 'One tool'),
  'product/app/tools/one-tool/detail.yaml': node('app:detail', 'Detail'),
  'product/app/sibling.yaml': node('app:sibling', 'Sibling', { decision: 'A sibling rule.' }),
  'models/view.thing.yaml': { id: 'view:thing', decision: 'A thing as it crosses a boundary.', schema: { fields: { id: 'int (app:detail) — the key', at: 'epoch' } } },
});

/** The files as an in-memory store, through the same classifier and parser the loader uses. */
const storeOf = (files) => {
  const store = buildStore(Object.entries(files).map(([rel, body]) => ({
    kind: entryKind(`ledger/${rel}`), path: `ledger/${rel}`, rel, content: typeof body === 'string' ? body : emit(body),
  })));
  return { ...store, strayRoots: [] };
};
/** The files written to a scratch store on disk, for the spawned entry points. */
function onDisk(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'adroit-ledger-'));
  const dir = join(root, 'ledger');
  try {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), typeof body === 'string' ? body : emit(body));
    }
    return fn(dir, root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}
const check = (dir) => spawnSync(process.execPath, [SERVER, '--check', '--dir', dir], { encoding: 'utf8' });
const dump = (dir, ...args) => spawnSync(process.execPath, [DUMP, ...args],
  { encoding: 'utf8', env: { ...process.env, ADROIT_LEDGER_DIR: dir }, maxBuffer: 64 * 1024 * 1024 });
const lines = (r) => r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rules = (errors) => errors.map((e) => e.rule);
const errorsFor = (files) => validate(storeOf(files));
const edit = (fn) => { const f = BASE(); fn(f); return f; };

// ---------------------------------------------------------------------------
// The live store
// ---------------------------------------------------------------------------

test('the live store passes its own check, and the summary counts one decision per node file', () => {
  const r = check(LEDGER);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ledger: \d+ decisions, \d+ include\(s\), \d+ dubious node\(s\), \d+ open question\(s\), /);
  const { nodes, records } = loadLedger();
  assert.equal(records.filter((x) => x._node).length, nodes.length, 'one decision per node file');
  assert.ok(nodes.every((n) => n.ids.length === 1 && !n.legacy), 'every live node file is in the singular format');
  assert.match(r.stdout, /\(validated/);
});

test('every @DecisionRef in the app resolves against the live store', () => {
  const { byId } = loadLedger();
  const bindings = decisionRefBindings();
  assert.ok(bindings.size > 20, 'the backend binds tests to decisions');
  assert.deepEqual([...bindings.keys()].filter((id) => !byId.has(id)), [], 'every bound id names a live decision');
});

// ---------------------------------------------------------------------------
// The node shape
// ---------------------------------------------------------------------------

test('the synthetic store is valid — every rule below breaks it in exactly one way', () => {
  assert.deepEqual(errorsFor(BASE()), []);
  const s = storeOf(BASE());
  assert.equal(s.nodes.length, 12);
  assert.equal(s.records.filter((r) => r._node).length, 12, 'one decision per node');
  assert.deepEqual(s.nodeByRel.get('product/app/self.yaml').ids, ['story:app']);
  assert.equal(s.nodeByRel.get('product/app/self.yaml').id, 'story:app');
  assert.equal(s.byId.get('app:on-phone')._nestedUnder, 'product/app/self.yaml', 'a leaf file is a child decision of its directory');
  assert.equal(s.byId.get('app:detail')._nestedUnder, 'product/app/tools/one-tool/self.yaml', 'parentage is the directory');
  assert.equal(s.byId.get('app:detail')._node, 'product/app/tools/one-tool/detail.yaml');
  assert.equal(new Set(s.records.map((r) => r._rel)).size, s.records.length, 'every decision has a unique _rel');
});

test('a retired key is a hard error, naming what replaced it', () => {
  for (const key of ['links', 'peers', 'mounts', 'severs', 'severed', 'severable', 'commitments', 'decisions']) {
    const errors = errorsFor(edit((f) => { f['product/app/sibling.yaml'][key] = []; }));
    assert.deepEqual(rules(errors), ['retired-key'], key);
    assert.match(errors[0].message, new RegExp(`^'${key}' is retired`));
  }
  assert.match(errorsFor(edit((f) => { f['product/app/sibling.yaml'].mounts = ['capa']; }))[0].message, /includes/);
});

test('the decision-list format is retired: a decisions: list fails, saying one decision per file', () => {
  const listed = errorsFor(edit((f) => {
    f['product/app/sibling.yaml'] = { name: 'Sibling', decisions: [{ id: 'app:sibling', decision: 'A sibling rule.' }, { id: 'app:peer', decision: 'A peer.' }] };
  }));
  assert.deepEqual(listed.map((e) => [e.id, e.rule]), [['product/app/sibling.yaml', 'retired-key']]);
  assert.match(listed[0].message, /^'decisions' is retired — one decision per file/);
  // …and it is still READ (for --diff against older refs): both its decisions load
  const s = storeOf(edit((f) => {
    f['product/app/sibling.yaml'] = { name: 'Sibling', decisions: [{ id: 'app:sibling', decision: 'A sibling rule.' }, { id: 'app:peer', decision: 'A peer.' }] };
  }));
  assert.deepEqual(s.nodeByRel.get('product/app/sibling.yaml').ids, ['app:sibling', 'app:peer']);
  assert.equal(s.byId.get('app:peer').decision, 'A peer.');
});

test('an unknown key is a hard error', () => {
  const unknown = errorsFor(edit((f) => { f['product/app/sibling.yaml'].status = 'live'; }));
  assert.deepEqual(rules(unknown), ['unknown-key']);
  assert.match(unknown[0].message, /^'status' is not a node key — a node holds only id, name, decision, rejected, references, includes, dubious, questions, context$/);
  assert.deepEqual(NODE_KEYS, ['id', 'name', 'decision', 'rejected', 'references', 'includes', 'dubious', 'questions', 'context']);
});

test('severs are gone: severed and severable on a node both fail as retired keys', () => {
  const severed = errorsFor(edit((f) => { f['product/app/tools/self.yaml'].severed = ['app:on-phone']; }));
  assert.deepEqual(rules(severed), ['retired-key']);
  assert.equal(severed[0].id, 'product/app/tools/self.yaml');
  const severable = errorsFor(edit((f) => { f['product/app/on-phone.yaml'].severable = true; }));
  assert.deepEqual(rules(severable), ['retired-key']);
  assert.equal(severable[0].id, 'product/app/on-phone.yaml');
});

test('a node needs an id, a one-line name and one decision', () => {
  const bad = [
    (f) => { delete f['product/app/sibling.yaml'].id; },
    (f) => { f['product/app/sibling.yaml'].id = ''; },
    (f) => { f['product/app/sibling.yaml'].id = 7; },
    (f) => { delete f['product/app/sibling.yaml'].name; },
    (f) => { f['product/app/sibling.yaml'].name = 'two\nlines'; },
    (f) => { delete f['product/app/sibling.yaml'].decision; },
    (f) => { f['product/app/sibling.yaml'].decision = ' '; },
    (f) => { f['product/app/sibling.yaml'].decision = ['a list']; },
    (f) => { f['product/app/sibling.yaml'].rejected = 'not a list'; },
    (f) => { f['product/app/sibling.yaml'] = 'just text'; },
  ];
  for (const fn of bad) assert.deepEqual(rules(errorsFor(edit(fn))), ['shape'], fn.toString());
  const noId = errorsFor(edit((f) => { delete f['product/app/sibling.yaml'].id; }));
  assert.equal(noId[0].id, 'product/app/sibling.yaml', 'a node with no id is named by its path');
  assert.match(noId[0].message, /^id must be a non-empty string/);
  const noDecision = errorsFor(edit((f) => { delete f['product/app/sibling.yaml'].decision; }));
  assert.equal(noDecision[0].id, 'app:sibling');
  assert.match(noDecision[0].message, /^decision must be a non-empty string/);
});

test('ids are unique across the whole ledger, slug-shaped, and in a declared namespace', () => {
  const dup = errorsFor(edit((f) => { f['product/app/sibling.yaml'].id = 'app:detail'; }));
  assert.deepEqual(rules(dup), ['duplicate-id']);
  assert.match(dup[0].message, /^also written in product\/app\/(sibling|tools\/one-tool\/detail)\.yaml#app:detail/);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].id = 'app:D14'; }))), ['id-shape']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].id = 'nope:sibling'; }))), ['namespace']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].id = 'capb:sibling'; }))), ['namespace'],
    'a capability-namespaced decision lives in its capability');
});

test('nothing keys off the file name — a node may live in any file name, and its ids in no path', () => {
  const f = BASE();
  f['product/app/tools/one-tool/renamed-anything.yaml'] = f['product/app/tools/one-tool/detail.yaml'];
  delete f['product/app/tools/one-tool/detail.yaml'];
  assert.deepEqual(errorsFor(f), []);
});

test('dubious and questions: their shape is checked, and they are never a fault otherwise', () => {
  const s = storeOf(BASE());
  assert.deepEqual(validate(s), []);
  assert.deepEqual(warn(s).filter((w) => /dubious|question/.test(w.rule)), [], 'not even a warning');
  const bad = [
    ['dubious', (f) => { f['product/app/self.yaml'].dubious = 'two\nlines'; }],
    ['dubious', (f) => { f['product/app/self.yaml'].dubious = ''; }],
    ['dubious', (f) => { f['product/app/self.yaml'].dubious = ['a list']; }],
    ['questions', (f) => { f['product/app/self.yaml'].questions = 'one string'; }],
    ['questions', (f) => { f['product/app/self.yaml'].questions = ['ok', '']; }],
    ['questions', (f) => { f['product/app/self.yaml'].questions = ['line\nbreak']; }],
    ['questions', (f) => { f['product/app/self.yaml'].questions = []; }],
  ];
  for (const [rule, fn] of bad) assert.deepEqual(rules(errorsFor(edit(fn))), [rule], fn.toString());
  // a dubious mark is WRITTEN into each descendant by whoever marks a node — never derived
  assert.equal(s.nodeByRel.get('product/app/tools/self.yaml').dubious, undefined);
  assert.equal(storeCounts(s).dubious, 1);
  assert.equal(storeCounts(s).questions, 1);
});

test('context is one free-form text, never a mapping', () => {
  assert.deepEqual(errorsFor(edit((f) => { f['product/app/self.yaml'].context = 'a plain note'; })), []);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/self.yaml'].context = { why: 'w', src: 's' }; }))), ['context']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/self.yaml'].context = ''; }))), ['context']);
});

// ---------------------------------------------------------------------------
// Includes and the scoped read
// ---------------------------------------------------------------------------

test('includes must name a capability, once', () => {
  const unknown = errorsFor(edit((f) => { f['product/app/sibling.yaml'].includes = ['nope']; }));
  assert.deepEqual(rules(unknown), ['includes']);
  assert.match(unknown[0].message, /'nope', which is no capability/);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].includes = ['capa', 'capa']; }))), ['includes']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].includes = 'capa'; }))), ['includes']);
  const own = errorsFor(edit((f) => { f['capabilities/capa/leaf-a.yaml'].includes = ['capb', 'capa']; }));
  assert.deepEqual(rules(own), ['includes']);
  assert.match(own[0].message, /'capa', the capability it lives in/);
});

test('the scoped read: engineering, the ancestors and the target — a capability an ancestor includes is that ancestor\'s child, not in scope', () => {
  const s = storeOf(BASE());
  const r = scopedRead(s, ['app:detail']);
  const role = Object.fromEntries([...r.role].map(([rel, x]) => [rel, x]));
  assert.deepEqual(role, {
    'engineering/a-principle.yaml': 'engineering',
    'engineering/a-rule.yaml': 'engineering',
    'product/app/self.yaml': 'ancestor',
    // an ancestor is its own decision only: on-phone and sibling are the app's other children
    'product/app/tools/self.yaml': 'ancestor',
    'product/app/tools/one-tool/self.yaml': 'ancestor',
    'product/app/tools/one-tool/detail.yaml': 'target',
    // capa is included by the app root: grafted beneath the app, it is a sibling of tools, not above detail
  });
  assert.deepEqual(r.nodes.map((n) => n.rel), [
    'engineering/a-principle.yaml', 'engineering/a-rule.yaml', 'product/app/self.yaml',
    'product/app/tools/self.yaml', 'product/app/tools/one-tool/self.yaml', 'product/app/tools/one-tool/detail.yaml',
  ], 'reading order: engineering (principles first), then the chain root-first');
  // nor does a leaf beside the includer read it
  assert.ok(!scopedRead(s, ['product/app/sibling.yaml']).role.has('capabilities/capa/self.yaml'));
});

test('the scoped read: a node inside a capability reads the path above the graft — each includer, with its ancestors', () => {
  const s = storeOf(BASE());
  // capb is grafted beneath capa's leaf-a, and capa beneath the app root
  const r = scopedRead(s, ['capb:only-b']);
  const role = Object.fromEntries([...r.role].filter(([, x]) => x !== 'engineering'));
  assert.deepEqual(role, {
    'capabilities/capb/self.yaml': 'target',
    'capabilities/capa/self.yaml': 'includer',
    'capabilities/capa/leaf-a.yaml': 'includer',
    'product/app/self.yaml': 'includer',
  });
  assert.deepEqual(r.nodes.filter((n) => r.role.get(n.rel) !== 'engineering').map((n) => n.rel).at(-1),
    'capabilities/capb/self.yaml', 'the path above the graft reads before the target');
  assert.ok(!scopedRead(s, ['capc:only-c']).role.has('product/app/self.yaml'), 'a capability nobody includes has nothing above it');
});

test('the scoped read never reads a sibling — of the target or of any ancestor', () => {
  onDisk(BASE(), (dir) => {
    const out = lines(dump(dir, '--scope', 'app:detail')).filter((l) => l.node);
    assert.ok(!out.some((l) => l.id === 'app:on-phone' || l.id === 'app:sibling'), 'an ancestor\'s other children stay out');
  });
  const s = storeOf(BASE());
  const leaf = scopedRead(s, ['app:on-phone']);
  assert.deepEqual([...leaf.role].filter(([, x]) => x !== 'engineering'),
    [['product/app/self.yaml', 'ancestor'], ['product/app/on-phone.yaml', 'target']], 'a leaf reads its parent, never the leaves beside it');
});

test('the scoped read: --subtree adds the descendants; a target is an id, a node file or a directory; unknown throws', () => {
  const s = storeOf(BASE());
  const r = scopedRead(s, ['app:one-tool'], { subtree: true });
  assert.equal(r.role.get('product/app/tools/one-tool/detail.yaml'), 'descendant', 'a directory target\'s leaf children are its descendants');
  assert.ok(!scopedRead(s, ['app:one-tool']).role.has('product/app/tools/one-tool/detail.yaml'), 'without --subtree, they stay out');
  assert.equal(resolveNode(s, 'ledger/product/app/tools/one-tool/').rel, 'product/app/tools/one-tool/self.yaml');
  assert.equal(resolveNode(s, 'product/app/sibling.yaml').rel, 'product/app/sibling.yaml');
  assert.equal(resolveNode(s, 'app:on-phone').rel, 'product/app/on-phone.yaml', 'a decision id finds its node');
  const sub = scopedRead(s, ['story:app'], { subtree: true });
  assert.equal(sub.role.get('product/app/tools/one-tool/detail.yaml'), 'descendant', '--subtree still reaches the nested directories');
  assert.ok(!scopedRead(s, ['story:app']).role.has('product/app/tools/self.yaml'), 'without --subtree, a nested directory stays out');
  // the capabilities grafted beneath a target are among its descendants, transitively
  assert.equal(sub.role.get('capabilities/capa/leaf-a.yaml'), 'descendant');
  assert.equal(sub.role.get('capabilities/capb/self.yaml'), 'descendant');
  assert.ok(!sub.role.has('capabilities/capc/self.yaml'), 'a capability nobody includes stays out');
  assert.ok(!scopedRead(s, ['story:app']).role.has('capabilities/capa/self.yaml'), 'without --subtree, its own includes stay out');
  assert.throws(() => scopedRead(s, ['app:nope']), /no decision or ledger path matches: app:nope/);
  // a target inside engineering is the TARGET, not merely engineering
  assert.equal(scopedRead(s, ['eng:a-rule']).role.get('engineering/a-rule.yaml'), 'target');
});

test('dump --scope writes ONE line per node — one decision — with roles, and the notes left out', () => {
  onDisk(BASE(), (dir) => {
    const r = dump(dir, '--scope', 'app:detail');
    assert.equal(r.status, 0, r.stderr);
    const out = lines(r);
    assert.deepEqual(out[0], { domains: { eng: 'Engineering.', app: 'The app.' } });
    assert.ok(out.every((l) => l.domains || l.node), 'only the domains and the nodes — no other line kind');
    const nodes = out.filter((l) => l.node);
    assert.equal(nodes.length, 6, 'one line per node in scope');
    const root = nodes.find((l) => l.node === 'product/app/self.yaml');
    assert.deepEqual(root, {
      node: 'product/app/self.yaml', id: 'story:app', name: 'App',
      decision: 'A person runs the app.', rejected: ['a second app'],
      includes: ['capa'], tree: 'product/app', scope_role: 'ancestor',
    }, 'dubious, questions and context are omitted by default');
    assert.ok(nodes.every((l) => !('severed' in l) && !('severable' in l) && !('decisions' in l)),
      'no sever marks and no decision list on any line');
    assert.deepEqual(nodes.map((l) => l.scope_role).filter((x, i, a) => a.indexOf(x) === i),
      ['engineering', 'ancestor', 'target']);
    assert.ok(nodes.every((l) => !('dubious' in l) && !('questions' in l) && !('context' in l)));
    assert.match(r.stderr, /^6 of 12 decisions in scope \(2 engineering, 3 ancestor, 1 target\)\n$/);
  });
});

test('the referrer walk: a view plus every decision referencing it, explicit or by token — planning only', () => {
  const files = edit((f) => {
    f['product/app/sibling.yaml'].references = ['view:thing'];
    f['product/app/tools/one-tool/detail.yaml'].decision = 'The {thing.id} key is the door.';
  });
  const s = storeOf(files);
  const { view, nodes } = referrersOf(s, 'view:thing');
  assert.equal(view.id, 'view:thing');
  assert.deepEqual(nodes.map((n) => n.id).sort(), ['app:detail', 'app:sibling'],
    'an explicit references: entry and a {slug.field} token both subscribe');
  assert.throws(() => referrersOf(s, 'view:nope'), /'view:nope' resolves to no view record/);
  assert.throws(() => referrersOf(s, 'app:detail'), /'app:detail' resolves to no view record/,
    'only a view has referrers');
  onDisk(files, (dir) => {
    const r = dump(dir, '--referrers', 'view:thing');
    assert.equal(r.status, 0, r.stderr);
    const out = lines(r);
    assert.equal(out[0].id, 'view:thing', 'the view leads');
    assert.equal(out[0].tree, 'models');
    const refs = out.slice(1);
    assert.deepEqual(refs.map((l) => l.id).sort(), ['app:detail', 'app:sibling']);
    assert.ok(refs.every((l) => l.scope_role === 'referrer'), 'every referrer line says so');
    assert.ok(out.every((l) => !l.domains), 'the walk carries no domains line — view and subscribers only');
    assert.match(r.stderr, /^2 decision\(s\) reference view:thing\n$/);
    assert.equal(dump(dir, '--referrers', 'view:nope').status, 1, 'an unknown view id exits 1');
    assert.equal(dump(dir, '--referrers', 'view:thing', '--scope', 'app:detail').status, 1,
      'the planning walk never rides inside a scoped read');
  });
});

test('dump --maintenance brings back dubious, questions and context — scoped and full', () => {
  onDisk(BASE(), (dir) => {
    for (const args of [['--scope', 'app:detail', '--maintenance'], ['--maintenance']]) {
      const root = lines(dump(dir, ...args)).find((l) => l.node === 'product/app/self.yaml');
      assert.equal(root.dubious, 'the phone decision may no longer hold', args.join(' '));
      assert.deepEqual(root.questions, ['does the free tier still bind?']);
      assert.deepEqual(root.context, 'the app root');
    }
    const view = lines(dump(dir, '--maintenance')).find((l) => l.id === 'view:thing');
    assert.equal(view.tree, 'models');
    assert.deepEqual(Object.keys(view), ['id', 'decision', 'schema', 'tree'], 'a view line is its own content');
  });
});

test('the full dump is one line per node too, then the views; --context is gone', () => {
  onDisk(BASE(), (dir) => {
    const r = dump(dir);
    assert.equal(r.status, 0, r.stderr);
    const out = lines(r);
    const nodes = out.filter((l) => l.node);
    assert.equal(nodes.length, 12);
    assert.ok(nodes.every((l) => !('scope_role' in l) && !('context' in l) && !('dubious' in l)));
    const at = (rel) => nodes.findIndex((l) => l.node === rel);
    assert.ok(at('product/app/self.yaml') < at('product/app/on-phone.yaml')
      && at('product/app/tools/self.yaml') < at('product/app/tools/one-tool/self.yaml'),
      'a directory\'s self.yaml prints before its other children');
    assert.deepEqual(nodes.slice(0, 2).map((l) => l.node), ['engineering/a-principle.yaml', 'engineering/a-rule.yaml']);
    assert.equal(out.at(-1).id, 'view:thing');
    assert.match(r.stderr, /^12 decisions · 1 views\n$/);
    assert.equal(dump(dir, '--subtree').status, 1, '--subtree needs --scope');
    assert.equal(dump(dir, '--scope', 'app:nope').status, 1);
  });
});

test('nodeLine is the dump\'s line, and leaves notes out unless asked', () => {
  const s = storeOf(BASE());
  const n = s.nodeByRel.get('product/app/self.yaml');
  assert.deepEqual(Object.keys(nodeLine(s, n)), ['node', 'id', 'name', 'decision', 'rejected', 'includes', 'tree']);
  assert.deepEqual(Object.keys(nodeLine(s, n, { maintenance: true, role: 'target' })),
    ['node', 'id', 'name', 'decision', 'rejected', 'includes', 'dubious', 'questions', 'context', 'tree', 'scope_role']);
});

// ---------------------------------------------------------------------------
// Text rules, models, domains, capabilities
// ---------------------------------------------------------------------------

test('decision text names no record id — rejected and context may', () => {
  const named = errorsFor(edit((f) => { f['product/app/sibling.yaml'].decision = 'Follows app:detail closely.'; }));
  assert.deepEqual(rules(named), ['id-in-decision-text']);
  assert.deepEqual(errorsFor(edit((f) => {
    f['product/app/sibling.yaml'].rejected = ['what app:detail does'];
    f['product/app/sibling.yaml'].context = 'see app:detail';
  })), []);
  const s = storeOf(BASE());
  assert.deepEqual(idsInDecisionText({ ...s.byId.get('app:sibling'), decision: 'e.g. she:her and note:thing' }, s.byId), [],
    'only tokens that resolve count');
});

test('a decision never names a view (or a retired model) id — in its decisions or its context', () => {
  const named = errorsFor(edit((f) => { f['product/app/sibling.yaml'].decision = 'Stores a view:thing.'; }));
  assert.deepEqual(rules(named), ['model-in-decision']);
  assert.match(named[0].message, /\{slug\.field\} token, or list the view in the decision's references:/);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].context = 'see view:thing'; }))), ['model-in-decision']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].rejected = ['a model:thing table']; }))), ['model-in-decision'],
    'a retired model: id is no more welcome in the text than a view id');
  assert.deepEqual(errorsFor(edit((f) => { f['product/app/self.yaml'].questions = ['should view:thing split?']; })), [],
    'questions are maintenance notes, never a check fault');
});

test('a view\'s field citations resolve — a dangling one fails the check; uncited fields are a report', () => {
  const s = storeOf(BASE());
  const sx = shapeIndex(s);
  assert.deepEqual(sx.edges.map((e) => e.ruling), ['app:detail']);
  assert.deepEqual(sx.unlinked.map((u) => u.field), ['at']);
  assert.deepEqual(viewIndex(s).realizersOf('view:thing'), ['product/app']);
  const dangling = errorsFor(edit((f) => { f['models/view.thing.yaml'].schema.fields.at = 'epoch (app:gone)'; }));
  assert.deepEqual(rules(dangling), ['shape-citation']);
  assert.match(dangling[0].message, /^schema\.at cites 'app:gone'/);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].id = 'view:sibling'; }))), ['models'],
    'a view lives in the models directory');
  const stranger = errorsFor(edit((f) => { f['models/view.thing.yaml'].id = 'app:thing'; }));
  assert.ok(rules(stranger).includes('models'), 'the models directory holds only view: records');
  assert.match(stranger.find((e) => e.rule === 'models').message, /holds only view: records/);
});

// --- typed view schemas and decision references --------------------------------

/** BASE plus a second typed view, exercising the whole type vocabulary. */
const TYPED = () => edit((f) => {
  f['models/view.widget.yaml'] = {
    id: 'view:widget', decision: 'A widget as it crosses a boundary.',
    schema: {
      fields: {
        name: 'string (app:detail) — the widget\'s name',
        notes: 'text',
        size: 'int (app:one-tool, app:sibling) — how big',
        big: 'long', on: 'bool', at: 'epoch — when', day: 'date', blob: 'json',
        state: 'enum<OPEN|CLOSED|on-hold> (app:detail) — its state',
        thing: 'ref<view:thing> — the thing behind it',
        self: 'ref<view:widget>',
        total: 'derived<int> (app:detail) — read at request time',
        owner: 'derived<ref<view:thing>>',
        score: 'double — a decimal measure',
        parts: 'list<ref<view:widget>> — nested widgets',
        tags: 'list<string>',
        byDay: 'map<string,int> — counts keyed by day',
        slots: 'map<long,list<ref<view:thing>>>',
      },
    },
  };
});

test('a typed view schema validates its closed type vocabulary and feeds the same field links', () => {
  const s = storeOf(TYPED());
  assert.deepEqual(validate(s), []);
  const sx = shapeIndex(s);
  const widget = (xs) => xs.filter((e) => e.model === 'view:widget');
  assert.deepEqual(widget(sx.edges).map((e) => `${e.section}.${e.field}→${e.ruling}`).sort(), [
    'fields.name→app:detail', 'fields.size→app:one-tool', 'fields.size→app:sibling', 'fields.state→app:detail',
    'fields.total→app:detail',
  ]);
  assert.ok(widget(sx.unlinked).some((u) => u.field === 'notes'), 'an uncited typed field is unlinked');
  assert.deepEqual(declaredDerivations(s.byId.get('view:widget')), ['total', 'owner']);
  assert.equal(storeCounts(s).views, 2);
  assert.ok(!('typedViews' in storeCounts(s)), 'every view is typed — there is no second count');
});

test('a malformed type token is a schema-type fault', () => {
  for (const bad of ['scalar — the old kind', 'varchar', 'String', 'enum<>', 'enum<a||b>', 'enum<A|A>', 'enum<a b>',
    'ref<thing>', 'ref<model:thing', 'ref<view:gone> — names no record', 'ref<app:detail>', 'derived', 'derived<blob>',
    'derived<ref<view:gone>>', 'string(app:detail)', '', 'decimal', 'float', 'list<>', 'list<varchar>', 'list',
    'map<string>', 'map<bool,int>', 'map<string,blob>', 'map<string,ref<view:gone>>']) {
    const errors = errorsFor(edit((f) => { Object.assign(f, TYPED()); f['models/view.widget.yaml'].schema.fields.notes = bad; }));
    assert.deepEqual(rules(errors), ['schema-type'], JSON.stringify(bad));
    assert.match(errors[0].message, /^schema\.notes: /);
  }
});

test('a typed schema holds fields only — never tables or pending inside it, never empty', () => {
  const pending = errorsFor(edit((f) => { Object.assign(f, TYPED()); f['models/view.widget.yaml'].schema.pending = { later: 'not built' }; }));
  assert.deepEqual(rules(pending), ['schema-type']);
  assert.match(pending[0].message, /states current truth only/);
  const tables = errorsFor(edit((f) => { Object.assign(f, TYPED()); f['models/view.widget.yaml'].schema.tables = ['widget']; }));
  assert.deepEqual(rules(tables), ['schema-type']);
  assert.match(tables[0].message, /lists no tables/);
  assert.deepEqual(rules(errorsFor(edit((f) => { Object.assign(f, TYPED()); f['models/view.widget.yaml'].schema.fields = {}; }))), ['schema-type']);
});

// --- the retired model layer ----------------------------------------------------------

test('a model: id is retired — in the models directory or in a node, it fails naming what replaced it', () => {
  const inModels = errorsFor(edit((f) => { f['models/model.thing.yaml'] = { id: 'model:thing', decision: 'A thing.', schema: { fields: { id: 'int' } } }; }));
  assert.deepEqual(rules(inModels), ['retired-kind']);
  assert.equal(inModels[0].id, 'model:thing');
  assert.match(inModels[0].message, /^'model:' is retired — models were retired for views .* storage lives in the code, in its migrations and models/);
  const inNode = errorsFor(edit((f) => { f['product/app/sibling.yaml'].id = 'model:sibling'; }));
  assert.deepEqual(rules(inNode), ['retired-kind']);
  assert.ok(!kindOf('model:thing').startsWith('model'), 'model is no longer a reserved kind');
  assert.deepEqual(rules(errorsFor(edit((f) => { f['domains.yaml'].model = 'Data at rest.'; }))).sort(), ['domains', 'domains'],
    'nor can a domain take the retired namespace back (and it is unused)');
});

test('shape:, tables: and pending: on a view are retired keys, each saying where the thing went', () => {
  for (const [key, value, msg] of [
    ['shape', { fields: { x: 'scalar' } }, /typed schema: — the legacy shape: block went with the models; storage lives in the code, in its migrations and models/],
    ['tables', ['thing'], /storage is memorialized by the code, in its migrations and models/],
    ['pending', { later: 'not built' }, /a view states current truth only/],
  ]) {
    const errors = errorsFor(edit((f) => { f['models/view.thing.yaml'][key] = value; }));
    assert.deepEqual(rules(errors), ['retired-key'], key);
    assert.equal(errors[0].id, 'view:thing');
    assert.match(errors[0].message, new RegExp(`^'${key}' is retired — `), key);
    assert.match(errors[0].message, msg, key);
  }
});

test('a view needs a typed schema, holds only its own keys, and consumes only views', () => {
  const bare = errorsFor(edit((f) => { delete f['models/view.thing.yaml'].schema; }));
  assert.deepEqual(rules(bare), ['schema-type']);
  assert.match(bare[0].message, /a view carries a typed schema:/);
  const unknown = errorsFor(edit((f) => { f['models/view.thing.yaml'].audience = 'everyone'; }));
  assert.deepEqual(rules(unknown), ['unknown-key']);
  assert.match(unknown[0].message, new RegExp(`a view holds only ${VIEW_KEYS.join(', ')}`));
  assert.deepEqual(rules(errorsFor(edit((f) => { f['models/view.thing.yaml'].links = { owns: ['thing'] }; }))), ['unknown-key']);
  assert.deepEqual(errorsFor(edit((f) => {
    Object.assign(f, TYPED());
    f['models/view.widget.yaml'].links = { consumes: ['view:thing'], grounds: ['principle:fixture-principle'] };
  })), [], 'consuming a view and grounding in a principle are both fine');
  for (const target of ['model:thing', 'thing_table', 'view:gone', 'app:detail']) {
    const errors = errorsFor(edit((f) => { f['models/view.thing.yaml'].links = { consumes: [target] }; }));
    assert.deepEqual(rules(errors), ['dangling'], target);
    assert.match(errors[0].message, new RegExp(`consumes '${target}', which is no view record — a view consumes other views`), target);
  }
});

test('ref<…> takes view: ids only — a model: ref says the kind is retired', () => {
  const errors = errorsFor(edit((f) => { f['models/view.thing.yaml'].schema.fields.at = 'ref<model:thing> — the old pointer'; }));
  assert.deepEqual(rules(errors), ['schema-type']);
  assert.match(errors[0].message, /^schema\.at: ref<…> names 'model:thing' — models were retired for views/);
  assert.match(errorsFor(edit((f) => { f['models/view.thing.yaml'].schema.fields.at = 'list<ref<app:detail>>'; }))[0].message,
    /ref<…> takes one view: id/);
});

test('references on a decision resolve to view records, count, and ride the dump line', () => {
  const withRefs = (refs) => edit((f) => {
    Object.assign(f, TYPED());
    f['product/app/sibling.yaml'].references = refs;
  });
  const good = storeOf(withRefs(['view:widget', 'view:thing']));
  assert.deepEqual(validate(good), [], 'the structured key is the sanctioned channel — no model-in-decision fault');
  assert.equal(storeCounts(good).references, 2);
  assert.deepEqual(good.byId.get('app:sibling').references, ['view:widget', 'view:thing']);
  const line = nodeLine(good, good.nodeByRel.get('product/app/sibling.yaml'));
  assert.deepEqual(line.references, ['view:widget', 'view:thing']);
  assert.ok(!('references' in nodeLine(storeOf(BASE()), storeOf(BASE()).nodeByRel.get('product/app/sibling.yaml'))),
    'a decision without references carries no empty key');
  for (const bad of [['view:gone'], ['app:detail'], ['view:thing', 'view:thing'], [], 'view:widget', [7], ['model:thing']]) {
    const errors = errorsFor(withRefs(bad));
    assert.deepEqual(rules(errors), ['references'], JSON.stringify(bad));
  }
  assert.match(errorsFor(withRefs(['model:thing']))[0].message, /'model:thing' — models were retired for views.*reference the view that carries it/);
  assert.match(errorsFor(withRefs(['view:gone']))[0].message, /resolves to no view record/);
  // the text rule is untouched: naming the view in prose is still a fault
  const inText = errorsFor(edit((f) => { Object.assign(f, TYPED()); f['product/app/sibling.yaml'].decision = 'Reads view:widget.'; }));
  assert.deepEqual(rules(inText), ['model-in-decision']);
});

// --- {slug.field} tokens in decision text ------------------------------------------

/** TYPED plus prose on app:sibling (and optionally explicit references). */
const withText = (decision, { rejected, references } = {}) => edit((f) => {
  Object.assign(f, TYPED());
  const d = f['product/app/sibling.yaml'];
  d.decision = decision;
  if (rejected) d.rejected = rejected;
  if (references) d.references = references;
});

test('a valid field token resolves, derives its view as a reference, and rides the dump line', () => {
  const s = storeOf(withText('The widget is known by its {widget.name} and sized by {widget.size}.'));
  assert.deepEqual(validate(s), [], 'a token is neither a model-in-decision nor an id-in-decision-text fault');
  assert.equal(s.byId.get('app:sibling').references, undefined, 'the explicit key stays as written');
  assert.deepEqual(effectiveReferences(s.byId.get('app:sibling')), ['view:widget']);
  assert.equal(storeCounts(s).references, 1, 'two tokens on one view derive one reference');
  assert.deepEqual(nodeLine(s, s.nodeByRel.get('product/app/sibling.yaml')).references, ['view:widget']);
  assert.deepEqual(fieldTokens('{widget.name}'), [{ raw: '{widget.name}', slug: 'widget', field: 'name', view: 'view:widget' }]);
});

test('an unknown slug, an unknown field and a malformed token each fault token', () => {
  const cases = [
    ['Reads {gadget.name}.', /names view:gadget, which is no typed view/],
    ['Reads {widget.colour}.', /view:widget has no field 'colour'/],
    ['Reads {widget}.', /is not a field token/],
    ['Reads {widget.}.', /is not a field token/],
    ['Reads {.name}.', /is not a field token/],
    ['Reads {widget.name.x}.', /is not a field token/],
    ['Reads {widget. name}.', /is not a field token/],
    ['Reads {}.', /is not a field token/],
    ['Reads {Widget.name}.', /is not a field token/],
  ];
  for (const [text, msg] of cases) {
    const errors = errorsFor(withText(text));
    assert.deepEqual(rules(errors), ['token'], text);
    assert.equal(errors[0].id, 'app:sibling');
    assert.match(errors[0].message, msg, text);
  }
});

test('a token in rejected text is validated the same way, and derives a reference too', () => {
  const good = storeOf(withText('A plain rule.', { rejected: ['keying it by {widget.size} — lost'] }));
  assert.deepEqual(validate(good), []);
  assert.deepEqual(effectiveReferences(good.byId.get('app:sibling')), ['view:widget']);
  const bad = errorsFor(withText('A plain rule.', { rejected: ['fine', 'keying it by {widget.weight}'] }));
  assert.deepEqual(rules(bad), ['token']);
  assert.match(bad[0].message, /^rejected\[1\]: .*no field 'weight'/);
});

test('explicit and token-derived references deduplicate in the count and the dump', () => {
  const s = storeOf(withText('Sized by {widget.size}.', { references: ['view:thing', 'view:widget'] }));
  assert.deepEqual(validate(s), []);
  assert.deepEqual(effectiveReferences(s.byId.get('app:sibling')), ['view:thing', 'view:widget']);
  assert.equal(storeCounts(s).references, 2);
  const derivedOnly = storeOf(withText('Sized by {widget.size}.', { references: ['view:thing'] }));
  assert.deepEqual(effectiveReferences(derivedOnly.byId.get('app:sibling')), ['view:thing', 'view:widget']);
  assert.equal(storeCounts(derivedOnly).references, 2);
});

test('--check fails a bad token with a nonzero exit, and dump carries the derived reference', () => {
  onDisk(withText('Sized by {widget.size}.'), (dir) => {
    const r = check(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 decision→view reference\(s\)/);
    const d = lines(dump(dir, '--scope', 'app:sibling')).find((l) => l.node === 'product/app/sibling.yaml');
    assert.equal(d.decision, 'Sized by {widget.size}.');
    assert.deepEqual(d.references, ['view:widget']);
  });
  onDisk(withText('Sized by {widget.heft}.'), (dir) => {
    const r = check(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /app:sibling \[token\] decision: '\{widget\.heft\}'/);
  });
});

test('--check reports views and references in its summary, and a bad type token exits nonzero', () => {
  const files = TYPED();
  files['product/app/sibling.yaml'].references = ['view:widget'];
  onDisk(files, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, / 2 views \(\d+ field→decision link\(s\) into 1 decision tree\(s\), \d+ unlinked field\(s\)\), 1 decision→view reference\(s\)/);
    assert.doesNotMatch(r.stdout, /models|typed/, 'the summary speaks of views only');
    const s = dump(dir, '--scope', 'app:sibling');
    assert.deepEqual(lines(s).find((l) => l.node === 'product/app/sibling.yaml').references, ['view:widget']);
  });
  files['models/view.widget.yaml'].schema.fields.notes = 'blob';
  onDisk(files, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /view:widget \[schema-type\] schema\.notes: 'blob' is not a schema type/);
  });
});

test('a domain namespace is usable once declared, and the declaration stays honest', () => {
  const unused = errorsFor(edit((f) => { f['domains.yaml'].spare = 'Never used.'; }));
  assert.deepEqual(rules(unused), ['domains']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['domains.yaml'].capa = 'Shadows a capability.'; }))), ['domains']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['domains.yaml'].corpus = 'Not Kebab'; }))), ['domains']);
});

test('every capability has a root node — its decision is the tree\'s purpose', () => {
  const rootless = errorsFor(edit((f) => {
    f['capabilities/capc/only-c.yaml'] = f['capabilities/capc/self.yaml'];
    delete f['capabilities/capc/self.yaml'];
  }));
  assert.deepEqual(rules(rootless), ['capability-root']);
  assert.equal(rootless[0].id, 'capabilities/capc/');
  assert.match(rootless[0].message, /has no root self\.yaml/);
  assert.equal(storeOf(BASE()).treeByName.get('capabilities/capc').purpose, 'The capc rule.');
});

test('a contract.yaml anywhere in the store is a retired file — a hard error', () => {
  for (const rel of [`capabilities/capc/${RETIRED_CONTRACT}`, `product/app/${RETIRED_CONTRACT}`, `models/${RETIRED_CONTRACT}`]) {
    const errors = errorsFor(edit((f) => { f[rel] = { capability: 'capc', purpose: 'x' }; }));
    assert.deepEqual(errors.map((e) => [e.id, e.rule]), [[rel, 'retired-file']], rel);
    assert.match(errors[0].message, /retired — a capability's root node states what an includer takes on/);
  }
  onDisk({ ...BASE(), [RETIRED_CONTRACT]: 'a: 1\n', [`capabilities/capb/${RETIRED_CONTRACT}`]: 'a: 1\n' }, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^ {2}contract\.yaml \[retired-file\]/m, 'beside the roots too');
    assert.match(r.stderr, /^ {2}capabilities\/capb\/contract\.yaml \[retired-file\]/m);
  });
});

test('capability dependencies come from includes inside capability trees, and are one-way: an include cycle fails, naming the loop', () => {
  assert.deepEqual([...capabilityDependencies(storeOf(BASE()))].map(([a, m]) => [a, [...m.keys()]]), [['capa', ['capb']]],
    'only a capability node\'s include is a dependency — the app root including capa is not');
  const f = edit((x) => { x['capabilities/capb/self.yaml'].includes = ['capa']; });
  const errors = errorsFor(f);
  assert.deepEqual(rules(errors), ['capability-cycle']);
  assert.match(errors[0].message, /capa → capb → capa/);
  assert.deepEqual(capabilityCycles(capabilityDependencies(storeOf(BASE()))), []);
});

test('reach overclaim is a warning on product decisions below the app root', () => {
  const s = storeOf(edit((f) => { f['product/app/sibling.yaml'].decision = 'Holds in every tool.'; }));
  assert.deepEqual(validate(s), []);
  assert.deepEqual(warn(s).map((w) => [w.id, w.rule]), [['app:sibling', 'reach-overclaim']]);
  assert.deepEqual(reachOverclaims({ ...s.byId.get('story:app'), decision: 'everywhere' }), [], 'the app root reaches the whole app');
});

test('a directory beside the roots is an error, and a reappearing interactions/ says where events went', () => {
  onDisk({ ...BASE(), 'adroit/x.yaml': node('eng:x', 'X'), 'interactions/y.yaml': 'a: 1\n' }, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /adroit\/ \[root\] is not a ledger root/);
    assert.match(r.stderr, /interactions\/ \[root\].*machine-local telemetry/);
  });
});

test('a file the YAML parser refuses names itself, and the rest of the ledger is still validated', () => {
  onDisk({ ...BASE(), 'product/app/broken.yaml': 'name: [unterminated\n', 'engineering/also-broken.yaml': 'id: : x\n',
    'product/app/sibling.yaml': { ...BASE()['product/app/sibling.yaml'], includes: ['nope'] } }, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /product\/app\/broken\.yaml \[unreadable\] could not be parsed — line 1: unterminated flow sequence/);
    assert.match(r.stderr, /engineering\/also-broken\.yaml \[unreadable\]/, 'every unreadable file is named, not only the first');
    assert.match(r.stderr, /product\/app\/sibling\.yaml \[includes\]/, 'a fault in a readable file is still found');
  });
});

// ---------------------------------------------------------------------------
// The interaction log
// ---------------------------------------------------------------------------

test('the machine-local log is read beside the store, keyed by corpus, and validated line by line', () => {
  onDisk(BASE(), (dir) => {
    const log = interactionLogPath('fixture');
    mkdirSync(dirname(log), { recursive: true });
    const ev = (ts, kind, decisions, note) => JSON.stringify({ ts, src: 's', decisions, kind, note, where: 'w' });
    writeFileSync(log, [
      ev(1, 'resolved-fork', ['app:detail'], 'a fork'),
      ev(2, 'gap', [], 'nothing governed app:sibling'),
      ev(3, 'gap', ['app:detail'], 'closed by a decision'),
      ev(4, 'prevented-change', ['app:detail'], 'bad kind'),
      'not json',
      JSON.stringify({ ts: 5, src: 's', decisions: [], kind: 'prevented', note: 'x'.repeat(201), where: 'w' }),
    ].join('\n') + '\n');
    try {
      const s = loadLedger({ dir });
      assert.equal(s.corpus, 'fixture');
      assert.equal(s.interactions.length, 3);
      assert.deepEqual(s.interactionLog.bad.map((b) => b.line), [4, 5, 6]);
      assert.equal(interactionIndex(s).byDecision.get('app:detail').length, 2);
      const gaps = openGaps(s);
      assert.equal(gaps.length, 1, 'a gap naming the decision it produced is closed');
      assert.deepEqual(gaps[0].cites, ['app:sibling']);
      assert.deepEqual(gaps[0].trees, ['product/app']);
      const r = check(dir);
      assert.equal(r.status, 0, 'a bad line never fails the corpus');
      assert.match(r.stdout, /3 interaction event\(s\), 1 open gap\(s\)/);
      assert.match(r.stdout, /3 bad line\(s\) skipped/);
    } finally {
      rmSync(dirname(log), { recursive: true, force: true });
    }
  });
  assert.deepEqual(INTERACTION_KINDS, ['resolved-fork', 'prevented', 'gap']);
  assert.deepEqual(parseInteractionLog('').events, []);
});

test('citedIds resolves hyphenated and prose-fused ids, and nothing else', () => {
  const s = storeOf(BASE());
  assert.deepEqual(citedIds('see view:thing and app:detail-ish, not app:none or V150', s.byId), ['view:thing', 'app:detail']);
});

// ---------------------------------------------------------------------------
// The semantic diff
// ---------------------------------------------------------------------------

/** A throwaway git repo holding `files`, committed, so a ref exists to diff against. */
function gitFixture(files, fn) {
  return onDisk(files, (dir, root) => {
    // gc/maintenance off: background maintenance races the teardown's recursive delete.
    const git = (...args) => spawnSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const diff = () => spawnSync(process.execPath, [SERVER, '--diff', 'HEAD', '--dir', dir], { encoding: 'utf8' });
    return fn(dir, diff);
  });
}
const put = (dir, rel, body) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), emit(body)); };

test('a diff against an unchanged store reports nothing, and exits 0', () => {
  gitFixture(BASE(), (dir, diff) => {
    const r = diff();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\(no difference\)/);
  });
});

test('the diff reports decisions added, deleted and re-worded, and nodes re-parented, renamed and re-wired', () => {
  gitFixture(BASE(), (dir, diff) => {
    const f = BASE();
    f['product/app/sibling.yaml'].decision = 'A sibling rule, reworded.';
    put(dir, 'product/app/sibling.yaml', f['product/app/sibling.yaml']);
    put(dir, 'product/app/brand-new.yaml', node('app:brand-new', 'Brand new'));
    rmSync(join(dir, 'engineering/a-rule.yaml'));
    // re-parent: one-tool moves from under tools to the app root
    renameSync(join(dir, 'product/app/tools/one-tool'), join(dir, 'product/app/one-tool'));
    // re-wire with no word changed
    put(dir, 'product/app/tools/self.yaml', { ...f['product/app/tools/self.yaml'], includes: ['capc'] });
    const r = diff();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ADDED\n {2}\+ app:brand-new/);
    assert.match(r.stdout, /DELETED\n {2}− eng:a-rule/);
    assert.match(r.stdout, /~ app:sibling\n {6}decision text changed: .*reworded/);
    assert.match(r.stdout, /~ app:one-tool  ⚑ SILENT RE-WIRING\n {6}file: product\/app\/tools\/one-tool\/self\.yaml → product\/app\/one-tool\/self\.yaml\n {6}re-parented: story:tools → story:app/);
    assert.match(r.stdout, /~ story:tools  ⚑ SILENT RE-WIRING\n {6}includes gained capc/);
    assert.match(r.stdout, /~ app:detail\n {6}file: product\/app\/tools\/one-tool\/detail\.yaml → product\/app\/one-tool\/detail\.yaml\n/,
      'a moved child is a path change, not a re-parent — its parent node is the same node');
    assert.match(r.stdout, /SUMMARY: 3 decision\(s\) touched, 3 node\(s\) changed\./);
  });
});

test('the diff reads the host-record format at a ref, so it compares across both format changes', () => {
  const legacy = {
    'domains.yaml': { corpus: 'fixture', app: 'The app.' },
    'product/app/self.yaml': {
      id: 'story:app', decision: 'A person runs the app.', rejected: [],
      peers: { 'app:on-phone': { decision: 'Every surface works on a phone.' } },
      links: { domain: 'app' }, context: 'w',
    },
    'product/app/app.child.yaml': { id: 'app:child', decision: 'A child.', rejected: [], links: { domain: 'app' }, context: 'c' },
  };
  gitFixture(legacy, (dir, diff) => {
    put(dir, 'product/app/self.yaml', node('story:app', 'App', { decision: 'A person runs the app.', context: 'w' }));
    put(dir, 'product/app/on-phone.yaml', node('app:on-phone', 'On phone', { decision: 'Every surface works on a phone.' }));
    rmSync(join(dir, 'product/app/app.child.yaml'));
    put(dir, 'product/app/child.yaml', node('app:child', 'Child', { decision: 'A child.', context: 'c' }));
    const r = diff();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /SUMMARY: 1 decision\(s\) touched, 1 node\(s\) changed\./, 'no decision moved a word — the peer only moved file');
    assert.doesNotMatch(r.stdout, /decision text changed/);
    assert.match(r.stdout, /~ app:on-phone\n {6}moved from node story:app to node app:on-phone/);
    assert.match(r.stdout, /~ app:child\n {6}file: product\/app\/app\.child\.yaml → product\/app\/child\.yaml/);
  });
});

test('the diff reads the decision-list format at a ref: a split-out peer is a move, a hoisted leaf a path change', () => {
  const listed = {
    'domains.yaml': { corpus: 'fixture', app: 'The app.' },
    'product/app/self.yaml': { name: 'App', decisions: [{ id: 'story:app', decision: 'A person runs the app.' },
      { id: 'app:on-phone', decision: 'Every surface works on a phone.', rejected: ['desktop only'] }], context: 'why' },
    'product/app/leaf.yaml': { name: 'Leaf', decisions: [{ id: 'app:leaf', decision: 'A leaf.' }, { id: 'app:leaf-peer', decision: 'Its peer.' }] },
  };
  gitFixture(listed, (dir, diff) => {
    put(dir, 'product/app/self.yaml', node('story:app', 'App', { decision: 'A person runs the app.', context: 'why' }));
    put(dir, 'product/app/on-phone.yaml', node('app:on-phone', 'On phone', { decision: 'Every surface works on a phone.', rejected: ['desktop only'] }));
    rmSync(join(dir, 'product/app/leaf.yaml'));
    put(dir, 'product/app/leaf/self.yaml', node('app:leaf', 'Leaf', { decision: 'A leaf.' }));
    put(dir, 'product/app/leaf/leaf-peer.yaml', node('app:leaf-peer', 'Leaf peer', { decision: 'Its peer.' }));
    const r = diff();
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /ADDED|DELETED|decision text changed|rejected (grew|shrank)/, 'no decision lost, gained or re-worded');
    assert.match(r.stdout, /~ app:on-phone\n {6}moved from node story:app to node app:on-phone/);
    assert.match(r.stdout, /~ app:leaf-peer\n {6}moved from node app:leaf to node app:leaf-peer/);
    assert.match(r.stdout, /~ app:leaf\n {6}file: product\/app\/leaf\.yaml → product\/app\/leaf\/self\.yaml/);
    assert.match(r.stdout, /SUMMARY: 2 decision\(s\) touched, 1 node\(s\) changed\./);
  });
});

test('a bad ref is a git error, not an empty diff', () => {
  gitFixture(BASE(), (dir) => {
    const r = spawnSync(process.execPath, [SERVER, '--diff', 'no-such-ref', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /git error comparing against 'no-such-ref'/);
  });
});

test('compactTextChange quotes only what moved', () => {
  assert.equal(compactTextChange('Each listing has one hero card.', 'Every listing has one hero card.'), '"Each" → "Every"…',
    'cuts snap to word boundaries');
  assert.equal(compactTextChange('A long shared prefix and then one word changed at the end.', 'A long shared prefix and then one word swapped at the end.'),
    '…"changed" → "swapped"…');
  assert.equal(compactTextChange('same', 'same'), null);
});

// ---------------------------------------------------------------------------
// The explorer
// ---------------------------------------------------------------------------

test('the hierarchy is the filesystem: nodes nest under their parent node, groups per tree', () => {
  const t = treeIndex(storeOf(BASE()));
  assert.deepEqual(t.roots.map((r) => r.key), ['product', 'capabilities', 'engineering', 'models']);
  const app = t.roots[0].children.find((g) => g.tree === 'product/app');
  assert.equal(app.children.length, 1, 'the app root node holds the app');
  const root = app.children[0];
  assert.equal(root.name, 'App');
  assert.equal(root.dubious, true);
  assert.equal(root.questions, 1);
  assert.equal(root.id, 'story:app');
  assert.deepEqual(root.children.map((c) => c.name), ['On phone', 'Sibling', 'Tools']);
  assert.deepEqual(root.children[2].children[0].children.map((c) => c.key), ['product/app/tools/one-tool/detail.yaml']);
  assert.equal(t.nodes, 12);
});

test('a node\'s detail is whole — every field, the notes included, and what is grafted beneath it', () => {
  const s = storeOf(BASE());
  const nd = nodeDetail(s, 'app:detail');
  assert.equal(nd.key, 'product/app/tools/one-tool/detail.yaml');
  assert.deepEqual(nd.grafted, [], 'what an ancestor includes is not grafted beneath this node');
  assert.deepEqual(nd.ancestors.map((a) => a.name), ['App', 'Tools', 'One tool']);
  const root = nodeDetail(s, 'product/app/self.yaml');
  assert.deepEqual(root.grafted, ['capa', 'capb'], 'its own includes, with what they include');
  assert.equal(root.dubious, 'the phone decision may no longer hold');
  assert.deepEqual(root.questions, ['does the free tier still bind?']);
  assert.deepEqual(root.context, 'the app root');
  assert.equal(root.id, 'story:app');
  assert.equal(root.decision, 'A person runs the app.');
  assert.deepEqual(root.rejected, ['a second app']);
  assert.ok(!('decisions' in root) && !('severed' in root) && !('severedHere' in nd));
  const view = nodeDetail(s, 'view:thing');
  assert.equal(view.view, true);
  assert.deepEqual(view.fields, ['id: int', 'at: epoch'], 'a view\'s detail lists its typed fields');
  assert.equal(view.decision, 'A thing as it crosses a boundary.');
  assert.ok(!('tables' in view));
  assert.equal(nodeDetail(s, 'nope'), null);
});

test('a capability reports the nodes that include it — from includes, not from a list', () => {
  const caps = capabilityIndex(storeOf(BASE()));
  const capa = caps.find((c) => c.name === 'capa');
  assert.equal(capa.includerCount, 1);
  assert.deepEqual(capa.includersByTree.map((g) => [g.tree, g.nodes.map((n) => n.name)]), [['product/app', ['App']]]);
  assert.deepEqual(capa.uses.map((u) => u.name), ['capb'], 'a capa node includes capb');
  assert.deepEqual(caps.find((c) => c.name === 'capb').usedBy.map((u) => u.name), ['capa']);
  assert.equal(caps.find((c) => c.name === 'capc').includerCount, 0);
});

test('search finds nodes by every word, across name and decisions', () => {
  const s = storeOf(BASE());
  assert.deepEqual(search(s, { q: 'surface phone' }).map((n) => n.rel), ['product/app/on-phone.yaml']);
  assert.deepEqual(search(s, { q: 'one tool' }).map((n) => n.rel), ['product/app/tools/one-tool/self.yaml']);
});

test('the views\' assets are served from ui/ and from nowhere else', () => {
  const ok = resolveUiAsset('/ui/views.js');
  assert.ok(ok && ok.file.endsWith('/ui/views.js') && ok.type.includes('javascript'));
  assert.ok(resolveUiAsset('/ui/views.css').type.includes('css'));
  assert.equal(resolveUiAsset('/ui/../../../app/shared/index.css'), null, 'walking out');
  assert.equal(resolveUiAsset('/ui/subdir/../../lib.mjs'), null, 'walking out sideways');
  assert.equal(resolveUiAsset('/ui/%2e%2e/%2e%2e/ui/views.css'), null, 'walking out and back in');
  assert.equal(resolveUiAsset('/ui/../server.mjs'), null);
  assert.equal(resolveUiAsset('/ui/views.html'), null, 'a type this server does not serve');
  assert.equal(resolveUiAsset('/ui/nope.css'), null, 'a file that is not there');
  assert.equal(resolveUiAsset('/ui/%zz.css'), null, 'a malformed escape is not a file name');
  assert.equal(resolveUiAsset('/api/tree'), null, 'only the ui/ route resolves here');
});

test('the server answers every endpoint the explorer reads, against the live store', async () => {
  const proc = spawn(process.execPath, [SERVER, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not announce a port')), 20000);
      let out = '';
      proc.stdout.on('data', (chunk) => {
        out += chunk;
        const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
      });
      proc.on('error', reject);
    });
    const get = async (p) => (await fetch(`${base}${p}`)).json();

    assert.match(await (await fetch(`${base}/`)).text(), /AdroitViews/, 'the shell loads the views');
    const c = await get('/api/check');
    assert.deepEqual(c.errors, [], 'the live store validates through the server too');
    assert.ok(c.counts.nodes > 0 && c.counts.decisions === c.counts.nodes, 'one decision per node file');

    const tree = await get('/api/tree');
    const ROOTS = ['product', 'capabilities', 'engineering', 'models'];
    assert.deepEqual(tree.roots.map((r) => r.key), ROOTS.filter((r) => existsSync(join(LEDGER, r))));
    const app = tree.roots[0].children[0];
    assert.equal(app.children.length, 1, 'an app tree hangs off its root node');
    assert.ok(app.children[0].name && app.children[0].children.length);
    const someNode = app.children[0].children[0];

    const nd = await get(`/api/node?key=${encodeURIComponent(someNode.key)}`);
    assert.equal(nd.key, someNode.key);
    assert.ok(nd.id && nd.decision && !('decisions' in nd));
    assert.ok(Array.isArray(nd.ancestors) && Array.isArray(nd.children) && Array.isArray(nd.grafted));
    assert.equal((await fetch(`${base}/api/node?key=nope`)).status, 404);

    const hits = await get(`/api/search?q=${encodeURIComponent(someNode.name)}`);
    assert.ok(hits.nodes.some((n) => n.key === someNode.key));

    const caps = await get('/api/capability');
    if (caps.capabilities.length) {
    assert.ok(caps.capabilities.every((x) => x.name && typeof x.nodes === 'number'));
    const one = await get(`/api/capability?name=${encodeURIComponent(caps.capabilities[0].name)}`);
    assert.ok(one.root && one.root.key === `capabilities/${one.name}/self.yaml` && one.root.name
      && one.root.id && one.root.decision);
    assert.ok(Array.isArray(one.includersByTree) && Array.isArray(one.uses) && Array.isArray(one.usedBy));
    }
    assert.equal((await fetch(`${base}/api/capability?name=nope`)).status, 404);

    const erd = await get('/api/erd');
    assert.ok(erd.entities.every((e) => e.kind === 'view' && e.fields.length));
    assert.ok(erd.edges.every((e) => e.source && e.target && ['ref', 'consumes'].includes(e.type)));
    assert.ok(!('schema' in erd), 'the ERD is a catalog of views — no table mapping');

    const css = await fetch(`${base}/ui/views.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.equal((await fetch(`${base}/ui/%2e%2e/server.mjs`)).status, 404);
  } finally {
    proc.kill();
  }
});

// ---------------------------------------------------------------------------
// The ERD: a catalog of the views
// ---------------------------------------------------------------------------

test('a view declares its derivations in its schema fields; the statement convention is the fallback', () => {
  const view = { id: 'view:widget', schema: { fields: { name: 'string — a name', total: 'derived<int> — the sum' } } };
  assert.deepEqual(declaredDerivations(view), ['total']);
  assert.deepEqual(declaredDerivations({ decision: 'CLAIMED — has a live member; LIVE — one predicate.' }), ['CLAIMED', 'LIVE']);
  assert.deepEqual(declaredDerivations({ decision: 'NEVER store this. It is ALWAYS derived.' }), []);
});

test('the ERD draws each view with its typed fields, and the ref and consumes edges between views', () => {
  const s = storeOf(edit((f) => {
    Object.assign(f, TYPED());
    f['models/view.widget.yaml'].links = { consumes: ['view:thing'], grounds: ['principle:fixture-principle'] };
  }));
  const erd = erdData(s);
  assert.deepEqual(Object.keys(erd), ['entities', 'edges'], 'no schema, no tables, no unclaimed list');
  assert.deepEqual(erd.entities.map((e) => e.id), ['view:thing', 'view:widget']);
  const widget = erd.entities.find((e) => e.id === 'view:widget');
  assert.deepEqual(widget.fields.slice(0, 3), [{ name: 'name', type: 'string' }, { name: 'notes', type: 'text' }, { name: 'size', type: 'int' }]);
  assert.deepEqual(widget.derivations, ['total', 'owner']);
  assert.deepEqual(widget.consumers, ['product/app']);
  assert.ok(erd.entities.every((e) => !('tables' in e) && !('unmapped' in e)));
  const edges = erd.edges.map((e) => `${e.source}→${e.target} ${e.type}${e.field ? ` ${e.field}` : ''}`);
  for (const want of ['view:widget→view:thing ref thing', 'view:widget→view:widget ref self', 'view:widget→view:thing ref owner',
    'view:widget→view:widget ref parts', 'view:widget→view:thing ref slots', 'view:widget→view:thing consumes']) {
    assert.ok(edges.includes(want), want);
  }
  assert.ok(!erd.edges.some((e) => e.type === 'grounds'), 'a principle is no box, so grounding draws no edge');
});

test('a path names its tree, and a tree names its short name', () => {
  assert.equal(treeOfPath('capabilities/email/declared-mail-only/self.yaml'), 'capabilities/email');
  assert.equal(treeOfPath('product/shop/checkout/self.yaml'), 'product/shop');
  assert.equal(treeOfPath('engineering/explicit-utc-clock.yaml'), 'engineering');
  assert.equal(cloudOfTree('capabilities/email'), 'email');
  assert.equal(cloudOfTree('product/shop'), 'shop');
  assert.equal(cloudOfTree('models'), 'models');
  assert.equal(SELF, 'self.yaml');
  assert.ok(existsSync(join(LEDGER, 'engineering')), 'the live store really is laid out this way');
});

// ---------------------------------------------------------------------------
// Run from the adopting project
// ---------------------------------------------------------------------------

test('a citation reads as a comment or an annotation, one id or several', () => {
  assert.deepEqual(decisionRefIds('// @DecisionRef ui:edit-offers-clearing — the checkbox'), ['ui:edit-offers-clearing']);
  assert.deepEqual(decisionRefIds('@DecisionRef("cart:guest-checkout")'), ['cart:guest-checkout']);
  assert.deepEqual(decisionRefIds('@DecisionRef({"cart:guest-checkout", "pay:one-processor"})'), ['cart:guest-checkout', 'pay:one-processor']);
  assert.deepEqual(decisionRefIds('mentions @DecisionRef without an id'), []);
});

test('--citations exits 1 naming each cited id that resolves to nothing, run from the project itself', () => {
  onDisk(BASE(), (dir) => {
    const project = join(dir, '..');
    mkdirSync(join(project, 'src', 'deep'), { recursive: true });
    writeFileSync(join(project, 'src', 'a.ts'), '// @DecisionRef story:app — the root\n// @DecisionRef app:gone — stale\n');
    writeFileSync(join(project, 'src', 'B.java'), '@DecisionRef({"story:app", "app:also-gone"})\n');
    const run = () => spawnSync(process.execPath, [SERVER, '--citations'], { cwd: join(project, 'src', 'deep'), encoding: 'utf8',
      env: { ...process.env, ADROIT_LEDGER_DIR: '', ADROIT_PROJECT_DIR: '' } });
    const r = run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /app:gone {2}src\/a\.ts:2/);
    assert.match(r.stderr, /app:also-gone {2}src\/B\.java:1/);
    assert.doesNotMatch(r.stderr, /story:app/);
    writeFileSync(join(project, 'src', 'a.ts'), '// @DecisionRef story:app\n');
    writeFileSync(join(project, 'src', 'B.java'), '@DecisionRef("story:app")\n');
    assert.equal(run().status, 0, 'every citation resolves once the stale ones go');
  });
});
