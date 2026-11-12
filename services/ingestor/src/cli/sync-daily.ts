/**
 * Sync diário (issue #19), prioridade DAILY — rodar logo após 00:00 UTC (ex.: cron `5 0 * * *`).
 * Reexecutar no mesmo dia é seguro: cada item vale uma vez por dia UTC (ops.sync_cursor).
 *   pnpm --filter @galaxie/ingestor sync:daily --plan
 *   pnpm --filter @galaxie/ingestor sync:daily
 * Passos: fixtures?date= D-1/D0/D+1 · injuries?date= D0 · /leagues · /status (reconciliação, sem cota)
 *         · detalhe dos encerrados (tier 1 → clássicos → tier 2) · rodízio de entidades tier 1
 *         · relista da temporada atual (fixtures?league&season, tier 1 a cada 2 dias, os demais a cada 7)
 *         · números dos jogadores da temporada em jogo (players?league&season, todas as páginas; tier 1 a cada 3 dias).
 * Módulos por tier (escalação, relista, rodízio, números dos jogadores, lesões do dia): Ajustes → Dados → Módulos
 * por esporte (MODULES_FOOTBALL); padrão: o de sempre.
 * Opções: --max-detalhes N (free 35) · --rodizio N (free 5) · --listas-temporada N (pagos 300, free 0)
 *         · --estatisticas-jogadores N (páginas por dia; pagos 1000, free 0) · --tier-estatisticas 1
 *         · --dias-atras 3 · --lesoes-amanha
 *         · --outros-esportes (games/races/fights?date= nas outras 11 APIs) · --max-chamadas N · --forcar
 *         · --sem-normalizar (só grava o raw) · --sem-tabelas (não recalcula as classificações)
 * Cada resposta vai direto ao core (agenda, placares, detalhe dos encerrados); no fim, as tabelas das
 * temporadas com resultado novo são recalculadas localmente (@galaxie/rules, source = computed).
 */
import { resolve } from 'node:path';
import { type ApiSport } from '@galaxie/apisports-client';
import { closeDb } from '@galaxie/db';
import { moduleConfigFromEnv } from '@galaxie/runtime-config';
import { panelEnv } from '../assets/commons/panel-env.js';
import { jobContextFromEnv } from '../context.js';
import {
  checkProviderStatus,
  dailyJob,
  OTHER_SPORTS_SCHEDULE,
  reopenSeasonLists,
  startOfUtcDay,
  trackSeasonLists,
} from '../jobs/daily-job.js';
import { resolveDerbiesFromRaw } from '../knowledge/derbies.js';
import { logger } from '../logger.js';
import { normalizeAfterFetch } from '../normalize/after-fetch.js';
import {
  footballSeasonIds,
  needsAttention,
  recomputeStandings,
  seasonsWithNewResults,
} from '../standings/recompute.js';
import { intOption, parseCli, planOrRun, runCli } from './job-cli.js';

const knowledgeDir = resolve('../../data/knowledge');
const rulesDir = resolve('../../config/rules');

await runCli(async () => {
  const { values } = parseCli({
    'max-detalhes': { type: 'string' },
    rodizio: { type: 'string' },
    'listas-temporada': { type: 'string' },
    'estatisticas-jogadores': { type: 'string' },
    'tier-estatisticas': { type: 'string' },
    'dias-atras': { type: 'string' },
    'lesoes-amanha': { type: 'boolean', default: false },
    'outros-esportes': { type: 'boolean', default: false },
    'sem-status': { type: 'boolean', default: false },
    'sem-normalizar': { type: 'boolean', default: false },
    'sem-tabelas': { type: 'boolean', default: false },
  });
  const ctx = jobContextFromEnv();
  try {
    if (!values.plan && !ctx.offline && !values['sem-status']) {
      // /status não consome cota: reconcilia o Governor com o contador do fornecedor antes de gastar
      const sports: ApiSport[] = [
        'football',
        ...(values['outros-esportes'] ? (Object.keys(OTHER_SPORTS_SCHEDULE) as ApiSport[]) : []),
      ];
      for (const r of await checkProviderStatus(sports, (sport) => ctx.client.status(sport))) {
        if (r.ok)
          console.log(`/status ${r.sport}: ${r.status.used}/${r.status.limitDay} (${r.status.plan ?? '?'})`);
        else
          logger.warn(
            { err: r.error, sport: r.sport },
            '/status falhou; seguindo o sync com o contador local da cota',
          );
      }
    }
    const derbyKeys = async () =>
      new Set((await resolveDerbiesFromRaw(knowledgeDir, ctx.raw)).pairs.map((p) => p.key));
    // módulos por tier do painel (MODULES_FOOTBALL) por cima do env também quando o job roda à mão (pelo scheduler
    // o env já vem com eles); valor inválido no .env para o job antes de chamar o fornecedor
    const modules = moduleConfigFromEnv(await panelEnv(ctx.db)).api('football');
    const spec = dailyJob(ctx.catalog, ctx.raw, ctx.cursors, ctx.plan, ctx.now, derbyKeys, {
      modules,
      maxDetails: intOption(values['max-detalhes'], 'max-detalhes'),
      rotation: intOption(values.rodizio, 'rodizio'),
      seasonLists: intOption(values['listas-temporada'], 'listas-temporada'),
      playerStats: intOption(values['estatisticas-jogadores'], 'estatisticas-jogadores'),
      playerStatsTier: intOption(values['tier-estatisticas'], 'tier-estatisticas'),
      force: values.forcar,
      backlogDays: intOption(values['dias-atras'], 'dias-atras'),
      injuriesTomorrow: values['lesoes-amanha'],
      otherSports: values['outros-esportes'],
    });
    const normalize = values['sem-normalizar']
      ? undefined
      : normalizeAfterFetch(ctx.db, {
          onError: (err, endpoint, params) =>
            logger.warn(
              { err, endpoint, params },
              'falha ao normalizar resposta; o normalize:football tenta de novo',
            ),
        });
    // temporadas relistadas: a tabela é recalculada mesmo sem jogo recente (a relista traz os antigos)
    const lists = trackSeasonLists(normalize);
    const report = await planOrRun(
      ctx,
      spec,
      { ...values, 'sem-live': false },
      { afterFetch: lists.afterFetch },
    );
    await reopenSeasonLists(ctx.cursors, lists.failed());
    if (report && normalize) {
      const n = normalize.report();
      console.log(
        `Core: ${n.normalized} resposta(s) normalizadas (${n.stats.events.inserted} eventos novos, ${n.stats.events.updated} atualizados, ${n.stats.incidents} incidentes) · ${n.empty} vazias · ${n.errors} com erro.`,
      );
    }
    if (report && !values['sem-tabelas']) {
      // tabelas da temporada atual: recalculadas a partir dos resultados novos (D-1…D-N)
      const days = (intOption(values['dias-atras'], 'dias-atras') ?? 3) + 1;
      const since = new Date(startOfUtcDay(ctx.now()).getTime() - days * 86_400_000);
      const seasonIds = [
        ...(await seasonsWithNewResults(ctx.db, since)),
        ...(await footballSeasonIds(ctx.db, lists.normalized())),
      ];
      const tables = await recomputeStandings(ctx.db, { seasonIds, rulesDir });
      const written = tables.filter((t) => t.outcome === 'written');
      console.log(
        `Tabelas: ${written.length} recalculada(s) de ${tables.length} temporada(s) com resultado novo` +
          (written.length ? ` (${written.map((t) => `${t.competition} ${t.year}`).join(', ')})` : '') +
          '.',
      );
      // tabela parada, tabela do regulamento sem recálculo ou grupo desconhecido vão em warn (needsAttention)
      for (const t of tables) {
        const fields = {
          season_id: t.seasonId,
          competition: t.competition,
          outcome: t.outcome,
          detail: t.detail,
          skipped: t.skipped,
          unclassified: t.unclassified,
          unmatched_rounds: t.unmatchedRounds,
        };
        if (needsAttention(t))
          logger.warn(
            fields,
            t.outcome === 'written' ? 'tabela recalculada com pendências' : 'tabela não recalculada',
          );
        else if (t.outcome !== 'written') logger.info(fields, 'tabela não recalculada');
      }
    }
  } finally {
    await closeDb(ctx.db);
  }
});
