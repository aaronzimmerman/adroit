// @DecisionRef ui:read-only-code-lens — a read-only lens into the code: everything here reads,
// nothing writes.
// @DecisionRef eng:lens-reads-bindings — what changed because a decision changed is derived from
// the code's @DecisionRef bindings and the cited files' diffs, never from anyone's narrative.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CodeCitation } from '@adroit/shared';
import type { GitFacts } from './gitfacts.js';
import { UNCOMMITTED } from './clock.js';

// @DecisionRef eng:window-named-once — named once here: which files the lens reads, how much
// context a snippet carries, and how long a diff it returns.
const LENS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.java', '.css', '.html', '.sql'];
const LENS_SKIP_DIRS = ['node_modules', 'dist', 'dist-types', 'build', 'target', 'coverage', '.git'];
const SNIPPET_CONTEXT_LINES = 3;
const DIFF_MAX_CHARS = 6000;

const REF_RE = /@DecisionRef\s+([a-z][a-z0-9-]*:[a-z0-9]+(?:-[a-z0-9]+)*)/g;

/** Every code file under the repository, the ledger itself left out. */
function* walkCode(repoRoot: string, skip: string): Generator<string> {
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!LENS_SKIP_DIRS.includes(e.name) && child !== skip) stack.push(child);
      } else if (LENS_EXTENSIONS.includes(path.extname(e.name))) {
        yield child;
      }
    }
  }
}

/**
 * Every place the code cites one decision, each with its snippet in context and, read from git,
 * whether — and how — the file moved since the decision's text last changed.
 * @DecisionRef ui:lens-shows-snippets — the citing line arrives with the code around it.
 */
export async function citationsFor(
  git: GitFacts,
  ledgerDir: string,
  id: string,
  decisionFile: string | null,
): Promise<CodeCitation[]> {
  const root = fs.realpathSync(git.repoRoot);
  const skip = path.relative(root, fs.realpathSync(ledgerDir));
  const moment = decisionFile
    ? await git.lastDecisionChange(path.relative(root, path.join(fs.realpathSync(ledgerDir), decisionFile)), id)
    : { epoch: 0, hash: null };
  const out: CodeCitation[] = [];
  for (const file of walkCode(root, skip)) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    if (!text.includes(id)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (![...lines[i].matchAll(REF_RE)].some((m) => m[1] === id)) continue;
      const last = await git.lastContentTouch(file);
      const changed = moment.epoch > 0 && moment.epoch !== UNCOMMITTED && last >= moment.epoch;
      const diff = changed && moment.hash ? (await git.diffSince(moment.hash, file)).slice(0, DIFF_MAX_CHARS) : '';
      out.push({
        id,
        file,
        line: i + 1,
        snippet: lines
          .slice(Math.max(0, i - SNIPPET_CONTEXT_LINES), Math.min(lines.length, i + SNIPPET_CONTEXT_LINES + 1))
          .join('\n'),
        fileLastChanged: last === UNCOMMITTED ? 0 : last,
        changedSinceDecision: changed,
        diff,
      });
    }
  }
  return out;
}
