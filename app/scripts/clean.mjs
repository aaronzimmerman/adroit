// @DecisionRef eng:clean-verification-builds — verification builds start clean: no
// build artifact already in an output directory is ever trusted.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const appDir = path.resolve(fileURLToPath(import.meta.url), '../..');
for (const pkg of ['shared', 'server', 'web']) {
  for (const out of ['dist', 'dist-types']) {
    rmSync(path.join(appDir, pkg, out), { recursive: true, force: true });
  }
  rmSync(path.join(appDir, pkg, 'tsconfig.tsbuildinfo'), { force: true });
}
