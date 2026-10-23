/**
 * Bootstrap de pessoas e times (issue #15): players/squads, coachs e transfers por time; trophies e sidelined
 * em lotes de 20 (elencos e técnicos atuais tier 1); h2h de todos os clássicos da base semântica.
 *   pnpm --filter @galaxie/ingestor bootstrap:people --plan
 *   pnpm --filter @galaxie/ingestor bootstrap:people --sem-live
 * Opções: --tier-times 2 · --tier-pessoas 1 · --sem-classicos · --estatisticas-jogadores (players?league&season
 *         paginado) · --tier-estatisticas 1 · --so-estatisticas (só essas fases) · --temporadas-tier1 N
 *         · --temporadas-tier2 N · --max-chamadas N · --forcar · --por-dia N
 */
import { resolve } from 'node:path';
import { closeDb } from '@galaxie/db';
import { jobContextFromEnv } from '../context.js';
import { peopleJob } from '../jobs/people-job.js';
import { resolveDerbiesFromRaw } from '../knowledge/derbies.js';
import { intOption, parseCli, planOrRun, runCli } from './job-cli.js';

const knowledgeDir = resolve('../../data/knowledge');

await runCli(async () => {
  const { values } = parseCli({
    'tier-times': { type: 'string' },
    'tier-pessoas': { type: 'string' },
    'sem-classicos': { type: 'boolean', default: false },
    'estatisticas-jogadores': { type: 'boolean', default: false },
    'tier-estatisticas': { type: 'string' },
    'so-estatisticas': { type: 'boolean', default: false },
    'temporadas-tier1': { type: 'string' },
    'temporadas-tier2': { type: 'string' },
  });
  const ctx = jobContextFromEnv();
  try {
    let unresolved: { slug: string; missing: string[] }[] = [];
    const derbyPairs = async () => {
      const r = await resolveDerbiesFromRaw(knowledgeDir, ctx.raw);
      unresolved = r.unresolved;
      return r.pairs.map((p) => p.key);
    };
    const spec = peopleJob(ctx.catalog, ctx.raw, ctx.cursors, ctx.plan, ctx.now, derbyPairs, {
      teamMaxTier: intOption(values['tier-times'], 'tier-times'),
      personMaxTier: intOption(values['tier-pessoas'], 'tier-pessoas'),
      derbies: !values['sem-classicos'],
      playerStats: values['estatisticas-jogadores'] || values['so-estatisticas'],
      playerStatsMaxTier: intOption(values['tier-estatisticas'], 'tier-estatisticas'),
      onlyPlayerStats: values['so-estatisticas'],
      seasons: {
        tier1Seasons: intOption(values['temporadas-tier1'], 'temporadas-tier1'),
        tier2Seasons: intOption(values['temporadas-tier2'], 'temporadas-tier2'),
      },
    });
    await planOrRun(ctx, spec, values);
    if (unresolved.length) {
      console.log(
        `Clássicos sem ID resolvido (${unresolved.length}) — preencha api_sports.team_id na base ou rode bootstrap:seasons antes:`,
      );
      for (const u of unresolved) console.log(`  ${u.slug}: ${u.missing.join(', ')}`);
    }
  } finally {
    await closeDb(ctx.db);
  }
});
