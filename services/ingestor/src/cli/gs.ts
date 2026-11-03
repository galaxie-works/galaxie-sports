#!/usr/bin/env node
/**
 * `gs`: comandos de operação que rodam de qualquer máquina com DATABASE_URL (hoje, só `gs tarefa`).
 *
 *   pnpm --filter @galaxie/ingestor gs tarefa listar
 *   node services/ingestor/dist/cli/gs.js tarefa enfileirar exemplo.eco --param mensagem=oi --previa
 *
 * Runbook: docs/runbooks/tarefas.md.
 */
import { hostname, userInfo } from 'node:os';
import { closeDb, createDb } from '@galaxie/db';
import { runTarefaCli, USAGE } from '../tasks/cli.js';

const [command, ...rest] = process.argv.slice(2);

if (command !== 'tarefa') {
  console.error(command ? `Comando desconhecido: ${command}.` : 'Falta o comando.');
  console.error(USAGE);
  process.exit(2);
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('Defina DATABASE_URL (.env).');
  process.exit(2);
}

const user = (() => {
  try {
    return userInfo().username;
  } catch {
    return 'desconhecido';
  }
})();

const db = createDb(DATABASE_URL, { max: 2, applicationName: 'galaxie-gs' });
try {
  process.exitCode = await runTarefaCli(rest, db, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    by: process.env.GS_REQUESTED_BY ?? `cli:${user}@${hostname()}`,
  });
} finally {
  await closeDb(db);
}
