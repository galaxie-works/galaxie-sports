/**
 * Grade de canais e ofertas das operadoras e streamings (onde assistir): pesquisa com fontes e grava
 * tudo como `draft` (aprovação no painel).
 *   pnpm --filter @galaxie/ai-agents lineups:research --plan                 # o que seria chamado e o custo (sem LLM)
 *   pnpm --filter @galaxie/ai-agents lineups:research --pais BR --max 4      # descobre e levanta os planos
 *   pnpm --filter @galaxie/ai-agents lineups:research --revisitar --dias 30  # refaz o que foi visto há mais de 30 dias
 *   pnpm --filter @galaxie/ai-agents lineups:research --resumo --pais BR,AR  # como está a grade gravada (sem LLM)
 * Os planos vêm da página oficial (lineups/page-research.ts): a página de planos guardada da plataforma
 * (sem nenhuma, uma chamada curta com busca acha as URLs e elas ficam guardadas) é lida do nosso lado
 * (robots.txt, cache de 25 dias; navegador com LINEUP_RENDER_WS ou --renderizar) e, só se mudou desde a
 * última extração (hash), uma chamada de nível leve SEM busca extrai planos, preços, grade, inclusos e
 * complementos, cada um com o trecho literal da página. O validador determinístico (lineups/validate.ts)
 * confere o trecho na página e decide a prova; o que não tem prova entra como `unverified`, com a
 * checagem que falhou, para a revisão no painel. A descoberta das plataformas de um país continua com
 * busca (uma chamada por país, só para país novo, --redescobrir ou revisita).
 * Opções: --pais BR,AR (padrão: BR, AR, MX, CO, CL), --max N (chamadas ao modelo por execução, com e sem
 * busca; padrão 6), --plataforma <slug>, --redescobrir (refaz a descoberta e as URLs de planos),
 * --forcar (relê as páginas e extrai mesmo sem mudança), --max-paginas N (padrão 20),
 * --com-busca (a pesquisa antiga, com grounding em cada etapa, para comparar).
 * O texto das páginas que vai para o modelo na extração tem teto (LINEUP_PROMPT_MAX_CHARS por plataforma,
 * LINEUP_PAGE_MAX_CHARS por página, no painel de Operação): o que passa é cortado do fim, e cada corte
 * sai no log, no resumo e em ops.job_run (stats.lineups.prompt_cuts).
 * Idempotente: sem --redescobrir/--revisitar, só pesquisa país sem plataformas e plataforma sem planos.
 * Requer DATABASE_URL e o provedor da pesquisa de direitos, AI_RIGHTS_PROVIDER (e AI_RIGHTS_MODEL), ou o
 * AI_PROVIDER sem ele (Gemini na VPS, GEMINI_API_KEY). O custo e as buscas vão para ops.llm_usage
 * (agente `lineups`).
 * Agendado no perfil `agents` do scheduler como `lineups-revisit` (--revisitar --dias 30 --max 4
 * --max-paginas 10).
 */
import { parseArgs } from 'node:util';
import { closeDb, mergeJobRunStats } from '@galaxie/db';
import { loadWtwConfig, syncBroadcasterLibrary } from '@galaxie/where-to-watch';
import { dbPageStore, OfficialPageReader, type PageRenderer } from '../lineups/pages.js';
import { lineupPromptLimitsFromEnv } from '../lineups/prompt.js';
import { lineupReport } from '../lineups/report.js';
import { llmSettingsFromEnv, rightsLlmEnv } from '../llm/config.js';
import { createLlmClient } from '../llm/factory.js';
import {
  estimateLineupCalls,
  LINEUP_COUNTRIES,
  LINEUP_STALE_DAYS,
  LineupResearcher,
  planLineupResearch,
  type LineupCallOutcome,
} from '../lineups/research.js';
import { dbFromEnv, intFlag } from './common.js';

const REASON: Record<string, string> = {
  new_country: 'país sem plataformas',
  rediscover: 'refazer descoberta',
  revisit: 'revisita',
  no_plans: 'plataforma sem planos',
  requested: 'pedido',
};

const TIER: Record<string, string> = {
  official: 'oficial',
  comparator: 'comparador',
  press: 'imprensa',
  other: 'outro',
  discarded: 'descartada',
  unresolved: 'redirecionamento falhou',
};

const usd = (n: number) => `US$ ${n.toFixed(n >= 1 ? 2 : 4)}`;

function describe(o: LineupCallOutcome): string {
  const t = o.task;
  const head = t.kind === 'discover' ? `${t.country} · descoberta` : `${t.country} · ${t.slug}`;
  const cost = o.costUsd !== null ? ` · ${usd(o.costUsd)}` : '';
  const calls = ` · ${o.searchCalls} com busca (${o.searches} busca(s)), ${o.extractCalls} extração(ões)`;
  const pages = o.pages.length
    ? `\n    páginas: ${o.pages
        .map(
          (p) =>
            `${p.status}${p.via ? ` (${p.via})` : ''}${p.fromCache ? ' · cache' : ''}${p.hashChanged ? ' · MUDOU' : ''} ${p.url}${p.error ? ` — ${p.error}` : ''}`,
        )
        .join(' | ')}`
    : '';
  if (o.status !== 'done') return `${head}: ${o.status}${cost}${calls} — ${o.error ?? ''}${pages}`;
  if (o.note && !o.accepted) return `${head}: ${o.note}${cost}${calls}${pages}`;
  const d = o.drops;
  const v = o.verification;
  const tiers = Object.entries(v.tiers)
    .map(([k, n]) => `${TIER[k] ?? k} ${n}`)
    .join(', ');
  return (
    `${head}: ${o.accepted} item(ns) com fonte · ${o.created} novo(s), ${o.updated} atualizado(s), ` +
    `${o.unchanged} sem mudança, ${o.changes.length} mudança(s) para revisar${cost}${calls}` +
    ` · descartados: ${d.noSource} sem fonte, ${d.blocked} pela política, ${d.injection} suspeito(s)` +
    (t.kind === 'plans'
      ? `\n    validador: ${v.pricedPlans}/${v.plans} plano(s) com preço provado · vínculos: ${v.included} incluso(s), ` +
        `${v.addon} adicional(is), ${v.unverified} sem prova${tiers ? ` · fontes: ${tiers}` : ''} · ` +
        `${v.addons} complemento(s)` +
        (o.missingPlans.length
          ? `\n    PLANO FALTANDO (listado sem detalhe): ${o.missingPlans.join(', ')}`
          : '') +
        (o.skippedPlans.length ? `\n    sem orçamento para o detalhe: ${o.skippedPlans.join(', ')}` : '')
      : '') +
    pages +
    (o.promptCuts.length
      ? `\n    CORTADA NO PROMPT (o modelo não viu o fim): ${o.promptCuts
          .map((c) => `${c.url} (${c.chars} caracteres, teto ${c.limit})`)
          .join(' | ')}`
      : '') +
    (o.rebrandTo
      ? `\n    REBRAND: o site oficial redireciona para ${o.rebrandTo} (mudança para revisar)`
      : '') +
    (d.unknown.length ? `\n    fora da biblioteca: ${d.unknown.slice(0, 15).join(', ')}` : '') +
    (d.inactive.length ? `\n    canais extintos (recusados): ${d.inactive.join(', ')}` : '')
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      resumo: { type: 'boolean', default: false },
      pais: { type: 'string' },
      max: { type: 'string' },
      plataforma: { type: 'string' },
      revisitar: { type: 'boolean', default: false },
      redescobrir: { type: 'boolean', default: false },
      dias: { type: 'string' },
      forcar: { type: 'boolean', default: false },
      'max-paginas': { type: 'string' },
      renderizar: { type: 'boolean', default: false },
      'com-busca': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const countries = (
    values.pais
      ?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) ?? [...LINEUP_COUNTRIES]
  ).filter((c, i, all) => all.indexOf(c) === i);
  const maxCalls = intFlag(values.max, 'max') ?? 6;
  const staleDays = intFlag(values.dias, 'dias') ?? LINEUP_STALE_DAYS;
  const mode = values['com-busca'] ? ('search' as const) : ('pages' as const);
  const config = loadWtwConfig();
  const unknown = countries.filter((c) => !config.has(c));
  if (unknown.length) throw new Error(`País sem dicionário de emissoras: ${unknown.join(', ')}.`);
  const opts = {
    countries,
    revisit: values.revisitar,
    rediscover: values.redescobrir,
    staleDays,
    ...(values.plataforma ? { platformSlug: values.plataforma } : {}),
  };

  const db = dbFromEnv();
  let renderer: PageRenderer | null = null;
  try {
    if (values.resumo) {
      const rows = await lineupReport(db, countries);
      console.log(`Grade gravada em ${countries.join(', ')} (rascunho, conferido e aprovado; sem LLM):`);
      console.table(
        rows.map((r) => ({
          pais: r.country,
          plataforma: r.slug,
          planos: r.plans,
          'com preço provado': r.priced,
          'planos verificados': r.verifiedPlans,
          'grade pela página': r.pageConfirmed,
          'preço em conflito': r.priceConflicts,
          'plano sem detalhe': r.missingDetails,
          'canais inclusos': r.channels.included,
          'canais sem prova': r.channels.unverified,
          'streamings inclusos': r.services.included,
          'streamings adicionais': r.services.addon,
          'streamings sem prova': r.services.unverified,
          complementos: r.addons,
          'sem checagem': r.unchecked,
          'fonte oficial': r.checked ? `${Math.round((100 * r.official) / r.checked)}%` : '—',
        })),
      );
      return;
    }
    const tasks = await planLineupResearch(db, { ...opts, now: new Date() });
    console.log(
      `Grade (${values.revisitar ? `revisita, vistos há mais de ${staleDays} dias` : 'pesquisa'}, ` +
        `${mode === 'pages' ? 'pela página oficial' : 'com busca em cada etapa'}): ` +
        `${tasks.length} tarefa(s) pendente(s) em ${countries.join(', ')}; até ${maxCalls} chamada(s) ao modelo nesta execução.`,
    );
    if (values.plan) {
      const models = llmSettingsFromEnv(rightsLlmEnv(process.env)).models;
      const est = await estimateLineupCalls(db, tasks, { mode, models, rediscover: values.redescobrir });
      if (est.length)
        console.table(
          est.map((e) => ({
            pais: e.task.country,
            tipo: e.task.kind === 'discover' ? 'descoberta' : 'planos',
            plataforma: e.task.kind === 'plans' ? e.task.slug : '',
            motivo: REASON[e.task.reason] ?? e.task.reason,
            'com busca': e.searchCalls,
            buscas: Math.round(e.searches),
            'extração (sem busca)': e.extractCalls,
            'US$ (teto)': e.usd.toFixed(4),
            nota: e.note ?? '',
          })),
        );
      // na ordem da execução, até o --max (cada chamada, com ou sem busca, conta 1)
      let calls = 0;
      const sum = { searchCalls: 0, searches: 0, extractCalls: 0, usd: 0, tasks: 0 };
      for (const e of est) {
        if (calls >= maxCalls) break;
        const take = Math.min(e.searchCalls + e.extractCalls, maxCalls - calls);
        const searchCalls = Math.min(e.searchCalls, take);
        const extractCalls = Math.min(e.extractCalls, take - searchCalls);
        const share = e.searchCalls + e.extractCalls ? take / (e.searchCalls + e.extractCalls) : 0;
        calls += Math.max(take, 0);
        sum.tasks++;
        sum.searchCalls += searchCalls;
        sum.searches += e.searchCalls ? (e.searches * searchCalls) / e.searchCalls : 0;
        sum.extractCalls += extractCalls;
        sum.usd += e.usd * share;
      }
      const all = est.reduce(
        (s, e) => ({
          searchCalls: s.searchCalls + e.searchCalls,
          searches: s.searches + e.searches,
          extractCalls: s.extractCalls + e.extractCalls,
          usd: s.usd + e.usd,
        }),
        { searchCalls: 0, searches: 0, extractCalls: 0, usd: 0 },
      );
      console.log(
        `Nesta execução (--max ${maxCalls}): ${sum.searchCalls} chamada(s) com busca (~${Math.round(sum.searches)} busca(s)) + ` +
          `até ${sum.extractCalls} extração(ões) sem busca · ~${usd(sum.usd)} no teto (extração só se a página mudou).`,
      );
      console.log(
        `Fila inteira: ${all.searchCalls} com busca (~${Math.round(all.searches)} buscas) + até ${all.extractCalls} extração(ões) · ` +
          `~${usd(all.usd)} no teto · modelos: pesquisa ${models.research}, extração ${models.light}.`,
      );
      console.log(
        'PRÉVIA: nada chamado, nada lido, nada gravado. Plataformas novas da descoberta entram na fila da mesma execução (dentro do --max).',
      );
      return;
    }
    if (tasks.length)
      console.table(
        tasks.map((t) => ({
          pais: t.country,
          tipo: t.kind === 'discover' ? 'descoberta' : 'planos',
          plataforma: t.kind === 'plans' ? t.slug : '',
          motivo: REASON[t.reason] ?? t.reason,
        })),
      );
    if (!maxCalls || !tasks.length) return;

    const lib = await syncBroadcasterLibrary(db, config);
    console.log(`Biblioteca de emissoras sincronizada: ${lib.upserted} entrada(s).`);
    // o mesmo cliente da pesquisa de direitos (Gemini na VPS): nível research com busca, light sem busca
    const rt = createLlmClient({ db, env: rightsLlmEnv(process.env) });
    console.log(
      `Modelo: ${rt.settings.provider} · busca ${rt.settings.models.research} · extração ${rt.settings.models.light}`,
    );
    const ws = process.env.LINEUP_RENDER_WS?.trim();
    if (mode === 'pages' && (ws || values.renderizar)) {
      const { playwrightRenderer } = await import('../lineups/render.js');
      renderer = await playwrightRenderer({
        wsEndpoint: ws || null,
        executablePath: process.env.LINEUP_RENDER_CHROMIUM?.trim() || null,
      });
      console.log(`Navegador: ${ws ? `servidor ${ws}` : 'Chromium local'}`);
    } else if (mode === 'pages')
      console.log('Sem navegador (LINEUP_RENDER_WS): só HTML estático e JSON embutido.');
    const reader = new OfficialPageReader({
      store: dbPageStore(db),
      renderer,
      maxPages: intFlag(values['max-paginas'], 'max-paginas') ?? 20,
      log: (m) => console.log(`  ${m}`),
    });
    // tetos do texto das páginas no prompt da extração (painel de Operação ou env; inválido = padrão)
    const promptLimits = lineupPromptLimitsFromEnv(process.env, (m) => console.warn(`Aviso: ${m}`));
    const researcher = new LineupResearcher({
      db,
      llm: rt.client,
      config,
      pages: reader,
      promptLimits,
      log: (m) => console.log(`  ${m}`),
    });
    const outcomes = await researcher.run({ ...opts, maxCalls, mode, force: values.forcar });
    let cost = 0;
    const total = { searchCalls: 0, searches: 0, extractCalls: 0, unchanged: 0, promptCuts: 0 };
    for (const o of outcomes) {
      console.log(describe(o));
      cost += o.costUsd ?? 0;
      total.searchCalls += o.searchCalls;
      total.searches += o.searches;
      total.extractCalls += o.extractCalls;
      if (o.pagesUnchanged) total.unchanged++;
      total.promptCuts += o.promptCuts.length;
      for (const c of o.changes)
        console.log(`    mudou: ${c.target.type} ${JSON.stringify(c.target)} → ${c.fields.join(', ')}`);
    }
    console.log(
      `${outcomes.length} tarefa(s) · ${total.searchCalls} chamada(s) com busca (${total.searches} busca(s)) · ` +
        `${total.extractCalls} extração(ões) sem busca · ${total.unchanged} página(s) sem mudança (sem chamada) · ` +
        `${reader.pagesFetched} página(s) buscada(s) · ${total.promptCuts} página(s) cortada(s) no prompt ` +
        `(teto ${promptLimits.pageChars} por página, ${promptLimits.totalChars} por plataforma) · ` +
        `${usd(cost)} (registrado em ops.llm_usage). Tudo entrou como rascunho: aprove no painel.`,
    );
    // o resumo também vai para a linha da execução em ops.job_run (quando roda pelo scheduler)
    const runId = process.env.GALAXIE_SCHEDULER_RUN_ID?.trim();
    if (runId)
      await mergeJobRunStats(db, runId, {
        lineups: {
          tasks: outcomes.length,
          search_calls: total.searchCalls,
          searches: total.searches,
          extract_calls: total.extractCalls,
          pages_unchanged: total.unchanged,
          pages_fetched: reader.pagesFetched,
          prompt_cuts: total.promptCuts,
          prompt_page_max_chars: promptLimits.pageChars,
          prompt_max_chars: promptLimits.totalChars,
          cost_usd: Number(cost.toFixed(4)),
        },
      }).catch((err) =>
        console.warn(
          `Aviso: resumo não gravado em ops.job_run (${err instanceof Error ? err.message : err})`,
        ),
      );
    if (outcomes.some((o) => o.status === 'failed')) process.exitCode = 1;
  } finally {
    await renderer?.close().catch(() => undefined);
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
