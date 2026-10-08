import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitFacts } from '../src/gitfacts.js';
import { parseLedger } from '../src/ledger.js';
import { citationsFor, modelFieldUsage, scanCitations } from '../src/lens.js';
import { commitAll, makeFixtureRepo, PAST_EPOCH, rmFixture, write } from './fixture.js';

let repo: string;
beforeAll(() => {
  repo = makeFixtureRepo();
  write(
    repo,
    'app/demo.ts',
    [
      // split so the real repo's citation-resolution gate does not read this literal
      '// @Decision' + 'Ref app:parent-rule — enforces the broad rule at the gate',
      'export function gate(widget: { name: string; size: number }) {',
      '  return widget.name.length < widget.size;',
      '}',
      '// @Decision' + 'Gap is the gate open on weekends? no record says',
    ].join('\n'),
  );
  commitAll(repo, 'code with citations', PAST_EPOCH + 100);
});
afterAll(() => rmFixture(repo));

// @DecisionRef ui:read-only-code-lens / eng:code-cites-its-decisions — the lens reads
// @DecisionRef bindings from the code; attribution never comes from a narrative.
describe('code lens', () => {
  it('finds citations with file, line and snippet', () => {
    const { citations, gaps } = scanCitations(repo, ['app']);
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ id: 'app:parent-rule', file: 'app/demo.ts', line: 1 });
    expect(citations[0].snippet).toContain('export function gate');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].note).toContain('weekends');
  });

  it('reports whether cited code changed since the decision changed', async () => {
    const git = new GitFacts(repo);
    const decisionChangedAt = await git.lastDecisionChange(
      'ledger/product/demo/app.parent-rule/self.yaml',
    );
    const cites = await citationsFor(repo, ['app'], 'app:parent-rule', git, decisionChangedAt);
    expect(cites).toHaveLength(1);
    // code committed after the rule last changed: it has caught up
    expect(cites[0].changedSinceDecision).toBe(true);
  });

  it('measures model field usage as name references, unused fields visible', () => {
    const usage = modelFieldUsage(repo, ['app'], ['name', 'size', 'unused']);
    const byField = Object.fromEntries(usage.map((u) => [u.field, u.count]));
    expect(byField.name).toBeGreaterThan(0);
    expect(byField.size).toBeGreaterThan(0);
    expect(byField.unused).toBe(0);
  });
});

// @DecisionRef eng:code-cites-its-decisions — every cited id must resolve. This gate
// runs against the real repository's app code and ledger.
describe('citation resolution over this repository', () => {
  it('every @DecisionRef id in the app resolves to a live ledger record', () => {
    const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
    const ledger = parseLedger(path.join(repoRoot, 'ledger'));
    const { citations } = scanCitations(repoRoot, ['app']);
    expect(citations.length).toBeGreaterThan(20);
    const known = new Set<string>([...ledger.records.keys(), ...ledger.models.map((m) => m.id)]);
    const dangling = [...new Set(citations.filter((c) => !known.has(c.id)).map((c) => c.id))];
    expect(dangling).toEqual([]);
  });
});
