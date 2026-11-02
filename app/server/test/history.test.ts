import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { commitAll, git, ledgerOf, makeFixtureRepo, rmFixture, write } from './fixture.js';

let repo: string;
beforeEach(() => { repo = makeFixtureRepo(); });
afterEach(() => rmFixture(repo));
const head = () => git(repo, ['rev-parse', 'HEAD']).trim();
const commit = (message: string) => { commitAll(repo, message, Math.floor(Date.now() / 1000) - 10); return head(); };
const app = () => createApp({ ledgerDir: ledgerOf(repo) });

describe('ledger history', () => {
  // @DecisionRef ui:recent-ledger-commits — only commits affecting the opened ledger are offered.
  it('lists recent ledger commits with metadata, excluding code-only commits and working changes', async () => {
    const initial = head();
    git(repo, ['config', 'log.showRoot', 'false']);
    git(repo, ['config', 'color.ui', 'always']);
    write(repo, 'src/code.ts', 'export const code = 1;');
    commit('code only');
    write(repo, 'ledger/engineering/new-rule.yaml', 'a new rule\n');
    const changed = commit('change the ledger');
    write(repo, 'ledger/engineering/new-rule.yaml', 'uncommitted\n');
    const res = await request(app()).get('/api/history');
    expect(res.status).toBe(200);
    expect(res.body.commits.map((c: { hash: string }) => c.hash)).toEqual([changed, initial]);
    expect(res.body.commits[0]).toMatchObject({ author: 'Fixture', subject: 'change the ledger', epoch: expect.any(Number) });
    expect(res.body.hasMore).toBe(false);
  });

  // @DecisionRef ui:commit-changed-files — additions, edits and deletions are all selectable.
  // @DecisionRef ui:selected-file-diff — patches come from the commit, even for deleted files.
  it('reads added, edited and deleted files from the commit, independent of the index and working tree', async () => {
    const parent = head();
    write(repo, 'ledger/added.yaml', 'new contents\n');
    write(repo, 'ledger/product/demo/sibling.yaml', 'edited contents\n');
    git(repo, ['rm', '-q', 'ledger/engineering/sample-practice.yaml']);
    write(repo, 'outside.txt', 'not a ledger file\n');
    const hash = commit('add edit delete');
    write(repo, 'ledger/added.yaml', 'later staged contents\n');
    git(repo, ['add', 'ledger/added.yaml']);
    write(repo, 'ledger/added.yaml', 'later working contents\n');
    const beforeStatus = git(repo, ['status', '--porcelain=v1']);
    const server = app();
    const files = await request(server).get('/api/history/files').query({ commit: hash });
    expect(files.status).toBe(200);
    expect(files.body).toEqual({ commit: hash, parent, files: [
      { path: 'added.yaml', status: 'A' },
      { path: 'engineering/sample-practice.yaml', status: 'D' },
      { path: 'product/demo/sibling.yaml', status: 'M' },
    ] });
    for (const [file, expected] of [
      ['added.yaml', '+new contents'],
      ['engineering/sample-practice.yaml', '-decision: Do things the sample way.'],
      ['product/demo/sibling.yaml', '+edited contents'],
    ]) {
      const diff = await request(server).get('/api/history/diff').query({ commit: hash, path: file });
      expect(diff.status).toBe(200);
      expect(diff.body.patch).toContain(expected);
      expect(diff.body.patch).not.toContain('later');
      expect(diff.body.patch).not.toContain('outside.txt');
    }
    expect(head()).toBe(hash);
    expect(git(repo, ['status', '--porcelain=v1'])).toBe(beforeStatus);
  });

  // @DecisionRef ui:commit-comparison-base — roots are additions and merges compare against the first parent.
  it('shows every initial file as added and includes merges that bring ledger changes onto the branch', async () => {
    const server = app();
    const initial = head();
    const initialFiles = await request(server).get('/api/history/files').query({ commit: initial });
    expect(initialFiles.body.parent).toBeNull();
    expect(initialFiles.body.files.every((f: { status: string }) => f.status === 'A')).toBe(true);
    const initialDiff = await request(server).get('/api/history/diff').query({ commit: initial, path: 'domains.yaml' });
    expect(initialDiff.body.patch).toContain('--- /dev/null');
    expect(initialDiff.body.patch).toContain('+corpus: fixture');

    git(repo, ['checkout', '-q', '-b', 'branch']);
    write(repo, 'ledger/branch.yaml', 'from the branch\n');
    commit('branch rule');
    git(repo, ['checkout', '-q', 'main']);
    write(repo, 'main.txt', 'main branch\n');
    const firstParent = commit('main code');
    git(repo, ['merge', '--no-ff', '-q', 'branch', '-m', 'merge rules']);
    const merge = head();
    const files = await request(server).get('/api/history/files').query({ commit: merge });
    expect(files.body).toEqual({ commit: merge, parent: firstParent, files: [{ path: 'branch.yaml', status: 'A' }] });
    const diff = await request(server).get('/api/history/diff').query({ commit: merge, path: 'branch.yaml' });
    expect(diff.body.patch).toContain('+from the branch');
    const history = await request(server).get('/api/history');
    expect(history.body.commits[0].hash).toBe(merge);
  });

  it('treats unusual paths literally and shows moves as deletion and addition', async () => {
    const strange = 'product/demo/rule [*] café\t.yaml';
    git(repo, ['mv', 'ledger/product/demo/sibling.yaml', `ledger/${strange}`]);
    const hash = commit('move rule');
    const server = app();
    const files = await request(server).get('/api/history/files').query({ commit: hash });
    expect(files.body.files).toEqual([
      { path: strange, status: 'A' },
      { path: 'product/demo/sibling.yaml', status: 'D' },
    ]);
    const diff = await request(server).get('/api/history/diff').query({ commit: hash, path: strange });
    expect(diff.status).toBe(200);
    expect(diff.body.patch).toContain('+id: app:sibling');
    expect(diff.body.patch).not.toContain('-id: app:sibling');
  });

  it('keeps ledger edits from both merged branches while omitting merges with no first-parent ledger change', async () => {
    write(repo, 'ledger/shared.yaml', 'base\n');
    commit('shared base');
    git(repo, ['checkout', '-q', '-b', 'topic']);
    write(repo, 'ledger/shared.yaml', 'topic rule\n');
    const topic = commit('topic rule');
    git(repo, ['checkout', '-q', 'main']);
    write(repo, 'ledger/shared.yaml', 'main rule\n');
    const main = commit('main rule');
    git(repo, ['merge', '--no-ff', '-q', '-X', 'theirs', 'topic', '-m', 'choose topic rule']);
    const merge = head();
    git(repo, ['checkout', '-q', '-b', 'discarded']);
    write(repo, 'ledger/discarded.yaml', 'a discarded change\n');
    const discarded = commit('discarded rule');
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '--no-ff', '-q', '-s', 'ours', 'discarded', '-m', 'keep main unchanged']);
    const unchangedMerge = head();
    const history = await request(app()).get('/api/history');
    expect(history.status).toBe(200);
    const hashes = history.body.commits.map((c: { hash: string }) => c.hash);
    expect(hashes).toEqual(expect.arrayContaining([topic, main, merge, discarded]));
    expect(hashes).not.toContain(unchangedMerge);
    const next = await request(app()).get('/api/history').query({ skip: 1, head: history.body.head });
    expect(next.body.commits).toEqual(history.body.commits.slice(1));
  });

  it('rejects invalid commits and paths that were not changed within this ledger', async () => {
    const server = app();
    const hash = head();
    for (const bad of ['HEAD', '--all', '0'.repeat(40), 'a']) {
      const res = await request(server).get('/api/history/files').query({ commit: bad });
      expect(res.status).toBe(422);
      expect(res.body.refusal).toBeTruthy();
    }
    for (const file of ['../outside.txt', ':(top)**', 'missing.yaml', '/etc/passwd']) {
      expect((await request(server).get('/api/history/diff').query({ commit: hash, path: file })).status).toBe(422);
    }
    expect((await request(server).get('/api/history').query({ skip: -1 })).status).toBe(422);
    expect((await request(server).get('/api/history').query({ skip: 'NaN' })).status).toBe(422);
  });

  it('pages a fixed tip while new commits arrive', async () => {
    const start = Math.floor(Date.now() / 1000) - 100;
    for (let i = 0; i < 51; i++) {
      write(repo, 'ledger/page.yaml', `revision ${i}\n`);
      commitAll(repo, `revision ${i}`, start + i);
    }
    const server = app();
    const first = (await request(server).get('/api/history')).body;
    expect(first.commits).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    write(repo, 'ledger/page.yaml', 'newer\n');
    commit('newer');
    const second = (await request(server).get('/api/history').query({ head: first.head, skip: 50 })).body;
    expect(second.head).toBe(first.head);
    expect(second.commits.map((c: { subject: string }) => c.subject)).toEqual(['revision 0', 'fixture initial']);
    expect(second.hasMore).toBe(false);
    expect((await request(server).get('/api/history')).body.commits[0].subject).toBe('newer');
  }, 15_000);

  // @DecisionRef ui:read-ledger-history — history follows the opened directory, not the tool's repository.
  it('scopes a nested ledger literally, follows opening another ledger, and supports a ledger at the repo root', async () => {
    const nested = path.join(repo, 'projects/[demo]');
    fs.mkdirSync(nested, { recursive: true });
    git(repo, ['mv', 'ledger', 'projects/[demo]/decisions']);
    commit('move ledger');
    write(repo, 'projects/d/decisions/unrelated.yaml', 'wrong path\n');
    commit('another project');
    const server = createApp({ ledgerDir: path.join(nested, 'decisions') });
    const history = await request(server).get('/api/history');
    expect(history.body.commits.map((c: { subject: string }) => c.subject)).toEqual(['move ledger']);
    const files = await request(server).get('/api/history/files').query({ commit: history.body.commits[0].hash });
    expect(files.body.files[0].path).not.toContain('projects/');
    await request(server).post('/api/open').send({ dir: repo });
    const root = await request(server).get('/api/history');
    expect(root.status).toBe(200);
    expect(root.body.commits[0].subject).toBe('another project');
  });

  it('returns an empty history before the first commit and explains a ledger outside Git', async () => {
    git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/unborn']);
    const empty = await request(app()).get('/api/history');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ head: null, commits: [], hasMore: false });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'adroit-no-git-'));
    try {
      const res = await request(createApp({ ledgerDir: outside })).get('/api/history');
      expect(res.status).toBe(422);
      expect(res.body.refusal).toContain('not inside a git repository');
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
});
