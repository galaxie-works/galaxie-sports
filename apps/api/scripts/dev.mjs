/**
 * `pnpm --filter @galaxie/api dev`: o `tsc --watch` recompila src/ → dist/ a cada edição e, ao fim de cada
 * compilação, o servidor (`dist/main.js`) é reiniciado. Ctrl+C encerra os dois. Os pacotes do workspace
 * continuam vindo do dist/ deles (`pnpm build` antes).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const compiler = spawn(
  process.execPath,
  [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);

let server = null;
let restartPending = false;
let stopping = false;

function start() {
  server = spawn(process.execPath, ['--env-file-if-exists=../../.env', 'dist/main.js'], {
    cwd,
    stdio: 'inherit',
  });
  server.on('exit', () => {
    server = null;
    if (stopping) return finish();
    if (restartPending) {
      restartPending = false;
      start();
    }
    // o servidor caiu sozinho: espera a próxima compilação para subir de novo
  });
}

function restart() {
  if (stopping) return;
  if (!server) return start();
  restartPending = true;
  server.kill('SIGTERM');
}

function finish() {
  if (!server && compiler.exitCode !== null) process.exit(process.exitCode ?? 0);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  restartPending = false;
  if (compiler.exitCode === null) compiler.kill('SIGTERM');
  if (server) server.kill('SIGTERM');
  finish();
}

// erro de tipo não impede a emissão: o servidor sobe com o que compilou e o erro fica na tela
createInterface({ input: compiler.stdout }).on('line', (line) => {
  process.stdout.write(`${line}\n`);
  if (/Watching for file changes\./.test(line)) restart();
});
compiler.on('exit', (code) => (stopping ? finish() : stop(code ?? 1)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
