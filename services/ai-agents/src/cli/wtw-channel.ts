/**
 * Onde assistir — canal de cada jogo (docs/07 §2.2.4).
 *   pnpm --filter @galaxie/ai-agents wtw:channel --plan                      # o que seria pesquisado agora (sem LLM, sem gravar)
 *   pnpm --filter @galaxie/ai-agents wtw:channel --plan --competicao brasileirao-serie-a --rodada 32 --temporada 2026
 *                                                                            # prévia da rodada: canal atual e o que a importação aceitaria
 *   pnpm --filter @galaxie/ai-agents wtw:channel --plan --linha-de-base [--dias 7]   # encerrados com canal, por país
 *   pnpm --filter @galaxie/ai-agents wtw:channel                             # importa e pesquisa os grupos devidos (cron: 10 min)
 * Momentos (WTW_CHANNEL_*, também em Ajustes → Esportes e features → Onde assistir): consulta semanal
 * (WTW_CHANNEL_WEEKLY_CRON, padrão segunda 06:00 UTC), retentativas só para quem segue sem canal
 * confirmado (WTW_CHANNEL_RETRY_OFFSETS, padrão 3d,1d) e pós-jogo dos encerrados sem canal
 * (WTW_CHANNEL_POST, padrão on). Jogo × mercado com canal confirmado não volta à pesquisa.
 * Opções: --pais BR (senão WTW_MARKETS, senão os mercados dos tenants com where_to_watch), --chamadas N
 * (chamadas ao modelo por execução, padrão 2), --sem-importar (pula a importação das opções salvas).
 * Requer DATABASE_URL; para pesquisar, GEMINI_API_KEY (AI_MATCH_CHANNEL_PROVIDER/AI_MATCH_CHANNEL_MODEL
 * trocam provedor e modelo). Custo em enrich.wtw_research (kind channel) e no orçamento diário de
 * tokens (ops.llm_usage), com o teto por mercado (WTW_DAILY_USD_PER_MARKET).
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import {
  currentResearchedRights,
  getPublicWhereToWatch,
  loadWtwConfig,
  ResearchedRightsIndex,
} from '@galaxie/where-to-watch';
import { matchChannelLlmEnv } from '../llm/config.js';
import { createAgentLlm } from './common.js';
import type { LlmClient } from '../llm/types.js';
import { channelBaseline, type BaselineRow } from '../wtw/channel/baseline.js';
import { planChannelResearch, type ChannelEventFilter } from '../wtw/channel/plan.js';
import { MatchChannelRunner, type ChannelRunReport } from '../wtw/channel/runner.js';
import { channelMoments, channelScheduleFromEnv } from '../wtw/channel/windows.js';
import { loadEventInfo } from '../wtw/event-info.js';
import { HttpPageFetcher } from '../wtw/fetcher.js';
import { activeMarkets } from '../wtw/markets.js';
import { localKickoff } from '../wtw/prompt.js';
import { wtwPolicyFromEnv } from '../wtw/relevance.js';

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');

function printBaseline(title: string, rows: BaselineRow[]): void {
  console.log(`\n## ${title}`);
  console.table(
    rows.map((r) => ({
      pais: r.country,
      ...(r.competition ? { competicao: r.competition } : {}),
      encerrados: r.total,
      'opção gravada (confirmed+probable)': `${r.withOption}/${r.total}`,
      'canal do jogo confirmado': `${r.withMatchChannel}/${r.total} (${pct(r.withMatchChannel, r.total)})`,
    })),
  );
}

function summarizeImport(report: ChannelRunReport): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of report.targets) {
    const key = `${t.eventId}:${t.country}`;
    const acc = t.report.accepted.map(
      (a) =>
        `${a.providerName}${a.channel ? ` (${a.channel})` : ''} ← ${a.evidence[0]?.publisher} [${a.sourceKind}]`,
    );
    const rej = t.report.rejected.map(
      (r) => `${r.broadcasterId}: ${r.reason}${r.evidence?.length ? ` (${r.evidence.join(',')})` : ''}`,
    );
    out.set(key, [...acc, ...(rej.length ? [`recusadas: ${rej.join('; ')}`] : [])].join(' · '));
  }
  return out;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      pais: { type: 'string' },
      chamadas: { type: 'string' },
      competicao: { type: 'string' },
      rodada: { type: 'string' },
      temporada: { type: 'string' },
      'linha-de-base': { type: 'boolean', default: false },
      dias: { type: 'string' },
      'sem-importar': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida.');
  const maxCalls = values.chamadas ? Number(values.chamadas) : 2;
  if (!Number.isInteger(maxCalls) || maxCalls < 0) throw new Error('--chamadas precisa ser um inteiro ≥ 0.');
  if (values.rodada && !values.competicao) throw new Error('--rodada exige --competicao.');
  const country = values.pais?.toUpperCase();
  const policy = wtwPolicyFromEnv();
  const schedule = channelScheduleFromEnv();
  const db = createDb(url, { max: 4 });
  try {
    const config = loadWtwConfig();
    const now = new Date();
    if (country && !config.has(country))
      throw new Error(`País não suportado: ${country} (use ${config.countries.join(', ')}).`);
    const markets = country ? [country] : await activeMarkets(db);
    if (!markets.length) {
      console.log('Nenhum mercado ativo (sem tenant com where_to_watch e sem WTW_MARKETS). Use --pais.');
      return;
    }
    const researched = new ResearchedRightsIndex(await currentResearchedRights(db));
    const filter: ChannelEventFilter | undefined = values.competicao
      ? {
          competition: values.competicao,
          ...(values.rodada ? { round: values.rodada } : {}),
          ...(values.temporada ? { season: Number(values.temporada) } : {}),
        }
      : undefined;
    const plan = await planChannelResearch(db, {
      now,
      markets,
      config,
      researched,
      policy,
      schedule,
      ...(filter ? { filter, ignoreWindows: values.plan } : {}),
    });

    let llm: LlmClient | undefined;
    if (!values.plan) {
      try {
        llm = (await createAgentLlm(db, 'wtw', matchChannelLlmEnv)).client;
      } catch (err) {
        console.log(
          `Sem LLM (${err instanceof Error ? err.message : String(err)}): só a importação das opções salvas.`,
        );
      }
    }
    const runner = new MatchChannelRunner({
      db,
      llm,
      config,
      policy,
      fetcher: new HttpPageFetcher(),
      log: (m) => console.log(`  ${m}`),
    });

    if (values.plan) {
      console.log(
        `Canal do jogo — prévia (${now.toISOString()}) — mercados: ${markets.join(', ')}; limiar de relevância ${policy.minRelevance} (liga principal entra sempre)`,
      );
      const moments = channelMoments(schedule, now);
      console.log(
        `Momentos: consulta semanal ${
          moments.sweep
            ? `${schedule.weeklyCron} (vigente ${moments.sweep.current.toISOString()}, próxima ${moments.sweep.next.toISOString()})`
            : 'desligada'
        } · retentativas ${moments.retries.map((r) => r.label).join(', ') || 'desligadas'} · pós-jogo ${
          schedule.post ? 'ligado' : 'desligado'
        }`,
      );
      let before: BaselineRow[] = [];
      const days = values.dias ? Number(values.dias) : 7;
      if (values['linha-de-base']) {
        before = await channelBaseline(db, { now, days, markets, byCompetition: false });
        printBaseline(
          `Linha de base: futebol encerrado nos últimos ${days} dias (competições do país)`,
          before,
        );
        printBaseline(
          'Por competição',
          await channelBaseline(db, { now, days, markets, byCompetition: true }),
        );
      }
      const report = await runner.run(plan.groups, {
        maxCalls: 0,
        dryRun: true,
        importSaved: !values['sem-importar'],
      });
      console.log(
        `\n## Grupos devidos (${plan.groups.length}) — estimativa US$ ${report.estimateUsd.toFixed(3)} por chamada`,
      );
      if (report.groups.length)
        console.table(
          report.groups.map((g, i) => {
            const grp = plan.groups[i]!;
            return {
              grupo: g.key,
              momento: grp.window.window,
              fase: grp.window.phase,
              liga_principal: grp.mainLeague ? 'sim' : '',
              prioridade: grp.priority,
              jogos: g.events,
              mercados: g.markets.join(','),
              situacao: g.status,
            };
          }),
        );
      const toCall = report.groups.filter((g) => g.status === 'planned');
      console.log(
        `Chamadas previstas: ${toCall.length} (≈ US$ ${(toCall.length * report.estimateUsd).toFixed(2)}); ` +
          `fora da pesquisa: ${Object.entries(plan.skipped)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}`,
      );
      const imported = summarizeImport(report);
      if (filter) {
        console.log(`\n## Jogos de ${filter.competition}${filter.round ? ` · rodada ${filter.round}` : ''}`);
        const rows = [];
        for (const e of plan.events)
          for (const m of markets) {
            const pub = await getPublicWhereToWatch(db, { eventId: e.id, country: m }, config);
            if (!pub) continue;
            const ev = await loadEventInfo(db, e.id);
            const { date, time } = localKickoff(e.startsAt, m);
            const channels = pub.matchChannel.channels.map(
              (c) =>
                `${c.option.row.channelName ?? c.option.row.providerName}${c.source ? ` ← ${c.source.publisher} [${c.source.kind}]` : ''}`,
            );
            rows.push({
              jogo: ev ? `${ev.home} x ${ev.away}` : e.id,
              inicio: `${date} ${time}`,
              status: e.status,
              pais: m,
              estado: pub.matchChannel.state,
              canal_hoje: channels.join(' · ') || '-',
              importacao: imported.get(`${e.id}:${m}`) ?? '-',
            });
          }
        console.table(rows);
      } else if (report.targets.length) {
        console.log('\n## Importação das opções salvas (o que gravaria)');
        console.table([...imported].map(([k, v]) => ({ jogo_pais: k, resultado: v })));
      }
      if (values['linha-de-base'] && before.length) {
        // projeção para os encerrados da linha de base: o que a importação grava agora (sem LLM) e
        // quantos ainda sem canal entram numa pesquisa depois do jogo (resultado só com a chamada real)
        const since = now.getTime() - days * 86_400_000;
        const inBase = (
          e: { status: string; startsAt: Date; sport: string; countryCode: string | null },
          c: string,
        ) =>
          e.status === 'finished' &&
          e.startsAt.getTime() >= since &&
          e.sport === 'football' &&
          e.countryCode === c;
        const byId = new Map(plan.events.map((e) => [e.id, e]));
        const gained = new Map<string, number>();
        const resolved = new Set<string>();
        for (const t of report.targets) {
          const e = byId.get(t.eventId);
          if (!e || !t.report.accepted.length || !inBase(e, t.country)) continue;
          const pub = await getPublicWhereToWatch(db, { eventId: t.eventId, country: t.country }, config);
          if (pub?.matchChannel.state === 'confirmed') continue;
          gained.set(t.country, (gained.get(t.country) ?? 0) + 1);
          resolved.add(`${t.eventId}:${t.country}`);
        }
        const researched = new Map<string, number>();
        for (const g of plan.groups) {
          if (g.window.phase !== 'post') continue;
          for (const t of g.targets) {
            const key = `${t.event.id}:${t.country}`;
            if (resolved.has(key) || !inBase(t.event, t.country)) continue;
            const pub = await getPublicWhereToWatch(db, { eventId: t.event.id, country: t.country }, config);
            if (pub?.matchChannel.state === 'confirmed') continue;
            researched.set(t.country, (researched.get(t.country) ?? 0) + 1);
          }
        }
        console.log('\n## Antes e depois da prévia (futebol encerrado, competições do país)');
        console.table(
          before.map((r) => {
            const after = r.withMatchChannel + (gained.get(r.country) ?? 0);
            return {
              pais: r.country,
              encerrados: r.total,
              'opção gravada (medida anterior)': `${r.withOption}/${r.total}`,
              'canal do jogo hoje': `${r.withMatchChannel}/${r.total}`,
              'depois da importação': `${after}/${r.total} (${pct(after, r.total)})`,
              'ainda sem canal, na pesquisa pós-jogo': researched.get(r.country) ?? 0,
            };
          }),
        );
      }
      return;
    }

    const report = await runner.run(plan.groups, { maxCalls, importSaved: !values['sem-importar'] });
    const by = report.groups.reduce<Record<string, number>>(
      (acc, g) => ((acc[g.status] = (acc[g.status] ?? 0) + 1), acc),
      {},
    );
    const cost = report.groups.reduce((s, g) => s + g.costUsd, 0);
    console.log(
      `Grupos: ${report.groups.length} (${
        Object.entries(by)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ') || 'nenhum'
      }) · canais gravados: +${report.applied.inserted} novos, ${report.applied.updated} reconfirmados, ` +
        `${report.applied.retracted} retirados · US$ ${cost.toFixed(3)}.`,
    );
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
