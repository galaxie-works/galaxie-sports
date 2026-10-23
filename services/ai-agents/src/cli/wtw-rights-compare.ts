/**
 * Onde assistir — compara provedores na pesquisa de direitos por temporada, SEM gravar direitos.
 *   pnpm --filter @galaxie/ai-agents wtw:rights:compare --competicao conmebol-libertadores --temporada 2026
 *   pnpm --filter @galaxie/ai-agents wtw:rights:compare --competicao liga-mx --provedores gemini
 * Para cada provedor (padrão: o de AI_PROVIDER e gemini), UMA pesquisa nos mercados configurados (ou
 * --pais), o mesmo verificador de fontes e o mesmo validador do `wtw-rights`, e a tabela: detentores e
 * status por país, tokens, consultas de busca e custo. O uso vai para ops.llm_usage (orçamento diário).
 * Requer DATABASE_URL e as chaves dos provedores (OPENAI_API_KEY/ANTHROPIC_API_KEY, GEMINI_API_KEY).
 */
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { closeDb, competition, createDb } from '@galaxie/db';
import { loadWtwConfig, validateRightsResearch } from '@galaxie/where-to-watch';
import type { UsageWithSearches } from '../llm/budget.js';
import { LLM_PROVIDERS, type LlmProviderName } from '../llm/config.js';
import { createLlmClient } from '../llm/factory.js';
import { WhereToWatchAgent } from '../wtw/agent.js';
import { verifyRightsCandidate } from '../wtw/evidence.js';
import { CachingPageFetcher, HttpPageFetcher } from '../wtw/fetcher.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      competicao: { type: 'string' },
      temporada: { type: 'string' },
      pais: { type: 'string' },
      provedores: { type: 'string' },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida.');
  if (!values.competicao) throw new Error('--competicao <slug> é obrigatório.');
  const season = values.temporada ? Number(values.temporada) : new Date().getUTCFullYear();
  const providers = (values.provedores ?? `${process.env.AI_PROVIDER?.trim() || 'openai'},gemini`)
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p, i, all) => p && all.indexOf(p) === i) as LlmProviderName[];
  for (const p of providers)
    if (!LLM_PROVIDERS.includes(p))
      throw new Error(`Provedor desconhecido: ${p} (${LLM_PROVIDERS.join(', ')}).`);

  const db = createDb(url, { max: 4 });
  try {
    const config = loadWtwConfig();
    const markets = (values.pais?.split(',') ?? config.countries)
      .map((s) => s.trim().toUpperCase())
      .filter((m) => config.has(m));
    const directories = markets.map((m) => config.directory(m));
    const [comp] = await db
      .select({ slug: competition.slug, name: competition.name })
      .from(competition)
      .where(eq(competition.slug, values.competicao));
    const target = { slug: values.competicao, name: comp?.name ?? values.competicao };
    // as páginas das fontes são buscadas uma vez para os dois provedores
    const fetcher = new CachingPageFetcher(new HttpPageFetcher());
    const now = new Date();
    const summary: Record<string, unknown>[] = [];
    for (const provider of providers) {
      const env = {
        ...process.env,
        AI_PROVIDER: provider,
        AI_MODEL_LIGHT: undefined,
        AI_MODEL_STANDARD: undefined,
        AI_MODEL_RESEARCH:
          provider === 'gemini' ? process.env.AI_RIGHTS_MODEL : process.env.AI_MODEL_RESEARCH,
      };
      const rt = createLlmClient({ db, env });
      const agent = new WhereToWatchAgent(rt.client);
      const t0 = Date.now();
      console.log(
        `\n## ${provider} · ${rt.settings.models.research} — ${target.slug} ${season} [${markets.join(',')}]`,
      );
      try {
        const res = await agent.researchRights({ competition: target, season, directories });
        const usage = res.result.usage as UsageWithSearches;
        const rows: Record<string, unknown>[] = [];
        let confirmed = 0;
        let withHolders = 0;
        for (const m of markets) {
          const dir = config.directory(m);
          const cand = res.markets.find((c) => c.country === m) ?? {
            country: m,
            distribution: 'to_confirm' as const,
            holders: [],
            notes: 'sem resultado na pesquisa',
          };
          const verified = await verifyRightsCandidate(cand, dir, fetcher, now);
          const v = validateRightsResearch(verified.candidate, { directory: dir, now });
          if (v.status === 'confirmed') confirmed++;
          if (v.holders.length) withHolders++;
          rows.push({
            pais: m,
            status: v.status,
            distribuicao: v.distribution,
            detentores: v.holders
              .map((h) => `${h.broadcasterId ?? h.name}${h.status === 'confirmed' ? '' : '?'}`)
              .join(', '),
            pedidos: cand.holders.map((h) => h.broadcaster).join(', '),
            descartados: v.discarded.map((d) => `${d.broadcaster}: ${d.reason}`).join('; '),
            fontes: [
              ...new Set(cand.holders.flatMap((h) => h.evidence.map((e) => new URL(e.url).hostname))),
            ].join(' '),
          });
        }
        console.table(rows);
        const s = {
          provedor: provider,
          modelo: rt.settings.models.research,
          US$: usage.costUsd?.toFixed(4) ?? '?',
          tokens_entrada: usage.inputTokens,
          tokens_saida: usage.outputTokens,
          buscas: usage.webSearchCalls ?? 0,
          citacoes: res.citations.length,
          paises_com_detentor: `${withHolders}/${markets.length}`,
          paises_confirmados: `${confirmed}/${markets.length}`,
          segundos: Math.round((Date.now() - t0) / 1000),
        };
        summary.push(s);
      } catch (err) {
        const usage = (err as { usage?: UsageWithSearches }).usage;
        console.log(`falhou: ${err instanceof Error ? err.message : String(err)}`);
        summary.push({
          provedor: provider,
          erro: err instanceof Error ? err.message : String(err),
          US$: usage?.costUsd?.toFixed(4) ?? '0',
        });
      }
    }
    console.log('\n## Resumo');
    console.table(summary);
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
