import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import type { DubiousReason } from '@adroit/shared';
import { applyChange, confirmRecord } from '../src/change.js';
import { deriveDubious } from '../src/dubious.js';
import { GitFacts } from '../src/gitfacts.js';
import { parseLedger } from '../src/ledger.js';
import { makeFixtureRepo, rmFixture } from './fixture.js';

let repo: string;
beforeEach(() => {
  repo = makeFixtureRepo();
});
afterEach(() => rmFixture(repo));

async function dubiousNow(): Promise<Map<string, DubiousReason[]>> {
  const ledger = parseLedger(path.join(repo, 'ledger'));
  return deriveDubious(ledger, 'ledger', new GitFacts(repo));
}

const editDecision = (id: string, value: string) =>
  ({ op: 'edit-field', id, field: 'decision', value }) as never;

// @DecisionRef ui:dubious-derived-not-stored — dubiousness is computed from git history
// at read time, written nowhere; confirming writes one line of provenance and clears it.
describe('dubiousness derivation', () => {
  it('a fresh corpus has no dubious records', async () => {
    const d = await dubiousNow();
    for (const [, reasons] of d) expect(reasons).toEqual([]);
  });

  it('editing an ancestor decision marks descendants dubious until each is worked', async () => {
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'Parents rule differently now.')],
    });
    const d = await dubiousNow();
    expect(d.get('app:child-rule')).toMatchObject([
      { kind: 'ancestor-decision', source: 'app:parent-rule' },
    ]);
    expect(d.get('app:deep-leaf')!.map((r) => r.source)).toContain('app:parent-rule');
    // the edited record itself is not dubious
    expect(d.get('app:parent-rule')).toEqual([]);
    // an unrelated root is untouched
    expect(d.get('eng:sample-practice')).toEqual([]);
  });

  it('editing a consumed decision marks the consumer dubious', async () => {
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'The rule the consumer leans on moved.')],
    });
    const d = await dubiousNow();
    expect(d.get('app:consumer-rule')).toMatchObject([
      { kind: 'consumed-change', source: 'app:parent-rule' },
    ]);
  });

  it('editing only context casts no suspicion', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        { op: 'edit-field', id: 'app:parent-rule', field: 'context', value: { why: 'new why' } } as never,
      ],
    });
    const d = await dubiousNow();
    expect(d.get('app:child-rule')).toEqual([]);
    expect(d.get('app:consumer-rule')).toEqual([]);
  });

  it('an uncommitted decision edit already casts suspicion (at: 0 = now)', async () => {
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'Staged but not landed.')],
      commit: false,
    });
    const d = await dubiousNow();
    expect(d.get('app:child-rule')).toMatchObject([
      { kind: 'ancestor-decision', source: 'app:parent-rule', at: 0 },
    ]);
  });

  // @DecisionRef ui:edits-cast-suspicion — a move casts the same suspicion over the
  // moved subtree: ancestry changed without touching a field.
  it('moving a record marks the moved subtree dubious', async () => {
    await applyChange(repo, 'ledger', {
      operations: [{ op: 'move-record', id: 'app:severed-zone', newParent: 'story:demo' } as never],
    });
    const d = await dubiousNow();
    expect(d.get('app:severed-zone')!.map((r) => r.kind)).toContain('moved');
    expect(d.get('app:deep-leaf')!.map((r) => r.kind)).toContain('moved');
    expect(d.get('app:child-rule')).toEqual([]);
  });

  it('confirming without editing clears the label through an auditable commit', async () => {
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'Parents rule differently now.')],
    });
    expect((await dubiousNow()).get('app:child-rule')!.length).toBeGreaterThan(0);
    const outcome = await confirmRecord(repo, 'ledger', 'app:child-rule', 'still coherent');
    expect(outcome.committed).toBe(true);
    const d = await dubiousNow();
    expect(d.get('app:child-rule')).toEqual([]);
    // the confirmation is one line of provenance in context, in git
    const ledger = parseLedger(path.join(repo, 'ledger'));
    const reviewed = String(ledger.records.get('app:child-rule')!.doc.context.reviewed);
    expect(reviewed).toContain('still coherent');
  });

  it('editing the suspect record also clears the label', async () => {
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:parent-rule', 'Parents rule differently now.')],
    });
    await applyChange(repo, 'ledger', {
      operations: [editDecision('app:child-rule', 'Children follow the different rule.')],
    });
    const d = await dubiousNow();
    expect(d.get('app:child-rule')).toEqual([]);
  });

  // An expert can land one commit over the whole worked set: nothing stays dubious.
  it('a single commit touching parent and child leaves no residue', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        editDecision('app:parent-rule', 'Both move together.'),
        editDecision('app:child-rule', 'Child keeps up in the same act.'),
      ],
    });
    const d = await dubiousNow();
    expect(d.get('app:child-rule')).toEqual([]);
  });

  it('a changed capability contract marks its adherents dubious', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        {
          op: 'publish-contract',
          name: 'notify',
          contract: { capability: 'notify', version: 2, summary: 'New terms.' },
        } as never,
      ],
    });
    const d = await dubiousNow();
    expect(d.get('app:consumer-rule')!.map((r) => r.source)).toContain('notify');
    expect(d.get('story:demo')!.map((r) => r.source)).toContain('notify');
  });
});
