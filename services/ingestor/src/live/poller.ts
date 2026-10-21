/**
 * Live Poller (docs/07 §2.1, issue #55): cada tick faz **uma** chamada `listLive(<ligas na janela>)` com
 * prioridade LIVE (na api-sports: `fixtures?live=<ids>`, que traz placar, minuto, status e eventos de
 * todos os jogos ao vivo dessas ligas), aplica o lote pela normalização (máquina de estados,
 * *last-known-good*), calcula o diff contra o core e publica os sinais no change feed.
 *
 * Jogos que somem do `live` normalmente acabaram: o poller confirma o resultado com o detalhe
 * (`fixtures?id=`, reservado no orçamento pelo scheduler), que também grava escalações e estatísticas.
 */
import { isInPlay, type ProviderResult, type SportsDataProvider } from '@galaxie/providers';
import { diffSnapshot, isSignificant, type EventSnapshot, type LiveChange } from './diff.js';
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
  /** Tentativas de confirmar o resultado de um jogo que saiu do live. */
  maxFinalizeAttempts?: number | undefined;
  /** O detalhe confirmou um jogo encerrado (ex.: marcar o cursor do detalhe para o sync diário não repetir). */
  onDetailFetched?: ((providerEventId: string, at: Date) => void | Promise<void>) | undefined;
}

function spent(result: ProviderResult): number {
  if (result.status !== 'error') return result.source === 'network' ? 1 : 0;
  // bloqueios locais (cota do Governor, plano) não saem para a rede
  return result.error.kind === 'quota' || result.error.kind === 'plan' ? 0 : 1;
}

export class LivePoller {
  private readonly finalizeAttempts = new Map<string, number>();

  constructor(
    private readonly provider: SportsDataProvider,
    private readonly store: LiveStore,
    private readonly options: LivePollerOptions,
  ) {}

  private callOptions() {
    return { priority: 'LIVE' as const, ...(this.options.jobId ? { jobId: this.options.jobId } : {}) };
  }

  async tick(input: TickInput): Promise<TickReport> {
    const { sport } = this.options;
    const providerId = this.provider.id;
    const leagues = new Set(input.leagues);
    const inPlay = input.tracked.filter((c) => c.providerEventId && isInPlay(c.status));

    const result = await this.provider.listLive(sport, input.leagues, this.callOptions());
    let calls = spent(result);

    if (result.status === 'error') {
      // a fonte falhou: last-known-good (mantém o placar, marca stale) para o que estava em andamento
      const ids = inPlay.map((c) => c.providerEventId!);
      const before = await this.store.snapshots(providerId, sport, ids);
      const staleMarked = await this.store.applyFailure({
        provider: providerId,
        sport,
        providerEventIds: ids,
        at: result.fetchedAt,
        reason: result.error.kind,
      });
      const after = await this.store.snapshots(providerId, sport, ids);
      const changes = this.diff(before, after);
      const published = await this.store.publish(changes.filter((c) => isSignificant(c)));
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

    const before = await this.store.snapshots(providerId, sport, ids);
    if (result.status === 'ok') await this.store.applyBatch(result.batch);

    // confirmação do resultado de quem saiu do live (1 chamada por jogo, reservada no orçamento)
    const finalized: string[] = [];
    let budget = input.finalizeBudget;
    for (const id of vanished) {
      if (budget <= 0) break;
      const attempts = this.finalizeAttempts.get(id) ?? 0;
      if (attempts >= (this.options.maxFinalizeAttempts ?? 3)) continue;
      this.finalizeAttempts.set(id, attempts + 1);
      budget -= 1;
      const detail = await this.provider.getEventDetail(sport, id, this.callOptions());
      calls += spent(detail);
      if (detail.status !== 'ok') continue;
      await this.store.applyBatch(detail.batch);
      finalized.push(id);
      const ev = detail.batch.events.find((e) => e.id === id);
      if (ev?.observation.status === 'finished') await this.options.onDetailFetched?.(id, detail.fetchedAt);
    }

    // detalhe ao vivo do jogo em destaque (escalações, estatísticas) — só quando o plano permite
    let featured: string | undefined;
    if (featuredId) {
      const detail = await this.provider.getEventDetail(sport, featuredId, this.callOptions());
      calls += spent(detail);
      if (detail.status === 'ok') {
        await this.store.applyBatch(detail.batch);
        featured = featuredId;
      }
    }

    const after = await this.store.snapshots(providerId, sport, ids);
    const changes = this.diff(before, after);
    const published = await this.store.publish(
      changes.filter((c) => this.options.publishClock || isSignificant(c)),
    );
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
