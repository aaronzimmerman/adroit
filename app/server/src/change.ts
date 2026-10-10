// The change-propose capability's operations, realized as the ledger's ONE write path.
// @DecisionRef ui:change-the-ledger — every ledger write the UI can cause goes through
// these operations; there is no other mutation route in the server.
// @DecisionRef eng:refusal-writes-nothing — validation of every operation precedes the
// first write; a refusal leaves the working tree exactly as it found it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SUSPICION_FIELDS } from '@adroit/shared';
import type {
  ChangeDoc,
  ChangeRequest,
  ChangeOutcome,
  ContractDoc,
  EditableField,
  Operation,
  PendingFieldEntry,
  RecordDoc,
} from '@adroit/shared';
import {
  changeToYaml,
  contractToYaml,
  idToStem,
  modelToYaml,
  parseLedger,
  recordToYaml,
  validateRecordDoc,
  type ParsedLedger,
  type ParsedRecord,
} from './ledger.js';
import { dependentsOf, deriveCommitments, subtreeIds } from './derive.js';
import { runGit } from './gitfacts.js';

/** A user-caused refusal; its message is in the user's own terms
 * (@DecisionRef eng:refusal-explains-itself — the field, the limit, never internals). */
export class Refusal extends Error {}

type FsAction =
  | { type: 'write'; rel: string; content: string }
  | { type: 'rename'; from: string; to: string }
  | { type: 'delete'; rel: string };

const EDITABLE_FIELDS: EditableField[] = [
  'decision',
  'rejected',
  'links',
  'context',
  'commitments',
  'dubious',
];
/** Optional fields: an edit with a null value removes the field. */
const OPTIONAL_FIELDS: EditableField[] = ['commitments', 'dubious'];

interface PlanState {
  ledger: ParsedLedger;
  actions: FsAction[];
  /** Ledger-relative paths touched (for scoped git add/commit). */
  touched: Set<string>;
  /** Suspect id -> the one-line reason naming the record whose change made it suspect. */
  suspects: Map<string, string>;
  /** Records the change itself edits or creates: worked by this very commit. */
  worked: Set<string>;
  /** Records whose commitments this change writes directly: only their new
   * incoherences refuse; indirect ones (a move stranding an adherence) surface
   * instead — the commit is never gated (ui:edits-cast-suspicion,
   * principle:inform-dont-fence). */
  commitmentAuthored: Set<string>;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function castSuspicion(state: PlanState, id: string, reason: string): void {
  const prior = state.suspects.get(id);
  state.suspects.set(id, prior && !prior.includes(reason) ? `${prior}; ${reason}` : prior ?? reason);
}

function recordDirFor(rec: ParsedRecord, state: PlanState): string {
  if (rec.isFolder) return rec.nodePath;
  // A leaf file becomes <stem>/self.yaml the moment it has a child
  // (@DecisionRef adr:hierarchy-is-filesystem — the hierarchy is the filesystem).
  const dir = rec.path.replace(/\.yaml$/, '');
  state.actions.push({ type: 'rename', from: rec.path, to: path.posix.join(dir, 'self.yaml') });
  state.touched.add(rec.path);
  state.touched.add(path.posix.join(dir, 'self.yaml'));
  rec.isFolder = true;
  rec.path = path.posix.join(dir, 'self.yaml');
  rec.nodePath = dir;
  return dir;
}

function resolveParentDir(state: PlanState, parentSpec: string): { dir: string; parentId?: string } {
  if (parentSpec === 'engineering') return { dir: 'engineering' };
  const capMatch = /^capabilities\/([a-z][a-z-]*)$/.exec(parentSpec);
  if (capMatch) {
    const cap = state.ledger.capabilities.find((c) => c.name === capMatch[1]);
    if (!cap) throw new Refusal(`capability "${capMatch[1]}" does not exist`);
    return { dir: parentSpec };
  }
  const rec = state.ledger.records.get(parentSpec);
  if (!rec) throw new Refusal(`parent "${parentSpec}" is not a record id or a root`);
  return { dir: recordDirFor(rec, state), parentId: rec.id };
}

function assertLinksResolve(state: PlanState, doc: RecordDoc): void {
  const { ledger } = state;
  // @DecisionRef eng:dependencies-must-resolve — every declared dependency must resolve;
  // principle ids are ambient vocabulary and never dangle (adr:principles-are-ambient).
  for (const g of [...(doc.links.grounds ?? []), ...(doc.links.tension ?? [])]) {
    if (!String(g).startsWith('principle:')) {
      throw new Refusal(`grounds/tension may only name principles, got "${g}"`);
    }
  }
  for (const c of doc.links.consumes ?? []) {
    const t = String(c);
    const ok =
      ledger.capabilities.some((cap) => cap.name === t) ||
      ledger.models.some((m) => m.id === t) ||
      ledger.records.has(t);
    if (!ok) throw new Refusal(`consumes "${t}" does not resolve to a capability, model or record`);
  }
}

function validateDocOrRefuse(state: PlanState, doc: RecordDoc): void {
  const problems = validateRecordDoc(doc as unknown as Record<string, unknown>, {
    domains: state.ledger.domains,
    capabilityNames: state.ledger.capabilities.map((c) => c.name),
  });
  if (problems.length > 0) throw new Refusal(problems.join('; '));
  assertLinksResolve(state, doc);
}

function planCreateRecord(state: PlanState, parent: string, record: RecordDoc): void {
  if (state.ledger.records.has(record.id)) {
    throw new Refusal(`id "${record.id}" is already claimed — ids are unique across the corpus`);
  }
  validateDocOrRefuse(state, record);
  const { dir, parentId } = resolveParentDir(state, parent);
  const stem = idToStem(record.id);
  const rel = path.posix.join(dir, `${stem}.yaml`);
  for (const other of state.ledger.records.values()) {
    if (other.nodePath === rel || other.nodePath === path.posix.join(dir, stem)) {
      throw new Refusal(`a record already sits at ${rel}`);
    }
  }
  state.actions.push({ type: 'write', rel, content: recordToYaml(record) });
  state.touched.add(rel);
  const parentRec = parentId ? state.ledger.records.get(parentId) : undefined;
  const created: ParsedRecord = {
    id: record.id,
    path: rel,
    nodePath: rel,
    isFolder: false,
    root: parentRec ? parentRec.root : dir.startsWith('capabilities/') ? 'capabilities' : 'engineering',
    children: [],
    depth: parentRec ? parentRec.depth + 1 : 0,
    doc: clone(record),
    ...(parentRec ? { parent: parentRec.id, treeName: parentRec.treeName } : {}),
  };
  state.ledger.records.set(record.id, created);
  if (parentRec) parentRec.children.push(record.id);
  if (record.commitments !== undefined) state.commitmentAuthored.add(record.id);
  state.worked.add(record.id);
}

function planEditField(state: PlanState, id: string, field: EditableField, value: unknown): void {
  const rec = state.ledger.records.get(id);
  if (!rec) throw new Refusal(`record "${id}" does not exist`);
  if (!EDITABLE_FIELDS.includes(field)) {
    // @DecisionRef ui:all-but-id-editable — the id is the name every citation binds to;
    // the edit-field set excludes it on both sides of the contract.
    throw new Refusal(
      `"${field}" is not editable — the editable fields are ${EDITABLE_FIELDS.join(', ')}`,
    );
  }
  const next = clone(rec.doc) as RecordDoc & Record<string, unknown>;
  const removing = value === null || value === undefined;
  if (removing && OPTIONAL_FIELDS.includes(field)) {
    if (field === 'dubious' && next.dubious === undefined) {
      // @DecisionRef eng:refusal-explains-itself — confirming is removing the mark; a
      // record without one has nothing to confirm.
      throw new Refusal(`${id} is not marked dubious — there is nothing to confirm`);
    }
    delete (next as Record<string, unknown>)[field];
  } else {
    (next as Record<string, unknown>)[field] = typeof value === 'string' && field === 'dubious' ? value.trim() : value;
  }
  if (field !== 'dubious') {
    // @DecisionRef ui:dubious-is-recorded — reading a record through and editing it clears
    // its mark in the same write.
    delete next.dubious;
  }
  validateDocOrRefuse(state, next);
  if (SUSPICION_FIELDS.includes(field)) {
    // @DecisionRef ui:edits-cast-suspicion — editing a decision casts suspicion across
    // every refinement descendant and every consumer.
    for (const dep of dependentsOf(state.ledger, id)) {
      castSuspicion(state, dep, `${id} was edited (${field}) and this record depends on it`);
    }
  }
  if (field === 'commitments') state.commitmentAuthored.add(id);
  state.worked.add(id);
  rec.doc = next;
  state.actions.push({ type: 'write', rel: rec.path, content: recordToYaml(next) });
  state.touched.add(rec.path);
}

function planMoveRecord(state: PlanState, id: string, newParent: string): void {
  const rec = state.ledger.records.get(id);
  if (!rec) throw new Refusal(`record "${id}" does not exist`);
  if (!rec.parent && rec.root === 'product') {
    throw new Refusal('a product tree root cannot be moved — it is the tree');
  }
  if (newParent !== 'engineering' && !newParent.startsWith('capabilities/')) {
    const inOwnSubtree = subtreeIds(state.ledger, id).includes(newParent);
    if (inOwnSubtree) throw new Refusal(`cannot move ${id} beneath its own subtree`);
  }
  const { dir, parentId } = resolveParentDir(state, newParent);
  const stem = idToStem(id);
  const newNodePath = rec.isFolder ? path.posix.join(dir, stem) : path.posix.join(dir, `${stem}.yaml`);
  if (newNodePath === rec.nodePath) throw new Refusal(`${id} is already there`);
  for (const other of state.ledger.records.values()) {
    if (other.id !== id && (other.nodePath === newNodePath || other.nodePath === path.posix.join(dir, stem))) {
      throw new Refusal(`a record already sits at ${newNodePath}`);
    }
  }
  state.actions.push({ type: 'rename', from: rec.nodePath, to: newNodePath });
  // Touch every file inside the moved node for the scoped add/commit.
  const oldNode = rec.nodePath;
  for (const subId of subtreeIds(state.ledger, id)) {
    const sub = state.ledger.records.get(subId)!;
    state.touched.add(sub.path);
    sub.path = newNodePath + sub.path.slice(oldNode.length ? oldNode.length : 0);
    if (sub.isFolder) sub.nodePath = newNodePath + sub.nodePath.slice(oldNode.length);
    else sub.nodePath = sub.path;
    state.touched.add(sub.path);
    // @DecisionRef ui:edits-cast-suspicion — a move casts the same suspicion over the
    // moved subtree: ancestry changed without touching a field.
    castSuspicion(
      state,
      subId,
      subId === id
        ? `${id} was moved under ${newParent}; its ancestry and effective commitments changed`
        : `moved with ${id} under ${newParent}; its ancestry and effective commitments changed`,
    );
  }
  // Fix up bookkeeping on the moved record itself.
  if (rec.isFolder) {
    rec.nodePath = newNodePath;
    rec.path = path.posix.join(newNodePath, 'self.yaml');
  } else {
    rec.nodePath = newNodePath;
    rec.path = newNodePath;
  }
  const oldParent = rec.parent ? state.ledger.records.get(rec.parent) : undefined;
  if (oldParent) oldParent.children = oldParent.children.filter((c) => c !== id);
  if (parentId) {
    rec.parent = parentId;
    const p = state.ledger.records.get(parentId)!;
    p.children.push(id);
    rec.root = p.root;
    rec.treeName = p.treeName;
  } else {
    delete rec.parent;
    rec.root = dir.startsWith('capabilities/') ? 'capabilities' : 'engineering';
    rec.treeName = dir.startsWith('capabilities/') ? dir.split('/')[1] : undefined;
  }
}

function planSetModelField(state: PlanState, modelId: string, entry: PendingFieldEntry): void {
  const model = state.ledger.models.find((m) => m.id === modelId);
  if (!model) throw new Refusal(`model "${modelId}" does not exist`);
  const deployed = model.doc.fields;
  if (entry.op === 'add' && entry.field in deployed) {
    throw new Refusal(`field "${entry.field}" already exists on ${modelId}; use op "change"`);
  }
  if ((entry.op === 'change' || entry.op === 'remove') && !(entry.field in deployed)) {
    throw new Refusal(`field "${entry.field}" does not exist on ${modelId}`);
  }
  if ((entry.op === 'add' || entry.op === 'change') && !entry.intended) {
    throw new Refusal(`a pending ${entry.op} needs the intended definition`);
  }
  // @DecisionRef adr:models-memorialize-deployed-shape — the deployed statement is not
  // edited; the ruled divergence is recorded as a pending entry beside it.
  const normalized: PendingFieldEntry = {
    field: entry.field,
    op: entry.op,
    ...(entry.intended !== undefined ? { intended: entry.intended } : {}),
    ...(entry.op !== 'add' ? { current: deployed[entry.field] } : {}),
    ...(entry.origin !== undefined ? { origin: entry.origin } : {}),
  };
  const pending = (model.doc.pending ?? []).filter((p) => p.field !== entry.field);
  pending.push(normalized);
  model.doc.pending = pending;
  state.actions.push({ type: 'write', rel: model.path, content: modelToYaml(model.doc) });
  state.touched.add(model.path);
}

function planBeginMigration(
  state: PlanState,
  modelId: string,
  name: string,
  fields: string[],
  origin: string[],
): void {
  const model = state.ledger.models.find((m) => m.id === modelId);
  if (!model) throw new Refusal(`model "${modelId}" does not exist`);
  if (!/^[a-z][a-z-]*$/.test(name)) throw new Refusal('a migration name is lowercase kebab words');
  if (state.ledger.changes.some((c) => c.doc.name === name)) {
    throw new Refusal(`a pending change named "${name}" is already open`);
  }
  if (fields.length === 0) throw new Refusal('a migration gathers at least one pending entry');
  const pending = model.doc.pending ?? [];
  const gathered: PendingFieldEntry[] = [];
  for (const f of fields) {
    const entry = pending.find((p) => p.field === f);
    if (!entry) throw new Refusal(`"${f}" has no pending entry on ${modelId}`);
    gathered.push(entry);
  }
  // @DecisionRef eng:changes-are-projectable — begin-migration births the model:change
  // registering the compliance effort; until then the divergence stays in the model file.
  const doc: ChangeDoc = { name, model: modelId, origin, operations: gathered, state: 'in-flight' };
  model.doc.pending = pending.filter((p) => !fields.includes(p.field));
  const rel = path.posix.join('models', 'pending-changes', `${name}.yaml`);
  state.actions.push({ type: 'write', rel: model.path, content: modelToYaml(model.doc) });
  state.actions.push({ type: 'write', rel, content: changeToYaml(doc) });
  state.touched.add(model.path);
  state.touched.add(rel);
  state.ledger.changes.push({ path: rel, doc });
}

function samePending(a: PendingFieldEntry, b: PendingFieldEntry): boolean {
  return a.field === b.field && a.op === b.op && a.intended === b.intended;
}

/**
 * The user's attestation that a migration in flight shipped: the deployed shape takes the
 * intended shape for every field the change carries, its pending entries go, and the
 * model:change file is deleted — one act, refused whole or applied whole.
 * @DecisionRef adr:models-memorialize-deployed-shape — the model updates only when the
 * migration lands, and this is that landing.
 * @DecisionGap the contract has land-migration remove "the pending entries it gathered",
 * while begin-migration already lifts them out of the model file (model:change "until
 * then"); chosen: landing also removes any identical entry still on the model file.
 */
function planLandMigration(state: PlanState, name: string): void {
  const change = state.ledger.changes.find((c) => c.doc.name === name);
  if (!change) throw new Refusal(`no migration named "${name}" is in flight`);
  const model = state.ledger.models.find((m) => m.id === change.doc.model);
  if (!model) throw new Refusal(`migration "${name}" names model "${change.doc.model}", which does not exist`);
  const operations = change.doc.operations ?? [];
  if (operations.length === 0) throw new Refusal(`migration "${name}" carries no field changes to land`);
  const fields = { ...model.doc.fields };
  for (const op of operations) {
    const deployed = fields[op.field];
    if (op.op === 'add') {
      if (deployed !== undefined) {
        throw new Refusal(`"${op.field}" is already deployed on ${model.id}; the migration adds it`);
      }
    } else if (deployed === undefined) {
      throw new Refusal(`"${op.field}" is not deployed on ${model.id}; the migration ${op.op}s it`);
    } else if (op.current !== undefined && deployed !== op.current) {
      throw new Refusal(
        `the deployed shape of ${model.id}.${op.field} changed since migration "${name}" began`,
      );
    }
    if (op.op === 'remove') delete fields[op.field];
    else {
      if (!op.intended) throw new Refusal(`migration "${name}" has no intended shape for "${op.field}"`);
      fields[op.field] = op.intended;
    }
  }
  model.doc.fields = fields;
  const pending = (model.doc.pending ?? []).filter((p) => !operations.some((g) => samePending(g, p)));
  if (pending.length > 0) model.doc.pending = pending;
  else delete model.doc.pending;
  state.actions.push({ type: 'write', rel: model.path, content: modelToYaml(model.doc) });
  state.actions.push({ type: 'delete', rel: change.path });
  state.touched.add(model.path);
  state.touched.add(change.path);
  state.ledger.changes = state.ledger.changes.filter((c) => c !== change);
}

function planPublishContract(state: PlanState, name: string, contract: ContractDoc): void {
  if (!/^[a-z][a-z-]*$/.test(name)) throw new Refusal('a capability name is lowercase kebab words');
  if (contract.capability !== name) {
    throw new Refusal(`the contract names capability "${contract.capability}", not "${name}"`);
  }
  if (typeof contract.version !== 'number' || contract.version < 1) {
    throw new Refusal('a contract carries a numeric version of at least 1');
  }
  if (!contract.summary) throw new Refusal('a contract carries a summary');
  const existing = state.ledger.capabilities.find((c) => c.name === name);
  if (existing && contract.version <= Number(existing.contract.version ?? 0)) {
    // @DecisionRef adr:capability-contract-artifact — a contract changes as a versioned unit.
    throw new Refusal(
      `capability "${name}" is at version ${existing.contract.version}; publishing again is a version bump`,
    );
  }
  const rel = path.posix.join('capabilities', name, 'contract.yaml');
  state.actions.push({ type: 'write', rel, content: contractToYaml(contract) });
  state.touched.add(rel);
  if (existing) {
    // @DecisionGap ui:edits-cast-suspicion names edits and moves of decisions; a contract
    // is the interface its adherents consume (model:record: "something the record depends
    // on"), so a republish casts suspicion over the adherents. Model operations cast none.
    for (const adherent of state.ledger.records.values()) {
      if ((adherent.doc.links?.consumes ?? []).map(String).includes(name)) {
        castSuspicion(
          state,
          adherent.id,
          `the ${name} contract this record consumes was republished at version ${contract.version}`,
        );
      }
    }
    existing.contract = clone(contract);
  }
  else state.ledger.capabilities.push({ name, contractPath: rel, contract: clone(contract), records: [] });
}

function describeOp(op: Operation): string {
  switch (op.op) {
    case 'create-record':
      return `create ${op.record.id}`;
    case 'edit-field':
      return `edit ${op.id} ${op.field}`;
    case 'move-record':
      return `move ${op.id} under ${op.newParent}`;
    case 'set-model-field':
      return `pend ${op.model}.${op.entry.field} (${op.entry.op})`;
    case 'begin-migration':
      return `begin migration ${op.name} on ${op.model}`;
    case 'land-migration':
      return `land migration ${op.name}`;
    case 'publish-contract':
      return `publish contract ${op.name}`;
  }
}

/**
 * Validate, apply and (unless commit:false) land a change request as ONE atomic commit
 * across every record it touches. Source control is the transaction.
 * @DecisionRef ui:edits-cast-suspicion — the commit is never gated: suspects are reported
 * and marked, never a precondition.
 */
export async function applyChange(
  repoRoot: string,
  ledgerDirName: string,
  req: ChangeRequest,
): Promise<ChangeOutcome> {
  if (!Array.isArray(req.operations) || req.operations.length === 0) {
    throw new Refusal('a change needs at least one operation');
  }
  const ledgerDir = path.join(repoRoot, ledgerDirName);
  const state: PlanState = {
    ledger: parseLedger(ledgerDir),
    actions: [],
    touched: new Set(),
    suspects: new Map(),
    worked: new Set(),
    commitmentAuthored: new Set(),
  };
  const before = deriveCommitments(state.ledger).incoherences;

  // Phase 1 — plan and validate everything; no write happens in here.
  for (const op of req.operations) {
    switch (op.op) {
      case 'create-record':
        planCreateRecord(state, op.parent, op.record);
        break;
      case 'edit-field':
        planEditField(state, op.id, op.field, op.value);
        break;
      case 'move-record':
        planMoveRecord(state, op.id, op.newParent);
        break;
      case 'set-model-field':
        planSetModelField(state, op.model, op.entry);
        break;
      case 'begin-migration':
        planBeginMigration(state, op.model, op.name, op.fields, op.origin);
        break;
      case 'land-migration':
        planLandMigration(state, op.name);
        break;
      case 'publish-contract':
        planPublishContract(state, op.name, op.contract);
        break;
      default:
        throw new Refusal(`unknown operation "${(op as { op: string }).op}"`);
    }
  }

  // Commitment coherence over the projected state: refuse only incoherence this change
  // AUTHORS (a written negation of an unseverable, an adherence out of force). Indirect
  // incoherence — a move stranding a descendant's adherence — surfaces in the snapshot
  // instead: the commit is never gated (ui:edits-cast-suspicion).
  const after = deriveCommitments(state.ledger).incoherences;
  const beforeKeys = new Set(before.map((i) => `${i.recordId}|${i.commitmentId}|${i.kind}`));
  const introduced = after.filter(
    (i) =>
      !beforeKeys.has(`${i.recordId}|${i.commitmentId}|${i.kind}`) &&
      state.commitmentAuthored.has(i.recordId),
  );
  if (introduced.length > 0) {
    throw new Refusal(introduced.map((i) => i.note).join('; '));
  }

  // @DecisionRef ui:dubious-is-recorded — the same act that lands the edit writes the
  // mark onto every suspect not worked before the commit, naming what made it suspect.
  const worked = new Set([...state.worked, ...(req.worked ?? [])]);
  const markedDubious: string[] = [];
  for (const [id, reason] of state.suspects) {
    const rec = state.ledger.records.get(id);
    if (!rec || worked.has(id)) continue;
    const prior = rec.doc.dubious;
    // @DecisionGap one line holds every reason when a record is already dubious; chosen:
    // a new cause is appended to the existing line rather than replacing it.
    const line = prior && !prior.includes(reason) ? `${prior}; ${reason}` : prior ?? reason;
    if (line !== prior) {
      rec.doc = { ...rec.doc, dubious: line };
      state.actions.push({ type: 'write', rel: rec.path, content: recordToYaml(rec.doc) });
      state.touched.add(rec.path);
    }
    markedDubious.push(id);
  }

  // Phase 2 — perform the planned file operations.
  for (const action of state.actions) {
    if (action.type === 'rename') {
      const to = path.join(ledgerDir, action.to);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(path.join(ledgerDir, action.from), to);
    } else if (action.type === 'delete') {
      fs.rmSync(path.join(ledgerDir, action.rel), { force: true });
    } else {
      const to = path.join(ledgerDir, action.rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, action.content);
    }
  }

  // Phase 3 — stage, and land as one atomic commit scoped to exactly the touched paths,
  // so a dirty working tree outside this change is never swept in.
  const touchedRepoPaths = [...state.touched].map((p) => path.posix.join(ledgerDirName, p));
  await runGit(repoRoot, ['add', '-A', '--', ...touchedRepoPaths]);
  let commitHash: string | undefined;
  const wantCommit = req.commit !== false;
  if (wantCommit) {
    const message = req.message?.trim() || req.operations.map(describeOp).join('; ');
    await runGit(repoRoot, ['commit', '-m', message, '--', ...touchedRepoPaths]);
    commitHash = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
  }

  const suspects = [...state.suspects.keys()].filter((s) => state.ledger.records.has(s));
  return {
    ok: true,
    committed: wantCommit,
    ...(commitHash !== undefined ? { commit: commitHash } : {}),
    touched: touchedRepoPaths,
    suspects,
    markedDubious,
  };
}
