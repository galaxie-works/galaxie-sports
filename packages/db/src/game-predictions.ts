/**
 * Palpite individual e Ranking (#942), no schema `game`. O relógio que vale é o do banco (`now()`): o Palpite que
 * chega depois do `lock_at` não grava nem troca. A pontuação provisória fica no Palpite; o definitivo fecha uma vez
 * só (a linha sai de `open`/`locked` numa instrução), soma no Ranking do mês e do ano e vai para a auditoria.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { appendGameAudit, type GameProgramKey } from './game.js';
import {
  gamePeriodPoints,
  gamePrediction,
  type GamePredictionKind,
  type GamePredictionState,
} from './schema/game.js';
import { isProfileFrozen } from './game-fraud.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export interface GamePredictionItem {
  kind: GamePredictionKind;
  subject: string;
  value: Record<string, unknown>;
}

export interface GamePredictionRow {
  id: string;
  kind: GamePredictionKind;
  subject: string;
  value: Record<string, unknown>;
  state: GamePredictionState;
  provisionalPoints: number;
  finalPoints: number | null;
  fullHit: boolean;
  lockAt: Date;
}

const predictionColumns = {
  id: gamePrediction.id,
  kind: gamePrediction.kind,
  subject: gamePrediction.subject,
  value: gamePrediction.value,
  state: gamePrediction.state,
  provisionalPoints: gamePrediction.provisionalPoints,
  finalPoints: gamePrediction.finalPoints,
  fullHit: gamePrediction.fullHit,
  lockAt: gamePrediction.lockAt,
};

/** Palpites do Perfil num jogo, no programa. */
export async function readPredictions(
  db: Pick<Database, 'select'>,
  key: GameProgramKey & { profileId: string; eventId: string },
): Promise<GamePredictionRow[]> {
  return db
    .select(predictionColumns)
    .from(gamePrediction)
    .where(
      and(
        eq(gamePrediction.tenantId, key.tenantId),
        eq(gamePrediction.programCountry, key.programCountry),
        eq(gamePrediction.profileId, key.profileId),
        eq(gamePrediction.eventId, key.eventId),
      ),
    )
    .orderBy(gamePrediction.kind, gamePrediction.subject);
}

class PredictionLocked extends Error {}

/**
 * Grava ou troca os Palpites até o prazo, tudo ou nada. Devolve `locked` se o prazo (pelo relógio do banco) já
 * passou para algum deles.
 */
export async function savePredictions(
  db: Database,
  key: GameProgramKey & {
    profileId: string;
    eventId: string;
    lockAt: Date;
    ruleVersion: number;
    items: readonly GamePredictionItem[];
  },
): Promise<{ ok: true; rows: GamePredictionRow[] } | { ok: false; error: 'locked' }> {
  try {
    const rows = await db.transaction(async (tx) => {
      const [clock] = await tx.execute<{ open: boolean }>(
        sql`select now() < ${key.lockAt.toISOString()}::timestamptz as open`,
      );
      if (!clock?.open) throw new PredictionLocked();
      for (const item of key.items) {
        const saved = await tx
          .insert(gamePrediction)
          .values({
            tenantId: key.tenantId,
            programCountry: key.programCountry,
            profileId: key.profileId,
            eventId: key.eventId,
            kind: item.kind,
            subject: item.subject,
            value: item.value,
            lockAt: key.lockAt,
            ruleVersion: key.ruleVersion,
          })
          .onConflictDoUpdate({
            target: [
              gamePrediction.tenantId,
              gamePrediction.programCountry,
              gamePrediction.profileId,
              gamePrediction.eventId,
              gamePrediction.kind,
              gamePrediction.subject,
            ],
            set: {
              value: item.value,
              lockAt: key.lockAt,
              ruleVersion: key.ruleVersion,
              updatedAt: sql`now()` as never,
            },
            setWhere: sql`${gamePrediction.state} = 'open' and now() < ${gamePrediction.lockAt}`,
          })
          .returning({ id: gamePrediction.id });
        if (saved.length === 0) throw new PredictionLocked();
        await appendGameAudit(tx, {
          tenantId: key.tenantId,
          programCountry: key.programCountry,
          profileId: key.profileId,
          kind: 'prediction.placed',
          subject: `prediction:${saved[0]!.id}`,
          sourceEvent: `event:${key.eventId}`,
          ruleVersion: key.ruleVersion,
          detail: { kind: item.kind, subject: item.subject, value: item.value },
        });
      }
      return readPredictions(tx, key);
    });
    return { ok: true, rows };
  } catch (err) {
    if (err instanceof PredictionLocked) return { ok: false, error: 'locked' };
    throw err;
  }
}

/**
 * Prazo dos Palpites pelo jogo, em todos os clientes (sem `eventId`, em todos os jogos):
 * - jogo ainda não começou (`scheduled`, `postponed`) e foi remarcado: o prazo dos abertos acompanha o horário novo,
 *   mesmo que o antigo já tenha passado (jogo atrasado continua aceitando Palpite até começar);
 * - jogo começou (ou o horário chegou): os abertos deixam de aceitar troca.
 */
export async function lockPredictions(db: Pick<Database, 'execute'>, eventId?: string): Promise<number> {
  const only = eventId ? sql`and p.event_id = ${eventId}::uuid` : sql``;
  await db.execute(sql`
    update game.prediction p set lock_at = e.starts_at, updated_at = now()
      from core.event e
     where e.id = p.event_id and p.state = 'open' ${only}
       and e.status in ('scheduled', 'postponed') and e.starts_at > now() and p.lock_at <> e.starts_at`);
  const rows = await db.execute<{ id: string }>(sql`
    update game.prediction p set state = 'locked', updated_at = now()
      from core.event e
     where e.id = p.event_id and p.state = 'open' ${only}
       and (e.status not in ('scheduled', 'postponed') or e.starts_at <= now())
    returning p.id`);
  return rows.length;
}

export type GamePendingPrediction = GamePredictionRow &
  GameProgramKey & { profileId: string; eventId: string; ruleVersion: number };

/** Palpites do jogo ainda sem o definitivo, em todos os clientes (para o pontuador). */
export async function pendingPredictions(
  db: Pick<Database, 'select'>,
  eventId: string,
): Promise<GamePendingPrediction[]> {
  return db
    .select({
      ...predictionColumns,
      tenantId: gamePrediction.tenantId,
      programCountry: gamePrediction.programCountry,
      profileId: gamePrediction.profileId,
      eventId: gamePrediction.eventId,
      ruleVersion: gamePrediction.ruleVersion,
    })
    .from(gamePrediction)
    .where(and(eq(gamePrediction.eventId, eventId), inArray(gamePrediction.state, ['open', 'locked'])));
}

/** Jogos com Palpite ainda sem o definitivo (para a varredura do pontuador). */
export async function eventsWithPendingPredictions(db: Pick<Database, 'execute'>): Promise<string[]> {
  const rows = await db.execute<{ event_id: string }>(sql`
    select distinct p.event_id
      from game.prediction p join core.event e on e.id = p.event_id
     where p.state in ('open', 'locked')
       and (p.lock_at <= now() or e.status not in ('scheduled', 'postponed'))`);
  return rows.map((r) => r.event_id);
}

/**
 * Grava a pontuação provisória em lote (`UPDATE ... FROM (VALUES ...)`), só onde mudou. Devolve o que mudou, com
 * os Pontos de antes, para o pontuador avisar a reversão (acerto que deixou de ser).
 */
export async function writeProvisional(
  db: Pick<Database, 'execute'>,
  scores: readonly { tenantId: string; id: string; points: number; fullHit: boolean }[],
): Promise<{ tenantId: string; id: string; before: number; after: number }[]> {
  const changed: { tenantId: string; id: string; before: number; after: number }[] = [];
  for (let i = 0; i < scores.length; i += 1000) {
    const chunk = scores.slice(i, i + 1000);
    if (chunk.length === 0) break;
    const values = sql.join(
      chunk.map((s) => sql`(${s.tenantId}::uuid, ${s.id}::uuid, ${s.points}::int, ${s.fullHit}::boolean)`),
      sql`, `,
    );
    const rows = await db.execute<{ tenant_id: string; id: string; before: number; after: number }>(sql`
      with v(tenant_id, id, points, full_hit) as (values ${values}),
      old as (
        select p.tenant_id, p.id, p.provisional_points as before
          from game.prediction p join v on v.tenant_id = p.tenant_id and v.id = p.id
         where p.state in ('open', 'locked')
      )
      update game.prediction p
         set provisional_points = v.points, full_hit = v.full_hit, scored_at = now(), updated_at = now()
        from v join old on old.tenant_id = v.tenant_id and old.id = v.id
       where p.tenant_id = v.tenant_id and p.id = v.id
         and (p.provisional_points <> v.points or p.full_hit <> v.full_hit)
      returning p.tenant_id, p.id, old.before, v.points as after`);
    for (const r of rows) changed.push({ tenantId: r.tenant_id, id: r.id, before: r.before, after: r.after });
  }
  return changed;
}

/**
 * Fecha um Palpite com o definitivo, uma vez só: a linha sai de `open`/`locked` numa instrução, e só quem conseguiu
 * soma no Ranking (mês e ano) e registra na auditoria, na mesma transação. Os Pontos entram na carteira à parte,
 * pelo `creditPoints` (idempotente pelo id do Palpite). Devolve false se outra réplica já fechou.
 */
export async function finalizePrediction(
  tx: Executor,
  p: GameProgramKey & {
    id: string;
    profileId: string;
    eventId: string;
    ruleVersion: number;
    points: number;
    fullHit: boolean;
    voided: boolean;
    periods: readonly string[];
  },
): Promise<boolean> {
  const done = await tx
    .update(gamePrediction)
    .set({
      state: p.voided ? 'void' : 'final',
      finalPoints: p.voided ? null : p.points,
      provisionalPoints: p.voided ? 0 : p.points,
      fullHit: p.voided ? false : p.fullHit,
      scoredAt: sql`now()` as never,
      updatedAt: sql`now()` as never,
    })
    .where(
      and(
        eq(gamePrediction.tenantId, p.tenantId),
        eq(gamePrediction.id, p.id),
        inArray(gamePrediction.state, ['open', 'locked']),
      ),
    )
    .returning({ id: gamePrediction.id });
  if (done.length === 0) return false;
  // Perfil congelado pelo antifraude (#934): o Palpite fecha, mas não soma no Ranking (nem ganha os Pontos)
  if (!p.voided && p.points > 0 && !(await isProfileFrozen(tx, p))) {
    for (const period of p.periods) {
      await tx
        .insert(gamePeriodPoints)
        .values({
          tenantId: p.tenantId,
          programCountry: p.programCountry,
          period,
          profileId: p.profileId,
          points: p.points,
          fullHits: p.fullHit ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: [
            gamePeriodPoints.tenantId,
            gamePeriodPoints.programCountry,
            gamePeriodPoints.period,
            gamePeriodPoints.profileId,
          ],
          set: {
            points: sql`${gamePeriodPoints.points} + excluded.points`,
            fullHits: sql`${gamePeriodPoints.fullHits} + excluded.full_hits`,
            // o desempate é quem chegou primeiro ao total: o total mudou, o instante também
            reachedAt: sql`now()` as never,
            updatedAt: sql`now()` as never,
          },
        });
    }
  }
  await appendGameAudit(tx, {
    tenantId: p.tenantId,
    programCountry: p.programCountry,
    profileId: p.profileId,
    kind: p.voided ? 'prediction.voided' : 'prediction.scored',
    subject: `prediction:${p.id}`,
    sourceEvent: `event:${p.eventId}`,
    ruleVersion: p.ruleVersion,
    detail: p.voided ? {} : { points: p.points, full_hit: p.fullHit },
  });
  return true;
}

export interface GameRankingRow {
  position: number;
  profileId: string;
  nickname: string | null;
  points: number;
  fullHits: number;
}

/** Ranking do período no programa. Desempate: Acertos em cheio, depois quem chegou primeiro; nunca sorte. */
export async function readRanking(
  db: Pick<Database, 'execute'>,
  key: GameProgramKey & { period: string; limit: number },
): Promise<GameRankingRow[]> {
  const rows = await db.execute<{
    position: string;
    profile_id: string;
    nickname: string | null;
    points: string;
    full_hits: number;
  }>(sql`
    select row_number() over (order by pp.points desc, pp.full_hits desc, pp.reached_at asc, pp.profile_id asc)
             as position,
           pp.profile_id, f.nickname, pp.points, pp.full_hits
      from game.period_points pp
      join fan.profile f on f.tenant_id = pp.tenant_id and f.id = pp.profile_id and f.deleted_at is null
     where pp.tenant_id = ${key.tenantId} and pp.program_country = ${key.programCountry}
       and pp.period = ${key.period}
     order by pp.points desc, pp.full_hits desc, pp.reached_at asc, pp.profile_id asc
     limit ${key.limit}`);
  return rows.map((r) => ({
    position: Number(r.position),
    profileId: r.profile_id,
    nickname: r.nickname,
    points: Number(r.points),
    fullHits: r.full_hits,
  }));
}

/** Posição do Perfil no período (null = sem Pontos ainda). */
export async function readMyRanking(
  db: Pick<Database, 'execute'>,
  key: GameProgramKey & { period: string; profileId: string },
): Promise<{ position: number | null; points: number; fullHits: number }> {
  const [me] = await db.execute<{ points: string; full_hits: number; reached_at: unknown }>(sql`
    select points, full_hits, reached_at from game.period_points
     where tenant_id = ${key.tenantId} and program_country = ${key.programCountry}
       and period = ${key.period} and profile_id = ${key.profileId}`);
  if (!me) return { position: null, points: 0, fullHits: 0 };
  // a comparação fica no SQL, com o instante do banco (microssegundos), sem passar pelo Date do JavaScript
  const [ahead] = await db.execute<{ n: string }>(sql`
    with me as (
      select points, full_hits, reached_at, profile_id from game.period_points
       where tenant_id = ${key.tenantId} and program_country = ${key.programCountry}
         and period = ${key.period} and profile_id = ${key.profileId}
    )
    select count(*) as n from game.period_points pp
      join fan.profile f on f.tenant_id = pp.tenant_id and f.id = pp.profile_id and f.deleted_at is null
      cross join me
     where pp.tenant_id = ${key.tenantId} and pp.program_country = ${key.programCountry}
       and pp.period = ${key.period}
       and (pp.points > me.points
         or (pp.points = me.points and pp.full_hits > me.full_hits)
         or (pp.points = me.points and pp.full_hits = me.full_hits
             and (pp.reached_at, pp.profile_id) < (me.reached_at, me.profile_id)))`);
  return { position: Number(ahead?.n ?? 0) + 1, points: Number(me.points), fullHits: me.full_hits };
}
