// @DecisionRef principle:derive-dont-materialize — everything in this module is computed
// from the parsed files at read time; nothing here is ever written back or cached to disk.
import type {
  CommitmentIncoherence,
  EffectiveCommitment,
  PendingFieldEntry,
  SkewSignal,
} from '@adroit/shared';
import { commitmentEntryKind, type ParsedLedger, type ParsedRecord } from './ledger.js';

/** Reverse consumes edges: id (record, model, or capability name) -> consuming record ids. */
export function consumersByTarget(ledger: ParsedLedger): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const rec of ledger.records.values()) {
    const consumes = rec.doc.links?.consumes;
    if (!Array.isArray(consumes)) continue;
    for (const target of consumes) {
      const key = String(target);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(rec.id);
    }
  }
  return map;
}

export function subtreeSize(ledger: ParsedLedger, id: string): number {
  const rec = ledger.records.get(id);
  if (!rec) return 0;
  let n = 1;
  for (const c of rec.children) n += subtreeSize(ledger, c);
  return n;
}

export function subtreeIds(ledger: ParsedLedger, id: string): string[] {
  const rec = ledger.records.get(id);
  if (!rec) return [];
  const out = [id];
  for (const c of rec.children) out.push(...subtreeIds(ledger, c));
  return out;
}

export function ancestorsOf(ledger: ParsedLedger, id: string): ParsedRecord[] {
  const out: ParsedRecord[] = [];
  let cur = ledger.records.get(id)?.parent;
  while (cur) {
    const rec = ledger.records.get(cur);
    if (!rec) break;
    out.push(rec);
    cur = rec.parent;
  }
  return out;
}

/**
 * The dependents of a change to a record: every refinement descendant and every consumer.
 * @DecisionRef principle:scrutiny-follows-dependence — dependence is measured from the
 * graph (children and consumers), never asserted.
 */
export function dependentsOf(ledger: ParsedLedger, id: string): string[] {
  const consumers = consumersByTarget(ledger);
  const out = new Set<string>(subtreeIds(ledger, id));
  out.delete(id);
  for (const c of consumers.get(id) ?? []) out.add(c);
  return [...out];
}

interface InForce {
  id: string;
  description: string;
  severable: boolean;
  declaredBy: string;
}

export interface CommitmentDerivation {
  /** record id -> effective commitments (inherited and declared alike). */
  effective: Map<string, EffectiveCommitment[]>;
  /** record id -> commitment ids it negates. */
  negations: Map<string, string[]>;
  incoherences: CommitmentIncoherence[];
}

/**
 * Walk every tree deriving each record's EFFECTIVE commitment set.
 * @DecisionRef eng:commitments-endure-until-canceled — a declaration binds the whole
 * subtree silently; adherence enriches by id; negation cancels one-way; a consuming
 * record incorporates a contract's declarations; unseverable negation is hard incoherence.
 * @DecisionRef ui:commitments-always-visible — below a negation the commitment simply is
 * not in the derived set; extent is readable from the declaring and negating records.
 */
export function deriveCommitments(ledger: ParsedLedger): CommitmentDerivation {
  const effective = new Map<string, EffectiveCommitment[]>();
  const negationsByRecord = new Map<string, string[]>();
  const incoherences: CommitmentIncoherence[] = [];

  const contractCommitments = new Map<string, InForce[]>();
  for (const cap of ledger.capabilities) {
    const decls = (cap.contract.commitments ?? []).map((c) => ({
      id: c.id,
      description: c.description,
      severable: c.severable !== false,
      declaredBy: `capability:${cap.name}`,
    }));
    contractCommitments.set(cap.name, decls);
  }

  function visit(recId: string, inherited: InForce[], negatedAbove: Set<string>): void {
    const rec = ledger.records.get(recId);
    if (!rec) return;
    const inForce = new Map(inherited.map((c) => [c.id, c]));
    const negated = new Set(negatedAbove);
    const ownAdherence = new Map<string, string>();
    const ownNegations: string[] = [];

    // Incorporation: consuming a capability inherits the contract's declarations as if
    // declared on this record itself.
    for (const target of rec.doc.links?.consumes ?? []) {
      for (const decl of contractCommitments.get(String(target)) ?? []) {
        if (negated.has(decl.id)) {
          incoherences.push({
            recordId: recId,
            commitmentId: decl.id,
            kind: 'declare-beneath-negation',
            note: `incorporated from ${decl.declaredBy} beneath a negation of ${decl.id}`,
          });
          continue;
        }
        if (!inForce.has(decl.id)) inForce.set(decl.id, decl);
      }
    }

    const entries = rec.doc.commitments ?? [];
    const seen = new Map<string, string>();
    for (const entry of entries) {
      const kind = commitmentEntryKind(entry);
      if (kind === 'invalid') continue; // already a parse problem
      if (seen.has(entry.id) && (seen.get(entry.id) === 'adherence') !== (kind === 'adherence')) {
        incoherences.push({
          recordId: recId,
          commitmentId: entry.id,
          kind: 'adhere-and-negate',
          note: `record carries more than one form for commitment "${entry.id}"`,
        });
        continue;
      }
      seen.set(entry.id, kind);
      if (kind === 'declaration') {
        // One-way negation: beneath a negation the id cannot be re-declared.
        if (negated.has(entry.id)) {
          incoherences.push({
            recordId: recId,
            commitmentId: entry.id,
            kind: 'declare-beneath-negation',
            note: `"${entry.id}" is declared beneath a record that negated it`,
          });
          continue;
        }
        inForce.set(entry.id, {
          id: entry.id,
          description: entry.description ?? '',
          severable: entry.severable !== false,
          declaredBy: recId,
        });
      } else if (kind === 'adherence') {
        if (!inForce.has(entry.id)) {
          incoherences.push({
            recordId: recId,
            commitmentId: entry.id,
            kind: 'adherence-out-of-force',
            note: `adherence to "${entry.id}", which is not in force here`,
          });
          continue;
        }
        ownAdherence.set(entry.id, entry.adherence ?? '');
      } else {
        const decl = inForce.get(entry.id);
        if (!decl) {
          incoherences.push({
            recordId: recId,
            commitmentId: entry.id,
            kind: 'negation-out-of-force',
            note: `negation of "${entry.id}", which is not in force here`,
          });
          continue;
        }
        if (!decl.severable) {
          incoherences.push({
            recordId: recId,
            commitmentId: entry.id,
            kind: 'negation-of-unseverable',
            note: `"${entry.id}" was declared unseverable by ${decl.declaredBy}; this negation is a hard incoherence, not a ruling`,
          });
          // The declaration stays in force: an unseverable commitment admits no negation.
          continue;
        }
        inForce.delete(entry.id);
        negated.add(entry.id);
        ownNegations.push(entry.id);
      }
    }

    effective.set(
      recId,
      [...inForce.values()].map((c) => ({
        ...c,
        ...(ownAdherence.has(c.id) ? { adherence: ownAdherence.get(c.id)! } : {}),
      })),
    );
    negationsByRecord.set(recId, ownNegations);

    for (const child of rec.children) visit(child, [...inForce.values()], negated);
  }

  for (const rec of ledger.records.values()) {
    if (!rec.parent) visit(rec.id, [], new Set());
  }

  return { effective, negations: negationsByRecord, incoherences };
}

// Named once (eng:window-named-once): what counts as "most of a tree under one child",
// and what a subtree must weigh before concentration is worth surfacing.
const SKEW_CONCENTRATION_SHARE = 0.75;
const SKEW_MIN_SUBTREE = 8;

/**
 * @DecisionRef ui:surface-structural-skew — measure where the mass concentrates and where
 * the shape thins out, so the macro view can surface it without being asked.
 */
export function deriveSkew(ledger: ParsedLedger): SkewSignal[] {
  const out: SkewSignal[] = [];
  for (const rec of ledger.records.values()) {
    if (rec.children.length < 2) continue;
    const total = subtreeSize(ledger, rec.id) - 1;
    if (total < SKEW_MIN_SUBTREE) continue;
    for (const child of rec.children) {
      const share = subtreeSize(ledger, child) / total;
      if (share >= SKEW_CONCENTRATION_SHARE) {
        out.push({
          id: rec.id,
          kind: 'concentration',
          child,
          share: Math.round(share * 100) / 100,
          note: `${Math.round(share * 100)}% of the ${total} decisions under ${rec.id} hang beneath ${child}`,
        });
      }
    }
  }
  return out;
}

/** Project a model's pending entries (file entries plus open migrations) onto its fields. */
// @DecisionRef eng:changes-are-projectable — any tool projects the pending change onto the
// model at read time to see the ruled shape beside the deployed one.
export function projectModelFields(
  fields: Record<string, string>,
  pendings: PendingFieldEntry[],
): Record<string, string> {
  const projected = { ...fields };
  for (const p of pendings) {
    if (p.op === 'remove') delete projected[p.field];
    else projected[p.field] = p.intended ?? projected[p.field] ?? '';
  }
  return projected;
}
