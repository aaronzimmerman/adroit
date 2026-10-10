// @DecisionRef ui:read-only-code-lens — a read-only lens into the code: the UI never
// edits code, it only consumes facts about it. Everything here reads; nothing writes.
// @DecisionRef eng:code-cites-its-decisions — attribution derives from @DecisionRef
// bindings in the code plus git facts, never from anyone's narrative of what they did.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CodeCitation } from '@adroit/shared';
import type { GitFacts } from './gitfacts.js';
import { UNCOMMITTED } from './clock.js';

// Named once (eng:window-named-once): which files the lens reads and how much context a
// snippet carries.
const LENS_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.css', '.html'];
const LENS_SKIP_DIRS = ['node_modules', 'dist', '.git'];
const SNIPPET_CONTEXT_LINES = 3;

const REF_RE = /@DecisionRef\s+([a-z][a-z-]*:[a-z][a-z-]*)/g;
const GAP_RE = /@DecisionGap\s+(.+)/g;

export interface RawCitation {
  id: string;
  file: string;
  line: number;
  snippet: string;
}

export interface CodeGap {
  file: string;
  line: number;
  note: string;
}

function* walkCode(repoRoot: string, dirs: string[]): Generator<string> {
  const stack = [...dirs];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!LENS_SKIP_DIRS.includes(e.name)) stack.push(path.posix.join(rel, e.name));
      } else if (LENS_EXTENSIONS.includes(path.extname(e.name))) {
        yield path.posix.join(rel, e.name);
      }
    }
  }
}

export function scanCitations(
  repoRoot: string,
  codeDirs: string[],
): { citations: RawCitation[]; gaps: CodeGap[] } {
  const citations: RawCitation[] = [];
  const gaps: CodeGap[] = [];
  for (const file of walkCode(repoRoot, codeDirs)) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(REF_RE)) {
        const from = Math.max(0, i - SNIPPET_CONTEXT_LINES);
        const to = Math.min(lines.length, i + SNIPPET_CONTEXT_LINES + 1);
        citations.push({
          id: m[1],
          file,
          line: i + 1,
          snippet: lines.slice(from, to).join('\n'),
        });
      }
      for (const m of lines[i].matchAll(GAP_RE)) {
        gaps.push({ file, line: i + 1, note: m[1].trim() });
      }
    }
  }
  return { citations, gaps };
}

/**
 * Citations of one decision, with "did this code change since the rule changed" read
 * from git — what changed in the codebase because the decision changed.
 */
export async function citationsFor(
  repoRoot: string,
  codeDirs: string[],
  id: string,
  git: GitFacts,
  decisionChangedAt: number,
): Promise<CodeCitation[]> {
  const { citations } = scanCitations(repoRoot, codeDirs);
  const out: CodeCitation[] = [];
  for (const c of citations.filter((c) => c.id === id)) {
    const last = await git.lastContentTouch(c.file);
    out.push({
      ...c,
      fileLastChanged: last === UNCOMMITTED ? 0 : last,
      changedSinceDecision: last >= decisionChangedAt && decisionChangedAt > 0,
    });
  }
  return out;
}
