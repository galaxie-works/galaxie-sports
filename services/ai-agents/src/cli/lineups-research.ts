/**
 * Grade de canais e ofertas das operadoras e streamings (onde assistir): pesquisa com fontes e grava
 * tudo como `draft` (aprovação no painel).
 *   pnpm --filter @galaxie/ai-agents lineups:research --plan                 # o que seria pesquisado (sem LLM)
 *   pnpm --filter @galaxie/ai-agents lineups:research --pais BR --max 4      # descobre e levanta os planos
 *   pnpm --filter @galaxie/ai-agents lineups:research --revisitar --dias 30  # refaz o que foi visto há mais de 30 dias
 * Opções: --pais BR,AR (padrão: BR, AR, MX, CO, CL), --max N (chamadas de pesquisa por execução,
 * padrão 6), --plataforma <slug> (só os planos dessa plataforma), --redescobrir (refaz a descoberta).
 * Idempotente: sem --redescobrir/--revisitar, só pesquisa país sem plataformas e plataforma sem planos.
 * Requer DATABASE_URL e, para pesquisar, o provedor com busca (Gemini em dois passos com grounding,
 * GEMINI_API_KEY): o mesmo da pesquisa de direitos, AI_RIGHTS_PROVIDER (e AI_RIGHTS_MODEL), ou o
 * AI_PROVIDER sem ele. O custo vai para ops.llm_usage (agente `lineups`).
 * Agendado no perfil `agents` do scheduler como `lineups-revisit` (--revisitar --dias 30 --max 4).
 */
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { loadWtwConfig, syncBroadcasterLibrary } from '@galaxie/where-to-watch';
import { rightsLlmEnv } from '../llm/config.js';
import { createLlmClient } from '../llm/factory.js';
import {
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

function describe(o: LineupCallOutcome): string {
  const t = o.task;
  const head = t.kind === 'discover' ? `${t.country} · descoberta` : `${t.country} · ${t.slug}`;
  const cost = o.costUsd !== null ? ` · US$ ${o.costUsd.toFixed(4)}` : '';
  if (o.status !== 'done') return `${head}: ${o.status}${cost} — ${o.error ?? ''}`;
  const d = o.drops;
  return (
    `${head}: ${o.accepted} item(ns) com fonte · ${o.created} novo(s), ${o.updated} atualizado(s), ` +
    `${o.unchanged} sem mudança, ${o.changes.length} mudança(s) para revisar${cost}` +
    ` · descartados: ${d.noSource} sem fonte, ${d.blocked} pela política, ${d.injection} suspeito(s)` +
    (d.unknown.length ? `\n    fora da biblioteca: ${d.unknown.slice(0, 15).join(', ')}` : '')
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      pais: { type: 'string' },
      max: { type: 'string' },
      plataforma: { type: 'string' },
      revisitar: { type: 'boolean', default: false },
      redescobrir: { type: 'boolean', default: false },
      dias: { type: 'string' },
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
  try {
    const tasks = await planLineupResearch(db, { ...opts, now: new Date() });
    console.log(
      `Grade (${values.revisitar ? `revisita, vistos há mais de ${staleDays} dias` : 'pesquisa'}): ` +
        `${tasks.length} pesquisa(s) pendente(s) em ${countries.join(', ')}; até ${maxCalls} nesta execução.`,
    );
    if (tasks.length)
      console.table(
        tasks.map((t) => ({
          pais: t.country,
          tipo: t.kind === 'discover' ? 'descoberta' : 'planos',
          plataforma: t.kind === 'plans' ? t.slug : '',
          motivo: REASON[t.reason] ?? t.reason,
        })),
      );
    if (values.plan) {
      console.log(
        'PRÉVIA: nada chamado, nada gravado. Plataformas novas da descoberta entram na fila da mesma execução (dentro do --max).',
      );
      return;
    }
    if (!maxCalls) return;

    const lib = await syncBroadcasterLibrary(db, config);
    console.log(`Biblioteca de emissoras sincronizada: ${lib.upserted} entrada(s).`);
    // pesquisa com busca, como a de direitos: o job agendado usa o provedor dela (Gemini na VPS)
    const rt = createLlmClient({ db, env: rightsLlmEnv(process.env) });
    console.log(`Pesquisa: ${rt.settings.provider} · ${rt.settings.models.research}`);
    const researcher = new LineupResearcher({
      db,
      llm: rt.client,
      config,
      log: (m) => console.log(`  ${m}`),
    });
    const outcomes = await researcher.run({ ...opts, maxCalls });
    let cost = 0;
    for (const o of outcomes) {
      console.log(describe(o));
      cost += o.costUsd ?? 0;
      for (const c of o.changes)
        console.log(`    mudou: ${c.target.type} ${JSON.stringify(c.target)} → ${c.fields.join(', ')}`);
    }
    console.log(
      `${outcomes.length} chamada(s) · US$ ${cost.toFixed(4)} (registrado em ops.llm_usage). ` +
        'Tudo entrou como rascunho: aprove no painel.',
    );
    if (outcomes.some((o) => o.status === 'failed')) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
