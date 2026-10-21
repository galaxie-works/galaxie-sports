/**
 * Valida data/knowledge (issue #38): JSON Schema + regras cruzadas. Sai com código 1 se houver erro.
 *   pnpm knowledge:validate                 # na raiz
 *   pnpm knowledge:validate --sem-avisos    # mostra só erros
 *   pnpm knowledge:validate --dir <pasta>   # outra pasta com a mesma estrutura
 */
import { resolve } from 'node:path';
import { DEFAULT_KNOWLEDGE_DIR, loadKnowledge } from '../load.js';
import { formatReport, validateKnowledge } from '../validate.js';

const args = process.argv.slice(2);
const dirArg = args.indexOf('--dir');
const dir =
  dirArg >= 0 && args[dirArg + 1]
    ? resolve(process.env.INIT_CWD ?? '.', args[dirArg + 1]!)
    : DEFAULT_KNOWLEDGE_DIR;

const report = await validateKnowledge(await loadKnowledge(dir));
if (args.includes('--sem-avisos')) report.warnings = [];
console.log(formatReport(report));
process.exitCode = report.errors.length ? 1 : 0;
