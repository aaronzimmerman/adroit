// @DecisionRef ui:search-any-text — finding is a match on any text in the ledger directory:
// names, decisions, rejected alternatives, includes, notes, context, model fields and pending
// entries, pending changes, the domain registry, and the text of a file the parser refused.
// @DecisionRef ui:no-privileged-id-lookup — an id is one more piece of text; a pasted id finds
// its decision because its text matches, through the same match as every other field.
import type { LedgerView, Place, SearchHit } from '@adroit/shared';

// @DecisionRef eng:window-named-once — named once here: result and snippet bounds for one search.
const SEARCH_MAX_HITS = 200;
const SNIPPET_RADIUS = 70;

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

/** Every string inside a free-form value, each keyed by where it sits. */
function flatten(prefix: string, v: unknown, out: [string, string][]): void {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out.push([prefix, String(v)]);
  else if (Array.isArray(v)) v.forEach((x, i) => flatten(`${prefix}[${i + 1}]`, x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) flatten(`${prefix}.${k}`, x, out);
}

/** The text of one place, field by field. */
function fieldsOf(place: Place, view: LedgerView): [string, string][] {
  const out: [string, string][] = [];
  if (place.node) {
    const d = place.node.doc;
    out.push(['name', d.name]);
    for (const x of d.decisions) {
      out.push([`${x.id} · id`, x.id], [`${x.id} · decision`, x.decision]);
      (x.rejected ?? []).forEach((r, i) => out.push([`${x.id} · rejected ${i + 1}`, r]));
    }
    if (d.includes?.length) out.push(['includes', d.includes.join(', ')]);
    if (d.severed?.length) out.push(['severed', d.severed.join(', ')]);
    if (d.dubious) out.push(['dubious', d.dubious]);
    (d.questions ?? []).forEach((q, i) => out.push([`question ${i + 1}`, q]));
    flatten('context', d.context, out);
  }
  if (place.model) {
    out.push(['id', place.model.id], ['decision', place.model.decision]);
    for (const f of place.model.fields) {
      out.push([`field ${f.name}`, f.name]);
      if (f.deployed) out.push([`field ${f.name} · deployed`, f.deployed]);
      if (f.intended) out.push([`field ${f.name} · intended`, f.intended]);
    }
  }
  if (place.change) flatten('pending change', place.change, out);
  if (place.raw !== undefined) place.raw.split('\n').forEach((line, i) => out.push([`line ${i + 1}`, line]));
  if (place.path === 'domains.yaml') {
    out.push(['corpus', view.corpus]);
    for (const [k, v] of Object.entries(view.domains)) out.push([`domain ${k}`, `${k}: ${v}`]);
  }
  return out;
}

/** The labels of the places above one, root first: where a hit lives in the hierarchy. */
function trailOf(view: LedgerView, at: string): string[] {
  const trail: string[] = [];
  for (let p = view.places[at]?.parent ?? null; p; p = view.places[p]?.parent ?? null) {
    trail.unshift(view.places[p].label);
  }
  return trail;
}

/**
 * A place matches when every word of the query appears somewhere in its text; each of its
 * fields holding a word is one hit, so the reader sees what matched.
 * @DecisionRef ui:hit-shows-its-place — every hit carries its field, its snippet and its trail.
 */
export function searchLedger(view: LedgerView, query: string): SearchHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const place of Object.values(view.places)) {
    const fields = fieldsOf(place, view);
    const all = fields.map(([, t]) => t.toLowerCase()).join('\n');
    if (!terms.every((t) => all.includes(t))) continue;
    const trail = trailOf(view, place.path);
    for (const [field, text] of fields) {
      const lower = text.toLowerCase();
      const term = terms.find((t) => lower.includes(t));
      if (!term) continue;
      hits.push({ place: place.path, field, snippet: snippetAround(text, lower.indexOf(term), term.length), trail });
      if (hits.length >= SEARCH_MAX_HITS) return hits;
    }
  }
  return hits;
}
