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
