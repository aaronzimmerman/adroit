#!/usr/bin/env node
// adroit — the ledger explorer (eng:decision-per-file). Local, read-only, dependency-free.
//
//   node tools/server.mjs           # serve the explorer, print the URL
//   node tools/server.mjs --open    # ...and open it in a browser
//   node tools/server.mjs --port N  # pick the port
//   node tools/server.mjs --check   # validate the store, print errors, exit 1 if any
//   node tools/server.mjs --dir D   # read a store other than ./ledger (fixtures, tests)
//   node tools/server.mjs --diff [ref]  # semantic diff of the working tree vs a ref (default: main)
//
// The graph is rebuilt from `ledger/` on every request. 461 small files parse in milliseconds,
// so there is no index, no cache and no database — a materialized graph would be a second copy
// of the store to keep in step. v1 is READ-ONLY: writing decisions back through the UI is a
// later step, deliberately not taken here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  ROOT, loadLedger, loadLedgerAtRef, validate, warn, graphOf, neighborhood, computeImpact, search,
  moduleOf, interactionIndex, diffStores, hasDiff, graphData, moduleCoherence, decorate, modelIndex,
  rootStoryIndex, incoherence, openGaps, interactionLogSummary,
  treeIndex, capabilityIndex, erdData, loadSchema, tablesOf, resolveUiAsset,
} from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};

const DIR = flag('--dir', undefined);

// The ref side is read with git rooted where the store lives, so `--dir` works against any
// checkout (the tests point it at a fixture repo) rather than only this one.
const readDiff = (ref) => {
  const dir = DIR ? path.resolve(DIR) : undefined;
  const head = loadLedger({ dir });
  const base = dir
    ? loadLedgerAtRef(ref, { cwd: path.dirname(dir), dir: path.basename(dir) })
    : loadLedgerAtRef(ref);
  return diffStores(base, head, { ref });
};

// --- --diff: the review report -------------------------------------------------
// A REPORT, not a gate: it always exits 0. Only a git failure (a ref that does not exist) is
// an error, because then there is nothing to compare against and silence would be a lie.
if (argv.includes('--diff')) {
  const i = argv.indexOf('--diff');
  const ref = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'main';
  let d;
  try {
    d = readDiff(ref);
  } catch (e) {
    console.error(`git error comparing against '${ref}': ${e.message.trim().split('\n')[0]}`);
    process.exit(2);
  }
  const section = (title, rows) => { if (rows.length) { console.log(`\n${title}`); console.log(rows.join('\n')); } };

  console.log(`ledger diff — working tree vs ${ref}`);
  section('ADDED', d.added.map((r) => `  + ${r.id} [${r.module ?? '—'}] ${r.decision}`));
  section('DELETED', d.deleted.map((r) => `  − ${r.id} [${r.module ?? '—'}] ${r.decision}`));
  if (d.changed.length) {
    console.log('\nCHANGED');
    for (const c of d.changed) {
      console.log(`  ~ ${c.id}${c.silentRewire ? '  ⚑ SILENT RE-WIRING' : ''}`);
      for (const op of c.ops) console.log(`      ${op.line}`);
    }
  }
  section('MODULES / TREES', [
    ...d.modulesAdded.map((m) => `  + ${m}`),
    ...d.modulesRemoved.map((m) => `  − ${m}`),
  ]);
  if (!hasDiff(d)) console.log('\n  (no difference)');

  const { recordsTouched, edgesAdded, edgesRemoved, silentRewires } = d.summary;
  console.log(`\nSUMMARY: ${recordsTouched} record(s) touched, ${edgesAdded} edge(s) added, ${edgesRemoved} removed.`);
  if (silentRewires.length) {
    console.log(`\n⚑ ${silentRewires.length} record(s) re-wired with NO change to what they say — review these first:`);
    for (const id of silentRewires) console.log(`    ${id}`);
  }
  process.exit(0);
}

// --- --check: the CI/gate mode ------------------------------------------------
if (argv.includes('--check')) {
  // A file the parser rejects is the most common reason to run this, and the parser already
  // says WHICH file. Letting the exception escape printed a stack trace with the message buried
  // in it; the gate's job is to name the thing to fix.
  let ctx;
  try {
    ctx = loadLedger({ dir: DIR ? path.resolve(DIR) : undefined });
  } catch (e) {
    console.error(`ledger: could not be read — ${e.message}`);
    process.exit(1);
  }
  const errors = validate(ctx);
  const mx = modelIndex(ctx);
  const line =
    `ledger: ${ctx.records.length} decisions, ${ctx.modules.length} trees, ` +
    `${ctx.contracts.size} capability contract(s), ` +
    `${mx.models.length} models/views (${mx.refs.length} reference(s) from other trees), ` +
    `${ctx.records.filter((r) => !r.links?.refines && !r.id.startsWith('principle:')).length} load-bearing, ` +
    `${ctx.records.filter((r) => r.rejected?.length).length} naming a rejected alternative, ` +
    `${ctx.interactions.length} interaction event(s), ` +
    // OPEN is a rule, not a kind: a gap that names the decision it produced is closed. The rule
    // lives once, in openGaps(), and every reader of it — this summary, the rail, the ghosts —
    // goes through that one lookup rather than re-counting `kind === 'gap'` for itself.
    `${openGaps(ctx).length} open gap(s)`;
  const warnings = warn(ctx);
  // The interaction log is machine-local telemetry, not corpus (eng:log-ledger-interactions): its
  // standing is reported here and NEVER moves the exit code — a bad line is skipped, not fatal.
  const log = ctx.interactionLog;
  const logLines = !log.present
    ? [`interaction log: none on this machine (${log.file}) — tallies and gaps read empty`]
    : [`interaction log: ${log.file} — ${log.events.length} event(s)` +
        (log.bad.length ? `, ${log.bad.length} bad line(s) skipped` : ''),
      ...log.bad.map((b) => `  ~ line ${b.line}: ${b.problems.join('; ')}`)];
  if (errors.length) {
    console.error(line);
    console.error(`\n${errors.length} validation error(s):`);
    for (const e of errors) console.error(`  ${e.id} [${e.rule}] ${e.message}`);
    for (const l of logLines) console.error(l);
    process.exit(1);
  }
  console.log(`${line} (validated${warnings.length ? `, ${warnings.length} warning(s)` : ''})`);
  // Warnings never change the exit code — they are worth seeing, not worth failing over.
  for (const w of warnings) console.log(`  ! ${w.id} [${w.rule}] ${w.message}`);
  for (const l of logLines) console.log(l);
  process.exit(0);
}

// --- the graph, rebuilt per request -------------------------------------------
function context() {
  const ctx = loadLedger({ dir: DIR ? path.resolve(DIR) : undefined });
  ctx.graph = graphOf(ctx);
  ctx.errors = validate(ctx);
  ctx.warnings = warn(ctx);
  return ctx;
}

const UI = path.join(import.meta.dirname, 'ui.html');

const json = (res, body, code = 200) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(UI);
      // read from disk per request and never cached: editing the UI is a reload, not a restart
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }
    if (p.startsWith('/ui/')) {
      const asset = resolveUiAsset(p);
      if (!asset) return json(res, { error: 'not found' }, 404);
      res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(asset.file));
    }
    if (p === '/api/graph') {
      const ctx = context();
      const mx = modelIndex(ctx);
      const rx = rootStoryIndex(ctx);
      return json(res, {
        // Records go out DECORATED: kind, moduleScoped and gist are the store's to decide, and a
        // renderer that worked them out itself would be a second copy of the rule (eng:namespace-names-kind).
        decisions: ctx.records.map((r) => decorate(r, ctx.moduleByName, mx, rx)),
        modules: ctx.modules,
        interactions: ctx.interactions,
        interactionLog: interactionLogSummary(ctx),
        review: ctx.review,
        errors: ctx.errors,
        warnings: ctx.warnings,
        root: path.relative(process.cwd(), ROOT) || '.',
      });
    }
    if (p === '/api/check') {
      const ctx = context();
      return json(res, {
        errors: ctx.errors, warnings: ctx.warnings,
        decisions: ctx.records.length, modules: ctx.modules.length,
        interactions: ctx.interactions.length,
        interactionLog: interactionLogSummary(ctx),
      });
    }
    if (p === '/api/diff') {
      const ref = url.searchParams.get('ref') || 'main';
      try {
        const d = readDiff(ref);
        return json(res, { ...d, any: hasDiff(d) });
      } catch (e) {
        return json(res, { ref, error: e.message.trim().split('\n')[0], any: false }, 200);
      }
    }
    if (p === '/api/graphdata') {
      return json(res, graphData(context(), { scope: url.searchParams.get('scope') || 'all' }));
    }
    if (p === '/api/models') {
      // The model layer, as the store derives it: every model and view with the trees that reach
      // it. The same index --check and the galaxy read. Declarations are gone; this is traffic.
      const ctx = context();
      const mx = modelIndex(ctx);
      return json(res, {
        models: mx.models.map((m) => ({
          id: m.id, tree: m._tree ?? null, gist: decorate(m, ctx.moduleByName).gist,
          importers: mx.importersOf(m.id),
          tables: tablesOf(m),
        })),
        contracts: [...ctx.contracts].map(([name, c]) => ({ name, ...c })),
        references: mx.refs,
      });
    }
    if (p === '/api/tree') {
      // THE HIERARCHY, as the filesystem has it, plus the capability each record leverages. One
      // walk in lib; the view expands and collapses what it is given and derives nothing.
      const ctx = context();
      return json(res, treeIndex(ctx));
    }
    if (p === '/api/capability') {
      const all = capabilityIndex(context());
      const name = url.searchParams.get('name');
      if (!name) return json(res, { capabilities: all.map(({ consumers, ...rest }) => rest) });
      const one = all.find((c) => c.name === name);
      return one ? json(res, one) : json(res, { error: 'no such capability' }, 404);
    }
    if (p === '/api/erd') {
      // The entity boxes and their fields. The FIELDS come from `schema.json` — derived from the
      // migrations by `schema-dump.mjs` and committed — so the ERD renders with no Java at hand.
      const ctx = context();
      return json(res, erdData(ctx, loadSchema()));
    }
    if (p === '/api/incoherence') {
      // WHERE IS THE INCOHERENCE, as data: adrift records, open gaps, seams where the declared
      // boundary and the traffic disagree, and the link suggestions that would close the gaps in a
      // module. Ranked here; the rail renders the order it is given and computes nothing.
      return json(res, incoherence(context()));
    }
    if (p === '/api/modules-coherence') {
      const report = moduleCoherence(context());
      return json(res, {
        modules: report,
        incoherent: report.filter((m) => m.components > 1).length,
        coherent: report.filter((m) => m.components === 1).map((m) => m.module),
      });
    }
    if (p === '/api/interactions') {
      const ctx = context();
      const idx = interactionIndex(ctx);
      const id = url.searchParams.get('id');
      const log = interactionLogSummary(ctx);
      if (id) return json(res, { id, events: idx.byDecision.get(id) ?? [], log });
      if (url.searchParams.get('kind') === 'gap') return json(res, { events: idx.gaps, log });
      return json(res, { events: idx.events, log });
    }
    if (p === '/api/decision') {
      const ctx = context();
      const id = url.searchParams.get('id') ?? '';
      const nb = neighborhood(id, ctx);
      if (!nb) return json(res, { error: 'no such decision' }, 404);
      return json(res, {
        ...nb,
        record: decorate(nb.record, ctx.moduleByName, modelIndex(ctx), rootStoryIndex(ctx)),
        interactions: interactionIndex(ctx).byDecision.get(id) ?? [],
      });
    }
    if (p === '/api/impact') {
      const ctx = context();
      const rep = computeImpact(url.searchParams.get('id') ?? '', ctx);
      return rep ? json(res, rep) : json(res, { error: 'no such decision' }, 404);
    }
    if (p === '/api/search') {
      const ctx = context();
      const q = Object.fromEntries(url.searchParams);
      const hits = search(ctx, {
        q: q.q ?? '',
        module: q.module || undefined,
        domain: q.domain || undefined,
        platitude: q.platitude === 'true',
      });
      return json(res, { count: hits.length, decisions: hits.map((r) => ({ ...r, module: moduleOf(r) })) });
    }
    return json(res, { error: 'not found' }, 404);
  } catch (e) {
    return json(res, { error: e.message, stack: e.stack }, 500);
  }
});

const want = Number(flag('--port', process.env.ADROIT_PORT ?? 7373));
const listen = (port, tries = 12) => {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) return listen(port + 1, tries - 1);
    throw e;
  });
  server.listen(port, '127.0.0.1', () => {
    const urlStr = `http://127.0.0.1:${server.address().port}/`;
    const ctx = context();
    console.log(`adroit — ${ctx.records.length} decisions, ${ctx.modules.length} trees` +
      (ctx.errors.length ? `, ${ctx.errors.length} VALIDATION ERRORS` : ', validated'));
    console.log(`  ${urlStr}`);
    if (argv.includes('--open')) execFile('open', [urlStr]);
  });
};
listen(want);
