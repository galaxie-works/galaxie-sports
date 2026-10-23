/**
 * Perfil das pessoas sem foto e sem data de nascimento escaladas em competições tier 1 e 2 (as que só vieram das
 * escalações): players/profiles?player e coachs?id, uma chamada por pessoa, normalizadas na hora.
 *   pnpm --filter @galaxie/ingestor bootstrap:perfis --plan
 *   pnpm --filter @galaxie/ingestor bootstrap:perfis
 * Opções: --desde 2026-01-01 · --tier-max 2 · --max-chamadas N · --forcar · --por-dia N
 * Depois, `assets:fotos-wikidata` casa as fotos de quem ganhou data de nascimento.
 */
import { closeDb } from '@galaxie/db';
import { jobContextFromEnv } from '../context.js';
import { profilesJob, profileTargets } from '../jobs/profiles-job.js';
import { logger } from '../logger.js';
import { normalizeAfterFetch } from '../normalize/after-fetch.js';
import { intOption, parseCli, planOrRun, runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseCli({
    desde: { type: 'string', default: '2026-01-01' },
    'tier-max': { type: 'string' },
  });
  const ctx = jobContextFromEnv();
  try {
    const spec = profilesJob(() =>
      profileTargets(ctx.db, {
        since: new Date(`${values.desde}T00:00:00Z`),
        maxTier: intOption(values['tier-max'], 'tier-max') ?? 2,
      }),
    );
    const normalize = normalizeAfterFetch(ctx.db, {
      onError: (err, endpoint, params) =>
        logger.warn(
          { err, endpoint, params },
          'falha ao normalizar perfil; o normalize:football tenta de novo',
        ),
    });
    const report = await planOrRun(ctx, spec, values, { afterFetch: normalize.afterFetch });
    if (report) {
      const n = normalize.report();
      console.log(
        `Core: ${n.normalized} resposta(s) normalizadas (${n.stats.persons} pessoas) · ${n.errors} com erro.`,
      );
    }
  } finally {
    await closeDb(ctx.db);
  }
});
