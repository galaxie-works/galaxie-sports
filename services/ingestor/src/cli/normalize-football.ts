/**
 * Normalização raw → core do futebol (issue #22), sem nenhuma chamada ao fornecedor.
 *   pnpm --filter @galaxie/ingestor normalize:football            # incremental (desde o último cursor)
 *   pnpm --filter @galaxie/ingestor normalize:football --tudo     # reprocessa todo o raw
 *   pnpm --filter @galaxie/ingestor normalize:football --relogio  # depois, avança o relógio dos eventos
 *   pnpm --filter @galaxie/ingestor normalize:football --tudo --endpoints /players,/transfers
 *     # reprocessa só esses endpoints (sem mexer no cursor incremental)
 *   pnpm --filter @galaxie/ingestor normalize:football --reprocessar-falhas  # tenta de novo as falhas pendentes
 * Resposta que falha várias vezes seguidas vira poison (ops.normalize_failure) e o cursor segue sem ela.
 */
import { closeDb, createDb } from '@galaxie/db';
import { advanceEventClock } from '../normalize/event-state.js';
import { pendingNormalizeFailures, runNormalizeFootballJob } from '../normalize/raw-runner.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');

const full = process.argv.includes('--tudo');
const endpointsArg = process.argv[process.argv.indexOf('--endpoints') + 1];
const endpoints = process.argv.includes('--endpoints') && endpointsArg ? endpointsArg.split(',') : undefined;
const db = createDb(url);
const started = Date.now();
const result = await runNormalizeFootballJob(db, {
  full,
  retryFailures: process.argv.includes('--reprocessar-falhas'),
  ...(endpoints ? { endpoints } : {}),
  onRow: (r) =>
    console.log(
      `raw ${r.id} ${r.endpoint} ${JSON.stringify(r.params)} → ${r.outcome} (${r.items} itens)${r.error ? `: ${r.error}` : ''}`,
    ),
});
const s = result.stats;
console.log(
  `\nRespostas examinadas: ${result.rows.length} (${full ? 'reprocessamento completo' : 'incremental'})`,
);
console.table({
  competições_criadas: s.competitionsCreated,
  temporadas_criadas: s.seasonsCreated,
  fases: s.stages,
  estádios: s.venues,
  participantes: s.participants,
  pessoas: s.persons,
  eventos_novos: s.events.inserted,
  eventos_atualizados: s.events.updated,
  eventos_sem_mudança: s.events.unchanged,
  transições: s.events.transitions,
  incidentes: s.incidents,
  elencos: s.rosters,
  estatísticas_temporada: s.seasonStats,
  transferências: s.transfers,
  títulos: s.trophies,
  afastamentos: s.sidelined,
  classificação: s.standings,
  assets: s.assets,
});
if (Object.keys(s.events.ignored).length) console.log('Observações descartadas:', s.events.ignored);
const poison = (await pendingNormalizeFailures(db, 'api-sports', 'football')).filter((f) => f.poisonedAt);
if (poison.length)
  console.log(
    `${poison.length} resposta(s) em poison fora do cursor (raw ${poison.map((f) => f.rawId).join(', ')}); --reprocessar-falhas tenta de novo`,
  );

if (process.argv.includes('--relogio')) {
  const clock = await advanceEventClock(db, new Date());
  console.log(
    `Relógio: ${clock.examined} eventos examinados, ${clock.changed} mudaram (${clock.transitions} transições).`,
  );
}
console.log(`Concluído em ${((Date.now() - started) / 1000).toFixed(1)} s.`);
await closeDb(db);
if (result.rows.some((r) => r.outcome === 'error')) process.exitCode = 1;
