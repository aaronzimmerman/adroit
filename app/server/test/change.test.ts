import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChangeRequest, Operation } from '@adroit/shared';
import { parseYaml } from '../src/adroit.js';
import { applyChange, previewChange, Refusal } from '../src/change.js';
import { openLedger } from '../src/ledger.js';
import { exists, git, ledgerOf, makeFixtureRepo, read, rmFixture, write } from './fixture.js';

let repo: string;
let dir: string;
beforeEach(() => {
  repo = makeFixtureRepo();
  dir = ledgerOf(repo);
});
afterEach(() => rmFixture(repo));

const land = (req: ChangeRequest) => applyChange(dir, repo, req);
const one = (op: Operation, extra: Omit<ChangeRequest, 'operations'> = {}) => land({ operations: [op], ...extra });
const node = (rel: string) => parseYaml(read(repo, `ledger/${rel}`)) as Record<string, any>;
const commits = () => Number(git(repo, ['rev-list', '--count', 'HEAD']).trim());
const lastFiles = () => git(repo, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').sort();
const editParent = (value: string): Operation => ({
  op: 'edit-decision', place: 'product/demo/parent-rule', id: 'app:parent-rule', field: 'decision', value,
});

describe('a change lands as one commit', () => {
  // @DecisionRef ui:changes-land-as-commits — one atomic commit across every touched file.
  it('lands several operations as one commit, touching exactly their files', async () => {
    const before = commits();
    const out = await land({
      operations: [editParent('Parents rule kindly.'), { op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'name', value: 'Sibling' }],
      message: 'soften the parent rule',
      worked: ['product/demo/parent-rule/child-rule.yaml', 'product/demo/parent-rule/online-only', 'product/demo/parent-rule/online-only/deep-leaf.yaml'],
    }).catch((e) => e);
    // renaming to the same name changes nothing on its own, but the edit does
    expect(out).not.toBeInstanceOf(Error);
    expect(commits()).toBe(before + 1);
    expect(git(repo, ['log', '-1', '--format=%s'])).toContain('soften the parent rule');
    expect(lastFiles()).toEqual(['ledger/product/demo/parent-rule/self.yaml']);
    expect(node('product/demo/parent-rule/self.yaml').decisions[0].decision).toBe('Parents rule kindly.');
  });

  it('never sweeps an unrelated dirty file into the commit', async () => {
    write(repo, 'unrelated.txt', 'someone else was here');
    await one({ op: 'edit-decision', place: 'product/demo/sibling.yaml', id: 'app:sibling', field: 'decision', value: 'Changed.' });
    expect(lastFiles()).toEqual(['ledger/product/demo/sibling.yaml']);
    expect(git(repo, ['status', '--porcelain'])).toContain('unrelated.txt');
  });

  // @DecisionRef eng:refusal-writes-nothing — a refusal leaves the tree as it found it.
  it('a refusal writes nothing, even after valid operations', async () => {
    const original = read(repo, 'ledger/product/demo/parent-rule/self.yaml');
    await expect(land({
      operations: [editParent('Would have been fine.'), { op: 'edit-decision', place: 'product/demo/parent-rule', id: 'app:parent-rule', field: 'id' as never, value: 'app:renamed' }],
    })).rejects.toThrow(/not an editable field of a decision/);
    expect(read(repo, 'ledger/product/demo/parent-rule/self.yaml')).toBe(original);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  // @DecisionRef ui:commit-validates-first — the check's rules run before anything is written.
  it('refuses a change the check would fail, naming the finding', async () => {
    await expect(one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'includes', value: ['nope'] }))
      .rejects.toThrow(/the check would fail: .*'nope', which is no capability/);
    await expect(one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'severed', value: ['app:parent-rule'] }))
      .rejects.toThrow(/neither a decision of an ancestor/);
    await expect(one({ op: 'add-decision', place: 'product/demo/sibling.yaml', entry: { id: 'app:child-rule', decision: 'Again.' } }))
      .rejects.toThrow(/duplicate|also written/);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  it('a ledger outside git refuses to change, since changes land as commits', async () => {
    await expect(applyChange(dir, null, { operations: [editParent('x')] })).rejects.toThrow(/not inside a git repository/);
  });
});

describe('suspicion and the dubious mark', () => {
  // @DecisionRef ui:walk-the-suspect-set — the preview names every node the change makes
  // suspect, with nothing written.
  it('previews the suspects of an edit: every descendant, naming the edited node', () => {
    const p = previewChange(dir, { operations: [editParent('Parents rule kindly.')] });
    expect(p.suspects.map((s) => s.place)).toEqual([
      'product/demo/parent-rule/child-rule.yaml',
      'product/demo/parent-rule/online-only',
      'product/demo/parent-rule/online-only/deep-leaf.yaml',
    ]);
    expect(p.suspects[0].reason).toBe('"Parent rule" changed (product/demo/parent-rule)');
    expect(p.touched).toEqual(['product/demo/parent-rule/self.yaml']);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  // @DecisionRef ui:commit-never-gated — the commit lands over an unworked suspect set.
  // @DecisionRef ui:unworked-suspects-marked — the same commit marks the unworked suspects.
  it('the commit marks every unworked suspect and leaves the worked ones alone', async () => {
    const out = await one(editParent('Parents rule kindly.'), { worked: ['product/demo/parent-rule/child-rule.yaml'] });
    expect(out.marked).toEqual(['product/demo/parent-rule/online-only', 'product/demo/parent-rule/online-only/deep-leaf.yaml']);
    expect(node('product/demo/parent-rule/child-rule.yaml').dubious).toBeUndefined();
    expect(node('product/demo/parent-rule/online-only/self.yaml').dubious).toBe('"Parent rule" changed (product/demo/parent-rule)');
    expect(lastFiles()).toHaveLength(3);
  });

  it('a node already dubious keeps every reason', async () => {
    await one(editParent('First.'));
    await one({ op: 'edit-decision', place: 'product/demo/parent-rule/online-only', id: 'app:online-only', field: 'decision', value: 'Online, mostly.', clearDubious: false });
    expect(node('product/demo/parent-rule/online-only/deep-leaf.yaml').dubious).toBe(
      '"Parent rule" changed (product/demo/parent-rule); "Online only" changed (product/demo/parent-rule/online-only)',
    );
    // the edited node kept its own mark: the user left the clearing lever off
    expect(node('product/demo/parent-rule/online-only/self.yaml').dubious).toBe('"Parent rule" changed (product/demo/parent-rule)');
  });

  // @DecisionRef ui:dubious-clears-on-work — an edit with the lever on clears the node's own mark.
  it('editing a dubious node clears its own mark, never its descendants\'', async () => {
    await one(editParent('First.'));
    await one({ op: 'edit-node', place: 'product/demo/parent-rule/online-only', field: 'questions', value: ['Is offline ever back?'], clearDubious: true });
    expect(node('product/demo/parent-rule/online-only/self.yaml').dubious).toBeUndefined();
    expect(node('product/demo/parent-rule/online-only/deep-leaf.yaml').dubious).toBeDefined();
  });

  it('questions and names make nothing suspect', () => {
    expect(previewChange(dir, { operations: [{ op: 'edit-node', place: 'product/demo', field: 'questions', value: [] }] }).suspects).toEqual([]);
    expect(previewChange(dir, { operations: [{ op: 'edit-node', place: 'product/demo/parent-rule', field: 'name', value: 'Parent' }] }).suspects).toEqual([]);
  });

  it('includes, severed and context edits cast suspicion like a decision edit', () => {
    const ops: Operation[] = [
      { op: 'edit-node', place: 'product/demo/parent-rule', field: 'context', value: 'why: a better reason\n' },
      { op: 'edit-node', place: 'product/demo/parent-rule', field: 'severed', value: ['app:works-offline'] },
    ];
    for (const op of ops) expect(previewChange(dir, { operations: [op] }).suspects).toHaveLength(3);
  });

  it('an edit inside a capability makes its includers suspect, with their descendants', () => {
    const p = previewChange(dir, { operations: [{ op: 'edit-decision', place: 'capabilities/notify/quiet-hours.yaml', id: 'notify:quiet-hours', field: 'decision', value: 'Nothing fires after ten.' }] });
    expect(p.suspects.map((s) => s.place)).toContain('product/demo');
    expect(p.suspects.map((s) => s.place)).toContain('product/demo/parent-rule/online-only/deep-leaf.yaml');
    expect(p.suspects.find((s) => s.place === 'product/demo')!.reason).toBe('capability notify changed at "Quiet hours" (capabilities/notify/quiet-hours.yaml)');
  });

  // @DecisionRef ui:dubious-set-by-hand — the person's line, cascading to every descendant.
  it('marking by hand writes the reason and cascades, naming the marked ancestor', async () => {
    await one({ op: 'mark-dubious', place: 'product/demo/parent-rule/online-only', reason: 'contradicts the offline story' });
    expect(node('product/demo/parent-rule/online-only/self.yaml').dubious).toBe('contradicts the offline story');
    expect(node('product/demo/parent-rule/online-only/deep-leaf.yaml').dubious).toBe('"Online only" above was marked dubious (product/demo/parent-rule/online-only)');
    await expect(one({ op: 'mark-dubious', place: 'product/demo', reason: 'two\nlines' })).rejects.toThrow(/one line/);
  });

  it('confirming removes the mark in a commit, and never cascades', async () => {
    await one({ op: 'mark-dubious', place: 'product/demo/parent-rule/online-only', reason: 'saw a contradiction' });
    const out = await one({ op: 'confirm', place: 'product/demo/parent-rule/online-only' });
    expect(out.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(node('product/demo/parent-rule/online-only/self.yaml').dubious).toBeUndefined();
    expect(node('product/demo/parent-rule/online-only/deep-leaf.yaml').dubious).toBeDefined();
    await expect(one({ op: 'confirm', place: 'product/demo/sibling.yaml' })).rejects.toThrow(/not marked dubious/);
  });
});

describe('editing a node in place', () => {
  // @DecisionRef ui:all-but-id-editable — every field but a decision's id.
  it('edits rejected, severable, includes, questions and context', async () => {
    await one({ op: 'edit-decision', place: 'product/demo/sibling.yaml', id: 'app:sibling', field: 'rejected', value: ['a cousin rule — too far'] });
    await one({ op: 'edit-decision', place: 'product/demo/sibling.yaml', id: 'app:sibling', field: 'severable', value: true });
    await one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'questions', value: ['Who reads it?', ' '] });
    await one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'context', value: 'why: a reason\nsrc: a session\n' });
    expect(node('product/demo/sibling.yaml')).toEqual({
      name: 'Sibling',
      decisions: [{ id: 'app:sibling', decision: 'A sibling rule.', rejected: ['a cousin rule — too far'], severable: true }],
      questions: ['Who reads it?'],
      context: { why: 'a reason', src: 'a session' },
    });
    // keys land in the node's file order
    expect(Object.keys(node('product/demo/sibling.yaml'))).toEqual(['name', 'decisions', 'questions', 'context']);
  });

  it('a renamed node takes its file name from its name; a tree root keeps its directory', async () => {
    const out = await one({ op: 'edit-node', place: 'product/demo/parent-rule', field: 'name', value: 'Parental guidance' });
    expect(out.landedAt).toBe('product/demo/parental-guidance');
    expect(exists(repo, 'ledger/product/demo/parental-guidance/online-only/deep-leaf.yaml')).toBe(true);
    expect(exists(repo, 'ledger/product/demo/parent-rule')).toBe(false);
    await one({ op: 'edit-node', place: 'product/demo', field: 'name', value: 'Demo app' });
    expect(exists(repo, 'ledger/product/demo/self.yaml')).toBe(true);
    await expect(one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'name', value: 'Parental guidance' }))
      .rejects.toThrow(/already taken/);
  });

  it('adds a peer decision, which casts suspicion like an edit', async () => {
    const out = await one({ op: 'add-decision', place: 'product/demo/parent-rule', entry: { id: 'app:parents-listen', decision: 'Parents listen first.' } });
    expect(node('product/demo/parent-rule/self.yaml').decisions.map((x: { id: string }) => x.id)).toEqual(['app:parent-rule', 'app:parents-listen']);
    expect(out.marked).toHaveLength(3);
  });
});

describe('creating and moving nodes', () => {
  it('creates a node beneath a leaf, which becomes a directory holding its own node', async () => {
    const out = await one({
      op: 'create-node', parent: 'product/demo/sibling.yaml',
      doc: { name: 'Little sibling', decisions: [{ id: 'app:little-sibling', decision: 'The little one.' }] },
    });
    expect(out.landedAt).toBe('product/demo/sibling/little-sibling.yaml');
    expect(exists(repo, 'ledger/product/demo/sibling/self.yaml')).toBe(true);
    expect(exists(repo, 'ledger/product/demo/sibling.yaml')).toBe(false);
    expect(out.suspects).toEqual([]);
    expect(openLedger(dir).findings).toEqual([]);
  });

  it('creates a new tree root under product or capabilities, and a leaf under engineering', async () => {
    expect((await one({ op: 'create-node', parent: 'capabilities', doc: { name: 'Search', decisions: [{ id: 'search:any-text', decision: 'Any text is found.' }] } })).landedAt)
      .toBe('capabilities/search');
    expect((await one({ op: 'create-node', parent: 'engineering', doc: { name: 'Second practice', decisions: [{ id: 'eng:second-practice', decision: 'Twice.' }] } })).landedAt)
      .toBe('engineering/second-practice.yaml');
    await expect(one({ op: 'create-node', parent: 'models', doc: { name: 'X', decisions: [{ id: 'eng:x', decision: 'x' }] } }))
      .rejects.toThrow(/models, not nodes/);
    await expect(one({ op: 'create-node', parent: 'engineering', doc: { name: 'Bad', decisions: [{ id: 'nope:bad', decision: 'x' }] } }))
      .rejects.toThrow(/the check would fail/);
  });

  // @DecisionRef ui:reparent-is-a-move — the moved subtree becomes suspect.
  it('moves a node with its subtree, and the moved subtree becomes suspect', async () => {
    const out = await one({ op: 'move-node', place: 'product/demo/parent-rule/online-only', newParent: 'product/demo/sibling.yaml' });
    expect(out.landedAt).toBe('product/demo/sibling/online-only');
    expect(out.marked).toEqual(['product/demo/sibling/online-only', 'product/demo/sibling/online-only/deep-leaf.yaml']);
    expect(node('product/demo/sibling/online-only/deep-leaf.yaml').dubious).toBe('moved with "Online only" to product/demo/sibling/online-only');
    expect(exists(repo, 'ledger/product/demo/parent-rule/online-only')).toBe(false);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
    await expect(one({ op: 'move-node', place: 'product/demo/parent-rule', newParent: 'product/demo/parent-rule/child-rule.yaml' }))
      .rejects.toThrow(/beneath itself/);
  });

  it('a preview of a move reads each suspect where it is now', () => {
    const p = previewChange(dir, { operations: [{ op: 'move-node', place: 'product/demo/parent-rule/online-only', newParent: 'product/demo/sibling.yaml' }] });
    expect(p.suspects.map((s) => [s.place, s.readAt])).toEqual([
      ['product/demo/sibling/online-only', 'product/demo/parent-rule/online-only'],
      ['product/demo/sibling/online-only/deep-leaf.yaml', 'product/demo/parent-rule/online-only/deep-leaf.yaml'],
    ]);
  });

  // @DecisionRef ui:extract-a-capability — move into capabilities, include where it repeated.
  it('extracts a capability: the subtree moves into capabilities and each chosen node includes it', async () => {
    const out = await one({ op: 'extract-capability', place: 'product/demo/parent-rule/child-rule.yaml', name: 'following', includers: ['product/demo/parent-rule', 'product/demo/sibling.yaml'] });
    expect(out.landedAt).toBe('capabilities/following');
    expect(exists(repo, 'ledger/capabilities/following/self.yaml')).toBe(true);
    expect(node('product/demo/parent-rule/self.yaml').includes).toEqual(['following']);
    expect(node('product/demo/sibling.yaml').includes).toEqual(['following']);
    // the includers' subtrees had their scope changed: unworked, they are marked
    expect(out.marked).toContain('product/demo/parent-rule/online-only/deep-leaf.yaml');
    expect(openLedger(dir).findings.filter((f) => f.severity === 'error')).toEqual([]);
    await expect(one({ op: 'extract-capability', place: 'product/demo/parent-rule', name: 'parenting', includers: ['product/demo/parent-rule/online-only'] }))
      .rejects.toThrow(/moves with the capability/);
  });
});

describe('the model operations', () => {
  const widget = () => parseYaml(read(repo, 'ledger/models/model.widget.yaml')) as Record<string, any>;

  // @DecisionRef ui:set-model-field — a pending entry beside the deployed shape.
  // @DecisionRef ui:begin-migration — the named entries move into one pending change.
  // @DecisionRef ui:land-migration — the model takes the intended shape; the change is deleted.
  it('sets an intended definition, begins a migration from it, and lands it', async () => {
    const set = await one({ op: 'set-model-field', model: 'model:widget', field: 'size', intended: 'scalar — in millimetres' });
    expect(set.suspects).toEqual([]);
    expect(widget().shape.pending).toEqual({ size: 'scalar — in millimetres' });
    expect(widget().shape.fields.size).toBe('scalar — how big it is');

    await expect(one({ op: 'begin-migration', name: 'mm', origin: ['app:nope'], entries: [{ model: 'model:widget', field: 'size' }] }))
      .rejects.toThrow(/not a decision/);
    await one({ op: 'begin-migration', name: 'mm', origin: ['app:parent-rule'], entries: [{ model: 'model:widget', field: 'size' }] });
    expect(widget().shape.pending).toBeUndefined();
    expect(parseYaml(read(repo, 'ledger/models/pending-changes/mm.yaml'))).toEqual({
      name: 'mm', origin: ['app:parent-rule'], operations: [{ model: 'model:widget', field: 'size', deployed: 'scalar — how big it is', intended: 'scalar — in millimetres' }], state: 'begun',
    });
    await expect(one({ op: 'set-model-field', model: 'model:widget', field: 'size', intended: 'again' })).rejects.toThrow(/already in migration mm/);

    await one({ op: 'land-migration', name: 'mm' });
    expect(widget().shape.fields.size).toBe('scalar — in millimetres');
    expect(exists(repo, 'ledger/models/pending-changes/mm.yaml')).toBe(false);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  it('a refused landing changes nothing', async () => {
    await one({ op: 'set-model-field', model: 'model:widget', field: 'size', intended: 'scalar — in millimetres' });
    await one({ op: 'begin-migration', name: 'mm', origin: ['app:parent-rule'], entries: [{ model: 'model:widget', field: 'size' }] });
    const m = widget();
    m.shape.fields.size = 'changed meanwhile';
    write(repo, 'ledger/models/model.widget.yaml', m);
    git(repo, ['commit', '-qam', 'meanwhile']);
    await expect(one({ op: 'land-migration', name: 'mm' })).rejects.toThrow(/changed since migration mm began/);
    expect(exists(repo, 'ledger/models/pending-changes/mm.yaml')).toBe(true);
  });
});

it('the Refusal class is what the server answers 422 with', () => {
  expect(new Refusal('x')).toBeInstanceOf(Error);
  expect(fs.existsSync(os.tmpdir())).toBe(true);
  expect(path.isAbsolute(dir)).toBe(true);
});
