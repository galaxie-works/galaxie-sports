/**
 * Sync diário (issue #19), prioridade DAILY — rodar logo após 00:00 UTC (ex.: cron `5 0 * * *`).
 * Reexecutar no mesmo dia é seguro: cada item vale uma vez por dia UTC (ops.sync_cursor).
 *   pnpm --filter @galaxie/ingestor sync:daily --plan
 *   pnpm --filter @galaxie/ingestor sync:daily
 * Passos: fixtures?date= D-1/D0/D+1 · injuries?date= D0 · /leagues · /status (reconciliação, sem cota)
 *         · detalhe dos encerrados (tier 1 → clássicos → tier 2) · rodízio de entidades tier 1.
 * Opções: --max-detalhes N (free 35) · --rodizio N (free 5) · --dias-atras 3 · --lesoes-amanha
 *         · --outros-esportes (games/races/fights?date= nas outras 11 APIs) · --max-chamadas N · --forcar
 */
import { resolve } from 'node:path';
import { type ApiSport } from '@galaxie/apisports-client';
import { closeDb } from '@galaxie/db';
import { jobContextFromEnv } from '../context.js';
import { dailyJob, OTHER_SPORTS_SCHEDULE } from '../jobs/daily-job.js';
import { resolveDerbiesFromRaw } from '../knowledge/derbies.js';
import { intOption, parseCli, planOrRun, runCli } from './job-cli.js';

const knowledgeDir = resolve('../../data/knowledge');

await runCli(async () => {
  const { values } = parseCli({
    'max-detalhes': { type: 'string' },
    rodizio: { type: 'string' },
    'dias-atras': { type: 'string' },
    'lesoes-amanha': { type: 'boolean', default: false },
    'outros-esportes': { type: 'boolean', default: false },
    'sem-status': { type: 'boolean', default: false },
  });
  const ctx = jobContextFromEnv();
  try {
    if (!values.plan && !ctx.offline && !values['sem-status']) {
      // /status não consome cota: reconcilia o Governor com o contador do fornecedor antes de gastar
      const sports: ApiSport[] = [
        'football',
        ...(values['outros-esportes'] ? (Object.keys(OTHER_SPORTS_SCHEDULE) as ApiSport[]) : []),
      ];
      for (const sport of sports) {
        const s = await ctx.client.status(sport);
        console.log(`/status ${sport}: ${s.used}/${s.limitDay} (${s.plan ?? '?'})`);
      }
    }
    const derbyKeys = async () =>
      new Set((await resolveDerbiesFromRaw(knowledgeDir, ctx.raw)).pairs.map((p) => p.key));
    const spec = dailyJob(ctx.catalog, ctx.raw, ctx.cursors, ctx.plan, ctx.now, derbyKeys, {
      maxDetails: intOption(values['max-detalhes'], 'max-detalhes'),
      rotation: intOption(values.rodizio, 'rodizio'),
      backlogDays: intOption(values['dias-atras'], 'dias-atras'),
      injuriesTomorrow: values['lesoes-amanha'],
      otherSports: values['outros-esportes'],
    });
    await planOrRun(ctx, spec, { ...values, 'sem-live': false });
  } finally {
    await closeDb(ctx.db);
  }
});
