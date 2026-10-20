import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLedger } from '../src/ledger.js';
import { buildView } from '../src/snapshot.js';
import { GitFacts } from '../src/gitfacts.js';
import { FIXTURE, ledgerOf, makeFixtureRepo, rmFixture, write } from './fixture.js';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const CHECK = path.join(REPO_ROOT, 'tools/server.mjs');

let repo: string | undefined;
afterEach(() => {
  if (repo) rmFixture(repo);
  repo = undefined;
});

/** The check's verdict through its own entry point: exit status and each error line. */
function check(dir: string): { status: number | null; errors: string[]; stderr: string } {
  const r = spawnSync(process.execPath, [CHECK, '--check', '--dir', dir], {
    encoding: 'utf8',
    env: { ...process.env, ADROIT_HOME: path.join(dir, '..', '.adroit-home') },
  });
  const errors = r.stderr.split('\n').filter((l) => /^ {2}\S.* \[[a-z-]+\] /.test(l)).map((l) => l.trim());
  return { status: r.status, errors, stderr: r.stderr };
}

const view = async (dir: string) => buildView(openLedger(dir), new GitFacts(path.dirname(dir)));

describe('findings are the check\'s own', () => {
  // @DecisionRef ui:findings-match-the-check — the UI's findings and the check's are one set.
  it('a valid fixture: the check passes and the UI finds nothing', () => {
    repo = makeFixtureRepo();
    expect(check(ledgerOf(repo)).status).toBe(0);
    expect(openLedger(ledgerOf(repo)).findings).toEqual([]);
  });

  it('a broken fixture: the UI reports exactly the errors the check prints', () => {
    repo = makeFixtureRepo({
      'product/demo/sibling.yaml': { id: 'app:sibling', name: 'Sibling', decision: 'A sibling rule.', includes: ['nope'] },
      'product/demo/parent-rule/child-rule.yaml': {
        id: 'app:child-rule',
        name: 'Child rule',
        decision: 'Children follow {widget.colour}.',
        severed: ['app:parent-rule'],
      },
      'engineering/dup.yaml': { id: 'eng:sample-practice', name: 'Dup', decision: 'Again.' },
      'capabilities/orphan/leaf.yaml': { id: 'orphan:leaf', name: 'Leaf', decision: 'A leaf.' },
      'models/part.yaml': { id: 'view:part', decision: 'A part.', schema: { fields: { label: 'strng (app:nope)' } }, pending: {} },
      'product/demo/old-format.yaml': { name: 'Old format', decisions: [{ id: 'app:old-format', decision: 'Written as a list.' }] },
    });
    const dir = ledgerOf(repo);
    const cli = check(dir);
    expect(cli.status).toBe(1);
    const ours = openLedger(dir).findings.filter((f) => f.severity === 'error').map((f) => `${f.subject} [${f.rule}] ${f.message}`);
    expect(ours.sort()).toEqual(cli.errors.sort());
    expect(ours.length).toBeGreaterThanOrEqual(8);
    for (const rule of ['retired-key', 'token', 'schema-type', 'shape-citation', 'includes', 'duplicate-id', 'capability-root']) {
      expect(ours.some((l) => l.includes(`[${rule}]`)), rule).toBe(true);
    }
  });

  // @DecisionRef ui:broken-ledger-still-opens — a file the parser refuses is reported, and
  // everything else is still read.
  it('an unreadable file opens as a finding in place, with the rest of the ledger read', () => {
    repo = makeFixtureRepo({ 'product/demo/broken.yaml': 'name: [unterminated\n' });
    const dir = ledgerOf(repo);
    const cli = check(dir);
    expect(cli.status).toBe(1);
    const opened = openLedger(dir);
    expect(opened.store.nodes.length).toBe(Object.keys(FIXTURE).filter((k) => /^(product|capabilities|engineering)\//.test(k)).length);
    const f = opened.findings.find((x) => x.rule === 'unreadable')!;
    expect(f.place).toBe('product/demo/broken.yaml');
    // the same words the check prints, file and line included
    expect(cli.stderr).toContain(`${f.place} [unreadable] ${f.message}`);
  });

  // @DecisionRef ui:malformed-shown-in-place — each finding is placed on the node or directory
  // at fault.
  it('places each finding on the node holding the decision, or the directory at fault', () => {
    repo = makeFixtureRepo({
      'product/demo/sibling.yaml': { id: 'app:sibling', name: 'Sibling', decision: 'A sibling rule.', includes: ['nope'] },
      'capabilities/orphan/leaf.yaml': { id: 'orphan:leaf', name: 'Leaf', decision: 'A leaf.' },
      'product/demo/parent-rule/child-rule.yaml': { id: 'app:child-rule', name: 'Child rule', decision: 'Follows app:parent-rule.' },
      'models/part.yaml': { id: 'view:part', decision: 'A part.', schema: { fields: { label: 'strng' } } },
    });
    const places = Object.fromEntries(openLedger(ledgerOf(repo)).findings.map((f) => [f.rule, f.place]));
    expect(places.includes).toBe('product/demo/sibling.yaml');
    expect(places['capability-root']).toBe('capabilities/orphan');
    expect(places['id-in-decision-text']).toBe('product/demo/parent-rule/child-rule.yaml');
    expect(places['schema-type']).toBe('models/part.yaml');
  });

  it('this repository\'s own ledger opens with no findings', () => {
    expect(openLedger(path.join(REPO_ROOT, 'ledger')).findings).toEqual([]);
  });
});

describe('the view', () => {
  // @DecisionRef ui:organized-around-hierarchy — the places are the directory hierarchy.
  it('lays every root out as places, the hierarchy being the filesystem', async () => {
    repo = makeFixtureRepo();
    const v = await view(ledgerOf(repo));
    expect(v.roots).toEqual(['product', 'capabilities', 'engineering', 'models', 'domains.yaml']);
    expect(v.places.product.children).toEqual(['product/demo']);
    expect(v.places['product/demo'].kind).toBe('node');
    expect(v.places['product/demo'].label).toBe('Demo');
    expect(v.places['product/demo'].children).toEqual(['product/demo/parent-rule', 'product/demo/sibling.yaml']);
    expect(v.places['product/demo/parent-rule'].parent).toBe('product/demo');
    expect(v.places['models/widget.yaml'].kind).toBe('view');
    expect(v.places['models/widget.yaml'].label).toBe('view:widget');
    expect(v.corpus).toBe('fixture');
    expect(v.ids['app:deep-leaf']).toBe('product/demo/parent-rule/online-only/deep-leaf.yaml');
    expect(v.ids['view:part']).toBe('models/part.yaml');
  });

  // @DecisionRef ui:trace-dependence — the path down to the node.
  it('gives each node its one decision and the path down to it', async () => {
    repo = makeFixtureRepo();
    const v = await view(ledgerOf(repo));
    const leaf = v.places['product/demo/parent-rule/online-only/deep-leaf.yaml'].node!;
    expect(leaf.doc).toEqual({ id: 'app:deep-leaf', name: 'Deep leaf', decision: 'Deep leaves live here.' });
    expect(leaf.ancestors).toEqual(['product/demo', 'product/demo/parent-rule', 'product/demo/parent-rule/online-only']);
    expect(leaf).not.toHaveProperty('capabilities');
    const parent = v.places['product/demo/parent-rule'].node!;
    expect(parent.doc.rejected).toEqual(['letting children rule — too chaotic']);
    expect(parent.contextText).toBe('because parents know');
    expect(parent.dependents).toBe(3);
    // the views a decision governs: its references, then what its field tokens name
    expect(v.places['product/demo/sibling.yaml'].node!.views).toEqual(['view:part', 'view:widget']);
  });

  // @DecisionRef ui:capability-shows-includers — a capability's root lists every node including it.
  it('lists a capability root\'s includers, and counts them among its dependents', async () => {
    repo = makeFixtureRepo();
    const v = await view(ledgerOf(repo));
    const root = v.places['capabilities/notify'].node!;
    expect(root.capability).toBe('notify');
    expect(root.includers).toEqual(['product/demo']);
    // its own leaf, plus the includer and the includer's whole subtree
    expect(root.dependents).toBe(1 + 6);
  });

  // @DecisionRef ui:views-read-as-fields — each typed field with its type, citations and meaning.
  it('reads a view as its typed fields, with its links', async () => {
    repo = makeFixtureRepo({
      'models/part.yaml': {
        id: 'view:part',
        decision: 'One part of a widget.',
        schema: { fields: { label: 'string (app:sibling, app:child-rule) — what the part is called', weight: 'nonsense here' } },
      },
    });
    const v = await view(ledgerOf(repo));
    expect(v.places['models/widget.yaml'].view).toEqual({
      id: 'view:widget',
      decision: 'One widget, as the demo shows it.',
      rejected: [],
      fields: [
        { name: 'name', type: 'string', cites: ['app:parent-rule'], meaning: 'the widget name', raw: 'string (app:parent-rule) — the widget name' },
        { name: 'size', type: 'int', cites: [], meaning: 'how big it is', raw: 'int — how big it is' },
        { name: 'parts', type: 'list<ref<view:part>>', cites: [], meaning: '', raw: 'list<ref<view:part>>' },
      ],
      consumes: ['view:part'],
      grounds: [],
    });
    const part = v.places['models/part.yaml'].view!;
    expect(part.fields[0].cites).toEqual(['app:sibling', 'app:child-rule']);
    // a field that does not parse still shows, as written
    expect(part.fields[1]).toMatchObject({ name: 'weight', type: '?', raw: 'nonsense here' });
  });

  it('a file under models that is no view is shown as a plain file', async () => {
    repo = makeFixtureRepo({ 'models/pending-changes/add-colour.yaml': { name: 'add-colour', state: 'begun' } });
    const v = await view(ledgerOf(repo));
    expect(v.places['models/pending-changes/add-colour.yaml'].kind).toBe('file');
    expect(v.places['models/pending-changes/add-colour.yaml'].view).toBeUndefined();
  });

  // @DecisionRef ui:ruling-shows-one-state — in-flight edits show as the working diff.
  it('marks a place whose file differs from the last commit', async () => {
    repo = makeFixtureRepo();
    write(repo, 'ledger/product/demo/sibling.yaml', { id: 'app:sibling', name: 'Sibling', decision: 'Edited outside.' });
    const v = await view(ledgerOf(repo));
    expect(v.places['product/demo/sibling.yaml'].uncommitted).toBe(true);
    expect(v.places['product/demo/parent-rule'].uncommitted).toBe(false);
  });
});
