// Dev convenience: the thin server on :4181 plus vite's dev server proxying /api to it.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const root = path.resolve(fileURLToPath(import.meta.url), '../../..');
const server = spawn('node', [path.join(root, 'app/server/dist/index.js'), '--repo', root], {
  stdio: 'inherit',
});
const web = spawn('npm', ['run', 'dev', '-w', 'app/web'], { stdio: 'inherit', cwd: root });

const stop = () => {
  server.kill();
  web.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// @DecisionRef eng:honest-exit-codes — if either side dies, the dev command dies with it.
server.on('exit', (code) => {
  web.kill();
  process.exit(code ?? 1);
});
web.on('exit', (code) => {
  server.kill();
  process.exit(code ?? 1);
});
