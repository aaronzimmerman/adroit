import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const repoRoot = path.resolve(arg('repo', process.cwd()));
const port = Number(arg('port', '4181'));

if (!fs.existsSync(path.join(repoRoot, 'ledger'))) {
  // @DecisionRef eng:honest-exit-codes — refusing to start is a nonzero exit, not a
  // server that pretends to serve.
  console.error(`no ledger/ directory under ${repoRoot} — pass --repo <path>`);
  process.exit(1);
}

const webDist = path.resolve(fileURLToPath(import.meta.url), '../../../web/dist');
const app = createApp({ repoRoot, webDist });
app.listen(port, () => {
  console.log(`adroit ui serving ${repoRoot} on http://localhost:${port}`);
});
