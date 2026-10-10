import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import YAML from 'yaml';
import { applyChange } from '../src/change.js';
import { parseLedger } from '../src/ledger.js';
import { git, makeFixtureRepo, read, rmFixture } from './fixture.js';

let repo: string;
beforeEach(() => {
  repo = makeFixtureRepo();
});
afterEach(() => rmFixture(repo));

function dubiousOf(id: string): string | undefined {
  return parseLedger(path.join(repo, 'ledger')).records.get(id)?.doc.dubious;
}

const editDecision = (id: string, value: string) =>
  ({ op: 'edit-field', id, field: 'decision', value }) as never;
const setDubious = (id: string, value: string | null) =>
  ({ op: 'edit-field', id, field: 'dubious', value }) as never;

// @DecisionRef ui:dubious-is-recorded — dubiousness is a field on the record, written by the
// commit that edits or moves a decision, or by hand; confirming removes it and commits.
describe('the recorded dubious mark', () => {
  it('a fresh corpus has no dubious records', () => {
    for (const rec of parseLedger(path.join(repo, 'ledger')).records.values()) {
      expect(rec.doc.dubious).toBeUndefined();
    }
  });

  // @DecisionRef ui:edits-cast-suspicion — every refinement descendant and every consumer
  // becomes suspect; the commit marks each unworked one.
  it('editing a decision marks descendants and consumers in the same commit', async () => {
    const before = Number(git(repo, ['rev-list', '--count', 'HEAD']).trim());
    const outcome = await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'Parents rule differently now.')],
    });
    expect(Number(git(repo, ['rev-list', '--count', 'HEAD']).trim())).toBe(before + 1);
    expect(outcome.markedDubious.sort()).toEqual([
      'app:child-rule',
      'app:consumer-rule',
      'app:deep-leaf',
      'app:severed-zone',
    ]);
    // the reason names the record whose change made it suspect
    expect(dubiousOf('app:child-rule')).toContain('app:parent-rule');
    expect(dubiousOf('app:consumer-rule')).toContain('app:parent-rule');
    // the edited record itself and an unrelated root stay clean
    expect(dubiousOf('app:parent-rule')).toBeUndefined();
    expect(dubiousOf('eng:sample-practice')).toBeUndefined();
    // the marks rode in the one commit beside the edit
    const shown = git(repo, ['show', '--name-only', '--format=', 'HEAD']);
    expect(shown).toContain('app.child-rule.yaml');
    expect(shown).toContain('app.consumer-rule.yaml');
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  it('a suspect worked before the commit is not marked', async () => {
    const outcome = await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'Parents rule differently now.')],
      worked: ['app:child-rule'],
    });
    expect(outcome.suspects).toContain('app:child-rule');
    expect(outcome.markedDubious).not.toContain('app:child-rule');
    expect(dubiousOf('app:child-rule')).toBeUndefined();
    expect(dubiousOf('app:consumer-rule')).toBeDefined();
  });

  it('a suspect edited in the same commit is worked and not marked', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        editDecision('app:parent-rule', 'Both move together.'),
        editDecision('app:child-rule', 'Child keeps up in the same act.'),
      ],
    });
    expect(dubiousOf('app:child-rule')).toBeUndefined();
  });

  it('editing only context casts no suspicion', async () => {
    const outcome = await applyChange(repo, 'ledger', {
      operations: [
        { op: 'edit-field', id: 'app:parent-rule', field: 'context', value: { why: 'new why' } } as never,
      ],
    });
    expect(outcome.markedDubious).toEqual([]);
    expect(dubiousOf('app:child-rule')).toBeUndefined();
  });

  // @DecisionRef ui:edits-cast-suspicion — a move casts the same suspicion over the
  // moved subtree: ancestry changed without touching a field.
  it('moving a record marks the moved subtree', async () => {
    await applyChange(repo, 'ledger', {
      operations: [{ op: 'move-record', id: 'app:severed-zone', newParent: 'story:demo' } as never],
    });
    expect(dubiousOf('app:severed-zone')).toContain('moved');
    expect(dubiousOf('app:deep-leaf')).toContain('app:severed-zone');
    expect(dubiousOf('app:child-rule')).toBeUndefined();
    // the mark landed on the file at its new path
    const moved = YAML.parse(
      read(repo, 'ledger/product/demo/app.severed-zone/app.deep-leaf.yaml'),
    ) as { dubious?: string };
    expect(moved.dubious).toBeDefined();
  });

  it('a person sets the mark by hand, stating what they saw', async () => {
    const outcome = await applyChange(repo, 'ledger', {
      operations: [setDubious('eng:sample-practice', 'contradicts the way the parent rule now reads')],
    });
    expect(outcome.committed).toBe(true);
    expect(dubiousOf('eng:sample-practice')).toBe('contradicts the way the parent rule now reads');
  });

  it('confirming removes the field and commits that removal', async () => {
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'Parents rule differently now.')],
    });
    expect(dubiousOf('app:child-rule')).toBeDefined();
    const outcome = await applyChange(repo, 'ledger', {
      operations: [setDubious('app:child-rule', null)],
    });
    expect(outcome.committed).toBe(true);
    expect(outcome.markedDubious).toEqual([]);
    expect(dubiousOf('app:child-rule')).toBeUndefined();
    expect(read(repo, 'ledger/product/demo/app.parent-rule/app.child-rule.yaml')).not.toContain(
      'dubious',
    );
    // confirming casts no suspicion of its own
    expect(dubiousOf('eng:sample-practice')).toBeUndefined();
  });

  it('confirming a record that is not dubious is refused', async () => {
    await expect(
      applyChange(repo, 'ledger', { operations: [setDubious('app:child-rule', null)] }),
    ).rejects.toThrow(/not marked dubious/);
  });

  it('editing the suspect record also clears the mark', async () => {
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'Parents rule differently now.')],
    });
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:child-rule', 'Children follow the different rule.')],
    });
    expect(dubiousOf('app:child-rule')).toBeUndefined();
  });

  it('a second cause joins the one line rather than replacing it', async () => {
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'First change.')],
    });
    await applyChange(repo, 'ledger', {
      operations: [{ op: 'move-record', id: 'app:severed-zone', newParent: 'story:demo' } as never],
    });
    const line = dubiousOf('app:deep-leaf')!;
    expect(line).toContain('app:parent-rule');
    expect(line).toContain('app:severed-zone');
    expect(line).not.toMatch(/\n/);
  });

  it('a republished capability contract marks its adherents', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        {
          op: 'publish-contract',
          name: 'notify',
          contract: { capability: 'notify', version: 2, summary: 'New terms.' },
        } as never,
      ],
    });
    expect(dubiousOf('app:consumer-rule')).toContain('notify');
    expect(dubiousOf('story:demo')).toContain('notify');
  });
});
