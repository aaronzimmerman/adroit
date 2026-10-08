// Test fixture: a temp git repo holding a small but complete ledger corpus.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

export function write(repo: string, rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function read(repo: string, rel: string): string {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

export function exists(repo: string, rel: string): boolean {
  return fs.existsSync(path.join(repo, rel));
}

/** Commit everything, dated in the past so later real-time commits compare newer. */
export function commitAll(repo: string, message: string, epochSeconds: number): void {
  git(repo, ['add', '-A']);
  const date = `${epochSeconds} +0000`;
  git(repo, ['commit', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

export const PAST_EPOCH = Math.floor(Date.now() / 1000) - 10_000;

export function makeFixtureRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'adroit-fixture-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'Fixture']);

  write(
    repo,
    'ledger/domains.yaml',
    ['corpus: fixture', 'app: the demo product', 'eng: engineering practice'].join('\n') + '\n',
  );

  write(
    repo,
    'ledger/product/demo/self.yaml',
    [
      'id: story:demo',
      'decision: A user can demo things.',
      'rejected: []',
      'commitments:',
      '  - id: works-offline',
      '    description: every surface works with no network',
      '  - id: privacy-kept',
      '    description: user data never leaves the machine',
      '    severable: false',
      'links:',
      '  consumes: ["notify"]',
      'context: {}',
    ].join('\n') + '\n',
  );

  write(
    repo,
    'ledger/product/demo/app.parent-rule/self.yaml',
    [
      'id: app:parent-rule',
      'decision: Parents rule broadly.',
      'rejected:',
      '  - letting children rule - too chaotic',
      'links: {}',
      'context:',
      '  why: because',
    ].join('\n') + '\n',
  );

  write(
    repo,
    'ledger/product/demo/app.parent-rule/app.child-rule.yaml',
    [
      'id: app:child-rule',
      'decision: Children follow the parent rule.',
      'rejected: []',
      'commitments:',
      '  - id: works-offline',
      '    adherence: caches the demo list locally',
      'links:',
      '  consumes: ["model:widget"]',
      'context: {}',
    ].join('\n') + '\n',
  );

  write(
    repo,
    'ledger/product/demo/app.parent-rule/app.severed-zone/self.yaml',
    [
      'id: app:severed-zone',
      'decision: This corner works online only.',
      'rejected: []',
      'commitments:',
      '  - id: works-offline',
      '    negation: true',
      'links: {}',
      'context: {}',
    ].join('\n') + '\n',
  );

  write(
    repo,
    'ledger/product/demo/app.parent-rule/app.severed-zone/app.deep-leaf.yaml',
    [
      'id: app:deep-leaf',
      'decision: Deep leaves live beneath the severed zone.',
      'rejected: []',
      'links: {}',
      'context: {}',
    ].join('\n') + '\n',
  );

  write(
    repo,
    'ledger/product/demo/app.consumer-rule.yaml',
    [
      'id: app:consumer-rule',
      'decision: Consumers depend on the parent rule.',
      'rejected: []',
      'links:',
      '  consumes: ["app:parent-rule", "notify"]',
      'context: {}',
    ].join('\n') + '\n',
  );

  write(
    repo,
    'ledger/engineering/eng.sample-practice.yaml',
    [
      'id: eng:sample-practice',
      'decision: Do things the sample way.',
      'rejected: []',
      'links: {}',
      'context: {}',
    ].join('\n') + '\n',
  );

  write(
    repo,
    'ledger/capabilities/notify/contract.yaml',
    [
      'capability: notify',
      'version: 1',
      'summary: Tell the user something happened.',
      'operations:',
      '  send: one message to the user',
      'commitments:',
      '  - id: quiet-hours',
      '    description: nothing fires between local midnight and six',
      'blast-radius: messages may arrive from any adherent at any time',
    ].join('\n') + '\n',
  );

  write(
    repo,
    'ledger/models/model.widget.yaml',
    [
      'id: model:widget',
      'summary: One widget at rest.',
      'fields:',
      '  name: scalar - the widget name (app:parent-rule)',
      '  size: scalar - how big it is',
    ].join('\n') + '\n',
  );

  commitAll(repo, 'fixture initial', PAST_EPOCH);
  return repo;
}

export function rmFixture(repo: string): void {
  fs.rmSync(repo, { recursive: true, force: true });
}
