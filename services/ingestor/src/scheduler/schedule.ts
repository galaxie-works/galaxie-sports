import { MINUTE, type ScheduledJob } from '@galaxie/scheduler';

/**
 * Perfis do scheduler desta imagem (`SCHEDULER_PROFILE`): `ingestor` (sync, normalização, assets, cargas) e `live` (o
 * serviço do ao vivo, #535). Os agentes de IA têm entrada própria (`@galaxie/ai-agents`).
 */
export type IngestorSchedulerProfile = 'ingestor' | 'live';

/**
 * Agenda padrão do staging. Cada item pode ser sobrescrito por variável de ambiente
 * `SCHEDULE_<NOME_EM_MAIÚSCULAS>` (ex.: SCHEDULE_QUOTA_STATUS="*\/30 * * * *") ou desligado com "off".
 */
export const DEFAULT_JOBS: readonly ScheduledJob[] = [
  {
    name: 'sync-daily',
    description:
      'Sync diário (DAILY): futebol (agenda D-1/D0/D+1, lesões, detalhe dos encerrados, rodízio, relista da temporada atual) e a agenda D-1/D0/D+1 das outras 11 APIs; idempotente no dia',
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
    ownTimeout: true,
    live: true,
    heapMb: 128,
  },
  {
    name: 'postgame-close',
    description:
      'Fechamento pós-jogo: busca de novo a lista do dia (games/fixtures?date=, ADHOC) dos esportes com jogo pendente, no modo e no intervalo de cada esporte (POSTGAME_*), até o fim confirmado; sem nada na vez, sai sem chamar',
    cron: '* * * * *',
    script: 'dist/cli/postgame-close.js',
    args: [],
    onDemandArgs: ['--forcar'],
    timeoutMs: 10 * MINUTE,
    heapMb: 128,
  },
  {
    name: 'live-reconcile',
    description:
      'Reconciliação do ao vivo: detalhe (LIVE) dos jogos acompanhados pelo ao vivo que pararam de atualizar e agenda do dia (ADHOC, no máximo 1 por data a cada 60 min e dentro da fatia ADHOC) para os do catálogo encerrados pelo relógio sem placar da fonte; sob demanda (painel), detalhe de todos os em andamento',
    cron: '*/10 * * * *',
    script: 'dist/cli/live-reconcile.js',
    args: [],
    // botão de pânico do painel: confere todo jogo em andamento, não só os parados
    onDemandArgs: ['--forcar'],
    timeoutMs: 15 * MINUTE,
    live: true,
    heapMb: 64,
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
    live: true,
    heapMb: 64,
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
    name: 'explore-summary',
    description:
      'Resumo da home Explorar pré-calculado (core.explore_summary): recalcula quando um jogo muda de status, quando entra jogo novo na janela e a cada 10 min; sem mudança, confere e sai (sem chamadas ao fornecedor)',
    cron: '* * * * *',
    script: 'dist/cli/explore-summary.js',
    args: [],
    onDemandArgs: ['--forcar'],
    timeoutMs: 5 * MINUTE,
    heapMb: 128,
  },
  {
    name: 'assets-mirror',
    description:
      'Espelha logos/bandeiras/fotos do raw para o S3 (CDN de mídia; não consome cota da API); retoma do cursor por tipo de asset onde a execução anterior parou',
    cron: '30 1 * * *',
    script: 'dist/cli/mirror-assets.js',
    args: ['--descobrir-raw', '--limite', '2000'],
    timeoutMs: 90 * MINUTE,
    // QUEUE_MODE=enqueue (#542): o horário só enfileira; o worker roda em lotes, com o mesmo cursor
    task: { type: 'assets.espelhar', params: { descobrirRaw: true, limite: 2000 } },
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
    name: 'data-retention',
    description:
      'Retenção dos dados que só crescem (docs/04 §1.1): raw do ao vivo com mais de 30 dias (fica a última resposta de cada requisição), ledger de IA com mais de 90 dias (agregado por dia antes), job_run, quota_ledger, job_request, normalize_failure e entregas de webhook',
    cron: '20 3 * * *',
    script: 'dist/cli/data-retention.js',
    args: [],
    timeoutMs: 60 * MINUTE,
  },
  {
    name: 'fixture-people',
    description:
      'Preenche quem jogou e quem dirigiu cada partida (football_fixture.player_pids/coach_pids) nas linhas anteriores ao trigger, em lotes com pausa; sem linha nula, só confere e sai',
    cron: '25 4 * * *',
    script: 'dist/cli/fixture-people.js',
    args: [],
    timeoutMs: 60 * MINUTE,
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

/** Onde roda a faixa do ao vivo (`SCHEDULER_LIVE`): `internal` (padrão) no ingestor, `external` no serviço `live`. */
export type SchedulerLiveMode = 'internal' | 'external';

export function schedulerLiveMode(env: NodeJS.ProcessEnv = process.env): SchedulerLiveMode {
  const raw = env.SCHEDULER_LIVE?.trim().toLowerCase() || 'internal';
  if (raw !== 'internal' && raw !== 'external')
    throw new Error(`SCHEDULER_LIVE deve ser internal ou external (recebido: ${env.SCHEDULER_LIVE}).`);
  return raw;
}

/**
 * Os jobs de cada perfil (agenda padrão do código, antes das sobrescritas `SCHEDULE_<JOB>`):
 * - `ingestor`: todos; com `SCHEDULER_LIVE=external`, menos a faixa do ao vivo (`live: true`), que roda no serviço
 *   `live`. O padrão `internal` deixa o dev e a volta para uma versão anterior com um contêiner só.
 * - `live`: só a faixa do ao vivo. O `live-run` fica no ar (`--continuo`, `keepAlive`: morreu, o scheduler sobe de
 *   novo) com a trava por cópia em vez da trava por job: quem decide quem chama a api-sports é a liderança
 *   (`LIVE_LEADER=on`, live/leader.ts), e a trava por job deixaria a reserva sempre de fora. `live-reconcile` e
 *   `events-clock` seguem no cron, com a trava por job (um por vez em todo o banco, qualquer que seja a cópia).
 */
export function jobsForProfile(
  profile: IngestorSchedulerProfile,
  env: NodeJS.ProcessEnv = process.env,
  jobs: readonly ScheduledJob[] = DEFAULT_JOBS,
): ScheduledJob[] {
  if (profile === 'ingestor')
    return schedulerLiveMode(env) === 'external' ? jobs.filter((j) => !j.live) : [...jobs];
  return jobs
    .filter((j) => j.live)
    .map((j) =>
      j.name === 'live-run'
        ? {
            ...j,
            description: `${j.description}. No serviço live: fica no ar (--continuo) com líder e reserva`,
            args: [...j.args.filter((a) => a !== '--continuo'), '--continuo'],
            keepAlive: true,
            lock: 'instance' as const,
          }
        : j,
    );
}
