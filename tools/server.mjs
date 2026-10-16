#!/usr/bin/env node
// adroit — the ledger explorer (ADROIT.md, The node). Local, read-only, dependency-free.
//
//   node tools/server.mjs           # serve the explorer, print the URL
//   node tools/server.mjs --open    # ...and open it in a browser
//   node tools/server.mjs --port N  # pick the port
//   node tools/server.mjs --check   # validate the store, print errors, exit 1 if any
//   node tools/server.mjs --dir D   # read a store other than ./ledger (fixtures, tests)
//   node tools/server.mjs --diff [ref]  # semantic diff of the working tree vs a ref (default: main)
//
// Everything is rebuilt from `ledger/` on every request — no index, no cache, no database. The
// explorer is a MAINTENANCE surface: it shows every field of a node, the notes the agent dump
// leaves out (dubious, questions, context) included. Read-only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  loadLedger, loadLedgerAtRef, validate, warn, search, diffStores, hasDiff, viewIndex, shapeIndex,
  openGaps, interactionLogSummary, idsInDecisionTextFindings, reachOverclaimFindings, storeCounts,
  treeIndex, nodeDetail, capabilityIndex, erdData, resolveUiAsset, gistOf,
} from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const DIR = flag('--dir', undefined);
const load = () => loadLedger({ dir: DIR ? path.resolve(DIR) : undefined });

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
// A REPORT, not a gate: it always exits 0. Only a git failure (a ref that does not exist) is an
// error, because then there is nothing to compare against and silence would be a lie.
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
  section('ADDED', d.added.map((r) => `  + ${r.id} [${r.tree ?? '—'}] ${r.decision}`));
  section('DELETED', d.deleted.map((r) => `  − ${r.id} [${r.tree ?? '—'}] ${r.decision}`));
  section('CHANGED DECISIONS', d.changed.flatMap((c) => [`  ~ ${c.id}`, ...c.ops.map((op) => `      ${op.line}`)]));
  section('CHANGED NODES', d.nodes.flatMap((n) => [`  ~ ${n.key}${n.silentRewire ? '  ⚑ SILENT RE-WIRING' : ''}`,
    ...n.ops.map((op) => `      ${op.line}`)]));
  section('TREES', [...d.treesAdded.map((t) => `  + ${t}`), ...d.treesRemoved.map((t) => `  − ${t}`)]);
  if (!hasDiff(d)) console.log('\n  (no difference)');
  const { decisionsTouched, nodesTouched, silentRewires } = d.summary;
  console.log(`\nSUMMARY: ${decisionsTouched} decision(s) touched, ${nodesTouched} node(s) changed.`);
  if (silentRewires.length) {
    console.log(`\n⚑ ${silentRewires.length} node(s) re-wired with NO change to what their decisions say — review these first:`);
    for (const k of silentRewires) console.log(`    ${k}`);
  }
  process.exit(0);
}

// --- --check: the CI/gate mode ------------------------------------------------
if (argv.includes('--check')) {
  // A file the parser rejects is the most common reason to run this, and the parser already says
  // WHICH file — the gate's job is to name the thing to fix, not to print a stack trace.
  let ctx;
  try {
    ctx = load();
  } catch (e) {
    console.error(`ledger: could not be read — ${e.message}`);
    process.exit(1);
  }
  const errors = validate(ctx);
  const c = storeCounts(ctx);
  const vx = viewIndex(ctx);
  const sx = shapeIndex(ctx);
  const line =
    // One decision per node file, so the two counts agree in a valid store; a previous-format
    // file of several decisions is a check fault, and the node count shows it.
    `ledger: ${c.decisions} decisions${c.nodes !== c.decisions ? ` in ${c.nodes} node files` : ''}, ` +
    `${c.includes} include(s), ${c.dubious} dubious node(s), ${c.questions} open question(s), ` +
    `${ctx.trees.length} trees, ` +
    `${c.views} views (${sx.edges.length} field→decision link(s) into ` +
    `${new Set(vx.refs.map((r) => r.from)).size} decision tree(s), ${sx.unlinked.length} unlinked field(s)), ` +
    `${c.references} decision→view reference(s), ` +
    `${ctx.interactions.length} interaction event(s), ` +
    // OPEN is a rule, not a kind: a gap that names the decision it produced is closed (openGaps).
    `${openGaps(ctx).length} open gap(s), ` +
    `${new Set(idsInDecisionTextFindings(ctx).map((f) => f.id)).size} decision(s) cite ids in decision text, ` +
    `${new Set(reachOverclaimFindings(ctx).map((f) => f.id)).size} decision(s) claim reach beyond their subtree`;
  const warnings = warn(ctx);
  // The interaction log is machine-local telemetry, not corpus (ADROIT.md, The interactions log): its
  // standing is reported and NEVER moves the exit code.
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

// --- the explorer, rebuilt per request ------------------------------------------
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
      // read per request and never cached: editing the UI is a reload, not a restart
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(UI));
    }
    if (p.startsWith('/ui/')) {
      const asset = resolveUiAsset(p);
      if (!asset) return json(res, { error: 'not found' }, 404);
      res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(asset.file));
    }
    if (p === '/api/check') {
      const ctx = load();
      return json(res, {
        errors: validate(ctx), warnings: warn(ctx), counts: storeCounts(ctx),
        trees: ctx.trees.length,
        interactionLog: interactionLogSummary(ctx),
      });
    }
    if (p === '/api/tree') return json(res, treeIndex(load()));
    if (p === '/api/node') {
      const d = nodeDetail(load(), url.searchParams.get('key') ?? '');
      return d ? json(res, d) : json(res, { error: 'no such node' }, 404);
    }
    if (p === '/api/search') {
      const ctx = load();
      const hits = search(ctx, { q: url.searchParams.get('q') ?? '' });
      return json(res, { count: hits.length, nodes: hits.map((n) => ({ key: n.rel, name: n.name, id: n.id, gist: gistOf(ctx, n) })) });
    }
    if (p === '/api/capability') {
      const all = capabilityIndex(load());
      const name = url.searchParams.get('name');
      if (!name) return json(res, { capabilities: all.map(({ includersByTree, ...rest }) => rest) });
      const one = all.find((c) => c.name === name);
      return one ? json(res, one) : json(res, { error: 'no such capability' }, 404);
    }
    if (p === '/api/erd') return json(res, erdData(load()));
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
    const ctx = load();
    const errors = validate(ctx);
    console.log(`adroit — ${storeCounts(ctx).decisions} decisions` +
      (errors.length ? `, ${errors.length} VALIDATION ERRORS` : ', validated'));
    console.log(`  ${urlStr}`);
    if (argv.includes('--open')) execFile('open', [urlStr]);
  });
};
listen(want);
