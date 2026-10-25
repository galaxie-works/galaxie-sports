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
// os filhos saem sozinhos se este processo morrer à força (canal IPC fechado): ver dev-child.mjs
const watchdog = ['--import', new URL('./dev-child.mjs', import.meta.url).href];

const compiler = spawn(
  process.execPath,
  [...watchdog, tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  { cwd, stdio: ['ignore', 'pipe', 'inherit', 'ipc'] },
);

let server = null;
let restartPending = false;
let stopping = false;

const exited = (child) => child.exitCode !== null || child.signalCode !== null;

function start() {
  server = spawn(process.execPath, [...watchdog, '--env-file-if-exists=../../.env', 'dist/main.js'], {
    cwd,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
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
  if (!server && exited(compiler)) process.exit(process.exitCode ?? 0);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  restartPending = false;
  if (!exited(compiler)) compiler.kill('SIGTERM');
  if (server) server.kill('SIGTERM');
  finish();
}

// erro de tipo não impede a emissão: o servidor sobe com o que compilou e o erro fica na tela
createInterface({ input: compiler.stdout }).on('line', (line) => {
  process.stdout.write(`${line}\n`);
  if (/Watching for file changes\./.test(line)) restart();
});
// Ctrl+C chega também ao tsc (mesmo grupo de processos), que pode sair antes do nosso handler: saída por
// sinal é encerramento normal; só um tsc que termina sozinho com erro devolve o código dele
compiler.on('exit', (code, signal) => {
  if (stopping) return finish();
  stop(signal || code === 130 ? 0 : (code ?? 0));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
