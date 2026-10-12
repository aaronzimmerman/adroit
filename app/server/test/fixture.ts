// Test fixture: a temp git repo holding a small node-shaped ledger, written with the tools' own
// YAML writer so its files read exactly as the tools would write them.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { emitYaml } from '../src/adroit.js';

export function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });
}

export function write(repo: string, rel: string, content: unknown): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === 'string' ? content : emitYaml(content));
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
  git(repo, ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

const PAST_EPOCH = Math.floor(Date.now() / 1000) - 10_000;

const d = (id: string, decision: string, extra: Record<string, unknown> = {}) => ({ id, decision, ...extra });

/** The fixture ledger, as files: an app tree with a severable decision a descendant severs, a
 * capability the app root includes, an engineering node and a model. */
export const FIXTURE: Record<string, unknown> = {
  'domains.yaml': { corpus: 'fixture', app: 'The demo app.', eng: 'Engineering practice.' },
  'engineering/sample-practice.yaml': { name: 'Sample practice', decisions: [d('eng:sample-practice', 'Do things the sample way.')] },
  'capabilities/notify/self.yaml': {
    name: 'Notify',
    decisions: [d('notify:tell-the-user', 'The user is told when something happens.', { severable: true })],
  },
  'capabilities/notify/quiet-hours.yaml': { name: 'Quiet hours', decisions: [d('notify:quiet-hours', 'Nothing fires at night.')] },
  'product/demo/self.yaml': {
    name: 'Demo',
    decisions: [
      d('story:demo', 'A user can demo things.'),
      d('app:works-offline', 'Every surface works with no network.', { severable: true }),
    ],
    includes: ['notify'],
    questions: ['Does the demo need accounts?'],
  },
  'product/demo/parent-rule/self.yaml': {
    name: 'Parent rule',
    decisions: [d('app:parent-rule', 'Parents rule broadly.', { rejected: ['letting children rule — too chaotic'] })],
    context: { why: 'because' },
  },
  'product/demo/parent-rule/child-rule.yaml': { name: 'Child rule', decisions: [d('app:child-rule', 'Children follow the parent rule.')] },
  'product/demo/parent-rule/online-only/self.yaml': {
    name: 'Online only',
    decisions: [d('app:online-only', 'This corner works online only.')],
    severed: ['app:works-offline'],
  },
  'product/demo/parent-rule/online-only/deep-leaf.yaml': { name: 'Deep leaf', decisions: [d('app:deep-leaf', 'Deep leaves live here.')] },
  'product/demo/sibling.yaml': { name: 'Sibling', decisions: [d('app:sibling', 'A sibling rule.')] },
  'models/model.widget.yaml': {
    id: 'model:widget',
    decision: 'One widget at rest.',
    shape: { fields: { name: 'scalar (app:parent-rule) — the widget name', size: 'scalar — how big it is' } },
  },
};

/** A git repo whose ledger/ holds the fixture (plus any overrides; null removes a file). */
export function makeFixtureRepo(overrides: Record<string, unknown> = {}): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'adroit-fixture-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'Fixture']);
  for (const [rel, body] of Object.entries({ ...FIXTURE, ...overrides })) {
    if (body !== null) write(repo, `ledger/${rel}`, body);
  }
  commitAll(repo, 'fixture initial', PAST_EPOCH);
  return repo;
}

export const ledgerOf = (repo: string) => path.join(repo, 'ledger');

export function rmFixture(repo: string): void {
  fs.rmSync(repo, { recursive: true, force: true });
}
