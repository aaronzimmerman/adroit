import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { parseLedger, validateRecordDoc } from '../src/ledger.js';
import { makeFixtureRepo, rmFixture, write } from './fixture.js';

let repo: string;
beforeAll(() => {
  repo = makeFixtureRepo();
});
afterAll(() => rmFixture(repo));

const opts = { domains: { app: 'x', eng: 'y' }, capabilityNames: ['notify'] };

describe('parseLedger', () => {
  // @DecisionRef adr:hierarchy-is-filesystem — the refinement hierarchy is read from the
  // filesystem: folders are records with children, files are leaves.
  it('reads the tree with the path as the hierarchy', () => {
    const ledger = parseLedger(path.join(repo, 'ledger'));
    expect(ledger.corpus).toBe('fixture');
    const parent = ledger.records.get('app:parent-rule')!;
    expect(parent.parent).toBe('story:demo');
    expect(parent.children).toContain('app:child-rule');
    expect(parent.children).toContain('app:severed-zone');
    const leaf = ledger.records.get('app:deep-leaf')!;
    expect(leaf.parent).toBe('app:severed-zone');
    expect(leaf.depth).toBe(3);
    expect(ledger.productTrees).toEqual([{ name: 'demo', rootId: 'story:demo' }]);
  });

  it('reads capability contracts and models', () => {
    const ledger = parseLedger(path.join(repo, 'ledger'));
    expect(ledger.capabilities[0].name).toBe('notify');
    expect(ledger.capabilities[0].contract.version).toBe(1);
    expect(ledger.models[0].id).toBe('model:widget');
    expect(Object.keys(ledger.models[0].doc.fields)).toEqual(['name', 'size']);
  });

  it('reports a filename stem that does not match the id', () => {
    write(repo, 'ledger/engineering/eng.wrong-stem.yaml', [
      'id: eng:other-name',
      'decision: Mismatch.',
      'rejected: []',
      'links: {}',
      'context: {}',
    ].join('\n'));
    const ledger = parseLedger(path.join(repo, 'ledger'));
    expect(ledger.problems.some((p) => p.includes('wrong-stem'))).toBe(true);
  });
});

describe('validateRecordDoc', () => {
  const base = {
    id: 'app:some-rule',
    decision: 'Do the thing.',
    rejected: [],
    links: {},
    context: {},
  };

  // @DecisionRef eng:decision-per-file — the field list is closed; the check refuses a
  // record carrying status, tokens or api.
  it('refuses fields outside the record shape', () => {
    for (const field of ['status', 'tokens', 'api']) {
      const probs = validateRecordDoc({ ...base, [field]: 'x' }, opts);
      expect(probs.some((p) => p.includes(`"${field}"`))).toBe(true);
    }
  });

  it('requires rejected to be present as a list', () => {
    const { rejected: _, ...withoutRejected } = base;
    const probs = validateRecordDoc(withoutRejected, opts);
    expect(probs.some((p) => p.includes('rejected'))).toBe(true);
    expect(validateRecordDoc(base, opts)).toEqual([]);
  });

  // @DecisionRef adr:hierarchy-is-filesystem — restating refines is a check error.
  it('refuses links.refines', () => {
    const probs = validateRecordDoc({ ...base, links: { refines: 'app:parent-rule' } }, opts);
    expect(probs.some((p) => p.includes('refines'))).toBe(true);
  });

  // @DecisionRef eng:namespace-names-kind — the namespace is looked up, never inferred,
  // and slugs are never numbered.
  it('refuses an undeclared domain and a digit slug', () => {
    expect(
      validateRecordDoc({ ...base, id: 'nope:some-rule' }, opts).some((p) =>
        p.includes('not a declared domain'),
      ),
    ).toBe(true);
    expect(
      validateRecordDoc({ ...base, id: 'app:rule-two2' }, opts).some((p) => p.includes('digits')),
    ).toBe(true);
    expect(validateRecordDoc({ ...base, id: 'notify:send-fast' }, opts)).toEqual([]);
    expect(validateRecordDoc({ ...base, id: 'principle:one-thing' }, opts)).toEqual([]);
  });

  // @DecisionRef eng:commitments-endure-until-canceled — an entry is exactly one of
  // declaration, adherence, negation.
  it('refuses a commitment entry mixing forms', () => {
    const probs = validateRecordDoc(
      { ...base, commitments: [{ id: 'x-y', description: 'd', negation: true }] },
      opts,
    );
    expect(probs.some((p) => p.includes('exactly one'))).toBe(true);
  });
});
