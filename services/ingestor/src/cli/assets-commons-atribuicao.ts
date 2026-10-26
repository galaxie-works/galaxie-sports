/**
 * Atribuição pedida pelo autor (`Attribution` da Commons) nos créditos já gravados sem ela (logos de competição e
 * de plataforma, fotos da F1 e de pessoas). Uma vez depois do deploy que trouxe a coluna; rodar de novo é seguro.
 *
 *   pnpm --filter @galaxie/ingestor assets:commons:atribuicao --plan   # o que seria gravado (sem gravar)
 *   pnpm --filter @galaxie/ingestor assets:commons:atribuicao [--limite 500]
 *   pnpm --filter @galaxie/ingestor assets:commons:atribuicao --reconferir   # de novo os já conferidos sem atribuição
 *
 * Cada crédito consultado fica marcado (`attribution_checked_at`), com ou sem atribuição: rodadas com `--limite`
 * andam pela fila em vez de repetir os mesmos arquivos.
 *
 * Só lê a Commons (uma requisição a cada 50 arquivos, no ritmo do cliente da Wikimedia). Variável: DATABASE_URL.
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { backfillAttribution } from '../assets/commons/attribution.js';
import { WikimediaClient } from '../assets/commons/client.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    limite: { type: 'string' },
    reconferir: { type: 'boolean', default: false },
  },
  strict: true,
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const limit = values.limite ? Number(values.limite) : undefined;
if (limit !== undefined && !(Number.isInteger(limit) && limit > 0))
  throw new Error('--limite precisa ser um inteiro positivo.');
const db = createDb(url, { max: 2 });
try {
  const client = new WikimediaClient({
    userAgent: 'GalaxieSports/1.0 (https://github.com/galaxie-works/galaxie-sports; créditos da Commons)',
    log: (m) => console.log(`  ${m}`),
  });
  const report = await backfillAttribution({
    db,
    client,
    plan: values.plan,
    recheck: values.reconferir,
    ...(limit !== undefined ? { limit } : {}),
    log: (m) => console.log(`  ${m}`),
  });
  for (const t of report.missing) console.log(`  sumiu da Commons: ${t}`);
  console.log(
    `${values.plan ? 'PRÉVIA (nada gravado): ' : ''}${report.checked} arquivo(s) conferido(s): ` +
      `${report.updated} com atribuição, ${report.without} sem, ${report.missing.length} fora da Commons · ` +
      `${report.published} competição(ões)/plataforma(s) para purgar no cache · ` +
      `${client.requests} requisição(ões) à Wikimedia.`,
  );
} finally {
  await closeDb(db);
}
