#!/usr/bin/env node
/**
 * `gs`: comandos de operação que rodam de qualquer máquina com DATABASE_URL.
 *
 *   pnpm --filter @galaxie/ingestor gs tarefa listar                      # a fila de tarefas (docs/runbooks/tarefas.md)
 *   pnpm --filter @galaxie/ingestor gs dev:esquema                        # o esquema do dev está em dia com a main? (#550)
 *   node services/ingestor/dist/cli/gs.js tarefa enfileirar exemplo.eco --param mensagem=oi --previa
 */
import { hostname, userInfo } from 'node:os';
import { closeDb, createDb, devDatabaseWarning } from '@galaxie/db';
import { runEsquemaCli, USAGE_ESQUEMA } from '../dev/esquema.js';
import { runTarefaCli, USAGE } from '../tasks/cli.js';

const COMMANDS = ['tarefa', 'dev:esquema'] as const;
const [command, ...rest] = process.argv.slice(2);

if (!(COMMANDS as readonly string[]).includes(command ?? '')) {
  console.error(command ? `Comando desconhecido: ${command}.` : 'Falta o comando.');
  console.error(`Comandos: ${COMMANDS.join(', ')}\n`);
  console.error(USAGE);
  console.error('');
  console.error(USAGE_ESQUEMA);
  process.exit(2);
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('Defina DATABASE_URL (.env).');
  process.exit(2);
}
// tarefa que gera arquivo a partir de dados (manifesto do acervo, relatórios) é da produção, nunca do dev (#551);
// dev:esquema é do dev por definição, sem aviso
const avisoDev =
  command === 'tarefa'
    ? devDatabaseWarning(DATABASE_URL, 'o arquivo que uma tarefa gera a partir de dados')
    : undefined;
if (avisoDev) console.error(avisoDev);

const user = (() => {
  try {
    return userInfo().username;
  } catch {
    return 'desconhecido';
  }
})();

const db = createDb(DATABASE_URL, { max: 2, applicationName: 'galaxie-gs' });
const io = { out: (line: string) => console.log(line), err: (line: string) => console.error(line) };
try {
  process.exitCode =
    command === 'dev:esquema'
      ? await runEsquemaCli(rest, db, DATABASE_URL, io)
      : await runTarefaCli(rest, db, {
          ...io,
          by: process.env.GS_REQUESTED_BY ?? `cli:${user}@${hostname()}`,
        });
} finally {
  await closeDb(db);
}
