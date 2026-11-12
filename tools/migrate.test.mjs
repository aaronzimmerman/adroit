// The YAML subset the ledger is written in, and the mapping from the previous ledger formats.
//
// The YAML half must be EXACT — a ledger that loses a double space on the way to disk has been
// edited by its own tooling — so the emitter is driven with the strings that break naive quoting,
// and every case asserts a round trip rather than a rendering. The workhorse is the live store:
// every node file must re-emit BYTE-FOR-BYTE from what it parses to.
//
// The mapping half is how a file of a previous format reads as a node: `legacyNode` for the host
// record plus `peers:` (before 2026-10-11), `decisionsOf` for that and for the `decisions:` list
// (2026-10-11 to 2026-10-14). The loader applies them to git refs that predate one-decision-per-file,
// so `--diff` can compare across the changes; the working-tree check refuses both formats.
//
//   node --test tools/migrate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emit, parse, plainSafe, roundTrips, WIDTH } from './yaml.mjs';
import { loadLedger, LEDGER_DIR, legacyNode, mergeContexts, draftName, slugOf, buildStore, validate, decisionsOf, NODE_KEYS } from './lib.mjs';

// ---------------------------------------------------------------------------
// The YAML subset
// ---------------------------------------------------------------------------

/** Round-tripping is the ONLY assertion that matters for a value: what it looks like on disk is
 *  taste, what comes back is correctness. */
const trip = (value, note) => {
  const text = emit(value);
  assert.deepEqual(parse(text), value, `${note ?? JSON.stringify(value)} did not survive:\n${text}`);
  return text;
};

test('every string shape a ledger can hold survives the round trip exactly', () => {
  const strings = [
    '', ' ', '  ', 'plain', 'hello world',
    'multi  space   run', 'trailing space ', ' leading space', 'tab\there', 'carriage\rreturn',
    'line one\nline two', 'line one\nline two\n', 'ends with two\n\n', 'ends with four\n\n\n\n',
    '\nleading newline', 'a\n\nb',
    'colon: in the middle', 'ends with colon:', 'a # hash', '#starts with hash', 'no#space',
    '- starts with dash', '-5', '?question', ':colon', '[bracket', ']bracket', '{brace', '}brace',
    '&anchor', '*alias', '!tag', '|pipe', '>gt', '%percent', '@at', '`tick', "'quote", '"quote"',
    'back\\slash', 'has "quotes" inside', 'emoji 🎭 and é and あ',
    '403', '0', '-0.5', '1e10', '.5', '+7',
    'true', 'false', 'null', '~', 'yes', 'No', 'ON', 'Off', 'True', 'NULL',
    'x'.repeat(300),
    Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '),
    `A long sentence that: contains a colon and ${'and on '.repeat(20)}goes on for ages.`,
    `folded  with  doubles ${'and more words '.repeat(15)}to force a wrap`,
    'indented\n  second line\n    third line',
    'trailing space on a line \nand another',
  ];
  for (const s of strings) trip({ s }, JSON.stringify(s));
  // …and in every position a string can occupy, not only as a mapping value
  for (const s of strings) trip({ arr: [s], deep: { a: { b: [s, s] } } }, `nested ${JSON.stringify(s)}`);
  for (const s of strings) trip(s, `document scalar ${JSON.stringify(s)}`);
});

test('a string that cannot fold or block falls back to double quotes, and stays exact', () => {
  // Multi-space runs and edge whitespace cannot survive folding, so they must not be folded.
  const doubled = `word  with${' padding'.repeat(30)}  doubled`;
  const text = emit({ s: doubled });
  assert.equal(text.includes('>-'), false, 'a string with a double space must never fold');
  assert.deepEqual(parse(text).s, doubled);

  const trailing = `line with a trailing space \nand a second line${' x'.repeat(60)}`;
  const t2 = emit({ s: trailing });
  assert.equal(t2.includes('|'), false, 'a line with trailing space must never become a literal block');
  assert.deepEqual(parse(t2).s, trailing);
});

test('long text folds, multi-line text blocks, and neither is a rendering choice', () => {
  const long = Array.from({ length: 40 }, (_, i) => `token${i}`).join(' ');
  assert.match(emit({ decision: long }), /^decision: >-\n/, 'a long single-line string folds');
  assert.match(emit({ decision: 'one\ntwo' }), /^decision: \|-\n/, 'a multi-line string is a literal block');
  assert.match(emit({ decision: 'one\ntwo\n' }), /^decision: \|\n/, 'one trailing newline is clip chomping');
  assert.match(emit({ decision: 'one\ntwo\n\n\n' }), /^decision: \|\+\n/, 'surplus trailing newlines are kept');
  for (const s of [long, 'one\ntwo', 'one\ntwo\n', 'one\ntwo\n\n\n']) trip({ decision: s });
});

test('no emitted line runs past the width unless a single word does', () => {
  const long = `${'a'.repeat(140)} and then some ordinary words that wrap`;
  for (const line of emit({ k: long }).split('\n')) {
    if (line.includes('a'.repeat(140))) continue; // one unbreakable word is allowed to overrun
    assert.ok([...line].length <= WIDTH, `line too long: ${line}`);
  }
  const words = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
  for (const line of emit({ ctx: { why: words } }).split('\n')) assert.ok([...line].length <= WIDTH, line);
});

test('structure: nesting, empty containers, mixed sequences, and insertion order', () => {
  trip({ a: { b: { c: { d: 'deep' } } } });
  trip({ empty: [], obj: {}, nested: { e: [], o: {} } });
  trip({ seq: [[1, 2], ['a'], []] });
  trip({ seq: [{ a: 1 }, { b: [{ c: 'd' }] }] }, 'a sequence of mappings');
  trip({ mixed: ['short', 'a value that is quite a lot longer than the others and will not fit inline at all', 3, true, null] });
  trip([1, 'two', { three: 3 }]);
  trip([]);
  trip({});
  trip(null);
  trip(42);
  trip(true);

  // Insertion order is part of the value: a ledger record's field order is its shape.
  const order = { id: 'X', decision: 'd', rejected: [], status: 'live', links: { module: 'm' }, context: { why: 'w' } };
  const text = emit(order);
  assert.deepEqual(Object.keys(parse(text)), Object.keys(order));
  assert.deepEqual(text.split('\n').filter((l) => /^\w/.test(l)).map((l) => l.split(':')[0]),
    ['id', 'decision', 'rejected', 'status', 'links', 'context']);
  // An empty array is not an absent one — `rejected: []` says the alternatives were considered.
  assert.match(text, /^rejected: \[\]$/m);
  assert.deepEqual(parse(text).rejected, []);
});

test('keys as adversarial as values', () => {
  for (const k of ['plain', 'with space', 'with:colon', 'with #hash', '403', 'true', '-dash', '', 'é']) {
    trip({ [k]: 'v' }, `key ${JSON.stringify(k)}`);
  }
  trip({ a: 1, b: 2, a2: 3 });
});

test('numbers and booleans keep their types, and strings that look like them keep theirs', () => {
  trip({ n: [0, -1, 2.5, -0.5, 1e21, 1e-7] });
  trip({ b: [true, false], z: null });
  const text = emit({ s: '403', n: 403, t: 'true', b: true });
  assert.equal(parse(text).s, '403');
  assert.equal(parse(text).n, 403);
  assert.equal(parse(text).t, 'true');
  assert.equal(parse(text).b, true);
  assert.throws(() => emit({ n: NaN }), /non-finite/);
  assert.throws(() => emit({ n: Infinity }), /non-finite/);
  assert.throws(() => emit({ d: new Date() }), /cannot emit/);
  assert.throws(() => emit({ u: undefined }), /cannot emit/);
});

test('plainSafe is the parser\'s rules stated from the other side', () => {
  for (const s of ['plain', 'hello world', 'a:b', 'e.g. she/her', 'spec/checkout.spec.md (backfill)']) {
    assert.equal(plainSafe(s), true, s);
  }
  for (const s of ['', ' x', 'x ', 'a: b', 'a:', 'a # b', '403', 'true', 'null', '- x', '#x', '[x', 'a\nb']) {
    assert.equal(plainSafe(s), false, s);
  }
});

test('the parser is STRICT — it fails loudly, with a line number, on anything outside the subset', () => {
  const cases = [
    ['a: &anchor x', /line 1: .*anchors and aliases/],
    ['a: 1\nb: *ref', /line 2: .*anchors and aliases/],
    ['a: !!str x', /line 1: .*tags are not supported/],
    ['a: {b: c}', /line 1: .*flow mappings/],
    ['a: [x: y]', /line 1: .*flow mappings/],
    ["a: 'single'", /line 1: .*single-quoted/],
    ['---\na: 1', /line 1: .*document markers/],
    ['a: 1\na: 2', /line 2: duplicate key 'a'/],
    ['a: 1\n\tb: 2', /line 2: tab in indentation/],
    ['a: b: c', /line 1: .*ambiguous/],
    ['a: "unterminated', /line 1: unterminated double-quoted/],
    ['a: "x" trailing', /line 1: trailing content after a quoted scalar/],
    ['a: 1\n   b: 2', /line 2: unexpected indentation/],
    ['a:', /line 1: a key with no value/],
    ['hello\nworld', /line 2: unexpected content after the end/],
    ['a: |2\n  x', /line 1: unsupported block scalar header/],
    ['- 1\nb: 2', /line 2: expected a "- " sequence item/],
    ['a:\n  - 1\n  b: 2', /line 3: expected a "- " sequence item/],
    ['a: [1,, 2]', /line 1: empty item in a flow sequence/],
    ['a: [1, 2', /line 1: unterminated flow sequence/],
    ['a: [[1]]', /line 1: nested flow collections/],
    ['just a scalar: and then\n  a: b', /unexpected/],
  ];
  for (const [text, message] of cases) {
    assert.throws(() => parse(text), message, `expected a refusal for: ${JSON.stringify(text)}`);
  }
  // …and the tolerances it DOES grant: full-line comments and blank lines between entries.
  assert.deepEqual(parse('# a note\na: 1\n\n# another\nb: two\n'), { a: 1, b: 'two' });
  assert.deepEqual(parse(''), null);
  assert.deepEqual(parse('\n\n'), null);
  assert.throws(() => parse(42), TypeError);
});

test('the emit-time round-trip gate rejects a block that would not come back exactly', () => {
  // The gate is a BACKSTOP: the two block builders already refuse everything that corrupts today,
  // so driving `emit` can never reach it. Hand it the blocks they would have to start producing
  // for the gate to matter, and the axis it guards becomes testable — delete the gate and this
  // goes red, which is the only thing that makes it a net rather than a comment.
  assert.equal(roundTrips({ header: '|-', lines: ['a', 'b'] }, 'a\nb'), true, 'an honest block passes');
  assert.equal(roundTrips({ header: '>-', lines: ['a', 'b'] }, 'a b'), true);
  // folding rejoins with ONE space, so a double space could never come back
  assert.equal(roundTrips({ header: '>-', lines: ['a', 'b'] }, 'a  b'), false);
  // a more-indented line folds to a newline, not a space
  assert.equal(roundTrips({ header: '>-', lines: ['a', '  b'] }, 'a   b'), false);
  // chomping that does not match the trailing newlines
  assert.equal(roundTrips({ header: '|-', lines: ['a'] }, 'a\n'), false);
  assert.equal(roundTrips({ header: '|', lines: ['a'] }, 'a'), false);
  // a first line whose indentation would be swallowed by the block's own indentation
  assert.equal(roundTrips({ header: '|-', lines: ['  a', 'b'] }, '  a\nb'), false);
  // and a block the parser cannot even read is a refusal, never a throw out of `emit`
  assert.equal(roundTrips({ header: '|-', lines: [] }, 'anything'), false);
});

test('a comment INSIDE a block scalar is content, not a comment', () => {
  const s = '# this is content\nand so is this';
  const text = emit({ s });
  assert.match(text, /\|-/);
  assert.equal(parse(text).s, s);
});

test('a block list of maps is written compactly and read back — the shape of the retired decisions: list', () => {
  const node = {
    name: 'Checkout steps',
    decisions: [
      { id: 'story:checkout-steps', decision: 'Checkout walks the shopper through separate steps, each settling a single part of the order.' },
      { id: 'acct:member-full-access', decision: `${'A long decision that has to fold over several lines '.repeat(4)}end.`,
        rejected: ['finer authorities', `${'a long rejected alternative '.repeat(6)}end`] },
    ],
    includes: ['cards'],
  };
  const text = trip(node);
  // the compact form: the dash carries the first key, the rest align under it
  assert.match(text, /^decisions:\n {2}- id: story:checkout-steps\n {4}decision: >-\n {6}Checkout walks/m);
  assert.match(text, /^ {2}- id: acct:member-full-access\n {4}decision: >-$/m);
  assert.match(text, /^ {4}rejected:\n {6}- finer authorities\n {6}- >-$/m);
  assert.match(text, /^includes: \[cards\]$/m, 'a short id list stays a flow list');
  // hand-written variants of the same structure parse too
  assert.deepEqual(parse('l:\n  - a: 1\n    b: two\n  - c: [x, y]\n'), { l: [{ a: 1, b: 'two' }, { c: ['x', 'y'] }] });
  assert.deepEqual(parse('l:\n  -   a: 1\n      b: 2\n'), { l: [{ a: 1, b: 2 }] }, 'extra space after the dash');
  assert.deepEqual(parse('- a: 1\n- b:\n    - c: d\n'), [{ a: 1 }, { b: [{ c: 'd' }] }], 'a document that is a list of maps');
  assert.deepEqual(parse('l:\n  - a: |-\n      one\n      two\n    b: 3\n'), { l: [{ a: 'one\ntwo', b: 3 }] }, 'a block scalar inside');
  assert.deepEqual(parse('l:\n  -\n    a: 1\n'), { l: [{ a: 1 }] }, 'the bare-dash form still reads');
  // …and the scalars that LOOK like a key stay scalars
  assert.deepEqual(parse('l:\n  - principle:weigh-disruption\n  - "a: b"\n'), { l: ['principle:weigh-disruption', 'a: b'] });
  // a key of the item map mis-indented is a loud error, not a guess
  assert.throws(() => parse('l:\n  - a: 1\n     b: 2\n'), /line 3: unexpected indentation/);
  assert.throws(() => parse('l:\n  - a: 1\n   b: 2\n'), /line 3/);
});

// --- the workhorse -----------------------------------------------------------

test('every node file in the live ledger re-emits byte-for-byte from what it parses to', () => {
  // Every real string in the corpus, through the codec both ways — and the FILE itself, so an editor
  // of the store that writes through `emit` can never reformat what it did not change.
  const ctx = loadLedger();
  assert.ok(ctx.nodes.length > 40, 'the live store loaded');
  for (const n of ctx.nodes) {
    const text = readFileSync(join(LEDGER_DIR, n.rel), 'utf8');
    assert.equal(emit(parse(text)), text, `${n.rel} does not re-emit as written`);
  }
  for (const rec of ctx.records.filter((r) => r._tree === 'views')) {
    const want = Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith('_')));
    assert.deepEqual(parse(emit(want)), want, `${rec.id} did not survive the round trip`);
  }
  // A typed view is written through the codec, so its FILE re-emits byte-for-byte too — the
  // `schema:` block and its folded field strings included.
  const typed = ctx.records.filter((r) => r._tree === 'views' && r.schema !== undefined);
  for (const rec of typed) {
    const text = readFileSync(rec._file, 'utf8');
    assert.equal(emit(parse(text)), text, `${rec._rel} does not re-emit as written`);
  }
  // …and every node file writes its keys in the node's own order
  for (const n of ctx.nodes) {
    const keys = Object.keys(n.raw);
    assert.deepEqual(keys, NODE_KEYS.filter((k) => keys.includes(k)), `${n.rel} writes its keys out of order`);
  }
});

test('a node file with references and a typed schema block round-trip byte-for-byte', () => {
  const nodeFile = {
    id: 'cart:line-set-is-shared', name: 'Line set is shared', decision: 'A line set is configuration.',
    rejected: ['bare names'], references: ['view:line', 'view:order-line'], includes: ['cards'],
    questions: ['one open tension'], context: 'a note',
  };
  const view = {
    id: 'view:line', decision: 'One line as every step passes it.',
    schema: {
      fields: {
        name: 'string (cart:line-is-its-name) — the line\'s name',
        status: 'enum<NOT_CONTACTED|PENDING|ACCEPTED> (cart:offer-follows-line) — a long meaning that goes on and on until the emitter has to fold the line past its width',
        lineId: 'ref<view:line> — a pointer', total: 'derived<ref<view:basket>>',
      },
    },
    links: { consumes: ['view:order-line'] },
  };
  for (const value of [nodeFile, view]) {
    const text = trip(value);
    assert.equal(emit(parse(text)), text, 'the emitted file is a fixed point');
  }
});

// ---------------------------------------------------------------------------
// The previous format → the node format
// ---------------------------------------------------------------------------

const LEGACY = {
  id: 'story:shop',
  decision: 'A person runs their shop.',
  rejected: ['a product-centric root'],
  peers: {
    'mob:shop-works-on-phone': { decision: 'Every shop surface works on a phone.', severable: true },
    'ord:order-adjusted-by-its-step': { decision: 'Only the step that made an order line adjusts it.', rejected: [],
      context: { why: 'lifted from the step capability' }, links: { grounds: ['principle:single-resolver'] } },
  },
  mounts: ['cards'],
  severs: ['bill:shop-in-free-tier'],
  links: { domain: 'mob', consumes: ['auth:one-trust-contract'] },
  context: { why: 'root story', src: 'inbox 008' },
};

test('legacyNode: the host and its peers become the decisions, host first, peers in file order', () => {
  const n = legacyNode(LEGACY);
  assert.equal(n.name, 'Shop');
  assert.deepEqual(n.decisions, [
    { id: 'story:shop', decision: 'A person runs their shop.', rejected: ['a product-centric root'] },
    { id: 'mob:shop-works-on-phone', decision: 'Every shop surface works on a phone.' },
    { id: 'ord:order-adjusted-by-its-step', decision: 'Only the step that made an order line adjusts it.' },
  ], 'an empty rejected list is dropped; severable and links carry nothing forward');
  assert.deepEqual(n.includes, ['cards'], 'mounts → includes');
  assert.ok(!('severed' in n), 'severs carry nothing forward — severs are retired');
  assert.deepEqual(n.context, {
    'story:shop': { why: 'root story', src: 'inbox 008' },
    'ord:order-adjusted-by-its-step': { why: 'lifted from the step capability' },
  }, 'several contexts become a mapping keyed by decision id — no text lost');
  assert.deepEqual(Object.keys(n), ['name', 'decisions', 'includes', 'context'], 'the node key order');
});

test('mergeContexts: none is absent, one keeps its shape, several are keyed by decision id', () => {
  assert.equal(mergeContexts([['a:x', undefined], ['b:y', {}], ['c:z', '  ']]), undefined);
  assert.deepEqual(mergeContexts([['a:x', undefined], ['b:y', { why: 'w' }]]), { why: 'w' });
  assert.equal(mergeContexts([['a:x', 'a note']]), 'a note');
  assert.deepEqual(mergeContexts([['a:x', 'one'], ['b:y', { why: 'two' }]]), { 'a:x': 'one', 'b:y': { why: 'two' } });
});

test('a name is drafted from an id, and a file name is the name\'s slug', () => {
  assert.equal(draftName('story:checkout-steps'), 'Checkout steps');
  assert.equal(draftName('acct:card-access-sole-authority'), 'Card access sole authority');
  assert.equal(draftName('eng:explicit-utc-clock'), 'Explicit UTC clock', 'known acronyms keep their case');
  assert.equal(slugOf('Checkout steps'), 'checkout-steps');
  assert.equal(slugOf('Explicit UTC clock'), 'explicit-utc-clock');
  assert.equal(slugOf("Who's  in — the team, (v2)!"), 'whos-in-the-team-v2', 'punctuation dropped, spaces collapse');
});

test('the loader reads a host-record file as a node, and the check refuses it in the working tree', () => {
  const store = buildStore([{ kind: 'node', path: 'ledger/engineering/old.yaml', rel: 'engineering/old.yaml', content: emit({
    id: 'eng:old-format', decision: 'A rule in the old shape.', rejected: [], links: { domain: 'eng' }, context: { why: 'w' },
    peers: { 'eng:old-peer': { decision: 'Its peer.' } },
  }) }]);
  assert.deepEqual(store.nodes[0].ids, ['eng:old-format', 'eng:old-peer']);
  assert.equal(store.nodes[0].legacy, true);
  assert.equal(store.byId.get('eng:old-peer').decision, 'Its peer.');
  const errors = validate({ ...store, domains: new Map([['eng', 'x']]) });
  assert.deepEqual(errors.filter((e) => e.rule === 'retired-key').map((e) => e.message.split(' ')[0]).sort(),
    ["'links'", "'peers'"]);
});

test('the loader reads a decision-list file as a node of several decisions, and the check refuses it', () => {
  const raw = { name: 'Old', decisions: [{ id: 'eng:first', decision: 'One.', rejected: ['x'] }, { id: 'eng:second', decision: 'Two.', references: ['view:v'] }], context: 'c' };
  assert.deepEqual(decisionsOf(raw), [{ id: 'eng:first', decision: 'One.', rejected: ['x'] }, { id: 'eng:second', decision: 'Two.', references: ['view:v'] }]);
  const store = buildStore([{ kind: 'node', path: 'ledger/engineering/old.yaml', rel: 'engineering/old.yaml', content: emit(raw) }]);
  assert.deepEqual(store.nodes[0].ids, ['eng:first', 'eng:second']);
  assert.equal(store.nodes[0].legacy, true);
  const errors = validate({ ...store, domains: new Map([['eng', 'x']]) });
  assert.deepEqual(errors.map((e) => [e.id, e.rule]), [['engineering/old.yaml', 'retired-key']]);
  // the singular format is ONE decision, whatever else the file says
  assert.deepEqual(decisionsOf({ id: 'eng:one', name: 'One', decision: 'One.', context: 'c', includes: ['x'] }), [{ id: 'eng:one', decision: 'One.' }]);
  assert.deepEqual(decisionsOf({ name: 'No id', decision: 'Orphan.' }), [], 'no id, no decision record — the check names the file');
});
