/**
 * Onde assistir — direitos por temporada (docs/07 §2.2, nível 1) e biblioteca de emissoras.
 *   pnpm --filter @galaxie/ai-agents wtw:rights --plan                 # o que falta pesquisar (sem LLM)
 *   pnpm --filter @galaxie/ai-agents wtw:rights                        # sincroniza a biblioteca, reconfirma e pesquisa
 *   pnpm --filter @galaxie/ai-agents wtw:rights --competicao brasileirao-serie-a --incluir-curados
 * Opções: --chamadas N (pesquisas por execução, padrão 2), --dias N (horizonte de jogos, padrão 45),
 * --pais BR,AR (restringe os mercados; padrão: todos os configurados — a chamada cobre a região).
 * Requer DATABASE_URL; para pesquisar, AI_PROVIDER + OPENAI_API_KEY/ANTHROPIC_API_KEY — ou só para esta
 * pesquisa AI_RIGHTS_PROVIDER=gemini + GEMINI_API_KEY (AI_RIGHTS_MODEL troca o modelo).
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { loadWtwConfig, syncBroadcasterLibrary } from '@galaxie/where-to-watch';
import { rightsLlmEnv } from '../llm/config.js';
import { createLlmClient } from '../llm/factory.js';
import type { LlmClient } from '../llm/types.js';
import { HttpPageFetcher } from '../wtw/fetcher.js';
import { wtwPolicyFromEnv } from '../wtw/relevance.js';
import { planRightsResearch, RightsResearcher } from '../wtw/rights-runner.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      competicao: { type: 'string' },
      pais: { type: 'string' },
      dias: { type: 'string' },
      chamadas: { type: 'string' },
      'incluir-curados': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida.');
  const maxCalls = values.chamadas ? Number(values.chamadas) : 2;
  if (!Number.isInteger(maxCalls) || maxCalls < 0) throw new Error('--chamadas precisa ser um inteiro ≥ 0.');
  const db = createDb(url, { max: 4 });
  try {
    const config = loadWtwConfig();
    const now = new Date();
    const markets = values.pais
      ?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const needs = await planRightsResearch(db, {
      now,
      config,
      ...(markets?.length ? { markets } : {}),
      horizonDays: values.dias ? Number(values.dias) : 45,
      ...(values.competicao ? { competition: values.competicao } : {}),
      includeCurated: values['incluir-curados'],
      minRelevance: values.competicao ? 0 : wtwPolicyFromEnv().minRelevance,
    });
    console.log(
      `Direitos por temporada (${now.toISOString()}): ${needs.length} competição(ões) pendente(s).`,
    );
    if (needs.length)
      console.table(
        needs.slice(0, 40).map((n) => ({
          competicao: n.competition.slug,
          temporada: n.season,
          jogos: n.events,
          relevancia: n.maxRelevance,
          chamadas: n.chunks.length,
          mercados: n.chunks.map((c) => c.join(',')).join(' | '),
        })),
      );
    if (values.plan) return;

    const lib = await syncBroadcasterLibrary(db, config, now);
    console.log(
      `Biblioteca de emissoras: ${lib.upserted} entradas · ${lib.logosRegistered} logo(s) novo(s) para espelhar` +
        (lib.withoutLogo.length ? ` · sem logo: ${lib.withoutLogo.join(', ')}` : ''),
    );
    let llm: LlmClient | undefined;
    try {
      const rt = createLlmClient({ db, env: rightsLlmEnv(process.env) });
      llm = rt.client;
      console.log(`Pesquisa de direitos: ${rt.settings.provider} · ${rt.settings.models.research}`);
    } catch (err) {
      console.log(`Sem LLM (${err instanceof Error ? err.message : String(err)}): só reconfirmação.`);
    }
    const researcher = new RightsResearcher({
      db,
      llm,
      config,
      fetcher: new HttpPageFetcher(),
      policy: wtwPolicyFromEnv(),
      log: (m) => console.log(`  ${m}`),
    });
    const rev = await researcher.revalidate();
    console.log(
      `Reconfirmação (sem tokens): ${rev.checked} linha(s), ${rev.touched} ok, ${rev.changed} mudaram.`,
    );
    const outcomes = await researcher.run(needs, { maxCalls, requestedBy: 'cli' });
    for (const o of outcomes) {
      console.log(
        `${o.competition} ${o.season} [${o.markets.join(',')}]: ${o.status}` +
          `${o.costUsd !== null ? ` · US$ ${o.costUsd.toFixed(4)}` : ''}${o.error ? ` — ${o.error}` : ''}`,
      );
      for (const [c, r] of Object.entries(o.byCountry))
        console.log(
          `  ${c}: ${r.status} · ${r.distribution} · ${r.holders.join(', ') || '(nenhum)'} (${r.action})`,
        );
    }
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
