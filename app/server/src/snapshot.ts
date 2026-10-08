// Assemble the full derived picture the view renders. The browser is a pure view: it
// never derives from disk, it renders this (@DecisionRef eng:thin-server-owns-files).
import * as path from 'node:path';
import type { DerivedModel, DerivedRecord, LedgerSnapshot } from '@adroit/shared';
import {
  consumersByTarget,
  deriveCommitments,
  deriveSkew,
  projectModelFields,
  subtreeSize,
} from './derive.js';
import { deriveDubious } from './dubious.js';
import { GitFacts } from './gitfacts.js';
import { parseLedger } from './ledger.js';
import { interactionCounts, interactionsPathFor, readInteractions } from './interactions.js';

export interface SnapshotOptions {
  /** Override of the interactions log location (tests). */
  interactionsFile?: string;
}

export async function buildSnapshot(
  repoRoot: string,
  ledgerDirName: string,
  opts: SnapshotOptions = {},
): Promise<LedgerSnapshot> {
  const ledger = parseLedger(path.join(repoRoot, ledgerDirName));
  const git = new GitFacts(repoRoot);
  const consumers = consumersByTarget(ledger);
  const commitments = deriveCommitments(ledger);
  const dubious = await deriveDubious(ledger, ledgerDirName, git);
  const interactions = readInteractions(
    opts.interactionsFile ?? interactionsPathFor(ledger.corpus),
  );
  const counts = interactionCounts(interactions.events);

  const records: Record<string, DerivedRecord> = {};
  for (const rec of ledger.records.values()) {
    records[rec.id] = {
      id: rec.id,
      path: rec.path,
      root: rec.root,
      ...(rec.treeName !== undefined ? { treeName: rec.treeName } : {}),
      ...(rec.parent !== undefined ? { parent: rec.parent } : {}),
      children: rec.children,
      depth: rec.depth,
      doc: rec.doc,
      consumers: consumers.get(rec.id) ?? [],
      subtreeSize: subtreeSize(ledger, rec.id),
      effectiveCommitments: commitments.effective.get(rec.id) ?? [],
      negations: commitments.negations.get(rec.id) ?? [],
      dubious: dubious.get(rec.id) ?? [],
      interactionCount: counts.get(rec.id) ?? 0,
    };
  }

  const models: DerivedModel[] = ledger.models.map((m) => {
    // Pending divergence lives in the model file until a migration gathers it, then in
    // the model:change; projection reads both (eng:changes-are-projectable).
    const openOps = ledger.changes
      .filter((c) => c.doc.model === m.id)
      .flatMap((c) => c.doc.operations ?? []);
    return {
      id: m.id,
      path: m.path,
      doc: m.doc,
      projectedFields: projectModelFields(m.doc.fields, [...(m.doc.pending ?? []), ...openOps]),
      consumers: consumers.get(m.id) ?? [],
      dubious: [],
    };
  });

  return {
    corpus: ledger.corpus,
    domains: ledger.domains,
    productTrees: ledger.productTrees,
    records,
    models,
    changes: ledger.changes,
    capabilities: ledger.capabilities.map((cap) => ({
      name: cap.name,
      contractPath: cap.contractPath,
      contract: cap.contract,
      // @DecisionRef ui:links-explored-by-relation — a capability's adherents are the
      // records whose consumes name it, servable as a tree rooted at the capability.
      adherents: consumers.get(cap.name) ?? [],
      records: cap.records,
    })),
    skew: deriveSkew(ledger),
    incoherences: commitments.incoherences,
    workingDiff: await git.dirtyPaths(ledgerDirName + '/'),
  };
}
