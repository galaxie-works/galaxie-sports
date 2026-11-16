/**
 * Motor de Conquistas, a parte do banco (#908). Aplica uma entrada já aceita pelo `@galaxie/game-rules`
 * (`parseAchievementInput`) às Conquistas ativas do programa: soma o progresso (vitalício e da temporada), concede os
 * Degraus novos (únicos por Perfil, Conquista, temporada e Degrau), a Carta de cada Degrau e o bônus de Pontos, e
 * registra tudo na auditoria e no webhook.
 *
 * Idempotência: quem chama aplica a entrada uma vez só, na mesma transação do fato que a gerou (o Palpite que fecha
 * uma vez só, a participação que entra uma vez por partida). Reprocessar o mesmo fato não chega aqui de novo, e o
 * Degrau e a Carta têm chave única de qualquer forma.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { creditPoints } from './fan-wallet.js';
import { appendGameAudit, type GameProgramKey } from './game.js';
import {
  gameAchievementProgress,
  gameCardGrant,
  gameCatalogAchievement,
  gameCatalogStep,
  gameParticipationDaily,
  gamePeriodPoints,
  gameProgramAchievement,
  gameStepGrant,
} from './schema/game.js';
import { publishWebhookEvent } from './webhooks.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface GameActiveAchievement {
  id: string;
  sport: string | null;
  rule: Record<string, unknown>;
  seasonal: boolean;
  thresholds: number[];
  bonus: number[];
  cards: (string | null)[];
}

/**
 * Conquistas que contam no programa: as ativas do Catálogo que o cliente não desligou, com os limites ajustados por
 * ele quando houver. Sem linha do cliente, a Conquista ativa do Catálogo vale.
 */
export async function activeAchievements(
  db: Pick<Database, 'select'>,
  key: GameProgramKey,
): Promise<GameActiveAchievement[]> {
  const rows = await db
    .select({
      id: gameCatalogAchievement.id,
      sport: gameCatalogAchievement.sport,
      rule: gameCatalogAchievement.rule,
      seasonal: gameCatalogAchievement.seasonal,
      enabled: gameProgramAchievement.enabled,
      thresholds: gameProgramAchievement.thresholds,
      step: gameCatalogStep.step,
      threshold: gameCatalogStep.threshold,
      bonus: gameCatalogStep.bonusPoints,
      card: gameCatalogStep.cardKey,
    })
    .from(gameCatalogAchievement)
    .innerJoin(gameCatalogStep, eq(gameCatalogStep.achievementId, gameCatalogAchievement.id))
    .leftJoin(
      gameProgramAchievement,
      and(
        eq(gameProgramAchievement.tenantId, key.tenantId),
        eq(gameProgramAchievement.programCountry, key.programCountry),
        eq(gameProgramAchievement.achievementId, gameCatalogAchievement.id),
      ),
    )
    .where(eq(gameCatalogAchievement.active, true))
    .orderBy(gameCatalogAchievement.id, gameCatalogStep.step);
  const out = new Map<string, GameActiveAchievement>();
  for (const r of rows) {
    if (r.enabled === false) continue;
    let a = out.get(r.id);
    if (!a) {
      a = {
        id: r.id,
        sport: r.sport,
        rule: r.rule,
        seasonal: r.seasonal,
        thresholds: [],
        bonus: [],
        cards: [],
      };
      out.set(r.id, a);
    }
    a.thresholds.push(r.thresholds?.[r.step - 1] ?? r.threshold);
    a.bonus.push(r.bonus);
    a.cards.push(r.card);
  }
  return [...out.values()];
}

export interface GameStepReached {
  achievementId: string;
  season: string;
  step: number;
  completed: boolean;
}

/**
 * Soma 1 no progresso das Conquistas `matched` e concede os Degraus novos. `season` = a temporada do jogo (`2026`),
 * usada nas Conquistas sazonais além da vitalícia (`all`).
 */
export async function applyAchievementProgress(
  tx: Tx,
  input: GameProgramKey & {
    profileId: string;
    ruleVersion: number;
    season: string;
    /** Períodos do Ranking (mês e ano) em que o bônus entra. */
    periods: readonly string[];
    sourceEvent: string;
    matched: readonly GameActiveAchievement[];
  },
): Promise<GameStepReached[]> {
  const reached: GameStepReached[] = [];
  for (const a of input.matched) {
    for (const season of a.seasonal ? ['all', input.season] : ['all']) {
      const [row] = await tx
        .insert(gameAchievementProgress)
        .values({
          tenantId: input.tenantId,
          programCountry: input.programCountry,
          profileId: input.profileId,
          achievementId: a.id,
          season,
          count: 1,
        })
        .onConflictDoUpdate({
          target: [
            gameAchievementProgress.tenantId,
            gameAchievementProgress.programCountry,
            gameAchievementProgress.profileId,
            gameAchievementProgress.achievementId,
            gameAchievementProgress.season,
          ],
          set: { count: sql`${gameAchievementProgress.count} + 1`, updatedAt: sql`now()` as never },
        })
        .returning({ count: gameAchievementProgress.count });
      const count = row!.count;
      for (let i = 0; i < a.thresholds.length; i++) {
        if (count < a.thresholds[i]!) break;
        const step = i + 1;
        const granted = await tx
          .insert(gameStepGrant)
          .values({
            tenantId: input.tenantId,
            programCountry: input.programCountry,
            profileId: input.profileId,
            achievementId: a.id,
            season,
            step,
            threshold: a.thresholds[i]!,
            bonusPoints: a.bonus[i] ?? 0,
            ruleVersion: input.ruleVersion,
            sourceEvent: input.sourceEvent,
          })
          .onConflictDoNothing()
          .returning({ step: gameStepGrant.step });
        if (granted.length === 0) continue;
        const completed = step === a.thresholds.length;
        reached.push({ achievementId: a.id, season, step, completed });
        const card = a.cards[i];
        if (card) {
          await tx
            .insert(gameCardGrant)
            .values({
              tenantId: input.tenantId,
              programCountry: input.programCountry,
              profileId: input.profileId,
              cardKey: card,
              achievementId: a.id,
              season,
              step,
              ruleVersion: input.ruleVersion,
            })
            .onConflictDoNothing();
        }
        const bonus = a.bonus[i] ?? 0;
        // o bônus vem só da versão vitalícia: a sazonal repete o Degrau e não paga duas vezes
        if (bonus > 0 && season === 'all') {
          await creditPoints(tx as unknown as Database, {
            tenantId: input.tenantId,
            profileId: input.profileId,
            programCountry: input.programCountry,
            amount: bonus,
            reason: 'achievement',
            source: 'gamification',
            sourceEvent: `step:${a.id}:${season}:${step}`,
            note: 'Degrau de Conquista',
          });
          // o Ranking soma os Pontos do período, os de Conquista também
          for (const period of input.periods) {
            await tx
              .insert(gamePeriodPoints)
              .values({
                tenantId: input.tenantId,
                programCountry: input.programCountry,
                period,
                profileId: input.profileId,
                points: bonus,
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
                  reachedAt: sql`now()` as never,
                  updatedAt: sql`now()` as never,
                },
              });
          }
        }
        const detail = { achievement_id: a.id, season, step, card_key: card ?? null, bonus_points: bonus };
        await appendGameAudit(tx, {
          tenantId: input.tenantId,
          programCountry: input.programCountry,
          profileId: input.profileId,
          kind: completed ? 'achievement.completed' : 'achievement.step_reached',
          subject: `step:${a.id}:${season}:${step}`,
          sourceEvent: input.sourceEvent,
          ruleVersion: input.ruleVersion,
          detail,
        });
        if (card)
          await appendGameAudit(tx, {
            tenantId: input.tenantId,
            programCountry: input.programCountry,
            profileId: input.profileId,
            kind: 'card.granted',
            subject: `card:${card}:${season}`,
            sourceEvent: input.sourceEvent,
            ruleVersion: input.ruleVersion,
          });
        await publishWebhookEvent(tx, {
          tenantId: input.tenantId,
          topic: 'game.achievement.step_reached',
          data: {
            profile_id: input.profileId,
            program_country: input.programCountry,
            achievement_id: a.id,
            season,
            step,
            completed,
            card_key: card ?? null,
          },
        });
      }
    }
  }
  return reached;
}

export interface GameAchievementView {
  achievementId: string;
  season: string;
  count: number;
  steps: number;
  rarity: number | null;
}

/**
 * Estante do torcedor: progresso por Conquista e temporada, Degraus alcançados e a raridade (fração dos Perfis do
 * programa com pelo menos o primeiro Degrau, calculada na leitura).
 */
export async function readFanAchievements(
  db: Pick<Database, 'execute'>,
  key: GameProgramKey & { profileId: string },
): Promise<GameAchievementView[]> {
  const rows = await db.execute<{
    achievement_id: string;
    season: string;
    count: number;
    steps: number;
    holders: string;
    profiles: string;
  }>(sql`
    with mine as (
      select achievement_id, season, count from game.achievement_progress
       where tenant_id = ${key.tenantId} and program_country = ${key.programCountry} and profile_id = ${key.profileId}
    ), total as (
      select count(distinct profile_id) as n from game.achievement_progress
       where tenant_id = ${key.tenantId} and program_country = ${key.programCountry}
    )
    select m.achievement_id, m.season, m.count,
           (select count(*)::int from game.step_grant g
             where g.tenant_id = ${key.tenantId} and g.program_country = ${key.programCountry}
               and g.profile_id = ${key.profileId} and g.achievement_id = m.achievement_id and g.season = m.season) as steps,
           (select count(distinct g.profile_id) from game.step_grant g
             where g.tenant_id = ${key.tenantId} and g.program_country = ${key.programCountry}
               and g.achievement_id = m.achievement_id and g.season = m.season and g.step = 1) as holders,
           (select n from total) as profiles
      from mine m
     order by m.achievement_id, m.season`);
  return rows.map((r) => ({
    achievementId: r.achievement_id,
    season: r.season,
    count: r.count,
    steps: r.steps,
    rarity: Number(r.profiles) > 0 ? Number(r.holders) / Number(r.profiles) : null,
  }));
}

/** Cartas do torcedor no programa. */
export async function readFanCards(
  db: Pick<Database, 'select'>,
  key: GameProgramKey & { profileId: string },
): Promise<{ cardKey: string; achievementId: string; season: string; step: number; grantedAt: Date }[]> {
  return db
    .select({
      cardKey: gameCardGrant.cardKey,
      achievementId: gameCardGrant.achievementId,
      season: gameCardGrant.season,
      step: gameCardGrant.step,
      grantedAt: gameCardGrant.grantedAt,
    })
    .from(gameCardGrant)
    .where(
      and(
        eq(gameCardGrant.tenantId, key.tenantId),
        eq(gameCardGrant.programCountry, key.programCountry),
        eq(gameCardGrant.profileId, key.profileId),
      ),
    )
    .orderBy(gameCardGrant.grantedAt);
}

/** Soma Pontos no Ranking dos períodos (mês e ano). */
export async function addPeriodPoints(
  tx: Pick<Database, 'insert'>,
  key: GameProgramKey & { profileId: string; periods: readonly string[]; points: number; fullHits?: number },
): Promise<void> {
  if (key.points <= 0) return;
  for (const period of key.periods) {
    await tx
      .insert(gamePeriodPoints)
      .values({
        tenantId: key.tenantId,
        programCountry: key.programCountry,
        period,
        profileId: key.profileId,
        points: key.points,
        fullHits: key.fullHits ?? 0,
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
          reachedAt: sql`now()` as never,
          updatedAt: sql`now()` as never,
        },
      });
  }
}

/**
 * Sinal real de participação: entra uma vez por ação e referência (a partida, a enquete). Os Pontos são cortados pelo
 * teto diário (`dailyCap`), somando o que o Perfil já ganhou no dia em participação. Devolve null se já tinha entrado.
 */
export async function recordParticipation(
  tx: Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>,
  key: GameProgramKey & {
    profileId: string;
    day: string;
    action: 'watched' | 'poll' | 'trivia' | 'consumption';
    ref: string;
    points: number;
    dailyCap: number;
  },
): Promise<{ points: number } | null> {
  // trava o dia do Perfil: duas ações ao mesmo tempo não passam juntas do teto
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`game.participation:${key.tenantId}:${key.programCountry}:${key.profileId}:${key.day}`}, 0))`,
  );
  const [today] = await tx.execute<{ n: number }>(sql`
    select coalesce(sum(points), 0)::int as n from game.participation_daily
     where tenant_id = ${key.tenantId} and program_country = ${key.programCountry}
       and profile_id = ${key.profileId} and day = ${key.day}::date`);
  const points = Math.max(0, Math.min(key.points, key.dailyCap - (today?.n ?? 0)));
  const inserted = await tx
    .insert(gameParticipationDaily)
    .values({
      tenantId: key.tenantId,
      programCountry: key.programCountry,
      profileId: key.profileId,
      day: key.day,
      action: key.action,
      ref: key.ref,
      points,
    })
    .onConflictDoNothing()
    .returning({ points: gameParticipationDaily.points });
  if (!inserted.length) return null;
  await appendGameAudit(tx, {
    tenantId: key.tenantId,
    programCountry: key.programCountry,
    profileId: key.profileId,
    kind: 'participation.counted',
    subject: `${key.action}:${key.ref}`,
    sourceEvent: key.ref,
    detail: { points, day: key.day },
  });
  return { points };
}

export interface GameWatchedCandidate {
  tenantId: string;
  profileId: string;
  profileCountry: string;
  eventId: string;
  sport: string;
  startsAt: Date;
  presentMs: number;
  eventMs: number;
}

/**
 * Perfis que assistiram a jogos encerrados entre `since` e `until` (a janela de correção), nos clientes com a
 * Gamificação ligada, e que ainda não ganharam o "jogo assistido" daquele jogo.
 *
 * - A duração é a **real**: do primeiro `live` ao `finished` do `core.event_state_log`; sem registro, o horário
 *   oficial e o fim previsto. Vôlei 3x0, luta que acaba no 1º round e jogo atrasado contam certo.
 * - A presença é recortada a esse intervalo, e o corte (`minFraction`) é feito no SQL.
 * - Parte da presença (índice por `last_seen_at`), não do evento: a consulta roda a cada minuto e não pode varrer a
 *   base histórica de jogos.
 */
export async function watchedCandidates(
  db: Pick<Database, 'execute'>,
  window: { since: Date; until: Date; minFraction: number },
): Promise<GameWatchedCandidate[]> {
  // a presença de um jogo que terminou em `since` pode ter acabado até 12 h antes (jogo longo, F1 com bandeira vermelha)
  const presenceSince = new Date(window.since.getTime() - 12 * 3_600_000);
  const rows = await db.execute<{
    tenant_id: string;
    profile_id: string;
    country: string;
    event_id: string;
    sport: string;
    starts_at: string | Date;
    present_ms: string;
    event_ms: string;
  }>(sql`
    with recent as (
      select distinct w.event_id from fan.presence_window w
       where w.last_seen_at >= ${presenceSince.toISOString()}::timestamptz
    ), ev as (
      select e.id, e.sport, e.starts_at,
             coalesce((select min(l.occurred_at) from core.event_state_log l
                        where l.event_id = e.id and l.to_status = 'live'), e.starts_at) as real_start,
             coalesce((select max(l.occurred_at) from core.event_state_log l
                        where l.event_id = e.id and l.to_status = 'finished'), e.ends_at_expected) as real_end
        from recent r join core.event e on e.id = r.event_id
       where e.status = 'finished'
    ), done as (
      select * from ev
       where real_end >= ${window.since.toISOString()}::timestamptz
         and real_end <= ${window.until.toISOString()}::timestamptz
         and real_end > real_start
    )
    select w.tenant_id, w.profile_id, p.country, d.id as event_id, d.sport, d.starts_at,
           sum(greatest(0, extract(epoch from (least(w.last_seen_at, d.real_end) - greatest(w.started_at, d.real_start))) * 1000))::bigint as present_ms,
           (extract(epoch from (d.real_end - d.real_start)) * 1000)::bigint as event_ms
      from done d
      join fan.presence_window w on w.event_id = d.id
      join fan.profile p on p.tenant_id = w.tenant_id and p.id = w.profile_id
                        and p.deleted_at is null and p.age_band <> 'under13'
      join api.tenant t on t.id = w.tenant_id and t.status = 'active' and 'gamification' = any(t.modules)
     where not exists (
         select 1 from game.participation_daily pd
          where pd.tenant_id = w.tenant_id and pd.profile_id = w.profile_id
            and pd.action = 'watched' and pd.ref = 'event:' || d.id::text)
     group by w.tenant_id, w.profile_id, p.country, d.id, d.sport, d.starts_at, d.real_start, d.real_end
    having sum(greatest(0, extract(epoch from (least(w.last_seen_at, d.real_end) - greatest(w.started_at, d.real_start)))))
           >= ${window.minFraction} * extract(epoch from (d.real_end - d.real_start))`);
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    profileId: r.profile_id,
    profileCountry: r.country,
    eventId: r.event_id,
    sport: r.sport,
    startsAt: new Date(r.starts_at),
    presentMs: Number(r.present_ms),
    eventMs: Number(r.event_ms),
  }));
}

export interface GameAchievementEarners {
  /** Quantos Perfis do programa têm o primeiro Degrau (todos, inclusive os privados: é só um número). */
  total: number;
  /** Alguns que deixaram as Conquistas visíveis, do Degrau mais alto e mais recente. */
  earners: { profileId: string; nickname: string | null; avatarUrl: string | null; step: number }[];
}

/**
 * "Quem já ganhou" (decisão de 16/11): Perfis do mesmo cliente e país que chegaram ao primeiro Degrau. Só aparece
 * quem é adulto, não está com a faixa congelada e deixou `badges` público; a foto, só com `avatar` público e liberada
 * pela moderação de imagem. Menor nunca aparece (#1107).
 */
export async function readAchievementEarners(
  db: Pick<Database, 'execute'>,
  key: GameProgramKey & { achievementId: string; season: string; limit: number },
): Promise<GameAchievementEarners> {
  const [total] = await db.execute<{ n: string }>(sql`
    select count(*) as n from game.step_grant
     where tenant_id = ${key.tenantId} and program_country = ${key.programCountry}
       and achievement_id = ${key.achievementId} and season = ${key.season} and step = 1`);
  const rows = await db.execute<{
    profile_id: string;
    nickname: string | null;
    avatar_url: string | null;
    step: number;
  }>(sql`
    select g.profile_id, p.nickname,
           case when p.visibility->>'avatar' = 'public' and p.avatar_status = 'visible' then p.avatar_url end as avatar_url,
           max(g.step)::int as step
      from game.step_grant g
      join fan.profile p on p.tenant_id = g.tenant_id and p.id = g.profile_id
     where g.tenant_id = ${key.tenantId} and g.program_country = ${key.programCountry}
       and g.achievement_id = ${key.achievementId} and g.season = ${key.season}
       and p.deleted_at is null and p.age_band = '18plus' and p.age_frozen_at is null
       and p.visibility->>'badges' = 'public'
     group by g.profile_id, p.nickname, p.visibility, p.avatar_status, p.avatar_url
     order by max(g.step) desc, max(g.granted_at) desc
     limit ${key.limit}`);
  return {
    total: Number(total?.n ?? 0),
    earners: rows.map((r) => ({
      profileId: r.profile_id,
      nickname: r.nickname,
      avatarUrl: r.avatar_url,
      step: r.step,
    })),
  };
}
