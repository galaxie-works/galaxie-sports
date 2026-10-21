/**
 * Bootstrap do catálogo das outras 11 APIs (issue #16). Cada API tem cota própria, então os esportes rodam
 * em paralelo; o que já estiver no raw dentro do TTL não gasta cota.
 *
 *   pnpm --filter @galaxie/ingestor bootstrap:sports --plan                    # o que gastaria, por esporte
 *   pnpm --filter @galaxie/ingestor bootstrap:sports                           # todos os 11 esportes
 *   pnpm --filter @galaxie/ingestor bootstrap:sports basketball volleyball     # só alguns
 *   opções:
 *     --sem-live        planeja o dia sem ao vivo (LIVE = 0, DAILY = já usado) para liberar a folga ao BOOTSTRAP
 *     --jogos           também busca temporadas inteiras (games?league&season; F1 races?season; MMA fights?season)
 *     --tier N          competições até o tier N entram no --jogos (padrão 1)
 *     --temporadas N    sem janela de plano (planos pagos), quantas temporadas recentes buscar (padrão 3)
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { planByName } from '@galaxie/apisports-client';
import { closeDb, createDb } from '@galaxie/db';
import { planSportCatalog, runSportCatalogJob, summarizeSport } from '../bootstrap/sport-catalog-job.js';
import { loadSportCatalog } from '../catalog/catalog-config.js';
import { isOtherSport, OTHER_SPORTS, type OtherSport } from '../catalog/sport-catalog.js';
import { contextFromEnv } from '../context.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    plan: { type: 'boolean', default: false },
    'sem-live': { type: 'boolean', default: false },
    jogos: { type: 'boolean', default: false },
    tier: { type: 'string', default: '1' },
    temporadas: { type: 'string', default: '3' },
  },
});

const invalid = positionals.filter((s) => !isOtherSport(s));
if (invalid.length) {
  throw new Error(`Esporte(s) desconhecido(s): ${invalid.join(', ')}. Válidos: ${OTHER_SPORTS.join(', ')}.`);
}
const sports: OtherSport[] = positionals.length ? (positionals as OtherSport[]) : [...OTHER_SPORTS];
const games = values.jogos
  ? { maxTier: Number(values.tier), latestSeasons: Number(values.temporadas) }
  : undefined;
const catalogPath = (sport: string) => resolve(`../../config/competitions/${sport}.yaml`);

if (values.plan) {
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(process.env.DATABASE_URL);
  const plan = planByName(process.env.APISPORTS_PLAN);
  const rows = [];
  for (const sport of sports) {
    const p = await planSportCatalog(db, sport, await loadSportCatalog(catalogPath(sport)), { plan, games });
    const reference = p.calls.filter((c) => !c.params);
    const season = p.calls.filter((c) => c.params);
    rows.push({
      esporte: sport,
      'referência (cota)': `${reference.filter((c) => c.source === 'network').length}/${reference.length}`,
      'temporadas (cota)': games
        ? `${season.filter((c) => c.source === 'network').length}/${season.length}`
        : '-',
      total: p.calls.filter((c) => c.source === 'network').length,
      estimado: p.estimated ? 'sim (sem /leagues no raw)' : 'não',
    });
  }
  console.table(rows);
  console.log(
    `Plano ${plan.name}: ${plan.dailyLimit}/dia por API; temporadas ${plan.seasons ? `${plan.seasons.min}–${plan.seasons.max}` : 'todas'}.`,
  );
  await closeDb(db);
} else {
  const { db, client, governor } = contextFromEnv();
  const results = await Promise.allSettled(
    sports.map(async (sport) => {
      if (values['sem-live']) {
        const usage = await governor.usage(sport);
        await governor.plan(sport, usage.dayUtc, { LIVE: 0, DAILY: usage.used.DAILY });
      }
      return runSportCatalogJob(db, client, sport, await loadSportCatalog(catalogPath(sport)), { games });
    }),
  );
  const rows = results.map((r, i) =>
    r.status === 'fulfilled'
      ? {
          esporte: r.value.sport,
          cota: r.value.calls.filter((c) => c.source === 'network').length,
          raw: r.value.calls.filter((c) => c.source === 'cache').length,
          adiadas: r.value.calls.filter((c) => c.source === 'deferred').length,
          competições: r.value.stats.competitions.inserted + r.value.stats.competitions.updated,
          temporadas: r.value.stats.seasons,
          assets: r.value.stats.assets,
          catálogo: JSON.stringify(summarizeSport(r.value.check)),
        }
      : { esporte: sports[i], erro: String(r.reason) },
  );
  console.table(rows);
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const problems = r.value.check.filter((c) => c.status !== 'ok');
    if (problems.length) {
      console.log(`Conferência ${r.value.sport}:`);
      console.table(problems);
    }
  }
  if (results.some((r) => r.status === 'rejected')) process.exitCode = 1;
  await closeDb(db);
}
