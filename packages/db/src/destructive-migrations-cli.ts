/**
 * Procura declarações que contraem o schema nas migrations novas de um PR (ver destructive-migrations.ts). Usado
 * no CI, com os `.sql` que o PR acrescenta em packages/db/drizzle:
 *   node packages/db/dist/destructive-migrations-cli.js [--allowed | --warn] <arquivo.sql>...
 * Sem flag, achar uma declaração destrutiva é erro (saída 1). `--allowed` é o PR com o rótulo `contrair`: lista e
 * passa. `--warn` é a fila de merge e o push na main, onde o PR já passou pelo check: só avisa.
 * Também confere as migrations marcadas com `-- galaxie:concurrently` (só CREATE INDEX IF NOT EXISTS), para o erro
 * aparecer no PR e não no migrate do deploy.
 */
import { readFileSync } from 'node:fs';
import { concurrentIndexesOf, isConcurrentMigration } from './concurrent-indexes.js';
import { destructiveStatements } from './destructive-migrations.js';

const RULE =
  'Migration que contrai o schema só entra num PR próprio, com o rótulo `contrair`, depois do deploy que parou de usar ' +
  'o que sai (docs/runbooks/migrations.md). Para só acrescentar (coluna opcional ou com DEFAULT, tabela, índice) ' +
  'não precisa de rótulo: reescreva a migration para expandir e deixe a contração para o PR seguinte.';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const files = args.filter((a) => !a.startsWith('--'));
const unknown = flags.filter((f) => f !== '--allowed' && f !== '--warn');
if (unknown.length || flags.length > 1) {
  console.error('uso: destructive-migrations-cli.js [--allowed | --warn] <arquivo.sql>...');
  process.exit(2);
}
const level = flags[0] === '--allowed' ? 'notice' : flags[0] === '--warn' ? 'warning' : 'error';
const github = process.env.GITHUB_ACTIONS === 'true';

const report = (file: string, line: number, message: string, lvl = level) =>
  console.log(github ? `::${lvl} file=${file},line=${line}::${message}` : `${file}:${line}: ${message}`);

let destructive = 0;
let invalid = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (isConcurrentMigration(text)) {
    try {
      concurrentIndexesOf(text);
    } catch (err) {
      invalid += 1;
      report(file, 1, (err as Error).message, 'error');
    }
  }
  for (const s of destructiveStatements(text)) {
    destructive += 1;
    report(file, s.line, `${s.rule}: ${s.excerpt}`);
  }
}

if (invalid) process.exit(1);
if (!destructive) {
  console.log(`${files.length} migration(s) nova(s), nenhuma contrai o schema.`);
} else if (level === 'error') {
  console.error(
    `${destructive} declaração(ões) que contrai(em) o schema, e o PR não tem o rótulo \`contrair\`. ${RULE}`,
  );
  process.exit(1);
} else {
  console.log(
    `${destructive} declaração(ões) que contrai(em) o schema em ${files.length} migration(s) nova(s)` +
      (level === 'notice' ? ': PR com o rótulo `contrair`.' : ': conferido no PR (aqui só aviso).'),
  );
}
