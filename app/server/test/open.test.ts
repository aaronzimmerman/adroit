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
      'product/demo/sibling.yaml': { name: 'Sibling', decisions: [{ id: 'app:sibling', decision: 'A sibling rule.' }], includes: ['nope'] },
      'product/demo/parent-rule/child-rule.yaml': {
        name: 'Child rule',
        decisions: [{ id: 'app:child-rule', decision: 'Children follow.' }],
        severed: ['app:parent-rule'],
        links: { domain: 'app' },
      },
      'engineering/dup.yaml': { name: 'Dup', decisions: [{ id: 'eng:sample-practice', decision: 'Again.' }] },
      'capabilities/orphan/leaf.yaml': { name: 'Leaf', decisions: [{ id: 'orphan:leaf', decision: 'A leaf.' }] },
    });
    const dir = ledgerOf(repo);
    const cli = check(dir);
    expect(cli.status).toBe(1);
    const ours = openLedger(dir).findings.filter((f) => f.severity === 'error').map((f) => `${f.subject} [${f.rule}] ${f.message}`);
    expect(ours.sort()).toEqual(cli.errors.sort());
    expect(ours.length).toBeGreaterThanOrEqual(5);
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
    expect(cli.stderr).toContain(f.message.replace(/^could not be read — /, ''));
  });

  // @DecisionRef ui:malformed-shown-in-place — each finding is placed on the node or directory
  // at fault.
  it('places each finding on the node holding the decision, or the directory at fault', () => {
    repo = makeFixtureRepo({
      'product/demo/sibling.yaml': { name: 'Sibling', decisions: [{ id: 'app:sibling', decision: 'A sibling rule.' }], includes: ['nope'] },
      'capabilities/orphan/leaf.yaml': { name: 'Leaf', decisions: [{ id: 'orphan:leaf', decision: 'A leaf.' }] },
      'product/demo/parent-rule/child-rule.yaml': {
        name: 'Child rule',
        decisions: [{ id: 'app:child-rule', decision: 'Follows app:parent-rule.' }],
      },
    });
    const places = Object.fromEntries(openLedger(ledgerOf(repo)).findings.map((f) => [f.rule, f.place]));
    expect(places.includes).toBe('product/demo/sibling.yaml');
    expect(places['capability-root']).toBe('capabilities/orphan');
    expect(places['id-in-decision-text']).toBe('product/demo/parent-rule/child-rule.yaml');
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
    expect(v.places['models/model.widget.yaml'].kind).toBe('model');
    expect(v.corpus).toBe('fixture');
    expect(v.decisions['app:deep-leaf']).toBe('product/demo/parent-rule/online-only/deep-leaf.yaml');
  });

  // @DecisionRef ui:trace-dependence — every ancestor and every capability in scope.
  it('gives each node its ancestors, the capabilities in scope and what is severed', async () => {
    repo = makeFixtureRepo();
    const v = await view(ledgerOf(repo));
    const leaf = v.places['product/demo/parent-rule/online-only/deep-leaf.yaml'].node!;
    expect(leaf.ancestors).toEqual(['product/demo', 'product/demo/parent-rule', 'product/demo/parent-rule/online-only']);
    expect(leaf.capabilities).toEqual([{ name: 'notify', root: 'capabilities/notify', via: 'product/demo', decisionCount: 2 }]);
    // @DecisionRef ui:severed-shown-marked — the sever is named with the node that does it.
    expect(leaf.severed).toEqual({ 'app:works-offline': 'product/demo/parent-rule/online-only' });
    expect(v.places['product/demo/sibling.yaml'].node!.severed).toEqual({});
    expect(v.places['product/demo/parent-rule'].node!.dependents).toBe(3);
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

  // @DecisionRef ui:current-and-proposed-visible — deployed and intended side by side.
  it('reads a model as its fields, deployed beside intended', async () => {
    repo = makeFixtureRepo({
      'models/model.widget.yaml': {
        id: 'model:widget',
        decision: 'One widget at rest.',
        shape: {
          fields: { name: 'scalar (app:parent-rule) — the widget name', size: 'scalar — how big it is' },
          pending: { size: 'scalar — how big, in millimetres' },
        },
      },
      'models/pending-changes/add-colour.yaml': {
        name: 'add-colour',
        origin: ['app:parent-rule'],
        operations: [{ model: 'model:widget', field: 'colour', intended: 'scalar — its colour' }],
        state: 'begun',
      },
    });
    const v = await view(ledgerOf(repo));
    const m = v.places['models/model.widget.yaml'].model!;
    expect(m.fields).toEqual([
      { name: 'name', deployed: 'scalar (app:parent-rule) — the widget name', cites: ['app:parent-rule'] },
      { name: 'size', deployed: 'scalar — how big it is', intended: 'scalar — how big, in millimetres', pendingIn: 'model', cites: [] },
      { name: 'colour', intended: 'scalar — its colour', pendingIn: 'models/pending-changes/add-colour.yaml', cites: [] },
    ]);
    expect(v.places['models/pending-changes/add-colour.yaml'].kind).toBe('pending-change');
    expect(v.places['models/pending-changes/add-colour.yaml'].label).toBe('add-colour');
  });

  // @DecisionRef ui:ruling-shows-one-state — in-flight edits show as the working diff.
  it('marks a place whose file differs from the last commit', async () => {
    repo = makeFixtureRepo();
    write(repo, 'ledger/product/demo/sibling.yaml', { name: 'Sibling', decisions: [{ id: 'app:sibling', decision: 'Edited outside.' }] });
    const v = await view(ledgerOf(repo));
    expect(v.places['product/demo/sibling.yaml'].uncommitted).toBe(true);
    expect(v.places['product/demo/parent-rule'].uncommitted).toBe(false);
  });
});
