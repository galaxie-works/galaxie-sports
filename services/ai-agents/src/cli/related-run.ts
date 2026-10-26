/**
 * Agente de Conteúdo relacionado (docs/12): `pnpm --filter @galaxie/ai-agents related:run [--plan] [--evento <id>]`.
 * Candidatos: futebol encerrado nas últimas `--horas` (padrão RELATED_LOOKBACK_HOURS = 24), tier ≤ `--tier`
 * (padrão 2), com relevância ≥ RELATED_MIN_RELEVANCE nos mercados (RELATED_MARKETS, senão WTW_MARKETS), na
 * ordem: grupo (mercados ativos → fora deles → rendimento zero) → primeira busca pendente → prioridade
 * (relevância × peso do mercado × rendimento da competição). Lê primeiro os uploads dos canais conhecidos
 * (enrich.related_channel: 1 unidade por página) e só busca como complemento, dentro do balde de consultas do
 * dia (YOUTUBE_SEARCH_DAILY_QUOTA, 100) e da reserva para os jogos que ainda vão acontecer no dia
 * (`related/budget.ts`).
 * Flags: --limite <n> (padrão 60) · --forcar (busca completa mesmo dentro da janela de revalidação) ·
 * --sem-llm (só o classificador por regras). Cota: os dois baldes menos YOUTUBE_QUOTA_RESERVE_PERCENT.
 */
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { loadWtwConfig } from '@galaxie/where-to-watch';
import { channelEntriesFromDb } from '../related/channel-map.js';
import {
  broadcasterChannelsFrom,
  ChannelAllowlist,
  DEFAULT_CREATOR_MIN_SUBSCRIBERS,
  loadChannelEntries,
} from '../related/channels.js';
import {
  DEFAULT_QUOTA_RESERVE_PERCENT,
  DEFAULT_RESEARCH_HOURS,
  DEFAULT_YOUTUBE_DAILY_QUOTA,
  DEFAULT_YOUTUBE_SEARCH_DAILY_QUOTA,
  runRelatedAgent,
  type RelatedRunReport,
} from '../related/run.js';
import { YoutubeClient } from '../related/youtube.js';
import { dbFromEnv, intFlag, llmOrNull } from './common.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    evento: { type: 'string' },
    horas: { type: 'string' },
    tier: { type: 'string' },
    limite: { type: 'string' },
    forcar: { type: 'boolean', default: false },
    'sem-llm': { type: 'boolean', default: false },
  },
  strict: true,
});

const envInt = (name: string, fallback: number) =>
  intFlag(process.env[name]?.trim() || undefined, name) ?? fallback;

const ACTION_LABEL: Record<string, string> = {
  searched: 'buscado',
  channels: 'canais',
  revalidated: 'revalidado',
  planned: 'buscaria',
  skipped: 'pulado',
  error: 'erro',
};

function printReport(report: RelatedRunReport, plan: boolean): void {
  const rows = report.items.map((i) => ({
    evento: i.eventId,
    jogo: i.label,
    inicio: i.startsAt.slice(0, 16).replace('T', ' '),
    relevancia: i.relevance ?? '',
    prioridade: i.score ?? '',
    acao: ACTION_LABEL[i.action] ?? i.action,
    canais: i.channels ?? '',
    consultas: i.queries?.join(' ') ?? '',
    buscas: i.searches ?? '',
    unidades: i.units ?? '',
    publicados: i.published ?? '',
    detalhe: i.reason ?? '',
  }));
  if (rows.length) console.table(rows);
  else console.log('Nenhum evento com trabalho nesta execução.');
  const q = report.quota;
  const quota =
    `cota ${report.quotaDay}: busca ${q.search.usedBefore + q.search.spent}/${q.search.limit} consultas ` +
    `(${q.search.reserved} reservadas para a agenda) · geral ${q.api.usedBefore + q.api.spent}/${q.api.limit} unidades`;
  if (plan) {
    const n = report.items.filter((i) => i.action === 'planned').length;
    console.log(
      `Plano: ${n} evento(s) com trabalho · ${report.idle} em dia · ${quota} (antes desta execução). Nada foi chamado.`,
    );
    return;
  }
  const u = report.usage;
  console.log(
    `related: ${q.search.spent} consulta(s) e ${q.api.spent} unidade(s) do YouTube · ${quota} · ${report.idle} em dia · ` +
      `${report.llmCalls} chamada(s) ao LLM · ${u.inputTokens}+${u.outputTokens} tokens · US$ ${u.costUsd.toFixed(4)} · ` +
      `${report.expired} linha(s) apagada(s) pela retenção de 30 dias`,
  );
  if (report.items.some((i) => i.action === 'error')) process.exitCode = 1;
}

const db = dbFromEnv();
try {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!values.plan && !apiKey) throw new Error('YOUTUBE_API_KEY não definida no .env (veja .env.example).');
  const wtw = loadWtwConfig();
  const allowlist = new ChannelAllowlist({
    entries: [...loadChannelEntries(), ...broadcasterChannelsFrom(wtw), ...(await channelEntriesFromDb(db))],
    blocklist: wtw.blocklist,
    creatorMinSubscribers: envInt('RELATED_CREATOR_MIN_SUBSCRIBERS', DEFAULT_CREATOR_MIN_SUBSCRIBERS),
  });
  const llm = values.plan ? null : await llmOrNull(values['sem-llm'], db, 'related');
  const lookback = intFlag(values.horas, 'horas');
  const tier = intFlag(values.tier, 'tier');
  const limit = intFlag(values.limite, 'limite');
  const report = await runRelatedAgent(db, {
    llm,
    youtube: apiKey ? new YoutubeClient({ apiKey }) : null,
    allowlist,
    wtw,
    plan: values.plan,
    force: values.forcar,
    dailyQuota: envInt('YOUTUBE_DAILY_QUOTA', DEFAULT_YOUTUBE_DAILY_QUOTA),
    searchDailyQuota: envInt('YOUTUBE_SEARCH_DAILY_QUOTA', DEFAULT_YOUTUBE_SEARCH_DAILY_QUOTA),
    reservePercent: envInt('YOUTUBE_QUOTA_RESERVE_PERCENT', DEFAULT_QUOTA_RESERVE_PERCENT),
    researchHours: envInt('RELATED_RESEARCH_HOURS', DEFAULT_RESEARCH_HOURS),
    ...(values.evento ? { eventId: values.evento } : {}),
    ...(lookback !== undefined ? { lookbackHours: lookback } : {}),
    ...(tier !== undefined ? { maxTier: tier } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  printReport(report, values.plan);
} finally {
  await closeDb(db);
}
