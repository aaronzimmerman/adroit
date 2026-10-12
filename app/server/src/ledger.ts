// Opening a ledger directory. Every rule comes from the tools (adroit.ts): which files are
// nodes and models (entryKind), how they parse (the tools' YAML subset), how a store is built
// (buildStore) and what is wrong with it (validate, warn).
// @DecisionRef eng:thin-server-owns-files — every read of the ledger's files happens here, on
// the server.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Finding, PendingChangeDoc } from '@adroit/shared';
import {
  buildStore,
  entryKind,
  parseYaml,
  SELF,
  TREE_ROOTS,
  validate,
  warn,
  type LibEntry,
  type LibStore,
} from './adroit.js';

/** Where pending changes live, beside the model files. */
export const PENDING_DIR = 'models/pending-changes';

export interface Unreadable {
  rel: string;
  message: string;
  content: string;
}

export interface Opened {
  dir: string;
  /** Every readable file the store is built from, with its text. */
  entries: LibEntry[];
  /** Files the parser refused: still shown, never a reason to refuse the ledger. */
  unreadable: Unreadable[];
  /** Pending-change files, read beside the store. */
  pending: { rel: string; doc: PendingChangeDoc; content: string }[];
  /** Every directory and .yaml file under the ledger, ledger-relative. */
  dirs: string[];
  files: string[];
  store: LibStore;
  findings: Finding[];
}

const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The whole ledger directory, as relative paths. Hidden entries are not part of a ledger. */
function walk(dir: string): { dirs: string[]; files: string[] } {
  const dirs: string[] = [];
  const files: string[] = [];
  const visit = (rel: string) => {
    let list: fs.Dirent[];
    try {
      list = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        dirs.push(child);
        visit(child);
      } else if (e.name.endsWith('.yaml')) {
        files.push(child);
      }
    }
  };
  visit('');
  return { dirs, files };
}

/** The tools' store over a set of entries, with the directories beside the roots the check
 * reports — the same two facts the tools' own loader attaches. */
export function storeOf(entries: LibEntry[], topDirs: string[]): LibStore {
  const store = buildStore(entries);
  store.strayRoots = topDirs.filter((d) => !TREE_ROOTS.includes(d)).sort();
  return store;
}

const topDirsOf = (dirs: string[]) => dirs.filter((d) => !d.includes('/'));

/** The check's findings over a store, errors and warnings, with the unreadable files first. */
export function findingsOf(store: LibStore, unreadable: Unreadable[]): Omit<Finding, 'place'>[] {
  return [
    ...unreadable.map((u) => ({
      subject: u.rel,
      rule: 'unreadable',
      message: `could not be read — ${u.message}`,
      severity: 'error' as const,
    })),
    ...validate(store).map((f) => ({ subject: f.id, rule: f.rule, message: f.message, severity: 'error' as const })),
    ...warn(store).map((f) => ({ subject: f.id, rule: f.rule, message: f.message, severity: 'warning' as const })),
  ];
}

/** The place a ledger-relative file is shown at: a directory's own node is the directory. */
export function placeOfFile(rel: string): string {
  return path.posix.basename(rel) === SELF ? path.posix.dirname(rel) : rel;
}

/** Where a finding is shown: the node holding the decision it names, else the path it names. */
function placeOfSubject(store: LibStore, subject: string, places: Set<string>): string {
  const rec = store.byId.get(subject);
  if (rec?._node) return placeOfFile(rec._node);
  if (rec) return rec._rel;
  // "<rel> decisions[i]": a decision entry with no usable id names its file first
  const file = subject.split(' ')[0].replace(/\/+$/, '');
  const at = placeOfFile(file);
  if (places.has(at)) return at;
  // a path the walk never saw (an absent capability root): its nearest existing directory
  for (let p = path.posix.dirname(at); p !== '.'; p = path.posix.dirname(p)) if (places.has(p)) return p;
  return '';
}

/**
 * Read a ledger directory. A file the parser refuses is set aside and reported as a finding;
 * everything else is still read and checked.
 * @DecisionRef ui:broken-ledger-still-opens — nothing is refused for being broken.
 * @DecisionGap the check stops at the first file it cannot parse; the UI reports each unreadable
 * file and runs the same rules over everything else, so a reader still sees the rest.
 */
export function openLedger(dir: string): Opened {
  const { dirs, files } = walk(dir);
  const entries: LibEntry[] = [];
  const unreadable: Unreadable[] = [];
  const pending: Opened['pending'] = [];
  const label = path.basename(dir);
  for (const rel of files) {
    const content = fs.readFileSync(path.join(dir, rel), 'utf8');
    const kind = entryKind(`ledger/${rel}`);
    const isPending = rel.startsWith(`${PENDING_DIR}/`) && rel.split('/').length === 3;
    if (!kind && !isPending) continue;
    let parsed: unknown;
    if (kind !== 'retired') {
      try {
        parsed = parseYaml(content);
      } catch (e) {
        unreadable.push({ rel, message: `${label}/${rel}: ${(e as Error).message}`, content });
        continue;
      }
    }
    if (isPending) {
      if (isMap(parsed)) pending.push({ rel, doc: parsed as unknown as PendingChangeDoc, content });
      continue;
    }
    entries.push({ kind: kind!, path: `${label}/${rel}`, rel, content });
  }
  const store = storeOf(entries, topDirsOf(dirs));
  const placeSet = new Set(['', ...dirs, ...files.map(placeOfFile)]);
  const findings = findingsOf(store, unreadable).map((f) => ({
    ...f,
    place: f.rule === 'unreadable' ? placeOfFile(f.subject) : placeOfSubject(store, f.subject, placeSet),
  }));
  return { dir, entries, unreadable, pending, dirs, files, store, findings };
}
