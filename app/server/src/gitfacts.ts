// @DecisionRef eng:thin-server-owns-files — git operations live here on the server; the
// browser only sees derived facts.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import { UNCOMMITTED } from './clock.js';

const execFileP = promisify(execFile);

export async function runGit(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export interface FileCommit {
  hash: string;
  epoch: number;
  status: 'A' | 'M' | 'D' | 'R' | 'C';
  /** True when the commit changed the file's content (a pure rename did not). */
  contentChanged: boolean;
  /** The file's path at (after) this commit. */
  pathAtCommit: string;
  renamedFrom?: string;
}

export interface WorkingState {
  /** Present in `git status` at all (any difference from HEAD). */
  dirty: boolean;
  /** Content differs from the HEAD version (at the pre-rename path when renamed). */
  contentDirty: boolean;
  /** The path is a staged rename target. */
  renamed: boolean;
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

  async status(): Promise<Map<string, { x: string; y: string; renamedFrom?: string }>> {
    if (this.statusMap) return this.statusMap;
    // -uall lists untracked files individually (a bare directory entry would hide them).
    const out = await runGit(this.repoRoot, ['status', '--porcelain=v1', '-z', '-uall']);
    const map = new Map<string, { x: string; y: string; renamedFrom?: string }>();
    const parts = out.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || part.length < 4) continue;
      const x = part[0];
      const y = part[1];
      const p = part.slice(3);
      if (x === 'R' || x === 'C') {
        const orig = parts[++i];
        map.set(p, { x, y, renamedFrom: orig });
      } else {
        map.set(p, { x, y });
      }
    }
    this.statusMap = map;
    return map;
  }

  async showAt(hash: string, relPath: string): Promise<string | null> {
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

  /** The file's commit history, newest first, with rename tracking. */
  async fileHistory(relPath: string): Promise<FileCommit[]> {
    const head = await this.head();
    if (!head) return [];
    const key = `${head}|${relPath}`;
    if (historyCache.has(key)) return historyCache.get(key)!;
    let out = '';
    try {
      out = await runGit(this.repoRoot, [
        'log',
        '--follow',
        '--name-status',
        '--format=%x01%H %ct',
        '--',
        relPath,
      ]);
    } catch {
      historyCache.set(key, []);
      return [];
    }
    const commits: FileCommit[] = [];
    for (const block of out.split('\x01')) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      const [hash, epochStr] = lines[0].trim().split(' ');
      const epoch = Number(epochStr);
      for (const line of lines.slice(1)) {
        const m = /^([AMDRC])(\d*)\t([^\t]+)(?:\t(.+))?$/.exec(line.trim());
        if (!m) continue;
        const status = m[1] as FileCommit['status'];
        const score = m[2] ? Number(m[2]) : undefined;
        const from = m[4] !== undefined ? m[3] : undefined;
        const to = m[4] !== undefined ? m[4] : m[3];
        commits.push({
          hash,
          epoch,
          status,
          contentChanged: status === 'R' || status === 'C' ? score !== 100 : status !== 'D',
          pathAtCommit: to,
          ...(from !== undefined ? { renamedFrom: from } : {}),
        });
        break; // one entry per commit for a single followed path
      }
    }
    historyCache.set(key, commits);
    return commits;
  }

  async workingState(relPath: string): Promise<WorkingState> {
    const st = (await this.status()).get(relPath);
    if (!st) return { dirty: false, contentDirty: false, renamed: false, untracked: false };
    const untracked = st.x === '?' || st.y === '?';
    const renamed = st.x === 'R' || st.y === 'R';
    let contentDirty = untracked || st.x === 'M' || st.y === 'M' || st.x === 'A';
    if (renamed && !contentDirty) {
      const head = await this.head();
      const prev = head && st.renamedFrom ? await this.showAt(head, st.renamedFrom) : null;
      const cur = this.readWorking(relPath);
      contentDirty = prev !== cur;
    }
    return {
      dirty: true,
      contentDirty,
      renamed,
      ...(st.renamedFrom !== undefined ? { renamedFrom: st.renamedFrom } : {}),
      untracked,
    };
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
    const histPath = ws.renamed && ws.renamedFrom ? ws.renamedFrom : relPath;
    for (const c of await this.fileHistory(histPath)) {
      if (c.contentChanged) return c.epoch;
    }
    return 0;
  }

  private static decisionOf(content: string | null): string | null {
    if (content === null) return null;
    try {
      const doc = YAML.parse(content) as { decision?: unknown } | null;
      return typeof doc?.decision === 'string' ? doc.decision : null;
    } catch {
      return null;
    }
  }

  /**
   * Epoch of the last change to the record's DECISION field — the rule itself.
   * @DecisionRef ui:read-only-code-lens — the lens reads "what changed in the code because
   * the decision changed" against this moment.
   */
  async lastDecisionChange(relPath: string): Promise<number> {
    const ws = await this.workingState(relPath);
    const head = await this.head();
    const histPath = ws.renamed && ws.renamedFrom ? ws.renamedFrom : relPath;
    if (ws.contentDirty) {
      if (ws.untracked || !head) return UNCOMMITTED;
      const headContent = await this.showAt(head, histPath);
      const headDecision = GitFacts.decisionOf(headContent);
      const nowDecision = GitFacts.decisionOf(this.readWorking(relPath));
      if (headDecision !== nowDecision) return UNCOMMITTED;
    }
    const history = await this.fileHistory(histPath);
    // Walk newest -> oldest comparing each version's decision with its predecessor's.
    for (let i = 0; i < history.length; i++) {
      const cur = history[i];
      if (!cur.contentChanged && cur.status !== 'A') continue;
      if (cur.status === 'A' && i === history.length - 1) return cur.epoch;
      const prev = history[i + 1];
      if (!prev) return cur.epoch;
      const curDecision = GitFacts.decisionOf(await this.showAt(cur.hash, cur.pathAtCommit));
      const prevDecision = GitFacts.decisionOf(await this.showAt(prev.hash, prev.pathAtCommit));
      if (curDecision !== prevDecision) return cur.epoch;
    }
    return 0;
  }

  /** Every ledger-relative path currently differing from HEAD (the working diff). */
  async dirtyPaths(prefix: string): Promise<string[]> {
    const st = await this.status();
    return [...st.keys()].filter((p) => p.startsWith(prefix));
  }
}
