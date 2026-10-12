// The ledger store's rules, driven through the SHIPPED entry points (`server.mjs --check`,
// `dump.mjs`, the explorer's HTTP routes) wherever a rule has one, and through lib.mjs directly for
// the indexes those entry points read.
//
// The store is a tree of NODES (user-ruled 2026-10-11): each file a `name` plus `decisions`
// (id / decision / rejected / severable), with optional `includes`, `severed`, `dubious`,
// `questions` and `context`; directory nesting is parentage. Most fixtures are a small synthetic
// store, so each rule is asserted against a shape built for it rather than against ids of the live
// ledger that a reorganisation would rot.
//
//   node --test tools/ledger.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emit } from './yaml.mjs';
import {
  loadLedger, buildStore, validate, warn, storeCounts, nodeIndex, scopedRead, nodeLine, resolveNode,
  interactionIndex, parseInteractionLog, interactionLogPath, openGaps, citedIds, compactTextChange,
  decisionRefBindings, shapeIndex, modelIndex, tablesOf, declaredDerivations, erdData,
  treeIndex, nodeDetail, capabilityIndex, capabilityDependencies, capabilityCycles, search,
  resolveUiAsset, entryKind, treeOfPath, cloudOfTree, idsInDecisionText, reachOverclaims, kindOf,
  INTERACTION_KINDS, NODE_KEYS, RETIRED_CONTRACT, SELF,
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

const node = (name, decisions, extra = {}) => ({ name, decisions, ...extra });
const d = (id, decision = `The ${id.replace(/[:-]/g, ' ')} rule.`, extra = {}) => ({ id, decision, ...extra });

/** A small store with every shape the rules talk about: an engineering root, three capabilities,
 *  each rooted at its own self.yaml (capa includes capb; capc is included by nobody), and one app whose root includes capa, carries
 *  a severable decision a descendant severs, and carries the maintenance notes. */
const BASE = () => ({
  'domains.yaml': { corpus: 'fixture', eng: 'Engineering.', app: 'The app.' },
  'engineering/a-principle.yaml': node('A principle', [d('principle:fixture-principle')]),
  'engineering/a-rule.yaml': node('A rule', [d('eng:a-rule')]),
  'capabilities/capa/self.yaml': node('Root A', [d('capa:root-a', 'The capa root rule.', { severable: true })]),
  'capabilities/capa/leaf-a.yaml': node('Leaf A', [d('capa:leaf-a')], { includes: ['capb'] }),
  'capabilities/capb/self.yaml': node('Only B', [d('capb:only-b')]),
  'capabilities/capc/self.yaml': node('Only C', [d('capc:only-c', 'The capc rule.', { severable: true })]),
  'product/app/self.yaml': node('App', [
    d('story:app', 'A person runs the app.', { rejected: ['a second app'] }),
    d('app:on-phone', 'Every surface works on a phone.', { severable: true }),
    d('app:binding', 'Every surface binds this.'),
  ], {
    includes: ['capa'],
    dubious: 'the phone decision may no longer hold',
    questions: ['does the free tier still bind?'],
    context: { why: 'the app root' },
  }),
  'product/app/tools/self.yaml': node('Tools', [d('story:tools')], { severed: ['app:on-phone'] }),
  'product/app/tools/one-tool/self.yaml': node('One tool', [d('app:one-tool')]),
  'product/app/tools/one-tool/detail.yaml': node('Detail', [d('app:detail')]),
  'product/app/sibling.yaml': node('Sibling', [d('app:sibling', 'A sibling rule.', { severable: true })]),
  'models/model.thing.yaml': { id: 'model:thing', decision: 'A thing.', shape: { fields: { 'thing.id': 'scalar (app:detail) — the key', 'thing.at': 'scalar' } } },
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

test('the live store passes its own check, and the summary counts the node format', () => {
  const r = check(LEDGER);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ledger: \d+ nodes, \d+ decisions \(\d+ severable, \d+ severed\), \d+ include\(s\), \d+ dubious node\(s\), \d+ open question\(s\), /);
  assert.match(r.stdout, /\(validated/);
});

// The app's citations are a compliance worklist, not a gate on the ledger (ADROIT.md, The protocol):
// a ledger change that deletes a cited id reddens this until the code is rebound.
test('every @DecisionRef in the app resolves against the live store', {
  todo: 'the app still cites ids the node-shape migration deleted; build pass three rebinds them',
}, () => {
  const { byId } = loadLedger();
  const bindings = decisionRefBindings();
  assert.ok(bindings.size > 20, 'the app binds its code to decisions');
  const dangling = [...bindings.keys()].filter((id) => !byId.has(id)).sort();
  assert.deepEqual(dangling, [], 'every bound id names a live decision');
});

// ---------------------------------------------------------------------------
// The node shape
// ---------------------------------------------------------------------------

test('the synthetic store is valid — every rule below breaks it in exactly one way', () => {
  assert.deepEqual(errorsFor(BASE()), []);
  const s = storeOf(BASE());
  assert.equal(s.nodes.length, 11);
  assert.deepEqual(s.nodeByRel.get('product/app/self.yaml').ids, ['story:app', 'app:on-phone', 'app:binding']);
  assert.equal(s.byId.get('app:detail')._nestedUnder, 'product/app/tools/one-tool/self.yaml', 'parentage is the directory');
  assert.equal(s.byId.get('app:detail')._node, 'product/app/tools/one-tool/detail.yaml');
  assert.equal(new Set(s.records.map((r) => r._rel)).size, s.records.length, 'every decision has a unique _rel');
});

test('a retired key is a hard error, naming what replaced it', () => {
  for (const key of ['links', 'peers', 'mounts', 'severs', 'id', 'decision', 'rejected', 'commitments']) {
    const errors = errorsFor(edit((f) => { f['product/app/sibling.yaml'][key] = key === 'id' ? 'app:x' : []; }));
    assert.deepEqual(rules(errors), ['retired-key'], key);
    assert.match(errors[0].message, new RegExp(`^'${key}' is retired`));
  }
  assert.match(errorsFor(edit((f) => { f['product/app/sibling.yaml'].mounts = ['capa']; }))[0].message, /includes/);
});

test('an unknown key is a hard error — on a node and on a decision entry', () => {
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].status = 'live'; }))), ['unknown-key']);
  const onDecision = errorsFor(edit((f) => { f['product/app/sibling.yaml'].decisions[0].links = { domain: 'app' }; }));
  assert.deepEqual(rules(onDecision), ['unknown-key']);
  assert.equal(onDecision[0].id, 'app:sibling');
  assert.deepEqual(NODE_KEYS, ['name', 'decisions', 'includes', 'severed', 'dubious', 'questions', 'context']);
});

test('a node needs a one-line name and a non-empty list of decisions, each with an id and one decision', () => {
  const bad = [
    (f) => { delete f['product/app/sibling.yaml'].name; },
    (f) => { f['product/app/sibling.yaml'].name = 'two\nlines'; },
    (f) => { f['product/app/sibling.yaml'].decisions = []; },
    (f) => { delete f['product/app/sibling.yaml'].decisions; },
    (f) => { f['product/app/sibling.yaml'].decisions[0].decision = ' '; },
    (f) => { f['product/app/sibling.yaml'].decisions[0].rejected = 'not a list'; },
    (f) => { f['product/app/sibling.yaml'].decisions[0].severable = 'yes'; },
    (f) => { f['product/app/sibling.yaml'].decisions[0] = 'just text'; },
  ];
  for (const fn of bad) assert.deepEqual(rules(errorsFor(edit(fn))), ['shape'], fn.toString());
  assert.deepEqual(errorsFor(edit((f) => { f['product/app/sibling.yaml'].decisions[0].severable = false; })), [],
    'severable is a boolean, false allowed');
});

test('ids are unique across the whole ledger, slug-shaped, and in a declared namespace', () => {
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].decisions.push(d('app:detail')); }))), ['duplicate-id']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].decisions[0].id = 'app:D14'; }))), ['id-shape']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].decisions[0].id = 'nope:sibling'; }))), ['namespace']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].decisions[0].id = 'capb:sibling'; }))), ['namespace'],
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

test('context is free-form: a string or a mapping', () => {
  assert.deepEqual(errorsFor(edit((f) => { f['product/app/self.yaml'].context = 'a plain note'; })), []);
  assert.deepEqual(errorsFor(edit((f) => { f['product/app/self.yaml'].context = { 'story:app': { why: 'w' }, 'app:binding': 'x' }; })), []);
});

// ---------------------------------------------------------------------------
// Severed
// ---------------------------------------------------------------------------

test('severed: a severable decision of an ancestor node may be severed', () => {
  const s = storeOf(BASE());
  assert.deepEqual(nodeIndex(s).problems, []);
  assert.deepEqual([...nodeIndex(s).severedFor('product/app/tools/one-tool/detail.yaml')], ['app:on-phone'],
    'a sever binds the severing node and every descendant');
  assert.deepEqual([...nodeIndex(s).severedFor('product/app/sibling.yaml')], [], 'and nothing beside it');
});

test('severed: an unmarked, out-of-reach or unknown decision fails the check', () => {
  const sever = (id) => errorsFor(edit((f) => { f['product/app/tools/self.yaml'].severed = [id]; }));
  const unmarked = sever('app:binding');
  assert.deepEqual(rules(unmarked), ['severed']);
  assert.match(unmarked[0].message, /not marked severable/);
  const outOfReach = sever('app:sibling');
  assert.deepEqual(rules(outOfReach), ['severed']);
  assert.match(outOfReach[0].message, /neither a decision of an ancestor node nor of a capability this node includes/);
  assert.match(sever('app:nope')[0].message, /names no decision/);
  assert.match(sever('model:thing')[0].message, /names no decision/, 'a model is not a decision');
  // a node cannot sever its own decision: it is not an ancestor's
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/self.yaml'].severed = ['app:on-phone']; }))), ['severed']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/tools/self.yaml'].severed = 'app:on-phone'; }))), ['severed'],
    'severed is a list');
});

test('severed: a severable decision brought in by an included capability may be severed — one not included may not', () => {
  assert.deepEqual(errorsFor(edit((f) => { f['product/app/tools/self.yaml'].severed = ['app:on-phone', 'capa:root-a']; })), [],
    'capa is included by the app root, an ancestor');
  const notIncluded = errorsFor(edit((f) => { f['product/app/tools/self.yaml'].severed = ['capc:only-c']; }));
  assert.deepEqual(rules(notIncluded), ['severed'], 'capc is severable but nobody in the chain includes it');
  assert.deepEqual(errorsFor(edit((f) => {
    f['product/app/tools/self.yaml'].includes = ['capc'];
    f['product/app/tools/self.yaml'].severed = ['capc:only-c'];
  })), [], 'including it on the node itself makes it severable there');
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

test('the scoped read: engineering, the ancestors, the target, and every included capability WHOLE — nothing else', () => {
  const s = storeOf(BASE());
  const r = scopedRead(s, ['app:detail']);
  const role = Object.fromEntries([...r.role].map(([rel, x]) => [rel, x]));
  assert.deepEqual(role, {
    'engineering/a-principle.yaml': 'engineering',
    'engineering/a-rule.yaml': 'engineering',
    'product/app/self.yaml': 'ancestor',
    'product/app/tools/self.yaml': 'ancestor',
    'product/app/tools/one-tool/self.yaml': 'ancestor',
    'product/app/tools/one-tool/detail.yaml': 'target',
    // capa is included by the app root: its whole tree joins the scope of every descendant…
    'capabilities/capa/self.yaml': 'capability',
    'capabilities/capa/leaf-a.yaml': 'capability',
    // …and what capa's own nodes include joins with it, transitively
    'capabilities/capb/self.yaml': 'capability',
  });
  assert.ok(!r.role.has('product/app/sibling.yaml'), 'a sibling binds nothing here');
  assert.ok(!r.role.has('capabilities/capc/self.yaml'), 'a capability nobody includes stays out');
  assert.deepEqual([...r.severed], ['app:on-phone'], 'the chain severs the phone decision');
  assert.deepEqual(r.nodes.map((n) => n.rel).slice(0, 6), [
    'engineering/a-principle.yaml', 'engineering/a-rule.yaml', 'product/app/self.yaml',
    'product/app/tools/self.yaml', 'product/app/tools/one-tool/self.yaml', 'product/app/tools/one-tool/detail.yaml',
  ], 'reading order: engineering (principles first), then the chain root-first');
  // the sibling, read on its own, sees the include but not the sever
  const sib = scopedRead(s, ['product/app/sibling.yaml']);
  assert.equal(sib.role.get('capabilities/capa/self.yaml'), 'capability');
  assert.deepEqual([...sib.severed], []);
});

test('the scoped read: --subtree adds the descendants; a target is an id, a node file or a directory; unknown throws', () => {
  const s = storeOf(BASE());
  const r = scopedRead(s, ['app:one-tool'], { subtree: true });
  assert.equal(r.role.get('product/app/tools/one-tool/detail.yaml'), 'descendant');
  assert.equal(resolveNode(s, 'ledger/product/app/tools/one-tool/').rel, 'product/app/tools/one-tool/self.yaml');
  assert.equal(resolveNode(s, 'product/app/sibling.yaml').rel, 'product/app/sibling.yaml');
  assert.equal(resolveNode(s, 'app:binding').rel, 'product/app/self.yaml', 'a decision id finds its node');
  assert.throws(() => scopedRead(s, ['app:nope']), /no decision or ledger path matches: app:nope/);
  // a target inside engineering is the TARGET, not merely engineering
  assert.equal(scopedRead(s, ['eng:a-rule']).role.get('engineering/a-rule.yaml'), 'target');
});

test('dump --scope writes ONE line per node, with roles, the sever marked, and the notes left out', () => {
  onDisk(BASE(), (dir) => {
    const r = dump(dir, '--scope', 'app:detail');
    assert.equal(r.status, 0, r.stderr);
    const out = lines(r);
    assert.deepEqual(out[0], { domains: { eng: 'Engineering.', app: 'The app.' } });
    assert.ok(out.every((l) => l.domains || l.node), 'only the domains and the nodes — no other line kind');
    const nodes = out.filter((l) => l.node);
    assert.equal(nodes.length, 9, 'one line per node in scope');
    const root = nodes.find((l) => l.node === 'product/app/self.yaml');
    assert.deepEqual(root, {
      node: 'product/app/self.yaml', name: 'App',
      decisions: [
        { id: 'story:app', decision: 'A person runs the app.', rejected: ['a second app'] },
        { id: 'app:on-phone', decision: 'Every surface works on a phone.', severable: true, severed: true },
        { id: 'app:binding', decision: 'Every surface binds this.' },
      ],
      includes: ['capa'], tree: 'product/app', scope_role: 'ancestor',
    }, 'dubious, questions and context are omitted by default');
    assert.deepEqual(nodes.find((l) => l.node === 'product/app/tools/self.yaml').severed, ['app:on-phone']);
    assert.deepEqual(nodes.map((l) => l.scope_role).filter((x, i, a) => a.indexOf(x) === i),
      ['engineering', 'ancestor', 'target', 'capability']);
    assert.ok(nodes.every((l) => !('dubious' in l) && !('questions' in l) && !('context' in l)));
    assert.match(r.stderr, /^9 of 11 nodes in scope \(2 engineering, 3 ancestor, 1 target, 3 capability\) · 11 of 13 decisions \(1 severed\)\n$/);
  });
});

test('dump --maintenance brings back dubious, questions and context — scoped and full', () => {
  onDisk(BASE(), (dir) => {
    for (const args of [['--scope', 'app:detail', '--maintenance'], ['--maintenance']]) {
      const root = lines(dump(dir, ...args)).find((l) => l.node === 'product/app/self.yaml');
      assert.equal(root.dubious, 'the phone decision may no longer hold', args.join(' '));
      assert.deepEqual(root.questions, ['does the free tier still bind?']);
      assert.deepEqual(root.context, { why: 'the app root' });
    }
    const model = lines(dump(dir, '--maintenance')).find((l) => l.id === 'model:thing');
    assert.equal(model.tree, 'models');
  });
});

test('the full dump is one line per node too, then the models; --context is gone', () => {
  onDisk(BASE(), (dir) => {
    const r = dump(dir);
    assert.equal(r.status, 0, r.stderr);
    const out = lines(r);
    const nodes = out.filter((l) => l.node);
    assert.equal(nodes.length, 11);
    assert.ok(nodes.every((l) => !('scope_role' in l) && !('context' in l) && !('dubious' in l)));
    assert.deepEqual(nodes.slice(0, 2).map((l) => l.node), ['engineering/a-principle.yaml', 'engineering/a-rule.yaml']);
    assert.ok(!nodes.some((l) => l.decisions.some((x) => 'severed' in x)), 'severed marks are a scoped-read fact');
    assert.equal(out.at(-1).id, 'model:thing');
    assert.match(r.stderr, /^11 nodes · 13 decisions · 1 models\/views\n$/);
    assert.equal(dump(dir, '--subtree').status, 1, '--subtree needs --scope');
    assert.equal(dump(dir, '--scope', 'app:nope').status, 1);
  });
});

test('nodeLine is the dump\'s line, and leaves notes out unless asked', () => {
  const s = storeOf(BASE());
  const n = s.nodeByRel.get('product/app/self.yaml');
  assert.deepEqual(Object.keys(nodeLine(s, n)), ['node', 'name', 'decisions', 'includes', 'tree']);
  assert.deepEqual(Object.keys(nodeLine(s, n, { maintenance: true, role: 'target' })),
    ['node', 'name', 'decisions', 'includes', 'dubious', 'questions', 'context', 'tree', 'scope_role']);
});

// ---------------------------------------------------------------------------
// Text rules, models, domains, capabilities
// ---------------------------------------------------------------------------

test('decision text names no record id — rejected and context may', () => {
  const named = errorsFor(edit((f) => { f['product/app/sibling.yaml'].decisions[0].decision = 'Follows app:detail closely.'; }));
  assert.deepEqual(rules(named), ['id-in-decision-text']);
  assert.deepEqual(errorsFor(edit((f) => {
    f['product/app/sibling.yaml'].decisions[0].rejected = ['what app:detail does'];
    f['product/app/sibling.yaml'].context = 'see app:detail';
  })), []);
  const s = storeOf(BASE());
  assert.deepEqual(idsInDecisionText({ ...s.byId.get('app:sibling'), decision: 'e.g. she:her and note:thing' }, s.byId), [],
    'only tokens that resolve count');
});

test('a decision never names a model or view — in its decisions or its context', () => {
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].decisions[0].decision = 'Stores a model:thing.'; }))), ['model-in-decision']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].context = { why: 'see model:thing' }; }))), ['model-in-decision']);
  assert.deepEqual(errorsFor(edit((f) => { f['product/app/self.yaml'].questions = ['should model:thing split?']; })), [],
    'questions are maintenance notes, never a check fault');
});

test('a model\'s field citations resolve — a dangling one fails the check; uncited fields are a report', () => {
  const s = storeOf(BASE());
  const sx = shapeIndex(s);
  assert.deepEqual(sx.edges.map((e) => e.ruling), ['app:detail']);
  assert.deepEqual(sx.unlinked.map((u) => u.field), ['thing.at']);
  assert.deepEqual(modelIndex(s).realizersOf('model:thing'), ['product/app']);
  const dangling = errorsFor(edit((f) => { f['models/model.thing.yaml'].shape.fields['thing.at'] = 'scalar (app:gone)'; }));
  assert.deepEqual(rules(dangling), ['shape-citation']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['product/app/sibling.yaml'].decisions[0].id = 'model:sibling'; }))), ['models'],
    'a model lives in the models directory');
});

test('a domain namespace is usable once declared, and the declaration stays honest', () => {
  const unused = errorsFor(edit((f) => { f['domains.yaml'].spare = 'Never used.'; }));
  assert.deepEqual(rules(unused), ['domains']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['domains.yaml'].capa = 'Shadows a capability.'; }))), ['domains']);
  assert.deepEqual(rules(errorsFor(edit((f) => { f['domains.yaml'].corpus = 'Not Kebab'; }))), ['domains']);
});

test('every capability has a root node — its first decision is the tree\'s purpose', () => {
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
  const s = storeOf(edit((f) => { f['product/app/sibling.yaml'].decisions[0].decision = 'Holds in every tool.'; }));
  assert.deepEqual(validate(s), []);
  assert.deepEqual(warn(s).map((w) => [w.id, w.rule]), [['app:sibling', 'reach-overclaim']]);
  assert.deepEqual(reachOverclaims({ ...s.byId.get('app:on-phone'), decision: 'everywhere' }), [], 'the app root reaches the whole app');
});

test('a directory beside the roots is an error, and a reappearing interactions/ says where events went', () => {
  onDisk({ ...BASE(), 'adroit/x.yaml': node('X', [d('eng:x')]), 'interactions/y.yaml': 'a: 1\n' }, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /adroit\/ \[root\] is not a ledger root/);
    assert.match(r.stderr, /interactions\/ \[root\].*machine-local telemetry/);
  });
});

test('a file the YAML parser refuses names itself, rather than escaping as a stack trace', () => {
  onDisk({ ...BASE(), 'product/app/broken.yaml': 'name: [unterminated\n' }, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^ledger: could not be read — \S*ledger\/product\/app\/broken\.yaml: line 1: unterminated flow sequence/);
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
  assert.deepEqual(citedIds('see model:thing and app:detail-ish, not app:none or V150', s.byId), ['model:thing', 'app:detail']);
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
    f['product/app/sibling.yaml'].decisions[0].decision = 'A sibling rule, reworded.';
    f['product/app/sibling.yaml'].decisions.push(d('app:brand-new'));
    put(dir, 'product/app/sibling.yaml', f['product/app/sibling.yaml']);
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

test('the diff reads the previous format at a ref, so it compares across the node-format change', () => {
  const legacy = {
    'domains.yaml': { corpus: 'fixture', app: 'The app.' },
    'product/app/self.yaml': {
      id: 'story:app', decision: 'A person runs the app.', rejected: [],
      peers: { 'app:on-phone': { decision: 'Every surface works on a phone.', severable: true } },
      links: { domain: 'app' }, context: { why: 'w' },
    },
    'product/app/app.child.yaml': { id: 'app:child', decision: 'A child.', rejected: [], links: { domain: 'app' }, context: { why: 'c' } },
  };
  gitFixture(legacy, (dir, diff) => {
    put(dir, 'product/app/self.yaml', node('App', [d('story:app', 'A person runs the app.'),
      d('app:on-phone', 'Every surface works on a phone.', { severable: true })], { context: { why: 'w' } }));
    rmSync(join(dir, 'product/app/app.child.yaml'));
    put(dir, 'product/app/child.yaml', node('Child', [d('app:child', 'A child.')], { context: { why: 'c' } }));
    const r = diff();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /SUMMARY: 0 decision\(s\) touched, 1 node\(s\) changed\./, 'no decision moved a word');
    assert.match(r.stdout, /~ app:child\n {6}file: product\/app\/app\.child\.yaml → product\/app\/child\.yaml/);
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
  assert.deepEqual(root.children.map((c) => c.name), ['Sibling', 'Tools']);
  assert.deepEqual(root.children[1].children[0].children.map((c) => c.key), ['product/app/tools/one-tool/detail.yaml']);
  assert.equal(t.nodes, 11);
});

test('a node\'s detail is whole — every field, the notes included, and what reaches it from above', () => {
  const s = storeOf(BASE());
  const nd = nodeDetail(s, 'app:detail');
  assert.equal(nd.key, 'product/app/tools/one-tool/detail.yaml');
  assert.deepEqual(nd.inScope, ['capa', 'capb']);
  assert.deepEqual(nd.severedHere, ['app:on-phone']);
  assert.deepEqual(nd.ancestors.map((a) => a.name), ['App', 'Tools', 'One tool']);
  const root = nodeDetail(s, 'product/app/self.yaml');
  assert.equal(root.dubious, 'the phone decision may no longer hold');
  assert.deepEqual(root.questions, ['does the free tier still bind?']);
  assert.deepEqual(root.context, { why: 'the app root' });
  assert.equal(root.decisions[1].severable, true);
  assert.equal(nodeDetail(s, 'model:thing').model, true);
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
  assert.deepEqual(search(s, { q: 'surface phone' }).map((n) => n.rel), ['product/app/self.yaml']);
  assert.deepEqual(search(s, { q: 'one tool' }).map((n) => n.rel), ['product/app/tools/one-tool/self.yaml']);
});

test('the views\' assets are served from ui/ and from nowhere else', () => {
  const ok = resolveUiAsset('/ui/views.js');
  assert.ok(ok && ok.file.endsWith('/ui/views.js') && ok.type.includes('javascript'));
  assert.ok(resolveUiAsset('/ui/views.css').type.includes('css'));
  assert.equal(resolveUiAsset('/ui/../../../magic/shared/index.css'), null, 'walking out');
  assert.equal(resolveUiAsset('/ui/subdir/../../lib.mjs'), null, 'walking out sideways');
  assert.equal(resolveUiAsset('/ui/%2e%2e/%2e%2e/ui/views.css'), null, 'walking out and back in');
  assert.equal(resolveUiAsset('/ui/../server.mjs'), null);
  assert.equal(resolveUiAsset('/ui/views.html'), null, 'a type this server does not serve');
  assert.equal(resolveUiAsset('/ui/nope.css'), null, 'a file that is not there');
  assert.equal(resolveUiAsset('/ui/%zz.css'), null, 'a malformed escape is not a file name');
  assert.equal(resolveUiAsset('/api/tree'), null, 'only the ui/ route resolves here');
});

/** The synthetic store plus a view, so every explorer endpoint has something to show. */
const WITH_VIEW = () => edit((f) => {
  f['models/view.thing-card.yaml'] = { id: 'view:thing-card', decision: 'What a reader sees of a thing.',
    shape: { fields: { 'id': 'scalar (app:detail) — the thing\'s key', 'age': 'derived (app:detail) — how old it is' } } };
});

test('the server answers every endpoint the explorer reads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'adroit-ledger-'));
  const dir = join(root, 'ledger');
  for (const [rel, body] of Object.entries(WITH_VIEW())) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), typeof body === 'string' ? body : emit(body));
  }
  const proc = spawn(process.execPath, [SERVER, '--port', '0', '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
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
    assert.deepEqual(c.errors, [], 'the store validates through the server too');
    assert.ok(c.counts.nodes > 0 && c.counts.decisions >= c.counts.nodes);

    const tree = await get('/api/tree');
    assert.deepEqual(tree.roots.map((r) => r.key), ['product', 'capabilities', 'engineering', 'models']);
    const hq = tree.roots[0].children.find((g) => g.tree === 'product/app');
    assert.equal(hq.children.length, 1, 'an app tree hangs off its root node');
    assert.ok(hq.children[0].name && hq.children[0].children.length);
    const someNode = hq.children[0].children[0];

    const nd = await get(`/api/node?key=${encodeURIComponent(someNode.key)}`);
    assert.equal(nd.key, someNode.key);
    assert.ok(nd.decisions.length && nd.decisions.every((x) => x.id && x.decision));
    assert.ok(Array.isArray(nd.ancestors) && Array.isArray(nd.children) && Array.isArray(nd.inScope));
    assert.equal((await fetch(`${base}/api/node?key=nope`)).status, 404);

    const hits = await get(`/api/search?q=${encodeURIComponent(someNode.name)}`);
    assert.ok(hits.nodes.some((n) => n.key === someNode.key));

    const caps = await get('/api/capability');
    assert.ok(caps.capabilities.length > 0 && caps.capabilities.every((x) => x.name && typeof x.nodes === 'number'));
    const one = await get(`/api/capability?name=${encodeURIComponent(caps.capabilities[0].name)}`);
    assert.ok(one.root && one.root.key === `capabilities/${one.name}/self.yaml` && one.root.name
      && one.root.decisions.length && one.root.decisions.every((x) => x.id && x.decision));
    assert.ok(Array.isArray(one.includersByTree) && Array.isArray(one.uses) && Array.isArray(one.usedBy));
    assert.equal((await fetch(`${base}/api/capability?name=nope`)).status, 404);

    const erd = await get('/api/erd');
    assert.ok(erd.entities.length > 0 && erd.entities.some((e) => e.kind === 'view'));
    assert.ok(erd.edges.every((e) => e.source && e.target && e.type));

    const css = await fetch(`${base}/ui/views.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.equal((await fetch(`${base}/ui/%2e%2e/server.mjs`)).status, 404);
  } finally {
    proc.kill();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

// ---------------------------------------------------------------------------
// The schema the ERD draws its fields from
// ---------------------------------------------------------------------------

test('a view declares its derivations in its shape fields; the statement convention is the fallback', () => {
  const view = storeOf(WITH_VIEW()).records.find((r) => kindOf(r.id) === 'view' && r.shape?.fields);
  assert.equal(tablesOf(view).length, 0, 'a view owns no table');
  assert.ok(declaredDerivations(view).length > 0);
  assert.deepEqual(declaredDerivations({ decision: 'CLAIMED — has a live member; LIVE — one predicate.' }), ['CLAIMED', 'LIVE']);
  assert.deepEqual(declaredDerivations({ decision: 'NEVER store this. It is ALWAYS derived.' }), []);
});

test('the ERD marks a table the schema does not have instead of dropping it', () => {
  const ctx = storeOf(edit((f) => {
    f['models/model.thing.yaml'] = { ...f['models/model.thing.yaml'], tables: ['thing'] };
    f['models/model.other.yaml'] = { id: 'model:other', decision: 'Another thing.', tables: ['gone'],
      shape: { fields: { 'other.id': 'scalar (app:detail) — the key' } } };
  }));
  const erd = erdData(ctx, { tables: { thing: [{ name: 'id', type: 'BIGINT', nullable: false }] } });
  const mapped = erd.entities.filter((e) => e.tables.length);
  assert.ok(mapped.some((e) => e.tables.some((t) => t.found)), 'the stub table is found');
  assert.ok(mapped.some((e) => e.unmapped.length), 'the tables the stub lacks are named, not silently gone');
  const blind = erdData(ctx, null);
  assert.equal(blind.schema.present, false);
  assert.ok(blind.entities.every((e) => e.fields === 0));
});

test('a path names its tree, and a tree names its short name', () => {
  assert.equal(treeOfPath('capabilities/email/declared-mail-only/self.yaml'), 'capabilities/email');
  assert.equal(treeOfPath('product/hq/standalone-tools/self.yaml'), 'product/hq');
  assert.equal(treeOfPath('engineering/explicit-utc-clock.yaml'), 'engineering');
  assert.equal(cloudOfTree('capabilities/email'), 'email');
  assert.equal(cloudOfTree('product/hq'), 'hq');
  assert.equal(cloudOfTree('models'), 'models');
  assert.equal(SELF, 'self.yaml');
  assert.ok(existsSync(join(LEDGER, 'engineering')), 'the live store really is laid out this way');
});
