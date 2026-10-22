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
  op: 'edit-node', place: 'product/demo/parent-rule', field: 'decision', value,
});
const ONLINE = 'product/demo/parent-rule/online-only';
const LEAF = 'product/demo/parent-rule/online-only/deep-leaf.yaml';
const CHILD = 'product/demo/parent-rule/child-rule.yaml';

describe('a change lands as one commit', () => {
  // @DecisionRef ui:changes-land-as-commits — one atomic commit across every touched file.
  it('lands several operations as one commit, touching exactly their files', async () => {
    const before = commits();
    await land({
      operations: [
        { op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'decision', value: 'A widget shows its {widget.size} plainly.' },
        { op: 'edit-node', place: CHILD, field: 'decision', value: 'Children follow, mostly.' },
      ],
      message: 'two leaves',
    });
    expect(commits()).toBe(before + 1);
    expect(git(repo, ['log', '-1', '--format=%s'])).toContain('two leaves');
    expect(lastFiles()).toEqual([`ledger/${CHILD}`, 'ledger/product/demo/sibling.yaml']);
    expect(node(CHILD).decision).toBe('Children follow, mostly.');
  });

  it('never sweeps an unrelated dirty file into the commit', async () => {
    write(repo, 'unrelated.txt', 'someone else was here');
    await one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'decision', value: 'Changed.' });
    expect(lastFiles()).toEqual(['ledger/product/demo/sibling.yaml']);
    expect(git(repo, ['status', '--porcelain'])).toContain('unrelated.txt');
  });

  // @DecisionRef eng:refusal-writes-nothing — a refusal leaves the tree as it found it.
  // @DecisionRef ui:all-but-id-editable — the id is never an editable field.
  it('a refusal writes nothing, even after valid operations', async () => {
    const original = read(repo, 'ledger/product/demo/parent-rule/self.yaml');
    await expect(land({
      operations: [editParent('Would have been fine.'), { op: 'edit-node', place: 'product/demo/parent-rule', field: 'id' as never, value: 'app:renamed' }],
    })).rejects.toThrow(/not an editable field of a node — its id is fixed/);
    expect(read(repo, 'ledger/product/demo/parent-rule/self.yaml')).toBe(original);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  // @DecisionRef ui:commit-validates-first — the check's rules run before anything is written.
  it('refuses a change the check would fail, naming the finding', async () => {
    await expect(one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'includes', value: ['nope'] }))
      .rejects.toThrow(/the check would fail: .*'nope', which is no capability/);
    await expect(one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'references', value: ['view:nope'] }))
      .rejects.toThrow(/'view:nope' resolves to no view record/);
    await expect(one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'decision', value: 'Shows its {widget.colour}.' }))
      .rejects.toThrow(/view:widget has no field 'colour'/);
    await expect(one({ op: 'create-node', parent: 'product/demo/sibling.yaml', doc: { id: 'app:child-rule', name: 'Again', decision: 'Again.' } }))
      .rejects.toThrow(/duplicate|also written/);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  // @DecisionRef ui:refuse-only-new-errors — an error the ledger already had refuses nothing.
  it('refuses only the errors a change introduces, so a broken ledger can be repaired', async () => {
    write(repo, 'ledger/product/demo/sibling.yaml', { id: 'app:sibling', name: 'Sibling', decision: 'A sibling.', includes: ['nope'] });
    git(repo, ['commit', '-qam', 'break it']);
    await one(editParent('Parents rule kindly.'));
    expect(node('product/demo/parent-rule/self.yaml').decision).toBe('Parents rule kindly.');
    await expect(one({ op: 'edit-node', place: CHILD, field: 'includes', value: ['also-nope'] })).rejects.toThrow(/'also-nope'/);
    await one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'includes', value: [] });
    expect(openLedger(dir).findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('a ledger outside git refuses to change, since changes land as commits', async () => {
    await expect(applyChange(dir, null, { operations: [editParent('x')] })).rejects.toThrow(/not inside a git repository/);
  });
});

describe('suspicion and the dubious mark', () => {
  // @DecisionRef ui:suspect-set-shown — the preview names every node the change makes suspect,
  // with nothing written.
  it('previews the suspects of an edit: every descendant, naming the edited node', () => {
    const p = previewChange(dir, { operations: [editParent('Parents rule kindly.')] });
    expect(p.suspects.map((s) => s.place)).toEqual([CHILD, ONLINE, LEAF]);
    expect(p.suspects[0].reason).toBe('"Parent rule" changed (product/demo/parent-rule)');
    expect(p.removed).toEqual([]);
    expect(p.touched).toEqual(['product/demo/parent-rule/self.yaml']);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  // @DecisionRef ui:commit-never-gated — the commit lands over the suspect set.
  // @DecisionRef ui:commit-marks-suspects — the same commit marks every suspect.
  it('the commit marks every suspect, in the same commit', async () => {
    const out = await one(editParent('Parents rule kindly.'));
    expect(out.marked).toEqual([CHILD, ONLINE, LEAF]);
    expect(node(CHILD).dubious).toBe('"Parent rule" changed (product/demo/parent-rule)');
    expect(node(`${ONLINE}/self.yaml`).dubious).toBe('"Parent rule" changed (product/demo/parent-rule)');
    expect(lastFiles()).toHaveLength(4);
    expect(git(repo, ['log', '-1', '--format=%s'])).toContain('marks 3 suspect(s) dubious');
  });

  it('a node already dubious keeps every reason', async () => {
    await one(editParent('First.'));
    await one({ op: 'edit-node', place: ONLINE, field: 'decision', value: 'Online, mostly.', clearDubious: false });
    expect(node(LEAF).dubious).toBe(
      '"Parent rule" changed (product/demo/parent-rule); "Online only" changed (product/demo/parent-rule/online-only)',
    );
    // the edited node kept its own mark: the user left the clearing lever off
    expect(node(`${ONLINE}/self.yaml`).dubious).toBe('"Parent rule" changed (product/demo/parent-rule)');
  });

  // @DecisionRef ui:edit-offers-clearing — an edit with the lever on clears the node's own mark.
  it('editing a dubious node clears its own mark, never its descendants\'', async () => {
    await one(editParent('First.'));
    await one({ op: 'edit-node', place: ONLINE, field: 'questions', value: ['Is offline ever back?'], clearDubious: true });
    expect(node(`${ONLINE}/self.yaml`).dubious).toBeUndefined();
    expect(node(LEAF).dubious).toBeDefined();
  });

  it('questions and names make nothing suspect', () => {
    expect(previewChange(dir, { operations: [{ op: 'edit-node', place: 'product/demo', field: 'questions', value: [] }] }).suspects).toEqual([]);
    expect(previewChange(dir, { operations: [{ op: 'edit-node', place: 'product/demo/parent-rule', field: 'name', value: 'Parent' }] }).suspects).toEqual([]);
  });

  it('rejected, references, includes and context edits cast suspicion like a decision edit', () => {
    const ops: Operation[] = [
      { op: 'edit-node', place: 'product/demo/parent-rule', field: 'rejected', value: ['children rule — too chaotic'] },
      { op: 'edit-node', place: 'product/demo/parent-rule', field: 'references', value: ['view:widget'] },
      { op: 'edit-node', place: 'product/demo/parent-rule', field: 'includes', value: ['notify'] },
      { op: 'edit-node', place: 'product/demo/parent-rule', field: 'context', value: 'a better reason' },
    ];
    for (const op of ops) expect(previewChange(dir, { operations: [op] }).suspects).toHaveLength(3);
  });

  it('an edit inside a capability makes its includers suspect, with their descendants', () => {
    const p = previewChange(dir, { operations: [{ op: 'edit-node', place: 'capabilities/notify/quiet-hours.yaml', field: 'decision', value: 'Nothing fires after ten.' }] });
    expect(p.suspects.map((s) => s.place)).toContain('product/demo');
    expect(p.suspects.map((s) => s.place)).toContain(LEAF);
    expect(p.suspects.find((s) => s.place === 'product/demo')!.reason).toBe('capability notify changed at "Quiet hours" (capabilities/notify/quiet-hours.yaml)');
  });

  // @DecisionRef ui:dubious-set-by-hand — the person's line, cascading to every descendant.
  it('marking by hand writes the reason and cascades, naming the marked ancestor', async () => {
    await one({ op: 'mark-dubious', place: ONLINE, reason: 'contradicts the offline story' });
    expect(node(`${ONLINE}/self.yaml`).dubious).toBe('contradicts the offline story');
    expect(node(LEAF).dubious).toBe('"Online only" above was marked dubious (product/demo/parent-rule/online-only)');
    await expect(one({ op: 'mark-dubious', place: 'product/demo', reason: 'two\nlines' })).rejects.toThrow(/one line/);
  });

  // @DecisionRef ui:dubious-set-by-hand — the question and the mark it gives the reason for, one commit.
  it('a question asked and the node marked dubious by it land as one commit', async () => {
    const before = commits();
    await land({
      operations: [
        { op: 'edit-node', place: ONLINE, field: 'questions', value: ['does offline still hold?'], clearDubious: false },
        { op: 'mark-dubious', place: ONLINE, reason: 'does offline still hold?' },
      ],
    });
    expect(commits()).toBe(before + 1);
    expect(node(`${ONLINE}/self.yaml`).questions).toEqual(['does offline still hold?']);
    expect(node(`${ONLINE}/self.yaml`).dubious).toBe('does offline still hold?');
    expect(node(LEAF).dubious).toBe('"Online only" above was marked dubious (product/demo/parent-rule/online-only)');
  });

  // @DecisionRef ui:dubious-clears-on-work — confirming removes the mark in a commit.
  it('confirming removes the mark in a commit, and never cascades', async () => {
    await one({ op: 'mark-dubious', place: ONLINE, reason: 'saw a contradiction' });
    const out = await one({ op: 'confirm', place: ONLINE });
    expect(out.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(node(`${ONLINE}/self.yaml`).dubious).toBeUndefined();
    expect(node(LEAF).dubious).toBeDefined();
    await expect(one({ op: 'confirm', place: 'product/demo/sibling.yaml' })).rejects.toThrow(/not marked dubious/);
  });
});

describe('editing a node in place', () => {
  // @DecisionRef ui:all-but-id-editable — every field but the id.
  it('edits decision, rejected, references, includes, questions and context', async () => {
    const at = 'product/demo/sibling.yaml';
    await one({ op: 'edit-node', place: at, field: 'decision', value: '  A widget shows its {widget.size}, always.  ' });
    await one({ op: 'edit-node', place: at, field: 'rejected', value: ['a cousin rule — too far', ' '] });
    await one({ op: 'edit-node', place: at, field: 'references', value: ['view:part', 'view:widget'] });
    await one({ op: 'edit-node', place: at, field: 'includes', value: ['notify'] });
    await one({ op: 'edit-node', place: at, field: 'questions', value: ['Who reads it?', ' '] });
    await one({ op: 'edit-node', place: at, field: 'context', value: 'a reason\nand a second line\n\n' });
    expect(node(at)).toEqual({
      id: 'app:sibling',
      name: 'Sibling',
      decision: 'A widget shows its {widget.size}, always.',
      rejected: ['a cousin rule — too far'],
      references: ['view:part', 'view:widget'],
      includes: ['notify'],
      questions: ['Who reads it?'],
      context: 'a reason\nand a second line',
    });
    // keys land in the node's file order
    expect(Object.keys(node(at))).toEqual(['id', 'name', 'decision', 'rejected', 'references', 'includes', 'questions', 'context']);
    // emptied lists and context leave the file
    await one({ op: 'edit-node', place: at, field: 'rejected', value: [] });
    await one({ op: 'edit-node', place: at, field: 'context', value: '  ' });
    expect(Object.keys(node(at))).toEqual(['id', 'name', 'decision', 'references', 'includes', 'questions']);
    await expect(one({ op: 'edit-node', place: at, field: 'decision', value: ' ' })).rejects.toThrow(/cannot be empty/);
  });

  // @DecisionRef ui:tree-root-keeps-directory — a tree root's rename keeps its directory.
  it('a renamed node takes its file name from its name; a tree root keeps its directory', async () => {
    const out = await one({ op: 'edit-node', place: 'product/demo/parent-rule', field: 'name', value: 'Parental guidance' });
    expect(out.landedAt).toBe('product/demo/parental-guidance');
    expect(exists(repo, 'ledger/product/demo/parental-guidance/online-only/deep-leaf.yaml')).toBe(true);
    expect(exists(repo, 'ledger/product/demo/parent-rule')).toBe(false);
    await one({ op: 'edit-node', place: 'product/demo', field: 'name', value: 'Demo app' });
    expect(exists(repo, 'ledger/product/demo/self.yaml')).toBe(true);
    expect(node('product/demo/self.yaml').name).toBe('Demo app');
    await one({ op: 'edit-node', place: 'capabilities/notify', field: 'name', value: 'Notifications' });
    expect(exists(repo, 'ledger/capabilities/notify/self.yaml')).toBe(true);
    await expect(one({ op: 'edit-node', place: 'product/demo/sibling.yaml', field: 'name', value: 'Parental guidance' }))
      .rejects.toThrow(/already taken/);
  });
});

describe('creating, moving and deleting nodes', () => {
  // @DecisionRef ui:create-a-node — a one-decision file: id, name, decision.
  it('creates a one-decision node beneath a leaf, which becomes a directory holding its own node', async () => {
    const out = await one({
      op: 'create-node', parent: 'product/demo/sibling.yaml',
      doc: { id: 'app:little-sibling', name: 'Little sibling', decision: 'The little one.' },
    });
    expect(out.landedAt).toBe('product/demo/sibling/little-sibling.yaml');
    expect(node('product/demo/sibling/little-sibling.yaml')).toEqual({ id: 'app:little-sibling', name: 'Little sibling', decision: 'The little one.' });
    expect(exists(repo, 'ledger/product/demo/sibling/self.yaml')).toBe(true);
    expect(exists(repo, 'ledger/product/demo/sibling.yaml')).toBe(false);
    expect(out.suspects).toEqual([]);
    expect(openLedger(dir).findings).toEqual([]);
  });

  it('creates a new tree root under product or capabilities, and a leaf under engineering', async () => {
    expect((await one({ op: 'create-node', parent: 'capabilities', doc: { id: 'search:any-text', name: 'Search', decision: 'Any text is found.' } })).landedAt)
      .toBe('capabilities/search');
    expect((await one({ op: 'create-node', parent: 'engineering', doc: { id: 'eng:second-practice', name: 'Second practice', decision: 'Twice.', rejected: ['once — too few'] } })).landedAt)
      .toBe('engineering/second-practice.yaml');
    expect(node('engineering/second-practice.yaml').rejected).toEqual(['once — too few']);
    await expect(one({ op: 'create-node', parent: 'models', doc: { id: 'eng:x', name: 'X', decision: 'x' } }))
      .rejects.toThrow(/models directory holds views, not nodes/);
    await expect(one({ op: 'create-node', parent: 'engineering', doc: { id: 'nope:bad', name: 'Bad', decision: 'x' } }))
      .rejects.toThrow(/the check would fail/);
    await expect(one({ op: 'create-node', parent: 'engineering', doc: { id: 'eng:empty', name: 'Empty', decision: ' ' } }))
      .rejects.toThrow(/cannot be empty/);
  });

  // @DecisionRef ui:reparent-is-a-move — the moved subtree becomes suspect.
  it('moves a node with its subtree, and the moved subtree becomes suspect', async () => {
    const out = await one({ op: 'move-node', place: ONLINE, newParent: 'product/demo/sibling.yaml' });
    expect(out.landedAt).toBe('product/demo/sibling/online-only');
    expect(out.marked).toEqual(['product/demo/sibling/online-only', 'product/demo/sibling/online-only/deep-leaf.yaml']);
    expect(node('product/demo/sibling/online-only/deep-leaf.yaml').dubious).toBe('moved with "Online only" to product/demo/sibling/online-only');
    expect(exists(repo, `ledger/${ONLINE}`)).toBe(false);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
    await expect(one({ op: 'move-node', place: 'product/demo/parent-rule', newParent: CHILD }))
      .rejects.toThrow(/beneath itself/);
  });

  it('a preview of a move reads each suspect where it is now', () => {
    const p = previewChange(dir, { operations: [{ op: 'move-node', place: ONLINE, newParent: 'product/demo/sibling.yaml' }] });
    expect(p.suspects.map((s) => [s.place, s.readAt])).toEqual([
      ['product/demo/sibling/online-only', ONLINE],
      ['product/demo/sibling/online-only/deep-leaf.yaml', LEAF],
    ]);
  });

  // @DecisionRef ui:extract-a-capability — move into capabilities, include where it repeated.
  it('extracts a capability: the subtree moves into capabilities and each chosen node includes it', async () => {
    const out = await one({ op: 'extract-capability', place: ONLINE, name: 'offline', includers: [CHILD, 'product/demo/sibling.yaml'] });
    expect(out.landedAt).toBe('capabilities/offline');
    expect(exists(repo, 'ledger/capabilities/offline/self.yaml')).toBe(true);
    expect(node(CHILD).includes).toEqual(['offline']);
    expect(node('product/demo/sibling.yaml').includes).toEqual(['offline']);
    // the moved subtree had its scope changed: it is marked
    expect(out.marked).toContain('capabilities/offline/deep-leaf.yaml');
    expect(openLedger(dir).findings.filter((f) => f.severity === 'error')).toEqual([]);
    await expect(one({ op: 'extract-capability', place: 'product/demo/parent-rule', name: 'parenting', includers: [CHILD] }))
      .rejects.toThrow(/moves with the capability/);
  });

  // @DecisionRef ui:deletion-shows-everything-lost — the preview lists every node and decision
  // the deletion removes, with nothing written.
  it('a preview of a deletion lists every node beneath it, each with its decision', () => {
    const p = previewChange(dir, { operations: [{ op: 'delete-node', place: ONLINE }] });
    expect(p.removed).toEqual([
      { place: LEAF, name: 'Deep leaf', id: 'app:deep-leaf', decision: 'Deep leaves live here.' },
      { place: ONLINE, name: 'Online only', id: 'app:online-only', decision: 'This corner works online only.' },
    ]);
    expect(p.suspects).toEqual([]);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  // @DecisionRef ui:delete-a-node — the node and everything nested beneath it, in one commit.
  it('deletes a node with everything nested beneath it, landing on its parent', async () => {
    const out = await one({ op: 'delete-node', place: ONLINE });
    expect(out.removed.map((r) => r.id)).toEqual(['app:deep-leaf', 'app:online-only']);
    expect(out.landedAt).toBe('product/demo/parent-rule');
    expect(exists(repo, `ledger/${ONLINE}`)).toBe(false);
    expect(exists(repo, `ledger/${CHILD}`)).toBe(true);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
    expect(openLedger(dir).findings).toEqual([]);
    await expect(one({ op: 'delete-node', place: 'models/widget.yaml' })).rejects.toThrow(/there is no node at models\/widget.yaml/);
  });

  it('a deletion the check would fail is refused: a view still cites a decision it removes', async () => {
    await expect(one({ op: 'delete-node', place: 'product/demo/parent-rule' })).rejects.toThrow(/cites 'app:(parent|child)-rule'/);
    expect(exists(repo, `ledger/${CHILD}`)).toBe(true);
  });

  it('deleting a node inside a capability makes its includers suspect', () => {
    const p = previewChange(dir, { operations: [{ op: 'delete-node', place: 'capabilities/notify/quiet-hours.yaml' }] });
    expect(p.removed.map((r) => r.id)).toEqual(['notify:quiet-hours']);
    expect(p.suspects.map((s) => s.place)).toContain('product/demo');
    expect(p.suspects.find((s) => s.place === 'product/demo')!.reason).toBe('capability notify lost "Quiet hours" (capabilities/notify/quiet-hours.yaml)');
  });
});

it('the Refusal class is what the server answers 422 with', () => {
  expect(new Refusal('x')).toBeInstanceOf(Error);
  expect(fs.existsSync(os.tmpdir())).toBe(true);
  expect(path.isAbsolute(dir)).toBe(true);
});
