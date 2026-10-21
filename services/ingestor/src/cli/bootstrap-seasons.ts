/**
 * Bootstrap das temporadas (issue #13): por competição × temporada acessível no plano — teams, fixtures,
 * rounds, standings, injuries e os 4 rankings de jogadores (só o que o `coverage` permite) + venues por país.
 *   pnpm --filter @galaxie/ingestor bootstrap:seasons --plan          # rede × cache × feito, sem chamar
 *   pnpm --filter @galaxie/ingestor bootstrap:seasons --sem-live      # executa (retoma de onde parou)
 * Opções: --tier-max 2 · --temporadas-tier1 N (padrão: todas) · --temporadas-tier2 N (padrão 3)
 *         --ligas 71,13 · --h2h-temporada-atual (free: reconstrói a temporada atual das ligas tier 1 via h2h)
 *         --max-chamadas N · --forcar · --por-dia N
 */
import { closeDb } from '@galaxie/db';
import { jobContextFromEnv } from '../context.js';
import { reconstructSeasonFromH2h } from '../jobs/fixtures.js';
import { seasonsJob, type SeasonsOptions } from '../jobs/seasons-job.js';
import { intOption, listOption, parseCli, planOrRun, runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseCli({
    'tier-max': { type: 'string' },
    'temporadas-tier1': { type: 'string' },
    'temporadas-tier2': { type: 'string' },
    ligas: { type: 'string' },
    'h2h-temporada-atual': { type: 'boolean', default: false },
  });
  const ctx = jobContextFromEnv();
  try {
    const opts: SeasonsOptions = {
      maxTier: intOption(values['tier-max'], 'tier-max'),
      tier1Seasons: intOption(values['temporadas-tier1'], 'temporadas-tier1'),
      tier2Seasons: intOption(values['temporadas-tier2'], 'temporadas-tier2'),
      leagues: listOption(values.ligas),
      h2hCurrentSeason: values['h2h-temporada-atual'],
    };
    const report = await planOrRun(ctx, seasonsJob(ctx.catalog, ctx.raw, ctx.plan, ctx.now, opts), values);
    if (report && opts.h2hCurrentSeason) {
      for (const c of await ctx.catalog.competitions(1)) {
        const current = c.seasons.find((s) => s.current);
        if (c.type !== 'league' || !current) continue;
        const fixtures = await reconstructSeasonFromH2h(ctx.raw, c.leagueId, current.year);
        if (fixtures.length)
          console.log(`  ${c.slug} ${current.year}: ${fixtures.length} jogo(s) reconstruído(s) via h2h`);
      }
    }
  } finally {
    await closeDb(ctx.db);
  }
});
