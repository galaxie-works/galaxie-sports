/**
 * Líder e reserva do ao vivo (issue #536): só a cópia com a trava `live:leader` faz os ticks e chama a
 * api-sports; a outra fica em espera e tenta a trava a cada `LIVE_LEADER_RETRY_MS`. A trava é um advisory lock
 * de sessão: se a líder morrer, a conexão cai junto e a reserva assume na tentativa seguinte. No SIGTERM a líder
 * fecha o tick, grava o que tem de gravar e solta a trava antes de sair. Ligado por `LIVE_LEADER=on`.
 */
import { hostname } from 'node:os';
import type { JobLock, JobLockOptions } from '@galaxie/db';
import { systemLiveClock, type LiveClock, type LiveLogger, type LiveRunSummary } from './runner.js';

export const LIVE_LEADER_LOCK = 'live:leader';
export const DEFAULT_LIVE_LEADER_RETRY_MS = 1_000;

export interface LiveLeaderSettings {
  enabled: boolean;
  retryMs: number;
  /** Identifica a cópia nos logs e em pg_stat_activity (no contêiner, o hostname é o ID dele). */
  instance: string;
}

export function liveLeaderSettings(env: NodeJS.ProcessEnv = process.env): LiveLeaderSettings {
  const mode = env.LIVE_LEADER?.trim() || 'off';
  if (mode !== 'on' && mode !== 'off') throw new Error(`LIVE_LEADER deve ser on ou off (recebido: ${mode}).`);
  const retryRaw = env.LIVE_LEADER_RETRY_MS?.trim();
  const retryMs = retryRaw ? Number(retryRaw) : DEFAULT_LIVE_LEADER_RETRY_MS;
  if (!Number.isInteger(retryMs) || retryMs <= 0)
    throw new Error(`LIVE_LEADER_RETRY_MS deve ser um inteiro > 0 (recebido: ${retryRaw}).`);
  return { enabled: mode === 'on', retryMs, instance: env.HOSTNAME?.trim() || hostname() };
}

/** Nome da sessão da trava em pg_stat_activity: a consulta do README mostra as cópias e quem é a líder. */
export const liveLeaderSessionName = (instance: string) => `galaxie-live-leader:${instance}`;

export interface LiveLeaderLock {
  tryAcquire(options?: JobLockOptions): Promise<JobLock | null>;
}

export interface LiveLeaderDeps {
  lock: LiveLeaderLock;
  instance: string;
  retryMs: number;
  clock?: LiveClock;
  log?: LiveLogger;
  /**
   * Um mandato de líder. `signal` é o encerramento com elegância (termina o tick); `fence`, a perda da trava
   * (descarta o tick). Volta só depois de registrar o que precisa: a trava é solta logo em seguida.
   */
  term(signal: AbortSignal, fence: AbortSignal): Promise<LiveRunSummary>;
}

/**
 * Espera a liderança e roda mandatos até o encerramento. Perdeu a trava: volta para a espera. Um mandato que
 * termina de outro jeito (SIGTERM, erro) encerra o processo, como o job de hoje: a outra cópia assume e o
 * scheduler religa esta. Devolve o resumo do último mandato (`null` = encerrou sem ter sido líder).
 */
export async function runLiveLeadership(
  deps: LiveLeaderDeps,
  signal: AbortSignal,
): Promise<LiveRunSummary | null> {
  const clock = deps.clock ?? systemLiveClock;
  const log = deps.log ?? { info() {}, warn() {}, error() {}, debug() {} };
  const fields = { instance: deps.instance };
  let last: LiveRunSummary | null = null;
  let lockDown = false;
  let waitingSince = clock.now();
  log.info({ ...fields, live_leader: 0, retry_ms: deps.retryMs }, 'ao vivo em espera pela liderança');

  for (;;) {
    if (signal.aborted) return last;
    const fence = new AbortController();
    let lock: JobLock | null = null;
    try {
      lock = await deps.lock.tryAcquire({ onLost: () => fence.abort() });
      lockDown = false;
    } catch (err) {
      // banco fora: segue tentando; o aviso sai uma vez por queda, não uma por segundo
      if (!lockDown) log.warn({ ...fields, err }, 'não foi possível disputar a liderança do ao vivo');
      lockDown = true;
    }
    if (!lock) {
      await clock.sleep(deps.retryMs, signal);
      continue;
    }

    log.info(
      { ...fields, live_leader: 1, waited_ms: clock.now() - waitingSince },
      'esta cópia assumiu a liderança do ao vivo',
    );
    try {
      last = await deps.term(signal, fence.signal);
      if (!fence.signal.aborted) return last;
    } catch (err) {
      // com a trava perdida o erro é consequência (ex.: banco fora) e a outra cópia já pode ter assumido
      if (!fence.signal.aborted) throw err;
      log.warn({ ...fields, err }, 'mandato terminou com erro depois de perder a trava');
    } finally {
      await lock
        .release()
        .catch((err: unknown) => log.warn({ ...fields, err }, 'não foi possível soltar a trava do líder'));
      log.info(
        { ...fields, live_leader: 0, lost: fence.signal.aborted },
        fence.signal.aborted
          ? 'esta cópia perdeu a trava do líder; tick descartado'
          : 'esta cópia soltou a liderança do ao vivo',
      );
    }
    if (signal.aborted) return last;
    // dá a vez: quem estava em espera tenta dentro deste intervalo
    waitingSince = clock.now();
    await clock.sleep(deps.retryMs, signal);
  }
}
