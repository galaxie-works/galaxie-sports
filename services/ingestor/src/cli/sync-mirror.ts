/**
 * Espelho da api-sports (sync:mirror), prioridade DAILY — roda às 08:00 UTC (fora da janela de jogos das Américas).
 * Renova no ritmo de cada endpoint o que o sync diário não busca: tabela oficial, artilharia, rodadas, times,
 * lesões da temporada, estatísticas de time, estádios, palpites, odds, referência e elencos tier 2+ do futebol;
 * nos outros 11 esportes, temporada inteira, classificação, times, elencos, estatísticas por jogo e odds.
 *   pnpm --filter @galaxie/ingestor sync:mirror --plan
 *   pnpm --filter @galaxie/ingestor sync:mirror [esporte ...]
 * Períodos, endpoints ligados, ordem dos grupos e orçamento: Ajustes → Operação → Espelho (MIRROR_* no env, com
 * as sobrescritas do painel que o scheduler aplica). O `--plan` também grava o inventário que o painel usa na
 * estimativa de chamadas (só contagem, sem chamar o fornecedor).
 * Opções: --orcamento N (chamadas por API e por dia; padrão MIRROR_BUDGET_PERCENT da cota nos pagos, 10 no free)
 *         · --tier-outros N (padrão 2) · --max-chamadas N · --forcar · --sem-normalizar
 * Reexecutar no mesmo dia é seguro: o que já foi renovado hoje conta no orçamento e não é buscado de novo.
 */
import { resolve } from 'node:path';
import type { ApiSport } from '@galaxie/apisports-client';
import { closeDb } from '@galaxie/db';
import { mirrorConfigFromEnv } from '@galaxie/runtime-config';
import { panelEnv } from '../assets/commons/panel-env.js';
import { loadSportCatalog } from '../catalog/catalog-config.js';
import { isOtherSport, OTHER_SPORTS } from '../catalog/sport-catalog.js';
import { jobContextFromEnv } from '../context.js';
import { mirrorJobs } from '../jobs/mirror-job.js';
import { PgSportMirrorSource } from '../jobs/mirror-source.js';
import { resolveDerbiesFromRaw } from '../knowledge/derbies.js';
import { logger } from '../logger.js';
import { normalizeAfterFetch } from '../normalize/after-fetch.js';
import { intOption, parseCli, planOrRun, runCli } from './job-cli.js';

const knowledgeDir = resolve('../../data/knowledge');
const catalogPath = (sport: string) => resolve(`../../config/competitions/${sport}.yaml`);

await runCli(async () => {
  const { values, positionals } = parseCli({
    orcamento: { type: 'string' },
    'tier-outros': { type: 'string' },
    'sem-normalizar': { type: 'boolean', default: false },
  });
  const invalid = positionals.filter((s) => s !== 'football' && !isOtherSport(s));
  if (invalid.length)
    throw new Error(
      `Esporte(s) desconhecido(s): ${invalid.join(', ')}. Válidos: football, ${OTHER_SPORTS.join(', ')}.`,
    );
  const sports: ApiSport[] = positionals.length ? (positionals as ApiSport[]) : ['football', ...OTHER_SPORTS];
  const ctx = jobContextFromEnv();
  try {
    // as flags do painel por cima do env também quando o job roda à mão (pelo scheduler o env já vem com elas);
    // flag inválida no .env (o painel não grava valor inválido) para o job antes de chamar o fornecedor
    const mirror = mirrorConfigFromEnv(await panelEnv(ctx.db));
    for (const sport of sports) mirror.api(sport);
    const jobs = mirrorJobs(
      {
        catalog: ctx.catalog,
        raw: ctx.raw,
        cursors: ctx.cursors,
        planFor: ctx.planFor!,
        now: ctx.now,
        derbyPairs: async () => (await resolveDerbiesFromRaw(knowledgeDir, ctx.raw)).pairs.map((p) => p.key),
        sports: new PgSportMirrorSource(ctx.db, (sport) => loadSportCatalog(catalogPath(sport)), ctx.now),
      },
      {
        sports,
        budget: intOption(values.orcamento, 'orcamento'),
        other: { maxTier: intOption(values['tier-outros'], 'tier-outros') },
        force: values.forcar,
        mirror,
      },
    );
    // futebol direto ao core (times, elencos; a tabela do fornecedor só onde não calculamos); os outros esportes
    // ficam com o normalize-sports de hora em hora
    const normalize = values['sem-normalizar']
      ? undefined
      : normalizeAfterFetch(ctx.db, {
          otherSports: true,
          onError: (err, endpoint, params) =>
            logger.warn(
              { err, endpoint, params },
              'falha ao normalizar resposta; a normalização noturna tenta de novo',
            ),
        });
    // uma execução por API: a cota esgotada (ou um 429) de uma não para as outras
    let ran = false;
    const failed: string[] = [];
    for (const { sport, spec } of jobs) {
      console.log(`\n== ${sport}`);
      try {
        const report = await planOrRun(
          ctx,
          spec,
          { ...values, 'sem-live': false },
          normalize ? { afterFetch: normalize.afterFetch } : {},
        );
        ran = !!report || ran;
        // 429 ou erro do fornecedor que vale para a API toda: o runner para e devolve parcial, sem exceção
        if (report?.stoppedBy === 'provider') failed.push(sport);
      } catch (err) {
        logger.error({ err, sport }, 'espelho: execução da API falhou; seguindo com as próximas');
        failed.push(sport);
      }
    }
    if (ran && normalize) {
      const n = normalize.report();
      console.log(
        `Core: ${n.normalized} resposta(s) normalizadas · ${n.empty} vazias · ${n.errors} com erro.`,
      );
    }
    // a falha de uma API não para as outras, mas o job sai com erro (job_run e alerta de falhas seguidas)
    if (failed.length) {
      console.error(`Espelho: ${failed.length} API(s) com falha: ${failed.join(', ')}.`);
      process.exitCode = 1;
    }
  } finally {
    await closeDb(ctx.db);
  }
});
