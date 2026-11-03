/**
 * Live Poller (docs/07 §2.1, issue #55): cada tick faz **uma** chamada `listLive(<ligas na janela>)` com
 * prioridade LIVE (na api-sports: `fixtures?live=<ids>`, que traz placar, minuto, status e eventos de
 * todos os jogos ao vivo dessas ligas), aplica o lote pela normalização (máquina de estados,
 * *last-known-good*), calcula o diff contra o core e publica os sinais no change feed.
 *
 * Jogos que somem do `live` normalmente acabaram: o poller confirma o resultado com o detalhe
 * (`fixtures?id=`, reservado no orçamento pelo scheduler), que também grava escalações e estatísticas.
 */
import {
  isInPlay,
  type NormalizedBatch,
  type ProviderResult,
  type SportsDataProvider,
} from '@galaxie/providers';
import { diffSnapshot, isSignificant, type EventSnapshot, type LiveChange } from './diff.js';
import { TickFencedError } from './leader-epoch.js';
import type { LiveStore } from './store.js';
import type { LiveCandidate } from './types.js';

export interface TickInput {
  now: Date;
  /** IDs (do provedor) das competições com jogo em janela ativa. */
  leagues: string[];
  /** Jogos em janela ativa, em ordem de prioridade. */
  tracked: readonly LiveCandidate[];
  /** Jogo em destaque para o detalhe ao vivo (escalações/estatísticas), quando o orçamento permite. */
  featured?: LiveCandidate | null | undefined;
  /** Máximo de chamadas de confirmação do resultado final neste tick. */
  finalizeBudget: number;
  /** Abortado quando esta cópia perde a liderança: nenhuma chamada nova ao fornecedor (líder e reserva). */
  fence?: AbortSignal | undefined;
  /**
   * Abortado no encerramento (SIGTERM): o tick termina com o que o `listLive` trouxe e não abre as chamadas de detalhe
   * (confirmação do final e destaque), que a próxima líder faz. Assim o tick mais longo no encerramento é uma chamada
   * (`APISPORTS_LIVE_TIMEOUT_MS`, 30 s) mais a gravação, e cabe no `stop_grace_period` do serviço `live`.
   */
  stop?: AbortSignal | undefined;
}

export interface TickReport {
  at: Date;
  leagues: string[];
  outcome: 'ok' | 'empty' | 'error';
  error?: { kind: string; message: string; retryable: boolean } | undefined;
  /** Chamadas que (provavelmente) gastaram cota: rede e erros do fornecedor; cache e bloqueios não. */
  calls: number;
  /** Eventos no lote do live. */
  events: number;
  changes: LiveChange[];
  published: number;
  /** Eventos marcados como stale (last-known-good) por falha da fonte. */
  staleMarked: number;
  /** Saíram do live nesta chamada (provavelmente encerrados). */
  vanished: string[];
  /** Confirmados pelo detalhe. */
  finalized: string[];
  featured?: string | undefined;
}

export interface LivePollerOptions {
  sport: string;
  jobId?: string | undefined;
  /** Publica também mudanças só de relógio (padrão: false — o minuto muda a cada tick). */
  publishClock?: boolean | undefined;
  /** Tentativas de confirmar o resultado de um jogo que saiu do live (espaçadas por `FINALIZE_BACKOFF_MS`). */
  maxFinalizeAttempts?: number | undefined;
  /** O detalhe confirmou um jogo encerrado (ex.: marcar o cursor do detalhe para o sync diário não repetir). */
  onDetailFetched?: ((providerEventId: string, at: Date) => void | Promise<void>) | undefined;
}

export function spent(result: ProviderResult): number {
  if (result.status !== 'error') return result.source === 'network' ? 1 : 0;
  // bloqueios locais (cota do Governor, plano) não saem para a rede
  return result.error.kind === 'quota' || result.error.kind === 'plan' ? 0 : 1;
}

/**
 * Espera antes de cada nova tentativa de confirmar o resultado. O jogo sai do `live` antes de o detalhe
 * virar FT/AET/PEN (na disputa de pênaltis, minutos antes): três tentativas seguidas no mesmo minuto
 * desistiam cedo demais e o jogo ficava "ao vivo" para sempre.
 */
export const FINALIZE_BACKOFF_MS = [0, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000];

/** Tentativas de confirmar o resultado de um jogo (entram no bastão entre líder e reserva). */
export interface FinalizeAttempt {
  attempts: number;
  nextAt: number;
}

/** Depois disto a tentativa já não decide nada: o backoff inteiro cabe com folga e o jogo saiu do plano. */
const FINALIZE_MEMORY_MS = 24 * 3_600_000;

export class LivePoller {
  private readonly finalizeAttempts = new Map<string, FinalizeAttempt>();

  constructor(
    private readonly provider: SportsDataProvider,
    private readonly store: LiveStore,
    private readonly options: LivePollerOptions,
  ) {}

  /** Tentativas ainda úteis, para a próxima líder não repetir a confirmação que esta já fez. */
  exportFinalizeAttempts(now: Date): Record<string, FinalizeAttempt> {
    const out: Record<string, FinalizeAttempt> = {};
    for (const [id, state] of this.finalizeAttempts)
      if (state.nextAt > now.getTime() - FINALIZE_MEMORY_MS) out[id] = state;
    return out;
  }

  restoreFinalizeAttempts(saved: Record<string, FinalizeAttempt>): void {
    for (const [id, state] of Object.entries(saved)) this.finalizeAttempts.set(id, state);
  }

  private callOptions() {
    return { priority: 'LIVE' as const, ...(this.options.jobId ? { jobId: this.options.jobId } : {}) };
  }

  async tick(input: TickInput): Promise<TickReport> {
    const { sport } = this.options;
    const providerId = this.provider.id;
    const leagues = new Set(input.leagues);
    const inPlay = input.tracked.filter((c) => c.providerEventId && isInPlay(c.status));
    const { fence } = input;

    if (fence?.aborted) throw new TickFencedError();
    const result = await this.provider.listLive(sport, input.leagues, this.callOptions());
    let calls = spent(result);
    // resposta de quem já não é líder: a outra cópia pode estar gravando o mesmo jogo
    if (fence?.aborted) throw new TickFencedError();

    // Primeiro tudo o que vai ao fornecedor; depois a escrita, numa transação só (`atomic`): sem rede com a
    // transação aberta e sem meio-termo na troca de líder, em que o core muda e o gol não é publicado.

    if (result.status === 'error') {
      // a fonte falhou: last-known-good (mantém o placar, marca stale) para o que estava em andamento
      const ids = inPlay.map((c) => c.providerEventId!);
      const { staleMarked, changes, published } = await this.store.atomic(async (store) => {
        const before = await store.snapshots(providerId, sport, ids);
        const staleMarked = await store.applyFailure({
          provider: providerId,
          sport,
          providerEventIds: ids,
          at: result.fetchedAt,
          reason: result.error.kind,
        });
        const after = await store.snapshots(providerId, sport, ids);
        const changes = this.diff(before, after);
        const published = await store.publish(changes.filter((c) => isSignificant(c)));
        return { staleMarked, changes, published };
      });
      return {
        at: input.now,
        leagues: input.leagues,
        outcome: 'error',
        error: result.error,
        calls,
        events: 0,
        changes,
        published,
        staleMarked,
        vanished: [],
        finalized: [],
      };
    }

    const batchIds = result.batch.events.map((e) => e.id);
    const returned = new Set(batchIds);
    const vanished = inPlay
      .filter((c) => c.providerCompetitionId && leagues.has(c.providerCompetitionId))
      .map((c) => c.providerEventId!)
      .filter((id) => !returned.has(id));
    const featuredId =
      input.featured?.providerEventId && !vanished.includes(input.featured.providerEventId)
        ? input.featured.providerEventId
        : undefined;
    const ids = [...new Set([...batchIds, ...vanished, ...(featuredId ? [featuredId] : [])])];

    // confirmação do resultado de quem saiu do live (1 chamada por jogo, reservada no orçamento)
    const details: NormalizedBatch[] = [];
    const confirmed: { id: string; at: Date }[] = [];
    let budget = input.finalizeBudget;
    const maxAttempts = this.options.maxFinalizeAttempts ?? FINALIZE_BACKOFF_MS.length;
    for (const id of vanished) {
      if (budget <= 0 || input.stop?.aborted) break;
      const state = this.finalizeAttempts.get(id) ?? { attempts: 0, nextAt: 0 };
      if (state.attempts >= maxAttempts || input.now.getTime() < state.nextAt) continue;
      const attempts = state.attempts + 1;
      const wait = FINALIZE_BACKOFF_MS[Math.min(attempts, FINALIZE_BACKOFF_MS.length - 1)]!;
      this.finalizeAttempts.set(id, { attempts, nextAt: input.now.getTime() + wait });
      budget -= 1;
      if (fence?.aborted) throw new TickFencedError();
      const detail = await this.provider.getEventDetail(sport, id, this.callOptions());
      calls += spent(detail);
      if (detail.status !== 'ok') continue;
      details.push(detail.batch);
      const ev = detail.batch.events.find((e) => e.id === id);
      if (ev?.observation.status === 'finished') confirmed.push({ id, at: detail.fetchedAt });
    }

    // detalhe ao vivo do jogo em destaque (escalações, estatísticas) — só quando o plano permite
    let featured: string | undefined;
    if (featuredId && !input.stop?.aborted) {
      if (fence?.aborted) throw new TickFencedError();
      const detail = await this.provider.getEventDetail(sport, featuredId, this.callOptions());
      calls += spent(detail);
      if (detail.status === 'ok') {
        details.push(detail.batch);
        featured = featuredId;
      }
    }

    if (fence?.aborted) throw new TickFencedError();
    const { changes, published } = await this.store.atomic(async (store) => {
      const before = await store.snapshots(providerId, sport, ids);
      if (result.status === 'ok') await store.applyBatch(result.batch);
      for (const batch of details) await store.applyBatch(batch);
      const after = await store.snapshots(providerId, sport, ids);
      const changes = this.diff(before, after);
      const published = await store.publish(
        changes.filter((c) => this.options.publishClock || isSignificant(c)),
      );
      return { changes, published };
    });

    // gravado: o que vem agora acompanha o que entrou no core, mesmo se a trava tiver caído nesse meio-tempo
    const finalized: string[] = [];
    for (const { id, at } of confirmed) {
      finalized.push(id);
      await this.options.onDetailFetched?.(id, at);
    }
    const done = changes.filter((c) => c.finished);
    if (done.length) await this.store.onFinished?.(done);
    for (const c of done) this.finalizeAttempts.delete(c.providerEventId);

    return {
      at: input.now,
      leagues: input.leagues,
      outcome: result.status,
      calls,
      events: batchIds.length,
      changes,
      published,
      staleMarked: 0,
      vanished,
      finalized,
      featured,
    };
  }

  private diff(before: Map<string, EventSnapshot>, after: Map<string, EventSnapshot>): LiveChange[] {
    const out: LiveChange[] = [];
    for (const [id, snap] of after) {
      const change = diffSnapshot(before.get(id), snap);
      if (change) out.push(change);
    }
    return out;
  }
}
