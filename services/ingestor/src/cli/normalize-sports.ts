/**
 * Normalização raw → core dos 11 esportes além do futebol (issue #25), sem nenhuma chamada ao fornecedor.
 *   pnpm --filter @galaxie/ingestor normalize:sports                          # todos, incremental (cursor por esporte)
 *   pnpm --filter @galaxie/ingestor normalize:sports --esporte basketball     # só um (repita --esporte para vários)
 *   pnpm --filter @galaxie/ingestor normalize:sports nba formula-1 --tudo     # posicionais também valem; --tudo reprocessa
 *   pnpm --filter @galaxie/ingestor normalize:sports --relogio                # depois, avança o relógio dos eventos
 *   pnpm --filter @galaxie/ingestor normalize:sports --detalhe                # uma linha por resposta do raw
 *   pnpm --filter @galaxie/ingestor normalize:sports --reprocessar-falhas     # tenta de novo as falhas pendentes
 * Resposta que falha várias vezes seguidas vira poison (ops.normalize_failure) e o cursor segue sem ela.
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { API_SPORTS_OTHER_SPORTS, isApiSportsOtherSport, type ApiSportsOtherSport } from '@galaxie/providers';
import { advanceEventClock } from '../normalize/event-state.js';
import { pendingNormalizeFailures, runNormalizeSportsJob } from '../normalize/raw-runner.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    esporte: { type: 'string', multiple: true, default: [] },
    tudo: { type: 'boolean', default: false },
    relogio: { type: 'boolean', default: false },
    detalhe: { type: 'boolean', default: false },
    'reprocessar-falhas': { type: 'boolean', default: false },
  },
});

const requested = [...(values.esporte ?? []), ...positionals];
const invalid = requested.filter((s) => !isApiSportsOtherSport(s));
if (invalid.length)
  throw new Error(
    `Esporte(s) desconhecido(s): ${invalid.join(', ')}. Válidos: ${API_SPORTS_OTHER_SPORTS.join(', ')}.`,
  );
const sports: ApiSportsOtherSport[] = requested.length
  ? [...new Set(requested as ApiSportsOtherSport[])]
  : [...API_SPORTS_OTHER_SPORTS];

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');

const db = createDb(url);
const started = Date.now();
const results = await runNormalizeSportsJob(db, {
  sports,
  full: values.tudo,
  retryFailures: values['reprocessar-falhas'],
  ...(values.detalhe
    ? {
        onRow: (r) =>
          console.log(
            `raw ${r.id} ${r.endpoint} ${JSON.stringify(r.params)} → ${r.outcome} (${r.items} itens)${r.error ? `: ${r.error}` : ''}`,
          ),
      }
    : {}),
});

console.table(
  results.map(({ sport, result }) => {
    const s = result.stats;
    return {
      esporte: sport,
      respostas: result.rows.length,
      erros: result.rows.filter((r) => r.outcome === 'error').length,
      competições_criadas: s.competitionsCreated,
      temporadas_criadas: s.seasonsCreated,
      fases: s.stages,
      participantes: s.participants,
      eventos_novos: s.events.inserted,
      eventos_atualizados: s.events.updated,
      eventos_sem_mudança: s.events.unchanged,
      transições: s.events.transitions,
      classificação: s.standings,
      complementos: s.supplements.applied,
      complementos_sem_evento: s.supplements.missingEvent,
    };
  }),
);
for (const { sport, result } of results) {
  for (const r of result.rows.filter((row) => row.outcome === 'error'))
    console.log(`✗ ${sport} raw ${r.id} ${r.endpoint}: ${r.error}`);
  if (Object.keys(result.stats.events.ignored).length)
    console.log(`${sport}: observações descartadas`, result.stats.events.ignored);
  const poison = (await pendingNormalizeFailures(db, 'api-sports', sport)).filter((f) => f.poisonedAt);
  if (poison.length)
    console.log(
      `${sport}: ${poison.length} resposta(s) em poison fora do cursor (raw ${poison.map((f) => f.rawId).join(', ')}); --reprocessar-falhas tenta de novo`,
    );
}

if (values.relogio) {
  const clock = await advanceEventClock(db, new Date());
  console.log(
    `Relógio: ${clock.examined} eventos examinados, ${clock.changed} mudaram (${clock.transitions} transições).`,
  );
}
console.log(
  `Concluído em ${((Date.now() - started) / 1000).toFixed(1)} s (${values.tudo ? 'reprocessamento completo' : 'incremental'}).`,
);
await closeDb(db);
if (results.some(({ result }) => result.rows.some((r) => r.outcome === 'error'))) process.exitCode = 1;
