/**
 * Onde assistir — agenda e executa as janelas por jogo (docs/07 §2.2).
 *   pnpm --filter @galaxie/ai-agents wtw:run --plan [--pais BR] [--dias 7]   # previsão e custo (sem LLM)
 *   pnpm --filter @galaxie/ai-agents wtw:run                                # enfileira e executa (cron: 5 min)
 *   pnpm --filter @galaxie/ai-agents wtw:run --evento <id> --pais BR --forcar   # reexecução manual
 * Opções: --limite N (execuções reservadas por rodada, padrão 100) e --chamadas N (chamadas de
 * alocação ao LLM por rodada, padrão 2).
 * Mercados: --pais, senão WTW_MARKETS, senão os mercados dos tenants com o módulo where_to_watch.
 * Requer DATABASE_URL; para a alocação, AI_PROVIDER + OPENAI_API_KEY/ANTHROPIC_API_KEY.
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import {
  currentResearchedRights,
  loadWtwConfig,
  queueRerun,
  ResearchedRightsIndex,
} from '@galaxie/where-to-watch';
import { createAgentLlm } from './common.js';
import type { LlmClient } from '../llm/types.js';
import { HttpPageFetcher } from '../wtw/fetcher.js';
import { activeMarkets } from '../wtw/markets.js';
import { forecast, scaleTable, type Forecast } from '../wtw/plan.js';
import { wtwPolicyFromEnv } from '../wtw/relevance.js';
import { WtwRunner } from '../wtw/runner.js';
import { enqueueRuns, planDueRuns } from '../wtw/scheduler.js';
import { estimateCallUsd } from '../wtw/spend.js';

const usd = (n: number) => `US$ ${n.toFixed(2)}`;
const DECISION: Record<string, string> = {
  llm: 'LLM (alocação ou, com WTW_ROUND_ALLOCATION=off, canal do jogo no wtw-channel)',
  deterministic: 'determinístico',
  to_confirm: 'a confirmar (abaixo do limiar)',
  no_rights: 'sem direitos',
};

function printForecast(title: string, f: Forecast, minRelevance: number, verbose: boolean): void {
  const c = f.cost;
  console.log(
    `\n## ${title} — ${c.markets.join(', ')} (${c.days} dias, limiar de relevância ${minRelevance})`,
  );
  if (verbose) {
    const rows = f.groups.flatMap((g) =>
      Object.entries(g.markets)
        .filter(([, m]) => m.decision !== 'no_rights')
        .map(([country, m]) => ({
          rodada: `${g.competition} · ${g.round}`,
          inicio: g.firstStart.toISOString().slice(0, 16),
          pais: country,
          jogos: m.events,
          deterministicos: m.deterministic,
          a_alocar: m.toAllocate,
          relevancia: m.maxRelevance,
          direitos: m.rights ?? '-',
          decisao: DECISION[m.decision],
          chamadas: g.calls,
        })),
    );
    if (rows.length) console.table(rows);
    const noRights = new Map<string, number>();
    for (const g of f.groups)
      for (const [country, m] of Object.entries(g.markets))
        if (m.decision === 'no_rights')
          noRights.set(
            `${g.competition} (${country})`,
            (noRights.get(`${g.competition} (${country})`) ?? 0) + m.events,
          );
    if (noRights.size)
      console.log(
        `Sem direitos (aguardam curadoria ou a pesquisa por temporada): ${[...noRights]
          .map(([k, n]) => `${k}: ${n}`)
          .join(' · ')}`,
      );
  }
  const decisions = { llm: 0, deterministic: 0, to_confirm: 0, no_rights: 0 } as Record<string, number>;
  for (const g of f.groups) for (const m of Object.values(g.markets)) decisions[m.decision]! += m.events;
  console.log(
    `Jogos × mercado: ${Object.entries(decisions)
      .map(([k, v]) => `${DECISION[k]} ${v}`)
      .join(' · ')}`,
  );
  console.log(
    `Pesquisas de direitos por temporada pendentes: ${c.rightsCalls} chamada(s) para ${f.rightsNeeds.length} competição(ões)` +
      (f.rightsNeeds.length
        ? ` — ${f.rightsNeeds
            .slice(0, 12)
            .map((n) => `${n.competition.slug} ${n.season} [${n.chunks.map((k) => k.join(',')).join(' | ')}]`)
            .join('; ')}${f.rightsNeeds.length > 12 ? '; …' : ''}`
        : ''),
  );
  console.table({
    'jogos/dia (tier ≤ 2)': c.gamesPerDay.toFixed(1),
    'alocações por rodada/dia': c.allocationCallsPerDay.toFixed(2),
    'US$ por alocação (estim.)': c.usdPerAllocation.toFixed(3),
    'US$ por pesquisa de direitos (estim.)': c.usdPerRights.toFixed(3),
    'novo: US$/dia (direitos amortizados em 30 d)': c.newUsdPerDay.toFixed(2),
    'novo: US$/mercado/dia': c.newUsdPerMarketDay.toFixed(3),
    'antigo: buscas por jogo/dia': c.oldSearchesPerDay.toFixed(1),
    'antigo: US$/dia': c.oldUsdPerDay.toFixed(2),
    'antigo: US$/mercado/dia': c.oldUsdPerMarketDay.toFixed(3),
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      detalhes: { type: 'boolean', default: false },
      dias: { type: 'string' },
      evento: { type: 'string' },
      pais: { type: 'string' },
      limite: { type: 'string' },
      chamadas: { type: 'string' },
      forcar: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida.');
  const limit = values.limite ? Number(values.limite) : 100;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limite precisa ser um inteiro > 0.');
  const maxCalls = values.chamadas ? Number(values.chamadas) : 2;
  if (!Number.isInteger(maxCalls) || maxCalls < 0) throw new Error('--chamadas precisa ser um inteiro ≥ 0.');
  const country = values.pais?.toUpperCase();
  const policy = wtwPolicyFromEnv();

  const db = createDb(url, { max: 4 });
  try {
    const config = loadWtwConfig();
    const now = new Date();
    if (country && !config.has(country))
      throw new Error(`País não suportado: ${country} (use ${config.countries.join(', ')}).`);
    const markets = country ? [country] : await activeMarkets(db);
    if (!markets.length)
      console.log(
        'Nenhum mercado ativo (sem tenant com where_to_watch e sem WTW_MARKETS). Use --pais para testar.',
      );
    const researched = new ResearchedRightsIndex(await currentResearchedRights(db));

    if (values.forcar) {
      if (!values.evento || !country) throw new Error('--forcar exige --evento e --pais.');
      const { runId } = await queueRerun(db, {
        eventId: values.evento,
        country,
        actor: 'cli',
        reason: 'reexecução manual pela CLI',
      });
      console.log(`Reexecução manual enfileirada (wtw_run ${runId}).`);
    }

    const due = await planDueRuns(db, {
      now,
      markets,
      config,
      researched,
      ...(values.evento ? { eventId: values.evento } : {}),
    });
    if (values.plan) {
      console.log(
        `Plano do onde assistir (${now.toISOString()}) — mercados: ${markets.join(', ') || '(nenhum)'}`,
      );
      const byWindow = new Map<string, number>();
      for (const d of due)
        byWindow.set(`${d.window}/${d.mode}`, (byWindow.get(`${d.window}/${d.mode}`) ?? 0) + 1);
      console.log(
        `Devido agora: ${due.length} execução(ões)${
          due.length ? ` (${[...byWindow].map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''
        }; grupos de alocação: ${new Set(due.filter((d) => d.mode === 'allocate').map((d) => d.group)).size}.`,
      );
      const days = values.dias ? Number(values.dias) : 7;
      const usdPerAllocation = await estimateCallUsd(db, 'allocation');
      const usdPerRights = await estimateCallUsd(db, 'rights');
      const common = { now, days, config, researched, policy, usdPerAllocation, usdPerRights };
      const mine = await forecast(db, { ...common, markets });
      printForecast('Mercados ativos', mine, policy.minRelevance, true);
      const all = await forecast(db, { ...common, markets: config.countries });
      printForecast('América Latina configurada', all, policy.minRelevance, values.detalhes);

      // escala: a alocação de uma rodada cobre todos os mercados, então cresce pouco com eles
      const games = Math.max(1, Math.round(all.cost.gamesPerDay));
      const roundsPerGame = all.cost.allocationCallsPerDay / Math.max(1, all.cost.gamesPerDay);
      console.log('\n## Escala (jogos/dia × mercados → US$/dia)');
      console.table(
        scaleTable({
          games: [games, 100],
          markets: [1, 8, 15],
          searchesPerGame: all.cost.oldSearchesPerGame,
          roundsPerDayPerGame: roundsPerGame,
          usdPerAllocation,
          usdPerRights,
          competitions: new Set(all.groups.map((g) => g.competition)).size,
        }).map((r) => ({
          'jogos/dia': r.games,
          mercados: r.markets,
          antigo: usd(r.oldUsd),
          novo: usd(r.newUsd),
          'novo por mercado': usd(r.newPerMarket),
        })),
      );
      return;
    }

    const queued = await enqueueRuns(db, due, now);
    let llm: LlmClient | undefined;
    try {
      llm = (await createAgentLlm(db, 'wtw')).client;
    } catch (err) {
      console.log(
        `Sem LLM (${err instanceof Error ? err.message : String(err)}): só a resposta dos direitos; alocações ficam para depois.`,
      );
    }
    const runner = new WtwRunner({
      db,
      llm,
      config,
      policy,
      fetcher: new HttpPageFetcher(),
      log: (m) => console.log(`  ${m}`),
    });
    const outcomes = await runner.runQueued({
      limit,
      maxCalls,
      ...(values.evento ? { eventId: values.evento } : {}),
      ...(country ? { country } : {}),
    });
    const by = outcomes.reduce<Record<string, number>>(
      (acc, o) => ((acc[`${o.mode}:${o.status}`] = (acc[`${o.mode}:${o.status}`] ?? 0) + 1), acc),
      {},
    );
    console.log(
      `Enfileiradas: ${queued} · executadas: ${outcomes.length} (${
        Object.entries(by)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ') || 'nenhuma'
      }).`,
    );
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
