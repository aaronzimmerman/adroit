// The ledger's ONE write path. A change is a list of operations planned against an in-memory
// copy of the ledger's files, checked with the tools' rules, and only then written and landed
// as one commit.
// @DecisionRef ui:changes-land-as-commits — each change lands as one atomic commit across every
// file it touches.
// @DecisionRef eng:refusal-writes-nothing — planning and validation precede the first write; a
// refused change leaves the working tree exactly as it found it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChangeOutcome, ChangePreview, ChangeRequest, NodeField, Operation, Removed, Suspect } from '@adroit/shared';
import {
  emitYaml,
  entryKind,
  NODE_KEYS,
  parseYaml,
  SELF,
  slugOf,
  type LibEntry,
  type LibStore,
} from './adroit.js';
import { runGit } from './gitfacts.js';
import { findingsOf, openLedger, placeOfFile, storeOf, type Opened, type Unreadable } from './ledger.js';
import { descendantsOf, editReach } from './scope.js';

/** A user-caused refusal, stated in the user's terms.
 * @DecisionRef eng:refusal-explains-itself — the message names the field, the place, the rule. */
export class Refusal extends Error {}

type Doc = Record<string, unknown>;
const isMap = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneLine = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '' && !/[\r\n]/.test(s);
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Writes the tools' house style: a node's keys in their file order. */
function emitNode(raw: Doc): string {
  const ordered: Doc = {};
  for (const k of NODE_KEYS) if (raw[k] !== undefined) ordered[k] = raw[k];
  for (const [k, v] of Object.entries(raw)) if (!(k in ordered)) ordered[k] = v;
  return emitYaml(ordered);
}

/** The change being planned: the ledger's files in memory, and what the change has done so far. */
class Plan {
  readonly files: Map<string, string>;
  /** The files as they were when the change began. */
  readonly original: Map<string, string>;
  /** Current node file -> the file it was before this change (moves rename it). */
  readonly origin = new Map<string, string>();
  /** Suspect node file -> the reasons it is suspect, each naming the node whose change did it. */
  readonly suspects = new Map<string, string[]>();
  /** Node files this change itself writes or creates: read through by its author, never marked. */
  readonly written = new Set<string>();
  /** The nodes this change deletes, each with its decision. */
  readonly removed: Removed[] = [];
  readonly describe: string[] = [];
  landedAt: string | undefined;
  private cached: LibStore | undefined;

  constructor(readonly opened: Opened) {
    this.files = new Map(opened.entries.map((e) => [e.rel, e.content]));
    for (const u of opened.unreadable) this.files.set(u.rel, u.content);
    this.original = new Map(this.files);
    for (const n of opened.store.nodes) this.origin.set(n.rel, n.rel);
  }

  /** The tools' store over the files as they now stand in the plan. */
  store(): LibStore {
    this.cached ??= projected(this.files, this.opened).store;
    return this.cached;
  }

  read(rel: string): Doc {
    const raw = parseYaml(this.files.get(rel) ?? '');
    if (!isMap(raw)) throw new Refusal(`${rel} is not a readable node`);
    return raw;
  }

  write(rel: string, content: string): void {
    this.files.set(rel, content);
    this.cached = undefined;
  }

  remove(rel: string): void {
    this.files.delete(rel);
    this.cached = undefined;
  }

  writeNode(rel: string, raw: Doc): void {
    this.write(rel, emitNode(raw));
    this.written.add(rel);
  }

  /** Move a file, or a directory and everything in it; every key tracking a file follows. */
  move(from: string, to: string): void {
    const remap = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
    for (const key of [...this.files.keys()]) {
      const next = remap(key);
      if (next !== key) {
        this.files.set(next, this.files.get(key)!);
        this.files.delete(key);
      }
    }
    for (const m of [this.origin, this.suspects] as Map<string, unknown>[]) {
      for (const [k, v] of [...m]) {
        if (remap(k) !== k) {
          m.delete(k);
          m.set(remap(k), v);
        }
      }
    }
    for (const k of [...this.written]) {
      if (remap(k) !== k) {
        this.written.delete(k);
        this.written.add(remap(k));
      }
    }
    this.cached = undefined;
  }

  suspect(rel: string, reason: string): void {
    const reasons = this.suspects.get(rel) ?? [];
    if (!reasons.includes(reason)) this.suspects.set(rel, [...reasons, reason]);
  }

  /** The node file at a place, or a refusal naming the place. */
  nodeAt(place: string): string {
    const rel = this.files.has(`${place}/${SELF}`) ? `${place}/${SELF}` : place;
    if (!this.files.has(rel) || entryKind(`ledger/${rel}`) !== 'node') throw new Refusal(`there is no node at ${place || 'the ledger root'}`);
    return rel;
  }

  hasPath(p: string): boolean {
    return this.files.has(p) || [...this.files.keys()].some((k) => k.startsWith(`${p}/`));
  }

  isDir(p: string): boolean {
    return this.opened.dirs.includes(p) || [...this.files.keys()].some((k) => k.startsWith(`${p}/`));
  }

  nameOf(rel: string): string {
    let raw: unknown;
    try {
      raw = parseYaml(this.files.get(rel) ?? '');
    } catch {
      raw = undefined; // an unreadable file is named by its place
    }
    return isMap(raw) && typeof raw.name === 'string' ? raw.name : placeOfFile(rel);
  }
}

/** The tools' store and findings over a set of files. */
function projected(files: Map<string, string>, opened: Opened): { store: LibStore; unreadable: Unreadable[] } {
  const entries: LibEntry[] = [];
  const unreadable: Unreadable[] = [];
  for (const [rel, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const kind = entryKind(`ledger/${rel}`);
    if (!kind) continue;
    if (kind !== 'retired') {
      try {
        parseYaml(content);
      } catch (e) {
        unreadable.push({ rel, message: `${path.basename(opened.dir)}/${rel}: ${(e as Error).message}`, content });
        continue;
      }
    }
    entries.push({ kind, path: `${path.basename(opened.dir)}/${rel}`, rel, content });
  }
  const tops = new Set([...opened.dirs.filter((d) => !d.includes('/')), ...[...files.keys()].filter((k) => k.includes('/')).map((k) => k.split('/')[0])]);
  return { store: storeOf(entries, [...tops]), unreadable };
}

// ---------------------------------------------------------------------------
// Suspicion (ADROIT.md, Dubious)

/** An edit of a node's decision, rejected, references, includes or context casts suspicion over
 * its reach, each suspect naming the edited node.
 * @DecisionRef ui:change-shows-implications — the reach is measured from the tree. */
function castEditSuspicion(plan: Plan, rel: string): void {
  const name = plan.nameOf(rel);
  for (const [suspect, why] of editReach(plan.store(), rel)) {
    plan.suspect(
      suspect,
      why.kind === 'descendant'
        ? `"${name}" changed (${placeOfFile(rel)})`
        : `capability ${why.capability} changed at "${name}" (${placeOfFile(rel)})`,
    );
  }
}

/** Every reason kept: a new cause joins the node's existing line. */
function withReason(prior: unknown, reason: string): string {
  const line = typeof prior === 'string' ? prior.trim() : '';
  if (!line) return reason;
  return line.split('; ').includes(reason) ? line : `${line}; ${reason}`;
}

function clearMark(plan: Plan, rel: string, raw: Doc, clear: boolean | undefined): void {
  // @DecisionRef ui:dubious-clears-on-work — an edit made after reading the node through clears
  // its own mark when the user leaves that lever on; never its descendants'.
  if (clear) delete raw.dubious;
  plan.writeNode(rel, raw);
}

// ---------------------------------------------------------------------------
// Where a node lands

/** The directory a node goes into beneath a place, and whether it becomes a tree's root.
 * A leaf that gains a child becomes a directory holding its own self.yaml. */
function targetDir(plan: Plan, parent: string): { dir: string; treeRoot: boolean } {
  if (parent === '') throw new Refusal('choose a root or a node to place it beneath');
  if (parent === 'models' || parent.startsWith('models/')) {
    throw new Refusal('the models directory holds views, not nodes');
  }
  if (parent === 'product' || parent === 'capabilities') return { dir: parent, treeRoot: true };
  if (parent === 'engineering') return { dir: parent, treeRoot: false };
  if (plan.files.has(`${parent}/${SELF}`)) return { dir: parent, treeRoot: false };
  if (parent.endsWith('.yaml') && plan.files.has(parent)) {
    plan.nodeAt(parent);
    const dir = parent.slice(0, -'.yaml'.length);
    if (plan.files.has(`${dir}/${SELF}`)) throw new Refusal(`${dir} already has its own node`);
    plan.move(parent, `${dir}/${SELF}`);
    return { dir, treeRoot: false };
  }
  if (plan.isDir(parent) && !parent.startsWith('models')) return { dir: parent, treeRoot: false };
  throw new Refusal(`there is no place ${parent} to put it beneath`);
}

function assertFree(plan: Plan, ...paths: string[]): void {
  for (const p of paths) if (plan.hasPath(p)) throw new Refusal(`${p} is already taken`);
}

/** Move a node — its whole subtree when it is a directory — beneath a parent place. */
function moveNode(plan: Plan, place: string, parent: string, base?: string): string {
  const rel = plan.nodeAt(place);
  const isDirNode = path.posix.basename(rel) === SELF;
  const src = isDirNode ? path.posix.dirname(rel) : rel;
  if (parent === src || parent.startsWith(`${src}/`)) throw new Refusal(`a node cannot move beneath itself`);
  const name = base ?? path.posix.basename(src, '.yaml');
  const { dir, treeRoot } = targetDir(plan, parent);
  let landed: string;
  if (treeRoot || isDirNode) {
    const dest = `${dir}/${name}`;
    if (dest === src) throw new Refusal(`${place} is already there`);
    assertFree(plan, dest, `${dest}.yaml`);
    plan.move(src, isDirNode ? dest : `${dest}/${SELF}`);
    landed = `${dest}/${SELF}`;
  } else {
    const dest = `${dir}/${name}.yaml`;
    if (dest === src) throw new Refusal(`${place} is already there`);
    assertFree(plan, dest, dest.slice(0, -'.yaml'.length));
    plan.move(src, dest);
    landed = dest;
  }
  // @DecisionRef ui:reparent-is-a-move — the moved subtree's scope changed, so each node in it
  // becomes suspect, naming the moved node.
  const movedName = plan.nameOf(landed);
  const where = placeOfFile(landed);
  for (const n of [landed, ...descendantsOf(plan.store(), landed).map((d) => d.rel)]) {
    plan.suspect(n, n === landed ? `moved to ${where}` : `moved with "${movedName}" to ${where}`);
  }
  plan.landedAt = where;
  return landed;
}

// ---------------------------------------------------------------------------
// The operations

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A list edited as lines: each entry trimmed, an emptied one dropped. */
function listOf(v: unknown, refusal: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Refusal(refusal);
  return v.map((x) => x.trim()).filter(Boolean);
}

/** A list key is written when it holds something and dropped when it is emptied. */
function setList(raw: Doc, key: string, v: string[]): void {
  if (v.length) raw[key] = v;
  else delete raw[key];
}

/**
 * Edit one field of a node in place.
 * @DecisionRef ui:all-but-id-editable — name, decision, rejected, references, includes, context
 * and questions edit here, and the dubious mark by marking and confirming; the id never does.
 */
function editNode(plan: Plan, op: Extract<Operation, { op: 'edit-node' }>): void {
  let rel = plan.nodeAt(op.place);
  const raw = plan.read(rel);
  const field: NodeField = op.field;
  switch (field) {
    case 'name': {
      if (!oneLine(op.value)) throw new Refusal('a name is one non-empty line');
      const name = op.value.trim();
      const slug = slugOf(name);
      if (!slug) throw new Refusal(`"${name}" gives no file name — a name needs letters or digits`);
      raw.name = name;
      clearMark(plan, rel, raw, op.clearDubious);
      // The file name is the name as a slug.
      // @DecisionRef ui:tree-root-keeps-directory — a product or capability tree's root keeps its
      // directory, which is the tree's name (the name includes resolve).
      const isDirNode = path.posix.basename(rel) === SELF;
      const src = isDirNode ? path.posix.dirname(rel) : rel;
      const treeRoot = isDirNode && /^(product|capabilities)\/[^/]+$|^engineering$/.test(src);
      const dest = isDirNode ? `${path.posix.dirname(src)}/${slug}` : `${path.posix.dirname(src)}/${slug}.yaml`;
      if (!treeRoot && dest !== src) {
        assertFree(plan, dest, isDirNode ? `${dest}.yaml` : dest.slice(0, -'.yaml'.length));
        plan.move(src, dest);
        rel = isDirNode ? `${dest}/${SELF}` : dest;
        plan.landedAt = placeOfFile(rel);
      }
      plan.describe.push(`rename ${placeOfFile(rel)}`);
      return;
    }
    case 'decision':
      if (typeof op.value !== 'string' || !op.value.trim()) throw new Refusal('a decision states its rule — it cannot be empty');
      raw.decision = op.value.trim();
      break;
    case 'rejected':
      setList(raw, 'rejected', listOf(op.value, 'rejected is a list of alternatives, each with why it lost'));
      break;
    case 'references':
      setList(raw, 'references', listOf(op.value, 'references is a list of view ids'));
      break;
    case 'includes':
      setList(raw, 'includes', listOf(op.value, 'includes is a list of capability names'));
      break;
    case 'questions': {
      // An emptied line is dropped, never written empty.
      const v = listOf(op.value, 'questions is a list of lines');
      if (v.some((q) => /[\r\n]/.test(q))) throw new Refusal('each question is one line');
      setList(raw, 'questions', v);
      clearMark(plan, rel, raw, op.clearDubious);
      plan.describe.push(`questions on ${placeOfFile(rel)}`);
      // Asking, answering or dropping a question makes nothing suspect (ADROIT.md, Dubious).
      return;
    }
    case 'context':
      // Context is one free-form text (ADROIT.md, The node).
      if (typeof op.value !== 'string') throw new Refusal('context is free-form text');
      if (!op.value.trim()) delete raw.context;
      else raw.context = op.value.replace(/\s+$/, '');
      break;
    default:
      throw new Refusal(`"${String(field)}" is not an editable field of a node — its id is fixed`);
  }
  clearMark(plan, rel, raw, op.clearDubious);
  plan.describe.push(`edit ${field} of ${placeOfFile(rel)}`);
  castEditSuspicion(plan, rel);
}

/** @DecisionRef ui:create-a-node — a one-decision node, in its place in the tree. */
function createNode(plan: Plan, op: Extract<Operation, { op: 'create-node' }>): void {
  const doc = op.doc;
  if (!doc || !oneLine(doc.name)) throw new Refusal('a node needs a one-line name');
  if (!oneLine(doc.id)) throw new Refusal('a node needs its decision\'s id, on one line');
  if (typeof doc.decision !== 'string' || !doc.decision.trim()) throw new Refusal('a decision states its rule — it cannot be empty');
  const slug = slugOf(doc.name);
  if (!slug) throw new Refusal(`"${doc.name}" gives no file name — a name needs letters or digits`);
  const { dir, treeRoot } = targetDir(plan, op.parent);
  const rel = treeRoot ? `${dir}/${slug}/${SELF}` : `${dir}/${slug}.yaml`;
  assertFree(plan, treeRoot ? `${dir}/${slug}` : rel, treeRoot ? `${dir}/${slug}.yaml` : `${dir}/${slug}`);
  const raw: Doc = { id: doc.id.trim(), name: doc.name.trim(), decision: doc.decision.trim() };
  if (doc.rejected !== undefined) setList(raw, 'rejected', listOf(doc.rejected, 'rejected is a list of alternatives, each with why it lost'));
  plan.writeNode(rel, raw);
  plan.origin.set(rel, rel);
  plan.landedAt = placeOfFile(rel);
  plan.describe.push(`create ${placeOfFile(rel)}`);
}

/**
 * Delete a node and everything nested beneath it; each node removed is listed with its decision.
 * @DecisionRef ui:delete-a-node — the whole subtree goes; nothing is re-parented.
 * @DecisionRef ui:deletion-shows-everything-lost — the plan records every node and decision lost.
 * Deleting inside a capability makes its includers suspect (ADROIT.md, Dubious).
 */
function deleteNode(plan: Plan, op: Extract<Operation, { op: 'delete-node' }>): void {
  const rel = plan.nodeAt(op.place);
  const store = plan.store();
  const src = path.posix.basename(rel) === SELF ? path.posix.dirname(rel) : rel;
  const gone = (f: string) => f === src || f.startsWith(`${src}/`);
  const name = plan.nameOf(rel);
  const decisionOf = new Map(store.records.filter((r) => r._node).map((r) => [r._node!, r]));
  for (const f of [...plan.files.keys()].filter(gone).sort()) {
    if (entryKind(`ledger/${f}`) !== 'node') continue;
    const n = store.nodeByRel.get(f);
    plan.removed.push({
      place: placeOfFile(plan.origin.get(f) ?? f),
      name: plan.nameOf(f),
      id: n?.id ?? '',
      decision: text(decisionOf.get(f)?.decision),
    });
  }
  for (const [suspect, why] of editReach(store, rel)) {
    if (why.kind === 'includer' && !gone(suspect)) {
      plan.suspect(suspect, `capability ${why.capability} lost "${name}" (${placeOfFile(rel)})`);
    }
  }
  const parent = store.nodeByRel.get(rel)?.parent;
  for (const f of [...plan.files.keys()].filter(gone)) plan.remove(f);
  plan.landedAt = parent ? placeOfFile(parent) : path.posix.dirname(src);
  plan.describe.push(`delete ${op.place}`);
}

function markDubious(plan: Plan, op: Extract<Operation, { op: 'mark-dubious' }>): void {
  if (!oneLine(op.reason)) throw new Refusal('say what you saw, in one line');
  const rel = plan.nodeAt(op.place);
  const raw = plan.read(rel);
  const name = plan.nameOf(rel);
  raw.dubious = withReason(raw.dubious, op.reason.trim());
  plan.write(rel, emitNode(raw));
  // Cascade: every descendant is marked too, naming the marked ancestor (ADROIT.md, Dubious).
  for (const d of descendantsOf(plan.store(), rel)) {
    const draw = plan.read(d.rel);
    draw.dubious = withReason(draw.dubious, `"${name}" above was marked dubious (${placeOfFile(rel)})`);
    plan.write(d.rel, emitNode(draw));
  }
  plan.describe.push(`mark ${placeOfFile(rel)} dubious`);
}

function confirm(plan: Plan, op: Extract<Operation, { op: 'confirm' }>): void {
  const rel = plan.nodeAt(op.place);
  const raw = plan.read(rel);
  if (raw.dubious === undefined) throw new Refusal(`${op.place} is not marked dubious — there is nothing to confirm`);
  delete raw.dubious;
  // Clearing never cascades: each descendant stays dubious until it is worked itself.
  plan.write(rel, emitNode(raw));
  plan.describe.push(`confirm ${placeOfFile(rel)}`);
}

function apply(plan: Plan, op: Operation): void {
  switch (op?.op) {
    case 'edit-node':
      return editNode(plan, op);
    case 'create-node':
      return createNode(plan, op);
    case 'delete-node':
      return deleteNode(plan, op);
    case 'move-node':
      moveNode(plan, op.place, op.newParent);
      plan.describe.push(`move ${op.place} beneath ${op.newParent}`);
      return;
    case 'extract-capability': {
      // @DecisionRef ui:extract-a-capability — the pattern's root moves into the capabilities
      // root, and each place it repeated includes it, in one change.
      if (!KEBAB.test(op.name ?? '')) throw new Refusal('a capability is named in lowercase kebab words');
      const rel = plan.nodeAt(op.place);
      const src = path.posix.basename(rel) === SELF ? path.posix.dirname(rel) : rel;
      const includers = (op.includers ?? []).map((p) => {
        let at: string;
        try {
          at = plan.nodeAt(p);
        } catch {
          throw new Refusal(`there is no node at ${p} to include ${op.name}`);
        }
        if (at === rel || at.startsWith(`${src}/`)) throw new Refusal(`${p} moves with the capability — it cannot include it`);
        return at;
      });
      // Nothing outside the moved subtree changes path, so each includer keeps its file.
      moveNode(plan, op.place, 'capabilities', op.name);
      for (const at of includers) {
        const raw = plan.read(at);
        const inc = Array.isArray(raw.includes) ? (raw.includes as string[]) : [];
        if (!inc.includes(op.name)) raw.includes = [...inc, op.name];
        plan.writeNode(at, raw);
        castEditSuspicion(plan, at);
      }
      plan.describe.push(`extract capability ${op.name}`);
      return;
    }
    case 'mark-dubious':
      // @DecisionRef ui:dubious-set-by-hand — the person's line is the reason written.
      return markDubious(plan, op);
    case 'confirm':
      return confirm(plan, op);
    default:
      throw new Refusal(`unknown operation ${JSON.stringify((op as { op?: unknown })?.op)}`);
  }
}

const findingKey = (f: { subject: string; rule: string; message: string }) => `${f.subject}|${f.rule}|${f.message}`;

/** Plan every operation, then check the result with the tools' rules. Nothing is written. */
function planChange(dir: string, req: ChangeRequest): Plan {
  if (!Array.isArray(req?.operations) || req.operations.length === 0) throw new Refusal('a change needs at least one operation');
  const opened = openLedger(dir);
  const p = new Plan(opened);
  for (const op of req.operations) apply(p, op);
  // @DecisionRef ui:commit-validates-first — the change is held to the check's rules before it
  // is written.
  // @DecisionRef ui:refuse-only-new-errors — only errors the change itself introduces refuse it,
  // so a ledger opened broken can be repaired one change at a time.
  const after = projected(p.files, opened);
  const before = new Set(opened.findings.filter((f) => f.severity === 'error').map(findingKey));
  const introduced = findingsOf(after.store, after.unreadable).filter((f) => f.severity === 'error' && !before.has(findingKey(f)));
  if (introduced.length > 0) {
    throw new Refusal(`the check would fail: ${introduced.map((f) => `${f.subject} — ${f.message}`).join('; ')}`);
  }
  if (touchedOf(p).length === 0) throw new Refusal('the change changes nothing');
  return p;
}

function suspectsOf(p: Plan): Suspect[] {
  const nodes = new Set(p.store().nodes.map((n) => n.rel));
  return [...p.suspects]
    .filter(([rel]) => nodes.has(rel) && !p.written.has(rel))
    .map(([rel, reasons]) => ({
      place: placeOfFile(rel),
      readAt: placeOfFile(p.origin.get(rel) ?? rel),
      name: p.nameOf(rel),
      reason: reasons.join('; '),
    }))
    .sort((a, b) => a.place.localeCompare(b.place));
}

/** What a change would do — its suspects, what it deletes and the files it writes — with
 * nothing written.
 * @DecisionRef ui:suspect-set-shown — the set the UI shows before the commit. */
export function previewChange(dir: string, req: ChangeRequest): ChangePreview {
  const p = planChange(dir, req);
  return { suspects: suspectsOf(p), removed: p.removed, touched: touchedOf(p) };
}

function touchedOf(p: Plan): string[] {
  const out = new Set<string>();
  for (const [rel, c] of p.files) if (p.original.get(rel) !== c) out.add(rel);
  for (const rel of p.original.keys()) if (!p.files.has(rel)) out.add(rel);
  return [...out].sort();
}

/**
 * Plan, check, write and commit a change. Every suspect is marked dubious by this same commit,
 * each naming the node whose change made it suspect.
 * @DecisionRef ui:commit-never-gated — the commit lands whatever the suspect set holds.
 * @DecisionRef ui:commit-marks-suspects — the marks are written into the suspects' files.
 */
export async function applyChange(dir: string, repo: string | null, req: ChangeRequest): Promise<ChangeOutcome> {
  if (!repo) throw new Refusal('this ledger is not inside a git repository, and changes land as commits');
  const p = planChange(dir, req);
  const suspects = suspectsOf(p);
  const marked: string[] = [];
  for (const s of suspects) {
    const rel = p.nodeAt(s.place);
    const raw = p.read(rel);
    raw.dubious = withReason(raw.dubious, s.reason);
    p.write(rel, emitNode(raw));
    marked.push(s.place);
  }
  const touched = touchedOf(p);

  // Write: every change and every removal, then the directories a move left empty.
  const real = fs.realpathSync(dir);
  const written: string[] = [];
  const removed: string[] = [];
  for (const rel of touched) {
    const abs = path.join(real, rel);
    if (p.files.has(rel)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, p.files.get(rel)!);
      written.push(rel);
    } else {
      fs.rmSync(abs, { force: true });
      removed.push(rel);
      for (let d = path.dirname(abs); d.startsWith(real + path.sep); d = path.dirname(d)) {
        if (fs.readdirSync(d).length > 0) break;
        fs.rmdirSync(d);
      }
    }
  }

  const repoRel = (rel: string) => path.relative(fs.realpathSync(repo), path.join(real, rel));
  const tracked = removed.length
    ? new Set((await runGit(repo, ['ls-files', '-z', '--', ...removed.map(repoRel)])).split('\0').filter(Boolean))
    : new Set<string>();
  const paths = [...written.map(repoRel), ...removed.map(repoRel).filter((r) => tracked.has(r))];
  const message = req.message?.trim()
    || `ledger: ${p.describe.join('; ')}${marked.length ? ` — marks ${marked.length} suspect(s) dubious` : ''}`;
  try {
    await runGit(repo, ['add', '-A', '--', ...paths]);
    await runGit(repo, ['commit', '-q', '-m', message, '--', ...paths]);
  } catch (e) {
    // A commit git refused writes nothing either: put every file back as it was.
    await runGit(repo, ['reset', '-q', '--', ...paths]).catch(() => undefined);
    for (const rel of touched) {
      const before = p.original.get(rel);
      const abs = path.join(real, rel);
      if (before === undefined) fs.rmSync(abs, { force: true });
      else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, before);
      }
    }
    throw new Refusal(`git refused the commit: ${String((e as Error).message).split('\n').find((l) => l.trim()) ?? 'no reason given'}`);
  }
  const commit = (await runGit(repo, ['rev-parse', 'HEAD'])).trim();
  return {
    ok: true,
    commit,
    touched,
    suspects,
    removed: p.removed,
    marked,
    ...(p.landedAt !== undefined ? { landedAt: p.landedAt } : {}),
  };
}
