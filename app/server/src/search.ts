// @DecisionRef ui:search-any-text — finding is a match on any text in the whole ledger
// directory: decision text, rejected alternatives, context, model field names and pending
// entries, contract text, and ids themselves, which match like any other text. There is
// no privileged id lookup.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SearchHit } from '@adroit/shared';
import { ancestorsOf } from './derive.js';
import type { ParsedLedger } from './ledger.js';

// Named once (eng:window-named-once): result and snippet bounds for one search.
const SEARCH_MAX_HITS = 200;
const SNIPPET_RADIUS = 70;

function snippetAround(text: string, index: number, matchLen: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + matchLen + SNIPPET_RADIUS);
  const clean = (s: string) => s.replace(/\s+/g, ' ');
  return (
    (start > 0 ? '…' : '') + clean(text.slice(start, end)).trim() + (end < text.length ? '…' : '')
  );
}

interface Searchable {
  id?: string;
  path: string;
  field: string;
  text: string;
  hierarchy: string[];
  root: SearchHit['root'];
}

function* recordSearchables(ledger: ParsedLedger): Generator<Searchable> {
  for (const rec of ledger.records.values()) {
    const hierarchy = ancestorsOf(ledger, rec.id)
      .map((a) => a.id)
      .reverse();
    const base = { id: rec.id, path: rec.path, hierarchy, root: rec.root };
    yield { ...base, field: 'id', text: rec.id };
    yield { ...base, field: 'decision', text: rec.doc.decision };
    for (let i = 0; i < rec.doc.rejected.length; i++) {
      yield { ...base, field: `rejected[${i + 1}]`, text: String(rec.doc.rejected[i]) };
    }
    for (const [k, v] of Object.entries(rec.doc.links ?? {})) {
      yield { ...base, field: `links.${k}`, text: Array.isArray(v) ? v.join(' ') : String(v) };
    }
    for (const [k, v] of Object.entries(rec.doc.context ?? {})) {
      yield { ...base, field: `context.${k}`, text: String(v) };
    }
    for (const c of rec.doc.commitments ?? []) {
      yield {
        ...base,
        field: `commitments.${c.id}`,
        text: [c.id, c.description, c.adherence].filter(Boolean).join(' '),
      };
    }
  }
}

function* otherSearchables(ledger: ParsedLedger): Generator<Searchable> {
  for (const model of ledger.models) {
    const base = { id: model.id, path: model.path, hierarchy: ['models'], root: 'models' as const };
    yield { ...base, field: 'id', text: model.id };
    yield { ...base, field: 'summary', text: model.doc.summary };
    for (const [name, text] of Object.entries(model.doc.fields)) {
      yield { ...base, field: `fields.${name}`, text: `${name} — ${text}` };
    }
    for (const p of model.doc.pending ?? []) {
      yield {
        ...base,
        field: `pending.${p.field}`,
        text: `${p.field} ${p.op} ${p.intended ?? ''} ${p.current ?? ''}`,
      };
    }
  }
  for (const change of ledger.changes) {
    const base = {
      id: `change:${change.doc.name}`,
      path: change.path,
      hierarchy: ['models', 'pending-changes'],
      root: 'models' as const,
    };
    yield { ...base, field: 'name', text: change.doc.name };
    for (const op of change.doc.operations ?? []) {
      yield { ...base, field: `operations.${op.field}`, text: `${op.current ?? ''} ${op.intended ?? ''}` };
    }
  }
  for (const cap of ledger.capabilities) {
    const base = {
      id: cap.name,
      path: cap.contractPath,
      hierarchy: ['capabilities'],
      root: 'capabilities' as const,
    };
    for (const [k, v] of Object.entries(cap.contract)) {
      if (typeof v === 'string') yield { ...base, field: k, text: v };
      else if (typeof v === 'object' && v !== null) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          yield { ...base, field: `${k}.${k2}`, text: String(v2) };
        }
      }
    }
  }
  for (const [domain, scope] of Object.entries(ledger.domains)) {
    yield {
      path: 'domains.yaml',
      field: domain,
      text: `${domain}: ${scope}`,
      hierarchy: [],
      root: 'ledger',
    };
  }
}

/** Raw-text fallback for ledger files that are not structured records (.md notes etc.). */
function* rawFileSearchables(ledger: ParsedLedger): Generator<Searchable> {
  const walk = function* (relDir: string): Generator<string> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(ledger.ledgerDir, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = path.posix.join(relDir, e.name);
      if (e.isDirectory()) yield* walk(rel);
      else if (!e.name.endsWith('.yaml')) yield rel;
    }
  };
  for (const rel of walk('')) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(ledger.ledgerDir, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue; // not text
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      yield { path: rel, field: `line ${i + 1}`, text: lines[i], hierarchy: [], root: 'ledger' };
    }
  }
}

export function searchLedger(ledger: ParsedLedger, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const sources = [recordSearchables(ledger), otherSearchables(ledger), rawFileSearchables(ledger)];
  for (const source of sources) {
    for (const s of source) {
      const idx = s.text.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      hits.push({
        ...(s.id !== undefined ? { id: s.id } : {}),
        path: s.path,
        field: s.field,
        snippet: snippetAround(s.text, idx, q.length),
        hierarchy: s.hierarchy,
        root: s.root,
      });
      if (hits.length >= SEARCH_MAX_HITS) return hits;
    }
  }
  return hits;
}
