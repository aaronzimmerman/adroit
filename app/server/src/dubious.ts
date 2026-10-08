// @DecisionRef ui:dubious-derived-not-stored — dubiousness is derived, never stored: a
// record is dubious when an ancestor's decision, or a decision or contract it consumes,
// changed more recently than the record itself was last touched — computed from git
// history at read time, written nowhere.
import * as path from 'node:path';
import type { DubiousReason } from '@adroit/shared';
import { UNCOMMITTED } from './clock.js';
import { ancestorsOf } from './derive.js';
import type { GitFacts } from './gitfacts.js';
import type { ParsedLedger } from './ledger.js';

function reportedAt(epoch: number): number {
  return epoch === UNCOMMITTED ? 0 : epoch;
}

export interface ConsumedTarget {
  key: string;
  /** Repo-relative path of the thing consumed. */
  repoPath: string;
  kind: 'record' | 'model' | 'contract';
}

export function resolveConsumed(
  ledger: ParsedLedger,
  ledgerPrefix: string,
  target: string,
): ConsumedTarget | undefined {
  const cap = ledger.capabilities.find((c) => c.name === target);
  if (cap) return { key: target, repoPath: path.posix.join(ledgerPrefix, cap.contractPath), kind: 'contract' };
  const model = ledger.models.find((m) => m.id === target);
  if (model) return { key: target, repoPath: path.posix.join(ledgerPrefix, model.path), kind: 'model' };
  const rec = ledger.records.get(target);
  if (rec) return { key: target, repoPath: path.posix.join(ledgerPrefix, rec.path), kind: 'record' };
  return undefined;
}

/**
 * Derive the dubious reasons for every record.
 * @DecisionRef ui:edits-cast-suspicion — an edited decision casts suspicion over every
 * descendant and consumer; a move casts it over the moved subtree (the per-file rename is
 * the ancestry change); the label survives any commit until the record is read through
 * and confirmed or edited.
 */
export async function deriveDubious(
  ledger: ParsedLedger,
  ledgerPrefix: string,
  git: GitFacts,
): Promise<Map<string, DubiousReason[]>> {
  const out = new Map<string, DubiousReason[]>();

  const touchCache = new Map<string, Promise<number>>();
  const decisionCache = new Map<string, Promise<number>>();
  const contentCache = new Map<string, Promise<number>>();
  const touch = (p: string) => {
    if (!touchCache.has(p)) touchCache.set(p, git.lastContentTouch(p));
    return touchCache.get(p)!;
  };
  const decisionChange = (p: string) => {
    if (!decisionCache.has(p)) decisionCache.set(p, git.lastDecisionChange(p));
    return decisionCache.get(p)!;
  };
  const contentChange = (p: string) => {
    if (!contentCache.has(p)) contentCache.set(p, git.lastContentChange(p));
    return contentCache.get(p)!;
  };

  for (const rec of ledger.records.values()) {
    const reasons: DubiousReason[] = [];
    const recRepoPath = path.posix.join(ledgerPrefix, rec.path);
    const touched = await touch(recRepoPath);

    for (const ancestor of ancestorsOf(ledger, rec.id)) {
      const t = await decisionChange(path.posix.join(ledgerPrefix, ancestor.path));
      if (t > touched) {
        reasons.push({ kind: 'ancestor-decision', source: ancestor.id, at: reportedAt(t) });
      }
    }

    const renamed = await git.lastRename(recRepoPath);
    if (renamed > touched) {
      reasons.push({ kind: 'moved', source: rec.id, at: reportedAt(renamed) });
    }

    for (const target of rec.doc.links?.consumes ?? []) {
      const resolved = resolveConsumed(ledger, ledgerPrefix, String(target));
      if (!resolved) continue;
      const t =
        resolved.kind === 'record'
          ? await decisionChange(resolved.repoPath)
          : await contentChange(resolved.repoPath);
      if (t > touched) {
        reasons.push({ kind: 'consumed-change', source: resolved.key, at: reportedAt(t) });
      }
    }

    out.set(rec.id, reasons);
  }
  return out;
}
