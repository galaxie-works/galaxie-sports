/**
 * Onde assistir — agenda e executa as verificações devidas (issue #50).
 *   pnpm --filter @galaxie/ai-agents wtw:run --plan            # só mostra o que está devido (sem LLM)
 *   pnpm --filter @galaxie/ai-agents wtw:run                   # enfileira e executa (cron: a cada 5 min)
 *   pnpm --filter @galaxie/ai-agents wtw:run --evento <id> --pais BR
 *   pnpm --filter @galaxie/ai-agents wtw:run --evento <id> --pais BR --forcar   # reexecução manual (busca completa)
 * Opções: --limite N (execuções por rodada, padrão 20).
 * Mercados: --pais, senão WTW_MARKETS, senão os mercados dos tenants com o módulo where_to_watch.
 * Requer DATABASE_URL; para buscas completas, AI_PROVIDER + OPENAI_API_KEY/ANTHROPIC_API_KEY.
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { loadWtwConfig, queueRerun } from '@galaxie/where-to-watch';
import { createLlmClient } from '../llm/factory.js';
import type { LlmClient } from '../llm/types.js';
import { HttpPageFetcher } from '../wtw/fetcher.js';
import { activeMarkets } from '../wtw/markets.js';
import { WtwRunner } from '../wtw/runner.js';
import { enqueueRuns, planDueRuns } from '../wtw/scheduler.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      evento: { type: 'string' },
      pais: { type: 'string' },
      limite: { type: 'string' },
      forcar: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida.');
  const limit = values.limite ? Number(values.limite) : 20;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limite precisa ser um inteiro > 0.');
  const country = values.pais?.toUpperCase();

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
      ...(values.evento ? { eventId: values.evento } : {}),
    });
    if (values.plan) {
      console.log(
        `Plano do onde assistir (${now.toISOString()}) — mercados: ${markets.join(', ') || '(nenhum)'}`,
      );
      if (due.length)
        console.table(
          due.map((d) => ({
            evento: d.eventId,
            pais: d.country,
            janela: d.window,
            modo: d.mode,
            tier: d.tier,
            competicao: d.competition,
            inicio: d.startsAt.toISOString(),
          })),
        );
      else console.log('  nada devido agora.');
      return;
    }

    const queued = await enqueueRuns(db, due, now);
    let llm: LlmClient | undefined;
    try {
      llm = createLlmClient({ db }).client;
    } catch (err) {
      console.log(
        `Sem LLM (${err instanceof Error ? err.message : String(err)}): só revalidações; buscas completas ficam "skipped".`,
      );
    }
    const runner = new WtwRunner({
      db,
      llm,
      config,
      fetcher: new HttpPageFetcher(),
      log: (m) => console.log(`  ${m}`),
    });
    const outcomes = await runner.runQueued({
      limit,
      ...(values.evento ? { eventId: values.evento } : {}),
      ...(country ? { country } : {}),
    });
    const by = outcomes.reduce<Record<string, number>>(
      (acc, o) => ((acc[o.status] = (acc[o.status] ?? 0) + 1), acc),
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
