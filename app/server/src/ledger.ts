// @DecisionRef eng:thin-server-owns-files — all ledger file reads live here, on the server
// side; the browser only ever sees what these parsers produce.
import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import type {
  ChangeDoc,
  CommitmentEntry,
  ContractDoc,
  ModelDoc,
  RecordDoc,
  RootKind,
} from '@adroit/shared';

export interface ParsedRecord {
  id: string;
  /** Ledger-relative posix path of the record's own yaml file. */
  path: string;
  /** Ledger-relative posix path of the record's node (dir for folder records, else the file). */
  nodePath: string;
  isFolder: boolean;
  root: RootKind;
  treeName?: string;
  parent?: string;
  children: string[];
  depth: number;
  doc: RecordDoc;
}

export interface ParsedModel {
  id: string;
  path: string;
  doc: ModelDoc;
}

export interface ParsedChange {
  path: string;
  doc: ChangeDoc;
}

export interface ParsedCapability {
  name: string;
  contractPath: string;
  contract: ContractDoc;
  records: string[];
}

export interface ParsedLedger {
  ledgerDir: string;
  corpus: string;
  domains: Record<string, string>;
  records: Map<string, ParsedRecord>;
  models: ParsedModel[];
  changes: ParsedChange[];
  capabilities: ParsedCapability[];
  productTrees: { name: string; rootId: string }[];
  /** Shape problems found while reading; reading never refuses, writing does. */
  problems: string[];
}

// @DecisionRef eng:decision-per-file — the closed field list, the optional dubious mark
// included; the write path refuses a record carrying anything else (status, tokens and api
// by name).
const RECORD_FIELDS = ['id', 'decision', 'rejected', 'links', 'context', 'commitments', 'dubious'];
// @DecisionRef model:record — the exact spelling of each commitment entry form.
const COMMITMENT_KEYS: Record<'declaration' | 'adherence' | 'negation', string[]> = {
  declaration: ['id', 'description', 'severable'],
  adherence: ['id', 'adherence'],
  negation: ['id', 'negation'],
};
const RESERVED_KINDS = ['principle', 'story', 'model', 'view'];

export function idToStem(id: string): string {
  return id.replace(':', '.');
}

function readYamlFile(file: string): unknown {
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

export function commitmentEntryKind(
  e: CommitmentEntry,
): 'declaration' | 'adherence' | 'negation' | 'invalid' {
  const forms = [e.description !== undefined, e.adherence !== undefined, e.negation === true];
  if (forms.filter(Boolean).length !== 1) return 'invalid';
  if (e.description !== undefined) return 'declaration';
  if (e.adherence !== undefined) return 'adherence';
  return 'negation';
}

/**
 * Validate one record document against the record shape (model:record).
 * Returns problems in the author's terms; empty means compliant.
 */
export function validateRecordDoc(
  doc: Record<string, unknown>,
  opts: { domains: Record<string, string>; capabilityNames: string[] },
): string[] {
  const problems: string[] = [];
  const id = doc.id;
  if (typeof id !== 'string' || !/^[a-z][a-z-]*:[a-z][a-z0-9-]*$/.test(id)) {
    problems.push(`id must be domain:slug in lowercase kebab words, got ${JSON.stringify(id)}`);
    return problems;
  }
  const [domain, slug] = id.split(':');
  // @DecisionRef eng:namespace-names-kind — the namespace is looked up (declared domain,
  // reserved kind, or capability name), never inferred; slugs are kebab words, never numbered.
  if (
    !RESERVED_KINDS.includes(domain) &&
    !(domain in opts.domains) &&
    !opts.capabilityNames.includes(domain)
  ) {
    problems.push(
      `id domain "${domain}" is not a declared domain, reserved kind, or capability name`,
    );
  }
  if (/\d/.test(slug)) problems.push(`slug "${slug}" must not contain digits`);

  for (const key of Object.keys(doc)) {
    if (!RECORD_FIELDS.includes(key)) {
      problems.push(`field "${key}" is outside the record shape (${RECORD_FIELDS.join(', ')})`);
    }
  }
  if (typeof doc.decision !== 'string' || doc.decision.trim() === '') {
    problems.push('decision must be a non-empty string');
  }
  if (!Array.isArray(doc.rejected)) {
    // An empty array is honest; an absent one is a shape error.
    problems.push('rejected must be present as a list (empty is allowed, absent is not)');
  }
  const links = doc.links;
  if (links === undefined || links === null || typeof links !== 'object' || Array.isArray(links)) {
    problems.push('links must be present as a mapping (may be empty)');
  } else if ('refines' in (links as Record<string, unknown>)) {
    // @DecisionRef adr:hierarchy-is-filesystem — the path carries refines; restating it is an error.
    problems.push('links.refines is not allowed: the file path carries the parent');
  }
  if (doc.context !== undefined && (typeof doc.context !== 'object' || Array.isArray(doc.context))) {
    problems.push('context must be a mapping when present');
  }
  // @DecisionRef ui:dubious-is-recorded — present, the mark holds one line of reason.
  if (doc.dubious !== undefined) {
    if (typeof doc.dubious !== 'string' || doc.dubious.trim() === '') {
      problems.push('dubious, when present, holds one line saying why the record is suspect');
    } else if (/[\r\n]/.test(doc.dubious.trim())) {
      problems.push('dubious holds one line of reason, not several');
    }
  }
  if (doc.commitments !== undefined) {
    if (!Array.isArray(doc.commitments)) {
      problems.push('commitments must be a list when present');
    } else {
      for (const entry of doc.commitments as CommitmentEntry[]) {
        if (typeof entry !== 'object' || entry === null || typeof entry.id !== 'string') {
          problems.push('every commitment entry needs an id');
          continue;
        }
        const kind = commitmentEntryKind(entry);
        if (kind === 'invalid') {
          problems.push(
            `commitment entry "${entry.id}" must be exactly one of: declaration (description), adherence, negation: true`,
          );
          continue;
        }
        const extra = Object.keys(entry).filter((k) => !COMMITMENT_KEYS[kind].includes(k));
        if (extra.length > 0) {
          problems.push(
            `commitment entry "${entry.id}" is a ${kind}, which is spelled {${COMMITMENT_KEYS[kind].join(', ')}} — "${extra.join('", "')}" is not part of it`,
          );
        }
        if (kind === 'declaration' && 'severable' in entry && entry.severable !== false) {
          problems.push(
            `commitment "${entry.id}": severable is written only as false, to mark a declaration no descendant may negate`,
          );
        }
      }
      const ids = (doc.commitments as CommitmentEntry[]).map((e) => e?.id);
      for (const cid of ids) {
        if (ids.filter((x) => x === cid).length > 1) {
          problems.push(`commitment id "${cid}" appears more than once on one record`);
          break;
        }
      }
    }
  }
  return problems;
}

function parseRecordFile(
  ledgerDir: string,
  relFile: string,
  nodePath: string,
  isFolder: boolean,
  root: RootKind,
  treeName: string | undefined,
  parent: string | undefined,
  depth: number,
  out: ParsedLedger,
): ParsedRecord | undefined {
  let raw: unknown;
  try {
    raw = readYamlFile(path.join(ledgerDir, relFile));
  } catch (e) {
    out.problems.push(`${relFile}: unreadable yaml (${(e as Error).message})`);
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) {
    out.problems.push(`${relFile}: not a record document`);
    return undefined;
  }
  const docRaw = raw as Record<string, unknown>;
  const capabilityNames = out.capabilities.map((c) => c.name);
  for (const p of validateRecordDoc(docRaw, { domains: out.domains, capabilityNames })) {
    out.problems.push(`${relFile}: ${p}`);
  }
  const id = String(docRaw.id ?? '');
  const expectedStem = idToStem(id);
  const actualStem = isFolder
    ? path.posix.basename(nodePath)
    : path.posix.basename(relFile, '.yaml');
  if (id && actualStem !== expectedStem) {
    out.problems.push(`${relFile}: filename stem "${actualStem}" does not match id "${id}"`);
  }
  const doc: RecordDoc = {
    id,
    decision: typeof docRaw.decision === 'string' ? docRaw.decision : '',
    rejected: Array.isArray(docRaw.rejected) ? (docRaw.rejected as string[]) : [],
    links: (docRaw.links as RecordDoc['links']) ?? {},
    context: (docRaw.context as Record<string, unknown>) ?? {},
    ...(docRaw.commitments !== undefined
      ? { commitments: docRaw.commitments as CommitmentEntry[] }
      : {}),
    ...(typeof docRaw.dubious === 'string' ? { dubious: docRaw.dubious.trim() } : {}),
  };
  const rec: ParsedRecord = {
    id,
    path: relFile,
    nodePath,
    isFolder,
    root,
    treeName,
    parent,
    children: [],
    depth,
    doc,
  };
  if (out.records.has(id)) {
    out.problems.push(`${relFile}: duplicate id "${id}"`);
    return undefined;
  }
  out.records.set(id, rec);
  return rec;
}

/** Walk one directory level for record entries (files and folder records). */
function walkRecordDir(
  ledgerDir: string,
  relDir: string,
  root: RootKind,
  treeName: string | undefined,
  parent: string | undefined,
  depth: number,
  out: ParsedLedger,
): string[] {
  const abs = path.join(ledgerDir, relDir);
  const childIds: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return childIds;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'pending-changes') continue;
      const selfRel = path.posix.join(rel, 'self.yaml');
      if (!fs.existsSync(path.join(ledgerDir, selfRel))) {
        out.problems.push(`${rel}: folder record missing self.yaml`);
        continue;
      }
      const rec = parseRecordFile(ledgerDir, selfRel, rel, true, root, treeName, parent, depth, out);
      if (rec) {
        childIds.push(rec.id);
        rec.children = walkRecordDir(ledgerDir, rel, root, treeName, rec.id, depth + 1, out);
      }
    } else if (
      entry.name.endsWith('.yaml') &&
      entry.name !== 'self.yaml' &&
      entry.name !== 'contract.yaml' &&
      entry.name !== 'domains.yaml'
    ) {
      const rec = parseRecordFile(ledgerDir, rel, rel, false, root, treeName, parent, depth, out);
      if (rec) childIds.push(rec.id);
    }
    // Non-yaml files (notes, .md) are not records and are skipped here; full-text
    // search still reads them (ui:search-any-text).
  }
  return childIds;
}

function parseModel(ledgerDir: string, relFile: string, out: ParsedLedger): void {
  try {
    const raw = readYamlFile(path.join(ledgerDir, relFile)) as Record<string, unknown>;
    if (!raw || typeof raw.id !== 'string') {
      out.problems.push(`${relFile}: not a model document`);
      return;
    }
    out.models.push({
      id: raw.id,
      path: relFile,
      doc: {
        id: raw.id,
        summary: typeof raw.summary === 'string' ? raw.summary : '',
        fields: (raw.fields as Record<string, string>) ?? {},
        ...(raw.pending !== undefined ? { pending: raw.pending as ModelDoc['pending'] } : {}),
      },
    });
  } catch (e) {
    out.problems.push(`${relFile}: unreadable yaml (${(e as Error).message})`);
  }
}

/** Read the whole ledger directory into memory. Reading reports problems, never refuses. */
export function parseLedger(ledgerDir: string): ParsedLedger {
  const out: ParsedLedger = {
    ledgerDir,
    corpus: '',
    domains: {},
    records: new Map(),
    models: [],
    changes: [],
    capabilities: [],
    productTrees: [],
    problems: [],
  };

  const domainsFile = path.join(ledgerDir, 'domains.yaml');
  if (fs.existsSync(domainsFile)) {
    const raw = (readYamlFile(domainsFile) ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'corpus') out.corpus = String(v);
      else out.domains[k] = String(v);
    }
  }
  if (!out.corpus) out.corpus = path.basename(path.dirname(ledgerDir));

  // Capabilities first so capability names are known to id validation.
  const capsDir = path.join(ledgerDir, 'capabilities');
  if (fs.existsSync(capsDir)) {
    for (const entry of fs.readdirSync(capsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const contractRel = path.posix.join('capabilities', entry.name, 'contract.yaml');
      const contractAbs = path.join(ledgerDir, contractRel);
      if (!fs.existsSync(contractAbs)) {
        out.problems.push(`capabilities/${entry.name}: missing contract.yaml`);
        continue;
      }
      // @DecisionRef adr:capability-contract-artifact — the contract is an artifact beside
      // the capability's records, parsed as an interface, never as a decision tree.
      const contract = readYamlFile(contractAbs) as ContractDoc;
      out.capabilities.push({ name: entry.name, contractPath: contractRel, contract, records: [] });
    }
  }
  for (const cap of out.capabilities) {
    cap.records = walkRecordDir(
      ledgerDir,
      path.posix.join('capabilities', cap.name),
      'capabilities',
      cap.name,
      undefined,
      0,
      out,
    );
  }

  const productDir = path.join(ledgerDir, 'product');
  if (fs.existsSync(productDir)) {
    for (const entry of fs.readdirSync(productDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const treeRel = path.posix.join('product', entry.name);
      const selfRel = path.posix.join(treeRel, 'self.yaml');
      if (!fs.existsSync(path.join(ledgerDir, selfRel))) {
        out.problems.push(`${treeRel}: product tree missing self.yaml root story`);
        continue;
      }
      const rec = parseRecordFile(ledgerDir, selfRel, treeRel, true, 'product', entry.name, undefined, 0, out);
      if (rec) {
        rec.children = walkRecordDir(ledgerDir, treeRel, 'product', entry.name, rec.id, 1, out);
        out.productTrees.push({ name: entry.name, rootId: rec.id });
      }
    }
  }

  if (fs.existsSync(path.join(ledgerDir, 'engineering'))) {
    walkRecordDir(ledgerDir, 'engineering', 'engineering', undefined, undefined, 0, out);
  }

  const modelsDir = path.join(ledgerDir, 'models');
  if (fs.existsSync(modelsDir)) {
    for (const entry of fs.readdirSync(modelsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && entry.name.endsWith('.yaml')) {
        parseModel(ledgerDir, path.posix.join('models', entry.name), out);
      }
    }
    // @DecisionRef adr:four-decision-roots — the models root holds the one staged state
    // that endures: the pending-changes directory of model:change files.
    const pendingDir = path.join(modelsDir, 'pending-changes');
    if (fs.existsSync(pendingDir)) {
      for (const entry of fs.readdirSync(pendingDir).sort()) {
        if (!entry.endsWith('.yaml')) continue;
        const rel = path.posix.join('models', 'pending-changes', entry);
        try {
          out.changes.push({ path: rel, doc: readYamlFile(path.join(ledgerDir, rel)) as ChangeDoc });
        } catch (e) {
          out.problems.push(`${rel}: unreadable yaml (${(e as Error).message})`);
        }
      }
    }
  }

  return out;
}

/** Serialize a record document back to yaml in the ledger's house style. */
export function recordToYaml(doc: RecordDoc): string {
  const ordered: Record<string, unknown> = {
    id: doc.id,
    decision: doc.decision,
    rejected: doc.rejected,
  };
  if (doc.dubious !== undefined) ordered.dubious = doc.dubious;
  if (doc.commitments !== undefined) ordered.commitments = doc.commitments;
  ordered.links = doc.links;
  ordered.context = doc.context;
  return YAML.stringify(ordered, { blockQuote: 'folded', lineWidth: 96 });
}

export function modelToYaml(doc: ModelDoc): string {
  const ordered: Record<string, unknown> = {
    id: doc.id,
    summary: doc.summary,
    fields: doc.fields,
  };
  if (doc.pending !== undefined && doc.pending.length > 0) ordered.pending = doc.pending;
  return YAML.stringify(ordered, { blockQuote: 'folded', lineWidth: 96 });
}

export function changeToYaml(doc: ChangeDoc): string {
  return YAML.stringify(doc, { blockQuote: 'folded', lineWidth: 96 });
}

export function contractToYaml(doc: ContractDoc): string {
  return YAML.stringify(doc, { blockQuote: 'folded', lineWidth: 96 });
}
