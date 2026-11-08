/**
 * Palpites e odds do raw para o core (docs/04 §2.4), sem nenhuma chamada ao fornecedor. O caminho normal é o
 * `afterFetch` do job que busca; isto reconstrói a partir do raw (primeira carga, ou depois de uma falha).
 *   pnpm --filter @galaxie/ingestor normalize:markets                       # futebol
 *   pnpm --filter @galaxie/ingestor normalize:markets --esporte basketball  # outro esporte (repita para vários)
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { normalizeMarketsFromRaw } from '../normalize/markets.js';

const { values } = parseArgs({
  options: { esporte: { type: 'string', multiple: true, default: ['football'] } },
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(url);
try {
  for (const sport of new Set(values.esporte)) {
    const r = await normalizeMarketsFromRaw(db, sport, {
      onError: (err, id) => console.error(`raw ${id}: ${err instanceof Error ? err.message : String(err)}`),
    });
    console.log(
      `${sport}: ${r.responses} resposta(s) · ${r.normalized} normalizadas · ${r.empty} vazias · ${r.errors} com erro · ` +
        `${r.stats.predictions} palpite(s) · ${r.stats.odds} odds (casa × jogo) · ${r.stats.oddsRemoved} removidas · ` +
        `${r.stats.bookmakersCreated} casa(s) nova(s) · ${r.stats.missingEvent} sem jogo no core`,
    );
  }
} finally {
  await closeDb(db);
}
