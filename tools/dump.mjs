#!/usr/bin/env node
// dump — the whole ledger as one compact stream, for reading into an agent's context (eng:decision-per-file).
//
//   node tools/dump.mjs           # every capability contract + every decision, one per line
//   node tools/dump.mjs --pretty  # the same, indented, for a human at a terminal
//
//   node tools/dump.mjs --interactions  # ...with this machine's interaction log appended (eng:log-ledger-interactions)
//
// This replaces `Read decisions/ledger.jsonl` in the protocol: the store is one file per decision,
// and this is how you read all of them at once. Order is the reading order, not the filesystem's:
// principles first (the constitution), then every decision by id — domain, then slug, so a
// domain's records read together — then the capability ledgers. stdout is pure JSONL; the count goes to stderr so a pipe stays clean.
//
// The MODULE declarations that used to head the stream retired with the four-roots swap: a tree is
// a directory, so a synthesized line per tree would say nothing a record's own path does not. What
// leads now is the capability CONTRACTS — real artifacts, and the only part of the store that is
// not a decision.
//
// Interaction events are LEFT OUT by default: they are evidence that the ledger did work, not
// law, and the constitution an agent loads should be the law (eng:log-ledger-interactions). They
// are not in the store at all — `--interactions` reads the machine-local log beside it.
import { loadLedger, isPrinciple, isModuleScoped } from './lib.mjs';

const PRETTY = process.argv.includes('--pretty');
const WITH_INTERACTIONS = process.argv.includes('--interactions');
const { records, modules, contracts, interactions, moduleByName, domains } = loadLedger();

// A dump is made to be piped (`| head`, `| grep`); a closed reader is the pipe working, not a fault.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
process.stderr.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });

const rank = (r) => (isPrinciple(r.id) ? 0 : isModuleScoped(r.id, moduleByName) ? 2 : 1);
const sorted = [...records].sort((a, b) => {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return a.id.localeCompare(b.id);
});

const emit = (o) => {
  // loader bookkeeping, not content — the tree placement travels as `tree` on the record instead,
  // because where a decision lives is now part of what it says (what it may reference).
  const { _file, _name, _line, _rel, _cloud, _tree, _nestedUnder, _restatedRefines, ...rest } = o;
  const out = _tree ? { ...rest, tree: _tree } : rest;
  process.stdout.write((PRETTY ? JSON.stringify(out, null, 2) : JSON.stringify(out)) + '\n');
};

// The declared domains lead: they are what a new id's namespace is chosen from.
if (domains.size) emit({ domains: Object.fromEntries(domains) });
for (const [name, c] of contracts) emit({ contract: name, ...c });
for (const r of sorted) emit(r);
if (WITH_INTERACTIONS) for (const e of [...interactions].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))) emit(e);

process.stderr.write(
  `${records.length} decisions · ${modules.length} trees · ${contracts.size} contracts · ` +
  `${records.filter((r) => r.rejected?.length).length} naming a rejected alternative` +
  (WITH_INTERACTIONS ? ` · ${interactions.length} interaction events` : '') + '\n'
);
