// @DecisionRef eng:thin-server-owns-files — git operations live here on the server; the
// browser only sees derived facts.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseYaml } from './adroit.js';
import { UNCOMMITTED } from './clock.js';

const execFileP = promisify(execFile);

export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** The repository holding a directory, or null when it is in none. */
export async function repoOf(dir: string): Promise<string | null> {
  try {
    return (await runGit(dir, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return null;
  }
}

interface FileCommit {
  hash: string;
  epoch: number;
  status: 'A' | 'M' | 'D' | 'R' | 'C';
  /** True when the commit changed the file's content (a pure rename did not). */
  contentChanged: boolean;
  /** The file's path at (after) this commit. */
  pathAtCommit: string;
}

interface WorkingState {
  contentDirty: boolean;
  renamedFrom?: string;
  untracked: boolean;
}


// Immutable caches: a blob at a commit and a file's history up to a given HEAD never change.
const versionCache = new Map<string, string | null>();
const historyCache = new Map<string, FileCommit[]>();

/**
 * Read-only git facts about one repository, derived fresh per request against the current
 * HEAD and working tree (@DecisionRef principle:derive-dont-materialize — nothing stored).
 */
export class GitFacts {
  private statusMap: Map<string, { x: string; y: string; renamedFrom?: string }> | undefined;
  private headHash: string | null | undefined;

  constructor(readonly repoRoot: string) {}

  async head(): Promise<string | null> {
    if (this.headHash !== undefined) return this.headHash;
    try {
      this.headHash = (await runGit(this.repoRoot, ['rev-parse', 'HEAD'])).trim();
    } catch {
      this.headHash = null;
    }
    return this.headHash;
  }

  /** Repo-relative path -> its status letters, untracked files listed one by one. */
  async status(): Promise<Map<string, { x: string; y: string; renamedFrom?: string }>> {
    if (this.statusMap) return this.statusMap;
    const out = await runGit(this.repoRoot, ['status', '--porcelain=v1', '-z', '-uall']);
    const map = new Map<string, { x: string; y: string; renamedFrom?: string }>();
    const parts = out.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || part.length < 4) continue;
      const x = part[0];
      const y = part[1];
      const p = part.slice(3);
      if (x === 'R' || x === 'C') map.set(p, { x, y, renamedFrom: parts[++i] });
      else map.set(p, { x, y });
    }
    this.statusMap = map;
    return map;
  }

  private async showAt(hash: string, relPath: string): Promise<string | null> {
    const key = `${hash}:${relPath}`;
    if (versionCache.has(key)) return versionCache.get(key)!;
    let content: string | null;
    try {
      content = await runGit(this.repoRoot, ['show', `${hash}:${relPath}`]);
    } catch {
      content = null;
    }
    versionCache.set(key, content);
    return content;
  }

  /** The file's commit history, newest first, following renames. */
  private async fileHistory(relPath: string): Promise<FileCommit[]> {
    const head = await this.head();
    if (!head) return [];
    const key = `${this.repoRoot}|${head}|${relPath}`;
    if (historyCache.has(key)) return historyCache.get(key)!;
    let out = '';
    try {
      out = await runGit(this.repoRoot, ['log', '--follow', '--name-status', '--format=%x01%H %ct', '--', relPath]);
    } catch {
      historyCache.set(key, []);
      return [];
    }
    const commits: FileCommit[] = [];
    for (const block of out.split('\x01')) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      const [hash, epochStr] = lines[0].trim().split(' ');
      for (const line of lines.slice(1)) {
        const m = /^([AMDRC])(\d*)\t([^\t]+)(?:\t(.+))?$/.exec(line.trim());
        if (!m) continue;
        const status = m[1] as FileCommit['status'];
        const score = m[2] ? Number(m[2]) : undefined;
        commits.push({
          hash,
          epoch: Number(epochStr),
          status,
          contentChanged: status === 'R' || status === 'C' ? score !== 100 : status !== 'D',
          pathAtCommit: m[4] !== undefined ? m[4] : m[3],
        });
        break; // one entry per commit for a single followed path
      }
    }
    historyCache.set(key, commits);
    return commits;
  }

  private async workingState(relPath: string): Promise<WorkingState> {
    const st = (await this.status()).get(relPath);
    if (!st) return { contentDirty: false, untracked: false };
    const untracked = st.x === '?' || st.y === '?';
    let contentDirty = untracked || st.x === 'M' || st.y === 'M' || st.x === 'A';
    if ((st.x === 'R' || st.y === 'R') && !contentDirty) {
      const head = await this.head();
      const prev = head && st.renamedFrom ? await this.showAt(head, st.renamedFrom) : null;
      contentDirty = prev !== this.readWorking(relPath);
    }
    return { contentDirty, untracked, ...(st.renamedFrom !== undefined ? { renamedFrom: st.renamedFrom } : {}) };
  }

  private readWorking(relPath: string): string | null {
    try {
      return fs.readFileSync(path.join(this.repoRoot, relPath), 'utf8');
    } catch {
      return null;
    }
  }

  /** Epoch of the last change to the file's CONTENT (UNCOMMITTED when dirty now). */
  async lastContentTouch(relPath: string): Promise<number> {
    const ws = await this.workingState(relPath);
    if (ws.contentDirty) return UNCOMMITTED;
    for (const c of await this.fileHistory(ws.renamedFrom ?? relPath)) if (c.contentChanged) return c.epoch;
    return 0;
  }

  /** The text of one decision inside a node file's content; null when absent or unreadable. */
  private static decisionOf(content: string | null, id: string): string | null {
    if (content === null) return null;
    try {
      const doc = parseYaml(content) as { decisions?: { id?: unknown; decision?: unknown }[] } | null;
      const d = Array.isArray(doc?.decisions) ? doc!.decisions.find((x) => x?.id === id) : undefined;
      return typeof d?.decision === 'string' ? d.decision : null;
    } catch {
      return null;
    }
  }

  /**
   * When the decision's own text last changed, read from the node file's history — the moment
   * the lens measures the code against.
   * @DecisionRef ui:lens-shows-what-changed — "what changed because the decision changed" is
   * measured from this moment.
   */
  async lastDecisionChange(relPath: string, id: string): Promise<{ epoch: number; hash: string | null }> {
    const ws = await this.workingState(relPath);
    const head = await this.head();
    const histPath = ws.renamedFrom ?? relPath;
    if (ws.contentDirty) {
      if (ws.untracked || !head) return { epoch: UNCOMMITTED, hash: null };
      const before = GitFacts.decisionOf(await this.showAt(head, histPath), id);
      if (before !== GitFacts.decisionOf(this.readWorking(relPath), id)) return { epoch: UNCOMMITTED, hash: null };
    }
    const history = await this.fileHistory(histPath);
    for (let i = 0; i < history.length; i++) {
      const cur = history[i];
      if (!cur.contentChanged) continue;
      const prev = history[i + 1];
      if (!prev) return { epoch: cur.epoch, hash: cur.hash };
      const now = GitFacts.decisionOf(await this.showAt(cur.hash, cur.pathAtCommit), id);
      const then = GitFacts.decisionOf(await this.showAt(prev.hash, prev.pathAtCommit), id);
      if (now !== then) return { epoch: cur.epoch, hash: cur.hash };
    }
    return { epoch: 0, hash: null };
  }

  /** A file's diff from a commit to the working tree; empty when it has not moved. */
  async diffSince(hash: string, relPath: string): Promise<string> {
    try {
      return await runGit(this.repoRoot, ['diff', hash, '--', relPath]);
    } catch {
      return '';
    }
  }
}
