/**
 * Agente de Conteúdo relacionado (docs/12): `pnpm --filter @galaxie/ai-agents related:run [--plan] [--evento <id>]`.
 * Candidatos: futebol encerrado nas últimas `--horas` (padrão RELATED_LOOKBACK_HOURS = 24), tier ≤ `--tier`
 * (padrão 2), com relevância ≥ RELATED_MIN_RELEVANCE nos mercados (RELATED_MARKETS, senão WTW_MARKETS), na
 * ordem: primeira busca pendente → relevância → mais recente. Teto de buscas e de vídeos por jogo, reserva
 * de cota para os jogos grandes e segunda busca RELATED_SECOND_SEARCH_MINUTES depois da primeira
 * (`related/priority.ts`).
 * Flags: --limite <n> (padrão 20) · --forcar (busca completa mesmo dentro da janela de revalidação) ·
 * --sem-llm (só o classificador por regras). Cota do YouTube: YOUTUBE_DAILY_QUOTA − reserva.
 */
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { loadWtwConfig } from '@galaxie/where-to-watch';
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
    acao: ACTION_LABEL[i.action] ?? i.action,
    consultas: i.queries?.join(' ') ?? '',
    unidades: i.units ?? '',
    publicados: i.published ?? '',
    tipos: i.types
      ? Object.entries(i.types)
          .map(([k, n]) => `${k}:${n}`)
          .join(' ')
      : '',
    detalhe: i.reason ?? '',
  }));
  if (rows.length) console.table(rows);
  else console.log('Nenhum evento candidato na janela.');
  const quota = `cota ${report.quotaDay}: ${report.unitsUsedBefore + report.unitsSpent}/${report.quotaLimit} unidades`;
  if (plan) {
    const n = report.items.filter((i) => i.action === 'planned').length;
    console.log(`Plano: ${n} evento(s) seriam buscados · ${quota} (antes desta execução). Nada foi chamado.`);
    return;
  }
  const u = report.usage;
  console.log(
    `related: ${report.unitsSpent} unidade(s) do YouTube · ${quota} · ${report.llmCalls} chamada(s) ao LLM · ` +
      `${u.inputTokens}+${u.outputTokens} tokens · US$ ${u.costUsd.toFixed(4)} · ${report.expired} linha(s) expirada(s)`,
  );
  if (report.items.some((i) => i.action === 'error')) process.exitCode = 1;
}

const db = dbFromEnv();
try {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!values.plan && !apiKey) throw new Error('YOUTUBE_API_KEY não definida no .env (veja .env.example).');
  const wtw = loadWtwConfig();
  const allowlist = new ChannelAllowlist({
    entries: [...loadChannelEntries(), ...broadcasterChannelsFrom(wtw)],
    blocklist: wtw.blocklist,
    creatorMinSubscribers: envInt('RELATED_CREATOR_MIN_SUBSCRIBERS', DEFAULT_CREATOR_MIN_SUBSCRIBERS),
  });
  const llm = values.plan ? null : llmOrNull(values['sem-llm'], db);
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
