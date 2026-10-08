// @DecisionRef eng:dead-code-surfaces — a one-way ratchet: every exported symbol in the
// app must have a referencing file, and the baseline of known-dead symbols only shrinks.
// The check names its own limits: it matches NAME REFERENCES across source files (not the
// type-checked module graph), skips entry points and config files, and does not see
// dynamic access — a green result proves no more than that axis.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const appDir = path.resolve(fileURLToPath(import.meta.url), '../..');
const baselinePath = path.join(appDir, 'scripts', 'dead-exports-baseline.json');

const ENTRY_FILES = ['index.ts', 'main.tsx', 'vite.config.ts', 'vitest.config.ts', 'dev.mjs'];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', 'dist', 'dist-types'].includes(e.name)) yield* walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      yield p;
    }
  }
}

const files = [...walk(appDir)];
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

const EXPORT_RE = /^export (?:abstract )?(?:async )?(?:function\*? |const |class |interface |type |enum )([A-Za-z0-9_]+)/gm;

const dead = [];
for (const [file, text] of sources) {
  const base = path.basename(file);
  if (ENTRY_FILES.includes(base) || base.endsWith('.test.ts') || base.endsWith('.test.tsx')) continue;
  for (const m of text.matchAll(EXPORT_RE)) {
    const symbol = m[1];
    const re = new RegExp(`\\b${symbol}\\b`);
    const used = files.some((other) => other !== file && re.test(sources.get(other)));
    if (!used) dead.push(`${path.relative(appDir, file)}:${symbol}`);
  }
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : [];
const fresh = dead.filter((d) => !baseline.includes(d));
const resolved = baseline.filter((b) => !dead.includes(b));

if (resolved.length > 0) {
  // the ratchet: entries that came back to life leave the baseline for good
  const shrunk = baseline.filter((b) => dead.includes(b));
  writeFileSync(baselinePath, JSON.stringify(shrunk, null, 2) + '\n');
  console.log(`dead-exports: baseline shrank by ${resolved.length} -> ${shrunk.length} entries`);
}

if (fresh.length > 0) {
  console.error('dead-exports: exported symbols with no referencing file (new since baseline):');
  for (const d of fresh) console.error(`  ${d}`);
  console.error('delete the symbol or its feature; the baseline never grows.');
  process.exit(1);
}

console.log(
  `dead-exports: ok — ${dead.length} known-dead (baselined), limits: name-reference axis only`,
);
