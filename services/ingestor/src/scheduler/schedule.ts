import { Cron } from 'croner';

/** Um CLI existente do ingestor executado periodicamente (horários em UTC — o dia de cota vira às 00:00 UTC). */
export interface ScheduledJob {
  /** Nome estável: vira `job` em ops.job_run e label das métricas. */
  name: string;
  description: string;
  /** Expressão cron de 5 campos (UTC). */
  cron: string;
  /** Script relativo à raiz do pacote do job (`cwd`). */
  script: string;
  /** Raiz do pacote do job, relativa à do ingestor (padrão: o próprio ingestor). */
  cwd?: string;
  args: string[];
  timeoutMs: number;
}

const MINUTE = 60_000;

/**
 * Agenda padrão do staging. Cada item pode ser sobrescrito por variável de ambiente
 * `SCHEDULE_<NOME_EM_MAIÚSCULAS>` (ex.: SCHEDULE_QUOTA_STATUS="*\/30 * * * *") ou desligado com "off".
 */
export const DEFAULT_JOBS: readonly ScheduledJob[] = [
  {
    name: 'sync-daily',
    description:
      'Sync diário (DAILY): futebol (agenda D-1/D0/D+1, lesões, detalhe dos encerrados, rodízio) e a agenda D-1/D0/D+1 das outras 11 APIs; idempotente no dia',
    cron: '5 0 * * *',
    script: 'dist/cli/sync-daily.js',
    args: ['--outros-esportes'],
    timeoutMs: 120 * MINUTE,
  },
  {
    name: 'live-run',
    description:
      'Ao vivo (LIVE): Live Scheduler + Live Poller enquanto houver janela; planeja o orçamento do dia (LIVE = 0 sem jogos) e sai ocioso',
    cron: '*/5 * * * *',
    script: 'dist/cli/live-run.js',
    args: [],
    timeoutMs: 20 * 60 * MINUTE,
  },
  {
    name: 'live-reconcile',
    description:
      'Reconciliação do ao vivo (LIVE): confirma pelo detalhe os jogos que o core ainda dá como em andamento (rede de segurança do live-run)',
    cron: '*/10 * * * *',
    script: 'dist/cli/live-reconcile.js',
    args: [],
    timeoutMs: 15 * MINUTE,
  },
  {
    name: 'normalize-football',
    description: 'Normalização incremental raw → core do futebol (sem chamadas ao fornecedor)',
    cron: '35 0 * * *',
    script: 'dist/cli/normalize-football.js',
    args: [],
    timeoutMs: 60 * MINUTE,
  },
  {
    name: 'normalize-sports',
    description:
      'Normalização incremental raw → core das outras 11 APIs (agenda e placares do sync diário), depois o relógio dos eventos; sem chamadas ao fornecedor',
    cron: '15 * * * *',
    script: 'dist/cli/normalize-sports.js',
    args: ['--relogio'],
    timeoutMs: 30 * MINUTE,
  },
  {
    name: 'events-clock',
    description: 'Relógio dos eventos (scheduled → starting → live → finished pelo horário previsto)',
    cron: '* * * * *',
    script: 'dist/cli/events-clock.js',
    args: [],
    timeoutMs: 5 * MINUTE,
  },
  {
    name: 'events-importance',
    description:
      'Importância dos jogos dos próximos 7 dias: sinais da tabela (título, rebaixamento, vaga) pelo motor de regras e prestígio do catálogo (sem chamadas ao fornecedor)',
    cron: '20 * * * *',
    script: 'dist/cli/events-importance.js',
    args: ['--esporte', 'football', '--proximos-dias', '7'],
    timeoutMs: 20 * MINUTE,
  },
  {
    name: 'assets-mirror',
    description: 'Espelha logos/bandeiras/fotos do raw para o S3 (CDN de mídia; não consome cota da API)',
    cron: '30 1 * * *',
    script: 'dist/cli/mirror-assets.js',
    args: ['--descobrir-raw', '--limite', '2000'],
    timeoutMs: 90 * MINUTE,
  },
  {
    name: 'assets-palette',
    description:
      'Cores dos times: paleta dos escudos já espelhados sem palette (lê do S3; sem chamadas ao fornecedor)',
    cron: '10 3 * * *',
    script: 'dist/cli/assets-palette.js',
    args: ['--limite', '5000'],
    timeoutMs: 30 * MINUTE,
  },
  {
    name: 'change-feed-prune',
    description:
      'Retenção do ops.change_feed: apaga mudanças com mais de CHANGE_FEED_RETENTION_DAYS (padrão 7), mantendo a última por entidade e o que os webhooks ainda não leram',
    cron: '45 2 * * *',
    script: 'dist/cli/change-feed-prune.js',
    args: [],
    timeoutMs: 30 * MINUTE,
  },
  {
    name: 'quota-status',
    description: 'Lê /status de cada API (não consome cota) e reconcilia o Quota Governor',
    cron: '5 * * * *',
    script: 'dist/cli/quota.js',
    args: [],
    timeoutMs: 10 * MINUTE,
  },
  {
    name: 'data-quality',
    description:
      'Qualidade dos dados: regras automáticas (F1 × F1DB pela API, placares, ao vivo travado, classificação, escudos, Wikidata, grades) e placar em ops.quality_*; sem cota do fornecedor',
    cron: '40 4 * * *',
    script: 'dist/cli/quality-run.js',
    args: ['--agendado'],
    timeoutMs: 30 * MINUTE,
  },
  {
    name: 'bootstrap-catalog',
    description:
      'Atualiza o catálogo global do futebol (~8 chamadas BOOTSTRAP; reaproveita o raw dentro do TTL)',
    cron: '15 3 * * 1',
    script: 'dist/cli/bootstrap-catalog.js',
    args: [],
    timeoutMs: 60 * MINUTE,
  },
];

/**
 * Agentes de IA (`services/ai-agents`, docs/07), no perfil `agents` do scheduler: um serviço à parte,
 * que roda mesmo com o ingestor parado. Sem LLM configurado, resumo e cenário gravam o texto
 * determinístico e o Onde Assistir só revalida o que já existe.
 */
export const AGENT_JOBS: readonly ScheduledJob[] = [
  {
    name: 'recap-run',
    description: 'Resumo pós-jogo (IA) dos encerrados nas últimas 36 h; ≤ 10 min depois do apito final',
    cron: '*/5 * * * *',
    script: 'dist/cli/recap-run.js',
    cwd: '../ai-agents',
    args: [],
    timeoutMs: 15 * MINUTE,
  },
  {
    name: 'context-run',
    description: 'Cenário pré-jogo (motor de regras + IA) dos jogos das próximas 72 h',
    cron: '10 * * * *',
    script: 'dist/cli/context-run.js',
    cwd: '../ai-agents',
    args: [],
    timeoutMs: 30 * MINUTE,
  },
  {
    name: 'wtw-run',
    description:
      'Onde Assistir: direitos (T-7d), alocação por rodada (T-48h, só quando os direitos dividem os jogos) e revalidações (T-3h, T-30min)',
    cron: '*/5 * * * *',
    script: 'dist/cli/wtw-run.js',
    cwd: '../ai-agents',
    args: ['--limite', '100', '--chamadas', '2'],
    timeoutMs: 20 * MINUTE,
  },
  {
    name: 'related-run',
    description:
      'Conteúdo relacionado (YouTube): vídeos dos jogos encerrados nas últimas 24 h, por relevância nos mercados e localizados por país',
    // a cada 3 min o dia todo: o jogo que acabou entra na fila na frente (vídeos em até ~5 min do apito);
    // execução sem jogo novo não chama o YouTube
    cron: '*/3 * * * *',
    script: 'dist/cli/related-run.js',
    cwd: '../ai-agents',
    args: [],
    timeoutMs: 20 * MINUTE,
  },
  {
    name: 'wtw-rights',
    description:
      'Onde Assistir: biblioteca de emissoras, direitos por temporada (uma pesquisa por competição para a América Latina) e reconfirmação mensal',
    // duas vezes por dia, até 4 pesquisas cada (~45 mil tokens e US$ 0,15 em média; até 120 mil e
    // US$ 0,40 com os 8 mercados): uma fila de ~20 competições zera em 2–3 dias; sem fila, custo zero
    cron: '40 5,17 * * *',
    script: 'dist/cli/wtw-rights.js',
    cwd: '../ai-agents',
    args: ['--chamadas', '4'],
    timeoutMs: 30 * MINUTE,
  },
  {
    name: 'review-suggestions',
    description:
      'Revisão semântica: o Gemini decide as sugestões de edição em aberto; a aprovada entra no ar como edição no banco (sem deploy), a recusada fica com o motivo no painel',
    // sem sugestão em aberto, só uma consulta ao banco (nenhuma chamada ao modelo)
    cron: '*/15 * * * *',
    script: 'dist/cli/review-suggestions.js',
    cwd: '../ai-agents',
    args: ['--max', '10'],
    timeoutMs: 15 * MINUTE,
  },
  {
    name: 'lineups-revisit',
    description:
      'Grade de canais e ofertas: revisita o que foi visto há mais de 30 dias (descoberta por país e planos por plataforma); mudanças em itens aprovados vão para revisão no painel',
    // uma vez por dia, até 4 pesquisas (US$ 0,20–0,40 cada nos testes): ~45 plataformas nos 5 países
    // voltam a ser vistas em ~12 dias, antes de vencer de novo; sem item vencido, custo zero
    cron: '50 4 * * *',
    script: 'dist/cli/lineups-research.js',
    cwd: '../ai-agents',
    args: ['--revisitar', '--dias', '30', '--max', '4'],
    timeoutMs: 30 * MINUTE,
  },
  {
    name: 'lineups-pages',
    description:
      'Grade de canais e ofertas: confirma a grade, os inclusos e o preço de cada plano pela página oficial, lida do nosso lado (robots.txt, cache de 25 dias, sem LLM); página que mudou vira mudança para revisar',
    // depois da revisita; o cache por URL faz a maior parte das execuções não buscar nada
    cron: '20 5 * * *',
    script: 'dist/cli/lineups-pages.js',
    cwd: '../ai-agents',
    args: ['--max-paginas', '20'],
    timeoutMs: 30 * MINUTE,
  },
  {
    name: 'channel-lists',
    description:
      'Lista de canais do cliente: a IA confere só as sobras do casamento por código (índices e enums, com validador depois); falha volta na próxima rodada',
    // sem lista pendente, só uma consulta ao banco (nenhuma chamada ao modelo)
    cron: '*/10 * * * *',
    script: 'dist/cli/channel-lists.js',
    cwd: '../ai-agents',
    args: ['--max', '10', '--repetir-falhas'],
    timeoutMs: 15 * MINUTE,
  },
];

/** Jobs de cada perfil do scheduler (`SCHEDULER_PROFILE`, padrão `ingestor`). */
export function jobsForProfile(profile: string | undefined): readonly ScheduledJob[] {
  const name = (profile ?? 'ingestor').trim().toLowerCase() || 'ingestor';
  if (name === 'ingestor') return DEFAULT_JOBS;
  if (name === 'agents') return AGENT_JOBS;
  throw new Error(`SCHEDULER_PROFILE inválido: "${profile}" (use ingestor ou agents).`);
}

export function envKey(name: string): string {
  return `SCHEDULE_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** Valida a expressão cron (5 campos) e lança um erro legível se for inválida. */
export function assertCron(pattern: string, name: string): void {
  try {
    new Cron(pattern, { paused: true, mode: '5-part', timezone: 'UTC' }).stop();
  } catch (err) {
    throw new Error(`Agenda inválida para "${name}": "${pattern}" (${(err as Error).message})`, {
      cause: err,
    });
  }
}

/** Aplica as sobrescritas do ambiente: SCHEDULE_<JOB>=<cron>|off e SCHEDULER_TIMEOUT_MINUTES. */
export function scheduleFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  jobs: readonly ScheduledJob[] = jobsForProfile(env.SCHEDULER_PROFILE),
): ScheduledJob[] {
  const timeoutMinutes = Number(env.SCHEDULER_TIMEOUT_MINUTES);
  const out: ScheduledJob[] = [];
  for (const job of jobs) {
    const override = env[envKey(job.name)]?.trim();
    if (override && ['off', 'false', 'disabled', '0'].includes(override.toLowerCase())) continue;
    const cron = override || job.cron;
    assertCron(cron, job.name);
    out.push({
      ...job,
      cron,
      ...(Number.isFinite(timeoutMinutes) && timeoutMinutes > 0
        ? { timeoutMs: timeoutMinutes * MINUTE }
        : {}),
    });
  }
  return out;
}

/** Próximas execuções (UTC) — para `scheduler --list` e logs de partida. */
export function nextRuns(job: ScheduledJob, count = 3, from: Date = new Date()): Date[] {
  const cron = new Cron(job.cron, { paused: true, mode: '5-part', timezone: 'UTC' });
  const runs = cron.nextRuns(count, from);
  cron.stop();
  return runs;
}
