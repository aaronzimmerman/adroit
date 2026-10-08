import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { deriveCommitments, dependentsOf, deriveSkew, projectModelFields, subtreeSize } from '../src/derive.js';
import { parseLedger, type ParsedLedger } from '../src/ledger.js';
import { commitAll, makeFixtureRepo, PAST_EPOCH, rmFixture, write } from './fixture.js';

let repo: string;
let ledger: ParsedLedger;
beforeAll(() => {
  repo = makeFixtureRepo();
  ledger = parseLedger(path.join(repo, 'ledger'));
});
afterAll(() => rmFixture(repo));

// @DecisionRef eng:commitments-endure-until-canceled — tests for the whole derivation:
// silent inheritance, adherence by id, one-way negation, severability, incorporation.
describe('deriveCommitments', () => {
  it('a declaration binds the whole subtree silently', () => {
    const d = deriveCommitments(ledger);
    const atChild = d.effective.get('app:child-rule')!;
    expect(atChild.map((c) => c.id).sort()).toContain('works-offline');
    const offline = atChild.find((c) => c.id === 'works-offline')!;
    expect(offline.declaredBy).toBe('story:demo');
    // the leaf under the parent also inherits with no link written anywhere
    expect(d.effective.get('app:parent-rule')!.map((c) => c.id)).toContain('works-offline');
  });

  it('adherence enriches the effective entry on the adhering record only', () => {
    const d = deriveCommitments(ledger);
    const atChild = d.effective.get('app:child-rule')!.find((c) => c.id === 'works-offline')!;
    expect(atChild.adherence).toBe('caches the demo list locally');
    const atParent = d.effective.get('app:parent-rule')!.find((c) => c.id === 'works-offline')!;
    expect(atParent.adherence).toBeUndefined();
  });

  // @DecisionRef ui:commitments-always-visible — below a negation the commitment simply
  // is not there; nothing about it appears on those records.
  it('negation severs the commitment for the negating record and everything beneath', () => {
    const d = deriveCommitments(ledger);
    expect(d.effective.get('app:severed-zone')!.map((c) => c.id)).not.toContain('works-offline');
    expect(d.effective.get('app:deep-leaf')!.map((c) => c.id)).not.toContain('works-offline');
    expect(d.negations.get('app:severed-zone')).toEqual(['works-offline']);
    // the unsevered commitment is still there
    expect(d.effective.get('app:deep-leaf')!.map((c) => c.id)).toContain('privacy-kept');
  });

  it('incorporation: consuming a capability inherits the contract declarations', () => {
    const d = deriveCommitments(ledger);
    const atRoot = d.effective.get('story:demo')!;
    expect(atRoot.map((c) => c.id)).toContain('quiet-hours');
    expect(atRoot.find((c) => c.id === 'quiet-hours')!.declaredBy).toBe('capability:notify');
    // and it flows down the subtree like any declaration
    expect(d.effective.get('app:deep-leaf')!.map((c) => c.id)).toContain('quiet-hours');
  });

  it('negating an unseverable declaration is a hard incoherence and does not sever', () => {
    write(repo, 'ledger/product/demo/app.parent-rule/app.rogue-zone.yaml', [
      'id: app:rogue-zone',
      'decision: Tries to drop the privacy promise.',
      'rejected: []',
      'commitments:',
      '  - id: privacy-kept',
      '    negation: true',
      'links: {}',
      'context: {}',
    ].join('\n'));
    const l2 = parseLedger(path.join(repo, 'ledger'));
    const d = deriveCommitments(l2);
    expect(
      d.incoherences.some(
        (i) => i.recordId === 'app:rogue-zone' && i.kind === 'negation-of-unseverable',
      ),
    ).toBe(true);
    expect(d.effective.get('app:rogue-zone')!.map((c) => c.id)).toContain('privacy-kept');
  });

  it('re-declaring beneath a negation is incoherent (negation is one-way)', () => {
    write(repo, 'ledger/product/demo/app.parent-rule/app.severed-zone/app.redeclare-try.yaml', [
      'id: app:redeclare-try',
      'decision: Tries to re-declare offline support below the severance.',
      'rejected: []',
      'commitments:',
      '  - id: works-offline',
      '    description: works offline again',
      'links: {}',
      'context: {}',
    ].join('\n'));
    const l2 = parseLedger(path.join(repo, 'ledger'));
    const d = deriveCommitments(l2);
    expect(
      d.incoherences.some(
        (i) => i.recordId === 'app:redeclare-try' && i.kind === 'declare-beneath-negation',
      ),
    ).toBe(true);
  });

  it('adherence to a commitment not in force is incoherent', () => {
    write(repo, 'ledger/engineering/eng.stray-adherence.yaml', [
      'id: eng:stray-adherence',
      'decision: Adheres to something never declared here.',
      'rejected: []',
      'commitments:',
      '  - id: works-offline',
      '    adherence: no declaration reaches the engineering root',
      'links: {}',
      'context: {}',
    ].join('\n'));
    const l2 = parseLedger(path.join(repo, 'ledger'));
    const d = deriveCommitments(l2);
    expect(
      d.incoherences.some(
        (i) => i.recordId === 'eng:stray-adherence' && i.kind === 'adherence-out-of-force',
      ),
    ).toBe(true);
  });
});

describe('graph measures', () => {
  // @DecisionRef principle:scrutiny-follows-dependence — dependents are measured from
  // the graph: refinement children and consumers, never asserted.
  it('dependentsOf unions descendants and consumers', () => {
    const deps = dependentsOf(ledger, 'app:parent-rule');
    expect(deps).toContain('app:child-rule');
    expect(deps).toContain('app:deep-leaf');
    expect(deps).toContain('app:consumer-rule');
    expect(deps).not.toContain('app:parent-rule');
  });

  it('subtreeSize counts the node and its descendants', () => {
    expect(subtreeSize(ledger, 'app:severed-zone')).toBe(2);
    expect(subtreeSize(ledger, 'app:deep-leaf')).toBe(1);
  });

  // @DecisionRef ui:surface-structural-skew — concentration is measured and surfaced.
  it('deriveSkew flags a tree hanging under one child', () => {
    const big = makeFixtureRepo();
    try {
      for (let i = 0; i < 9; i++) {
        const slug = `heavy-${'abcdefghi'[i]}x`;
        write(big, `ledger/product/demo/app.parent-rule/app.severed-zone/app.${slug}.yaml`, [
          `id: app:${slug}`,
          'decision: One of many under the heavy child.',
          'rejected: []',
          'links: {}',
          'context: {}',
        ].join('\n'));
      }
      commitAll(big, 'heavy children', PAST_EPOCH + 1);
      const l2 = parseLedger(path.join(big, 'ledger'));
      const skew = deriveSkew(l2);
      expect(
        skew.some((s) => s.id === 'app:parent-rule' && s.child === 'app:severed-zone'),
      ).toBe(true);
    } finally {
      rmFixture(big);
    }
  });
});

// @DecisionRef eng:changes-are-projectable — projecting pending entries yields the ruled
// shape beside the deployed one.
describe('projectModelFields', () => {
  it('applies add, change and remove', () => {
    const projected = projectModelFields(
      { name: 'old name def', size: 'old size def' },
      [
        { field: 'name', op: 'change', intended: 'new name def', current: 'old name def' },
        { field: 'size', op: 'remove', current: 'old size def' },
        { field: 'color', op: 'add', intended: 'the color' },
      ],
    );
    expect(projected).toEqual({ name: 'new name def', color: 'the color' });
  });
});
