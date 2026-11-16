/**
 * Pontuador do Palpite (#942, arquitetura 03 "Do Palpite ao Ranking"). Roda no processo da API, como o jogo do chat:
 *
 * - **Provisório:** ouve o tempo real (`ChangeStream`); a cada placar ou estado, no máximo uma rodada a cada
 *   `throttleMs` por jogo, recalcula os Palpites do jogo com o `@galaxie/game-rules` e grava em lote só o que mudou.
 *   Acerto que deixou de ser (gol anulado pelo VAR, placar corrigido) sai em `game.prediction.reverted`; nenhum Ponto
 *   é estornado, porque o extrato só recebe o definitivo.
 * - **Definitivo:** uma varredura a cada minuto fecha os Palpites dos jogos encerrados há mais que a janela de
 *   correção (`correctionWindowMs`, contada da última mudança do jogo). Cada Palpite fecha uma vez só, mesmo com
 *   várias réplicas: soma no Ranking do mês e do ano (no fuso do país, mês em que o jogo começou), credita na
 *   carteira pelo id do Palpite (idempotente) e sai em `game.prediction.scored`. Jogo cancelado ou abandonado anula
 *   os Palpites, sem Pontos.
 * - **Prazo:** jogo remarcado leva o prazo dos Palpites abertos junto; prazo vencido fecha a troca.
 */
import type { RealtimeChange } from '@galaxie/contracts';
import {
  creditPoints,
  event,
  eventsWithPendingPredictions,
  finalizePrediction,
  gameProgram,
  gameRuleVersion,
  lockPredictions,
  pendingPredictions,
  publishWebhookEvent,
  writeProvisional,
  type Database,
  type GamePendingPrediction,
} from '@galaxie/db';
import {
  DEFAULT_POINTS_SCALE,
  outcomeFromScore,
  periodKeys,
  scorePrediction,
  type MatchOutcome,
  type PointsScale,
  type PredictionValue,
} from '@galaxie/game-rules';
import { and, eq, inArray } from 'drizzle-orm';

const TOPICS = new Set(['event.score_changed', 'event.status_changed', 'event.incident_added']);
const NOT_STARTED = new Set(['scheduled', 'postponed']);
const FINISHED = new Set(['finished']);
const VOIDED = new Set(['cancelled', 'abandoned']);

type Logger = { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void };

export interface GameScorerOptions {
  logger?: Logger;
  now?: () => number;
  /** Intervalo mínimo entre rodadas provisórias do mesmo jogo. Padrão 15 s. */
  throttleMs?: number;
  /** Espera depois da última mudança do jogo encerrado antes do definitivo. Padrão 30 min. */
  correctionWindowMs?: number;
}

interface EventRow {
  id: string;
  sport: string;
  startsAt: Date;
  status: string;
  score: { home: number | null; away: number | null } | null;
  updatedAt: Date;
}

/** O Palpite gravado (corpo da API, camelCase) para o formato das regras. */
export function predictionValue(stored: Record<string, unknown>): PredictionValue {
  return stored as unknown as PredictionValue;
}

export class GameScorer {
  private readonly lastRun = new Map<string, number>();
  private readonly running = new Map<string, { pending: boolean }>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly db: Database,
    private readonly options: GameScorerOptions = {},
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private get throttleMs() {
    return this.options.throttleMs ?? 15_000;
  }
  private get windowMs() {
    return this.options.correctionWindowMs ?? 30 * 60_000;
  }

  /** Ouvinte do `ChangeStream`: nunca lança (falha vira log). */
  handle = (change: RealtimeChange): void => {
    if (!TOPICS.has(change.topic) || !change.event_id) return;
    this.schedule(change.event_id);
  };

  /** No máximo uma rodada por `throttleMs` por jogo; a mudança que chega no meio ganha uma rodada no fim. */
  private schedule(eventId: string): void {
    if (this.timers.has(eventId)) return;
    const wait = Math.max(0, (this.lastRun.get(eventId) ?? 0) + this.throttleMs - this.now());
    const timer = setTimeout(() => {
      this.timers.delete(eventId);
      this.lastRun.set(eventId, this.now());
      if (this.lastRun.size > 5_000) this.lastRun.clear();
      void this.run(eventId).catch((err: unknown) =>
        this.options.logger?.warn({ err, event: eventId }, 'gamificação: pontuação provisória falhou'),
      );
    }, wait);
    timer.unref();
    this.timers.set(eventId, timer);
  }

  private async run(eventId: string): Promise<void> {
    const state = this.running.get(eventId);
    if (state) {
      state.pending = true;
      return;
    }
    const s = { pending: true };
    this.running.set(eventId, s);
    try {
      while (s.pending) {
        s.pending = false;
        await this.reconcile(eventId);
      }
    } finally {
      this.running.delete(eventId);
    }
  }

  private async loadEvent(eventId: string): Promise<EventRow | null> {
    const [row] = await this.db
      .select({
        id: event.id,
        sport: event.sport,
        startsAt: event.startsAt,
        status: event.status,
        score: event.score,
        updatedAt: event.updatedAt,
      })
      .from(event)
      .where(eq(event.id, eventId));
    return (row as EventRow | undefined) ?? null;
  }

  /** Escala de Pontos de cada versão de regra dos Palpites (o que já foi feito pontua pela regra da época). */
  private async scales(rows: readonly GamePendingPrediction[]): Promise<Map<string, PointsScale>> {
    const out = new Map<string, PointsScale>();
    const keys = [...new Set(rows.map((r) => `${r.tenantId}|${r.programCountry}|${r.ruleVersion}`))];
    for (const key of keys) {
      const [tenantId, country, version] = key.split('|') as [string, string, string];
      const [rule] = await this.db
        .select({ rules: gameRuleVersion.rules })
        .from(gameRuleVersion)
        .where(
          and(
            eq(gameRuleVersion.tenantId, tenantId),
            eq(gameRuleVersion.programCountry, country),
            eq(gameRuleVersion.version, Number(version)),
          ),
        );
      const scale = (rule?.rules as { scale?: Partial<PointsScale> } | undefined)?.scale;
      out.set(key, { ...DEFAULT_POINTS_SCALE, ...scale });
    }
    return out;
  }

  private score(
    rows: readonly GamePendingPrediction[],
    outcome: MatchOutcome,
    scales: Map<string, PointsScale>,
  ) {
    return rows.map((r) => {
      const scale = scales.get(`${r.tenantId}|${r.programCountry}|${r.ruleVersion}`) ?? DEFAULT_POINTS_SCALE;
      return { row: r, ...scorePrediction(predictionValue(r.value), outcome, scale) };
    });
  }

  /** Rodada provisória de um jogo. */
  async reconcile(eventId: string): Promise<void> {
    const ev = await this.loadEvent(eventId);
    if (!ev) return;
    // remarcado: o prazo acompanha; começou: fecha a troca
    await lockPredictions(this.db, ev.id);
    if (NOT_STARTED.has(ev.status)) return;
    const outcome = outcomeFromScore(ev.score);
    if (!outcome) return;
    const rows = await pendingPredictions(this.db, ev.id);
    if (rows.length === 0) return;
    const scored = this.score(rows, outcome, await this.scales(rows));
    const changed = await writeProvisional(
      this.db,
      scored.map((s) => ({ tenantId: s.row.tenantId, id: s.row.id, points: s.points, fullHit: s.fullHit })),
    );
    const byId = new Map(rows.map((r) => [`${r.tenantId}|${r.id}`, r]));
    for (const c of changed) {
      if (!(c.before > 0 && c.after === 0)) continue;
      const r = byId.get(`${c.tenantId}|${c.id}`)!;
      await publishWebhookEvent(this.db, {
        tenantId: r.tenantId,
        topic: 'game.prediction.reverted',
        data: {
          profile_id: r.profileId,
          program_country: r.programCountry,
          event_id: r.eventId,
          kind: r.kind,
        },
      });
    }
  }

  /** Varredura: prazos vencidos, provisório dos jogos em andamento e definitivo dos encerrados. */
  async sweep(): Promise<{ finalized: number; voided: number }> {
    await lockPredictions(this.db);
    let finalized = 0;
    let voided = 0;
    for (const eventId of await eventsWithPendingPredictions(this.db)) {
      const ev = await this.loadEvent(eventId);
      if (!ev) continue;
      if (VOIDED.has(ev.status)) {
        voided += await this.finalize(ev, null);
      } else if (FINISHED.has(ev.status) && this.now() - ev.updatedAt.getTime() >= this.windowMs) {
        const outcome = outcomeFromScore(ev.score);
        if (outcome) finalized += await this.finalize(ev, outcome);
      } else if (!NOT_STARTED.has(ev.status)) {
        // o tempo real pode estar desligado: o provisório segue pela varredura
        await this.reconcile(ev.id);
      }
    }
    return { finalized, voided };
  }

  /** Fecha os Palpites do jogo: com o resultado, ou anulados (`outcome` null). Devolve quantos esta réplica fechou. */
  private async finalize(ev: EventRow, outcome: MatchOutcome | null): Promise<number> {
    const rows = await pendingPredictions(this.db, ev.id);
    if (rows.length === 0) return 0;
    const scales = outcome ? await this.scales(rows) : new Map<string, PointsScale>();
    const zones = await this.timeZones(rows);
    let closed = 0;
    for (const r of rows) {
      const result = outcome
        ? scorePrediction(
            predictionValue(r.value),
            outcome,
            scales.get(`${r.tenantId}|${r.programCountry}|${r.ruleVersion}`) ?? DEFAULT_POINTS_SCALE,
          )
        : { points: 0, fullHit: false, correct: false };
      const keys = periodKeys(ev.startsAt, zones.get(`${r.tenantId}|${r.programCountry}`) ?? 'UTC');
      try {
        const done = await this.db.transaction(async (tx) => {
          const ok = await finalizePrediction(tx, {
            tenantId: r.tenantId,
            programCountry: r.programCountry,
            id: r.id,
            profileId: r.profileId,
            eventId: ev.id,
            ruleVersion: r.ruleVersion,
            points: result.points,
            fullHit: result.fullHit,
            voided: outcome === null,
            periods: [keys.month, keys.year],
          });
          if (!ok || outcome === null) return ok;
          if (result.points > 0) {
            const credit = await creditPoints(tx as unknown as Database, {
              tenantId: r.tenantId,
              profileId: r.profileId,
              programCountry: r.programCountry,
              amount: result.points,
              reason: 'prediction',
              source: 'gamification',
              sourceEvent: `prediction:${r.id}`,
              note: 'Palpite certo',
            });
            if (!credit.ok)
              this.options.logger?.warn(
                { prediction: r.id, error: credit.error },
                'gamificação: crédito recusado',
              );
          }
          await publishWebhookEvent(tx, {
            tenantId: r.tenantId,
            topic: 'game.prediction.scored',
            data: {
              profile_id: r.profileId,
              program_country: r.programCountry,
              event_id: ev.id,
              kind: r.kind,
              points: result.points,
              full_hit: result.fullHit,
            },
          });
          return true;
        });
        if (done) closed++;
      } catch (err) {
        this.options.logger?.warn({ err, prediction: r.id }, 'gamificação: fechar o Palpite falhou');
      }
    }
    return closed;
  }

  private async timeZones(rows: readonly GamePendingPrediction[]): Promise<Map<string, string>> {
    const tenants = [...new Set(rows.map((r) => r.tenantId))];
    const programs = await this.db
      .select({
        tenantId: gameProgram.tenantId,
        country: gameProgram.programCountry,
        tz: gameProgram.timeZone,
      })
      .from(gameProgram)
      .where(inArray(gameProgram.tenantId, tenants));
    return new Map(programs.map((p) => [`${p.tenantId}|${p.country}`, p.tz]));
  }
}

/** Varredura do pontuador a cada minuto, no processo da API. */
export function startGameSweep(scorer: GameScorer, log: Logger, everyMs = 60_000): () => void {
  let busy = false;
  const run = () => {
    if (busy) return;
    busy = true;
    scorer
      .sweep()
      .then((r) => {
        if (r.finalized || r.voided) log.info?.(r, 'gamificação: Palpites fechados');
      })
      .catch((err: unknown) => log.warn({ err }, 'gamificação: varredura do Palpite falhou'))
      .finally(() => {
        busy = false;
      });
  };
  const first = setTimeout(run, Math.floor(15_000 + Math.random() * 30_000));
  first.unref();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
