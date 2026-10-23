/**
 * MMA: desfecho das lutas (`fights/results`, uma chamada por luta no plano free) e reagrupamento dos cards.
 *   pnpm --filter @galaxie/ingestor mma --plan                        # fila de desfechos (sem gastar cota)
 *   pnpm --filter @galaxie/ingestor mma --resultados                  # busca até a cota do dia acabar
 *   pnpm --filter @galaxie/ingestor mma --resultados --limite 20      # no máximo 20 chamadas
 *   pnpm --filter @galaxie/ingestor mma --cards                       # reagrupa lutas já gravadas nos cards
 *   opções:
 *     --temporada AAAA  temporada das lutas (padrão: a mais recente com lutas no core)
 *     --sem-live        planeja o dia sem ao vivo (LIVE = 0, DAILY = já usado) para liberar a folga ao BOOTSTRAP
 * Depois de --resultados, o desfecho chega ao core com `normalize:sports mma` (feito aqui, sem chamadas).
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb, event, season } from '@galaxie/db';
import { eq, sql } from 'drizzle-orm';
import { contextFromEnv } from '../context.js';
import { regroupMmaCards } from '../mma/cards.js';
import { knownMmaResults, loadMmaFights, prioritizeMmaResults, runMmaResultsJob } from '../mma/results.js';
import { runNormalizeSportsJob } from '../normalize/raw-runner.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    resultados: { type: 'boolean', default: false },
    cards: { type: 'boolean', default: false },
    limite: { type: 'string' },
    temporada: { type: 'string' },
    'sem-live': { type: 'boolean', default: false },
  },
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');

async function latestYear(db: ReturnType<typeof createDb>): Promise<number> {
  if (values.temporada) return Number(values.temporada);
  const [row] = await db
    .select({ year: sql<number>`max(${season.year})` })
    .from(event)
    .innerJoin(season, eq(season.id, event.seasonId))
    .where(eq(event.sport, 'mma'));
  if (!row?.year) throw new Error('Nenhuma luta de MMA no core: rode bootstrap:sports mma --jogos e normalize:sports mma.');
  return Number(row.year);
}

if (values.cards) {
  const db = createDb(url, { max: 2 });
  try {
    console.table(await regroupMmaCards(db));
  } finally {
    await closeDb(db);
  }
} else if (values.plan || !values.resultados) {
  const db = createDb(url, { max: 2 });
  try {
    const year = await latestYear(db);
    const queue = prioritizeMmaResults(await loadMmaFights(db, year), await knownMmaResults(db));
    const count = (pred: (c: (typeof queue)[number]) => boolean) => queue.filter(pred).length;
    console.table({
      temporada: year,
      'sem desfecho': queue.length,
      'lutas principais': count((c) => c.mainEvent),
      'card principal': count((c) => !c.mainEvent && c.segment === 'main_card'),
      preliminares: count((c) => c.segment === 'prelims'),
      'preliminares iniciais': count((c) => c.segment === 'early_prelims'),
    });
    console.table(
      queue.slice(0, 10).map((c) => ({ luta: c.fightId, card: c.cardName, segmento: c.segment, principal: c.mainEvent })),
    );
  } finally {
    await closeDb(db);
  }
} else {
  const { db, client, governor } = contextFromEnv();
  try {
    if (values['sem-live']) {
      const usage = await governor.usage('mma');
      await governor.plan('mma', usage.dayUtc, { LIVE: 0, DAILY: usage.used.DAILY });
    }
    const year = await latestYear(db);
    const result = await runMmaResultsJob(db, client, {
      year,
      ...(values.limite ? { limit: Number(values.limite) } : {}),
    });
    console.table({ temporada: year, ...result, errors: result.errors.length });
    for (const e of result.errors) console.log(`✗ luta ${e.fightId}: ${e.detail}`);
    const [norm] = await runNormalizeSportsJob(db, { sports: ['mma'] });
    console.log(`normalize:sports mma → ${norm?.result.stats.supplements.applied ?? 0} desfechos aplicados`);
  } finally {
    await closeDb(db);
  }
}
