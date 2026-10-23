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
      'Sync diário do futebol (DAILY): agenda D-1/D0/D+1, lesões, detalhe dos encerrados, rodízio; idempotente no dia',
    cron: '5 0 * * *',
    script: 'dist/cli/sync-daily.js',
    args: [],
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
      'Conteúdo relacionado (YouTube): vídeos diretos dos jogos encerrados nas últimas 48 h, classificados por tipo',
    // pós-jogo das noites latino-americanas; cada jogo só gasta busca completa uma vez a cada 12 h
    cron: '*/30 0-6,12-23 * * *',
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
