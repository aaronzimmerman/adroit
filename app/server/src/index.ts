import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// --ledger <dir> opens that ledger; --repo <dir> opens <dir>/ledger; by default ./ledger. The
// user can open another ledger from the UI at any time.
const repo = arg('repo');
const ledgerDir = path.resolve(arg('ledger') ?? path.join(repo ?? process.cwd(), 'ledger'));
const port = Number(arg('port') ?? '4181');

const webDist = path.resolve(fileURLToPath(import.meta.url), '../../../web/dist');
createApp({ ledgerDir, webDist }).listen(port, () => {
  console.log(`adroit ui serving ${ledgerDir} on http://localhost:${port}`);
});
