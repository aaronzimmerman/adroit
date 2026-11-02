import * as path from 'node:path';
import * as fs from 'node:fs';
import type { HistoryCommit, HistoryDiff, HistoryFile, HistoryFiles, HistoryPage } from '@adroit/shared';
import { Refusal } from './change.js';
import { GitFacts, runGit } from './gitfacts.js';

const PAGE_SIZE = 50;
const literal = (name: string) => `:(top,literal)${name}`;

/**
 * @DecisionRef ui:read-ledger-history — reads the opened ledger's committed history.
 * @DecisionRef eng:thin-server-owns-files — reuses the server's Git runner; no checkout or index writes.
 */
export class LedgerHistory {
  private readonly prefix: string;

  constructor(private readonly git: GitFacts, ledgerDir: string) {
    const rel = path.relative(fs.realpathSync(git.repoRoot), fs.realpathSync(ledgerDir)).split(path.sep).join('/');
    this.prefix = rel ? `${rel}/` : '';
  }

  private run(args: string[]): Promise<string> {
    return runGit(this.git.repoRoot, args);
  }

  private async commitHash(hash: string): Promise<string> {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) throw new Refusal('choose a commit from the history');
    try {
      return (await this.run(['rev-parse', '--verify', `${hash}^{commit}`])).trim();
    } catch {
      throw new Refusal('this commit is no longer available; refresh the history');
    }
  }

  /** @DecisionRef ui:recent-ledger-commits — page a fixed history tip, scoped to this ledger. */
  async page(skip: number, askedHead?: string): Promise<HistoryPage> {
    if (!Number.isSafeInteger(skip) || skip < 0) throw new Refusal('the history page must be a non-negative whole number');
    const head = askedHead ? await this.commitHash(askedHead) : await this.git.head();
    if (!head) return { head: null, commits: [], hasMore: false };
    const out = await this.run([
      'log', '--date-order', '--full-history', '--diff-merges=first-parent', '--diff-filter=AMDT', '--no-renames',
      '--root', '--no-patch', '--no-color', '--no-show-signature', '-z', '--format=%H%x00%an%x00%ct%x00%s',
      `--max-count=${skip + PAGE_SIZE + 1}`, head, '--', literal(this.prefix),
    ]);
    const fields = out.split('\0');
    const commits: HistoryCommit[] = [];
    for (let i = 0; i + 3 < fields.length; i += 4) {
      commits.push({ hash: fields[i], author: fields[i + 1], epoch: Number(fields[i + 2]), subject: fields[i + 3] });
    }
    // Git applies --skip before --diff-filter. Slice the filtered prefix here so an
    // unchanged merge cannot consume an offset and repeat a commit on the next page.
    return { head, commits: commits.slice(skip, skip + PAGE_SIZE), hasMore: commits.length > skip + PAGE_SIZE };
  }

  /** @DecisionRef ui:commit-comparison-base — merge commits use their first parent; roots use the empty tree. */
  private async comparison(asked: string): Promise<{ commit: string; parent: string | null; args: string[] }> {
    const commit = await this.commitHash(asked);
    const parents = (await this.run(['rev-list', '--parents', '-n', '1', commit])).trim().split(' ');
    const parent = parents[1] ?? null;
    return {
      commit,
      parent,
      args: parent ? ['diff', parent, commit] : ['diff-tree', '--root', '--no-commit-id', '-r', commit],
    };
  }

  private async changedFiles(args: string[]): Promise<HistoryFile[]> {
    const out = await this.run([...args, '--name-status', '--no-renames', '-z', '--', literal(this.prefix)]);
    const parts = out.split('\0');
    const files: HistoryFile[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const status = parts[i];
      const name = parts[i + 1];
      if (!name.startsWith(this.prefix) || !['A', 'M', 'D', 'T'].includes(status)) continue;
      files.push({ path: name.slice(this.prefix.length), status: status as HistoryFile['status'] });
    }
    return files;
  }

  /** @DecisionRef ui:commit-changed-files — enumerate paths at the commit, including deletions. */
  async files(hash: string): Promise<HistoryFiles> {
    const { commit, parent, args } = await this.comparison(hash);
    return { commit, parent, files: await this.changedFiles(args) };
  }

  /** @DecisionRef ui:selected-file-diff — the patch contains only the selected file's committed changes. */
  async diff(hash: string, file: string): Promise<HistoryDiff> {
    const { commit, args } = await this.comparison(hash);
    // Membership, not a path join, is the boundary: never interpret the request as a revision
    // or a pathspec, and never read a file outside this commit's ledger changes.
    if (!(await this.changedFiles(args)).some((f) => f.path === file)) {
      throw new Refusal('choose a ledger file changed in this commit');
    }
    const patch = await this.run([
      ...args, '--patch', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames',
      '--unified=3', '--', literal(`${this.prefix}${file}`),
    ]);
    return { commit, path: file, patch };
  }
}
